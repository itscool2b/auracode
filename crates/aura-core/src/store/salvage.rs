//! Copying whatever can still be read out of a damaged database into a new one.
//!
//! First `VACUUM INTO`: it rebuilds every table and index from what their b-trees hold, so unused
//! ("leaked") pages and broken free lists disappear, and it keeps `user_version`. It gives up at the
//! first page it can't read, though, so when it fails the tables are copied one by one, row by row,
//! and a read error skips ahead to the next readable rowid instead of abandoning the table. Rows
//! whose parent row was lost are dropped at the end, so the copy passes the foreign key check every
//! later migration runs.
//!
//! The damaged file is only ever read (read-only connection, no checkpoint on close), so it can be
//! quarantined byte for byte afterwards.

use std::collections::HashMap;
use std::path::Path;

use rusqlite::config::DbConfig;
use rusqlite::types::{ToSqlOutput, ValueRef};
use rusqlite::{Connection, ErrorCode, OpenFlags, Statement};

use super::{BUSY_TIMEOUT, Salvage, close_without_checkpoint, remove_with_sidecars};
use crate::error::{CoreError, Result};
use crate::fsutil;

/// Passes of the orphan cleanup. Each pass drops the rows whose parent the previous pass dropped,
/// so this bounds the depth of foreign key chains it untangles (the schema's deepest is 4).
const MAX_ORPHAN_PASSES: usize = 16;

/// Copies everything readable from the database at `damaged` into a new database at `out` and says
/// how much made it. Errors only mean `out` could not be written (disk full, no permission): the
/// caller then leaves everything as it was. Nothing is left at `out` when nothing could be read.
pub(super) fn salvage(damaged: &Path, out: &Path) -> Result<Salvage> {
    remove_with_sidecars(out);
    let source = open_source(damaged)?;
    let copied = match vacuum_into(&source, out) {
        Ok(()) => Ok(Salvage::Complete),
        Err(error) => {
            tracing::info!(%error, "VACUUM INTO could not copy the damaged database; copying it table by table");
            // A failed VACUUM INTO leaves an empty or partial file behind.
            remove_with_sidecars(out);
            copy_tables(&source, out)
        }
    };
    close_without_checkpoint(source);
    let salvage = match copied {
        Ok(salvage) => salvage,
        Err(error) => {
            remove_with_sidecars(out);
            return Err(error);
        }
    };
    if salvage == Salvage::Nothing {
        remove_with_sidecars(out);
    } else if let Err(source) = fsutil::sync_file(out) {
        // SQLite doesn't sync a VACUUM INTO target, and the copy below ran with synchronous=OFF.
        remove_with_sidecars(out);
        return Err(CoreError::Io {
            path: out.to_path_buf(),
            source,
        });
    }
    Ok(salvage)
}

/// Read-only, so salvaging never writes to the damaged file, and no checkpoint on close, so its
/// `-wal` stays as it was. The path is used as is (no URI parsing).
fn open_source(path: &Path) -> Result<Connection> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, true)?;
    conn.busy_timeout(BUSY_TIMEOUT)?;
    Ok(conn)
}

fn vacuum_into(source: &Connection, out: &Path) -> rusqlite::Result<()> {
    // Absolute, so a relative name can never be taken for a "file:" URI.
    let invalid = || rusqlite::Error::InvalidPath(out.to_path_buf());
    let target = std::path::absolute(out).map_err(|_| invalid())?;
    let target = target.to_str().ok_or_else(invalid)?;
    source.execute("VACUUM INTO ?1", [target]).map(|_| ())
}

/// Errors that mean the new database can't be written (disk full, no permission, I/O), which stop
/// the salvage. Anything else, such as a statement the new database rejects, costs only the table,
/// index, or row it was about.
fn is_write_failure(error: &rusqlite::Error) -> bool {
    matches!(
        error.sqlite_error_code(),
        Some(
            ErrorCode::DiskFull
                | ErrorCode::SystemIoFailure
                | ErrorCode::CannotOpen
                | ErrorCode::ReadOnly
                | ErrorCode::PermissionDenied
                | ErrorCode::OutOfMemory
                | ErrorCode::NoLargeFileSupport
                | ErrorCode::DatabaseBusy
                | ErrorCode::DatabaseLocked
                | ErrorCode::DatabaseCorrupt
                | ErrorCode::NotADatabase
        )
    )
}

/// One row of `sqlite_schema` that carries SQL.
struct SchemaEntry {
    kind: String,
    name: String,
    sql: String,
}

/// What `PRAGMA table_list` says about a table.
struct TableKind {
    /// `table`, `virtual`, or `shadow` (a virtual table's storage).
    kind: String,
    without_rowid: bool,
}

/// Rows of a table copied, and whether any could not be read or written.
struct TableCopy {
    rows: u64,
    complete: bool,
}

fn copy_tables(source: &Connection, out: &Path) -> Result<Salvage> {
    // With writable_schema on, SQLite skips schema entries it can't parse instead of failing every
    // statement, so one malformed CREATE doesn't hide the other tables.
    if let Err(error) = source.pragma_update(None, "writable_schema", true) {
        tracing::debug!(%error, "could not relax schema parsing for the salvage");
    }
    let Ok(version) = source.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
    else {
        // The header itself is unreadable, and with it everything else.
        return Ok(Salvage::Nothing);
    };
    let schema = read_schema(source);
    let kinds = table_kinds(source);
    let tables: Vec<&SchemaEntry> = schema
        .iter()
        .filter(|entry| {
            entry.kind == "table"
                && !entry.name.starts_with("sqlite_")
                && !is_shadow(&entry.name, &kinds, &schema)
        })
        .collect();
    if tables.is_empty() {
        return Ok(Salvage::Nothing);
    }

    let mut conn = Connection::open(out)?;
    // The bundled SQLite turns foreign keys on by default; off, rows can arrive in any order and
    // orphans are dealt with at the end.
    conn.pragma_update(None, "foreign_keys", false)?;
    // A scratch file until it is complete; `salvage` syncs it once at the end.
    conn.pragma_update(None, "synchronous", "OFF")?;
    let tx = conn.transaction()?;
    let mut rows = 0u64;
    let mut lost: Vec<&str> = Vec::new();
    for table in &tables {
        if let Err(error) = tx.execute_batch(&table.sql) {
            if is_write_failure(&error) {
                return Err(error.into());
            }
            tracing::warn!(%error, table = %table.name, "could not recreate a table from the damaged database");
            lost.push(&table.name);
            continue;
        }
        let copy = copy_rows(source, &tx, table, &kinds)?;
        rows += copy.rows;
        if !copy.complete {
            lost.push(&table.name);
        }
    }
    // Indexes after the rows (one pass each is faster) and triggers last, so none fire on copied rows.
    for kind in ["index", "view", "trigger"] {
        for entry in schema.iter().filter(|entry| entry.kind == kind) {
            if let Err(error) = tx.execute_batch(&entry.sql) {
                if is_write_failure(&error) {
                    return Err(error.into());
                }
                tracing::warn!(%error, name = %entry.name, kind, "could not recreate a schema object from the damaged database");
            }
        }
    }
    copy_sequences(source, &tx)?;
    let orphaned = drop_orphans(&tx)?;
    tx.pragma_update(None, "user_version", version)?;
    tx.commit()?;
    conn.close().map_err(|(_, error)| error)?;

    if rows == 0 && !lost.is_empty() {
        return Ok(Salvage::Nothing);
    }
    let incomplete: Vec<String> = tables
        .iter()
        .map(|table| table.name.as_str())
        .filter(|name| lost.contains(name) || orphaned.iter().any(|dropped| dropped == name))
        .map(str::to_owned)
        .collect();
    Ok(if incomplete.is_empty() {
        Salvage::Complete
    } else {
        Salvage::Partial { tables: incomplete }
    })
}

/// The schema entries that carry SQL, in creation order. Whatever was read before an unreadable
/// schema page is kept.
fn read_schema(source: &Connection) -> Vec<SchemaEntry> {
    let mut entries = Vec::new();
    let Ok(mut stmt) =
        source.prepare("SELECT type, name, sql FROM sqlite_schema WHERE sql IS NOT NULL")
    else {
        return entries;
    };
    let Ok(mut rows) = stmt.query([]) else {
        return entries;
    };
    while let Ok(Some(row)) = rows.next() {
        if let (Ok(kind), Ok(name), Ok(sql)) = (row.get(0), row.get(1), row.get(2)) {
            entries.push(SchemaEntry { kind, name, sql });
        }
    }
    entries
}

/// `PRAGMA table_list` for the main schema; empty if it can't be read.
fn table_kinds(source: &Connection) -> HashMap<String, TableKind> {
    let mut kinds = HashMap::new();
    let Ok(mut stmt) =
        source.prepare("SELECT name, type, wr FROM pragma_table_list WHERE schema = 'main'")
    else {
        return kinds;
    };
    let Ok(mut rows) = stmt.query([]) else {
        return kinds;
    };
    while let Ok(Some(row)) = rows.next() {
        if let (Ok(name), Ok(kind), Ok(wr)) = (
            row.get::<_, String>(0),
            row.get::<_, String>(1),
            row.get::<_, i64>(2),
        ) {
            kinds.insert(
                name,
                TableKind {
                    kind,
                    without_rowid: wr != 0,
                },
            );
        }
    }
    kinds
}

/// Shadow tables hold a virtual table's data and are recreated (and filled) through it.
fn is_shadow(name: &str, kinds: &HashMap<String, TableKind>, schema: &[SchemaEntry]) -> bool {
    match kinds.get(name) {
        Some(kind) => kind.kind == "shadow",
        // table_list leaves out what it can't parse. SQLite names shadow tables `<vtab>_<suffix>`.
        None => schema.iter().any(|entry| {
            entry.kind == "table"
                && is_virtual(entry, kinds)
                && name
                    .strip_prefix(entry.name.as_str())
                    .is_some_and(|rest| rest.starts_with('_'))
        }),
    }
}

fn is_virtual(entry: &SchemaEntry, kinds: &HashMap<String, TableKind>) -> bool {
    match kinds.get(&entry.name) {
        Some(kind) => kind.kind == "virtual",
        None => entry
            .sql
            .trim_start()
            .get(.."CREATE VIRTUAL TABLE".len())
            .is_some_and(|start| start.eq_ignore_ascii_case("CREATE VIRTUAL TABLE")),
    }
}

/// `"name"`, with embedded quotes doubled.
fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// The columns a copy reads and writes: everything but hidden columns (a virtual table's own
/// columns) and generated ones (which can't be inserted). `None` when the table's definition can't
/// be read.
fn columns_of(source: &Connection, table: &str) -> Option<Vec<String>> {
    let mut stmt = source
        .prepare("SELECT name, hidden FROM pragma_table_xinfo(?1)")
        .ok()?;
    let mut rows = stmt.query([table]).ok()?;
    let mut columns = Vec::new();
    while let Some(row) = rows.next().ok()? {
        let name: String = row.get(0).ok()?;
        let hidden: i64 = row.get(1).ok()?;
        if hidden == 0 {
            columns.push(name);
        }
    }
    (!columns.is_empty()).then_some(columns)
}

fn copy_rows(
    source: &Connection,
    out: &Connection,
    table: &SchemaEntry,
    kinds: &HashMap<String, TableKind>,
) -> Result<TableCopy> {
    let unreadable = TableCopy {
        rows: 0,
        complete: false,
    };
    let Some(columns) = columns_of(source, &table.name) else {
        return Ok(unreadable);
    };
    let quoted = quote(&table.name);
    let list = columns
        .iter()
        .map(|column| quote(column))
        .collect::<Vec<_>>()
        .join(", ");
    let params = (1..=columns.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ");
    // A virtual table settles conflicts itself (FTS5 has no unique key to collide on). Elsewhere a
    // duplicate can only come from an index the damage broke; the first copy wins.
    let verb = if is_virtual(table, kinds) {
        "INSERT"
    } else {
        "INSERT OR IGNORE"
    };
    let mut insert = match out.prepare(&format!("{verb} INTO {quoted} ({list}) VALUES ({params})"))
    {
        Ok(stmt) => stmt,
        Err(error) if is_write_failure(&error) => return Err(error.into()),
        Err(error) => {
            tracing::warn!(%error, table = %table.name, "could not prepare the copy of a table");
            return Ok(unreadable);
        }
    };
    let has_rowid = match kinds.get(&table.name) {
        Some(kind) => !kind.without_rowid,
        None => source
            .prepare(&format!("SELECT rowid FROM {quoted} LIMIT 0"))
            .is_ok(),
    };
    let mut copy = TableCopy {
        rows: 0,
        complete: true,
    };
    if has_rowid {
        copy_by_rowid(
            source,
            &quoted,
            &list,
            columns.len(),
            &mut insert,
            &mut copy,
        )?;
    } else {
        copy_in_order(
            source,
            &quoted,
            &list,
            columns.len(),
            &mut insert,
            &mut copy,
        )?;
    }
    Ok(copy)
}

/// Inserts the `count` columns of `row` starting at `first`. A row that can't be read or that the
/// new database rejects is skipped and makes the copy incomplete; only a write failure is an error.
fn insert_row(
    insert: &mut Statement<'_>,
    row: &rusqlite::Row<'_>,
    first: usize,
    count: usize,
    copy: &mut TableCopy,
) -> Result<()> {
    let values: rusqlite::Result<Vec<ValueRef<'_>>> = (first..first + count)
        .map(|index| row.get_ref(index))
        .collect();
    let Ok(values) = values else {
        copy.complete = false;
        return Ok(());
    };
    let values = values.into_iter().map(ToSqlOutput::Borrowed);
    match insert.execute(rusqlite::params_from_iter(values)) {
        Ok(changed) => {
            copy.rows += changed as u64;
            Ok(())
        }
        Err(error) if is_write_failure(&error) => Err(error.into()),
        Err(error) => {
            tracing::debug!(%error, "skipping a row the new database rejected");
            copy.complete = false;
            Ok(())
        }
    }
}

/// How a forward scan ended.
enum Scan {
    Finished,
    /// A row at or after `at` could not be read (`at` is one past the last row read, or the rowid
    /// the scan started from when it read nothing).
    Unreadable {
        at: i64,
    },
}

/// Copies a rowid table in rowid order. When a page can't be read, the rows on it are lost, but
/// the copy seeks past it and carries on, so one bad page costs one page of rows, not the rest of
/// the table.
fn copy_by_rowid(
    source: &Connection,
    quoted: &str,
    list: &str,
    count: usize,
    insert: &mut Statement<'_>,
    copy: &mut TableCopy,
) -> Result<()> {
    let select = format!("SELECT rowid, {list} FROM {quoted} WHERE rowid >= ?1 ORDER BY rowid");
    let seek = format!("SELECT rowid FROM {quoted} WHERE rowid >= ?1 ORDER BY rowid LIMIT 1");
    let mut next = i64::MIN;
    loop {
        match scan_from(source, &select, next, count, insert, copy)? {
            Scan::Finished => return Ok(()),
            Scan::Unreadable { at } => {
                copy.complete = false;
                match next_readable(source, &seek, at) {
                    Some(resume) => next = resume,
                    None => return Ok(()),
                }
            }
        }
    }
}

fn scan_from(
    source: &Connection,
    select: &str,
    next: i64,
    count: usize,
    insert: &mut Statement<'_>,
    copy: &mut TableCopy,
) -> Result<Scan> {
    let Ok(mut stmt) = source.prepare(select) else {
        return Ok(Scan::Unreadable { at: next });
    };
    let Ok(mut rows) = stmt.query([next]) else {
        return Ok(Scan::Unreadable { at: next });
    };
    let mut at = next;
    loop {
        match rows.next() {
            Ok(Some(row)) => {
                let Ok(rowid) = row.get::<_, i64>(0) else {
                    return Ok(Scan::Unreadable { at });
                };
                insert_row(insert, row, 1, count, copy)?;
                match rowid.checked_add(1) {
                    Some(following) => at = following,
                    None => return Ok(Scan::Finished),
                }
            }
            Ok(None) => return Ok(Scan::Finished),
            Err(_) => return Ok(Scan::Unreadable { at }),
        }
    }
}

/// The first rowid after `at` that a seek can reach again, or `None` when nothing after it can be
/// read. A seek for rowid `x` fails while it lands on the damaged page and works once `x` is past
/// it, so this steps out exponentially until a seek works, then bisects back to the first one that
/// does, so readable rows just past the damage aren't skipped.
fn next_readable(source: &Connection, seek: &str, at: i64) -> Option<i64> {
    // Some(found) when the seek worked (found: the first rowid >= from, if any); None when it failed.
    let probe = |from: i64| match source.query_row(seek, [from], |row| row.get::<_, i64>(0)) {
        Ok(rowid) => Some(Some(rowid)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Some(None),
        Err(_) => None,
    };
    let mut low = at;
    let mut step: i64 = 1;
    let (mut high, mut found) = loop {
        let candidate = low.saturating_add(step);
        if candidate == low {
            return None;
        }
        match probe(candidate) {
            Some(found) => break (candidate, found),
            None => {
                low = candidate;
                step = step.saturating_mul(2);
            }
        }
    };
    // Invariant: the seek for `low` failed (or `low` is the unreadable row), the seek for `high`
    // worked and found `found`. i128 because `high - low` can exceed i64::MAX.
    while i128::from(high) - i128::from(low) > 1 {
        let mid = ((i128::from(low) + i128::from(high)) / 2) as i64;
        match probe(mid) {
            Some(result) => {
                high = mid;
                found = result;
            }
            None => low = mid,
        }
    }
    found
}

/// Copies a table without rowids (nothing to seek by) up to the first page it can't read.
fn copy_in_order(
    source: &Connection,
    quoted: &str,
    list: &str,
    count: usize,
    insert: &mut Statement<'_>,
    copy: &mut TableCopy,
) -> Result<()> {
    let Ok(mut stmt) = source.prepare(&format!("SELECT {list} FROM {quoted}")) else {
        copy.complete = false;
        return Ok(());
    };
    let Ok(mut rows) = stmt.query([]) else {
        copy.complete = false;
        return Ok(());
    };
    loop {
        match rows.next() {
            Ok(Some(row)) => insert_row(insert, row, 0, count, copy)?,
            Ok(None) => return Ok(()),
            Err(_) => {
                copy.complete = false;
                return Ok(());
            }
        }
    }
}

/// AUTOINCREMENT counters, so the copy never hands out an id the damaged database already used.
/// Copying rows with their ids already moved each counter to the largest id copied; this raises it
/// to the old value where that was higher (rows deleted from the end of a table).
fn copy_sequences(source: &Connection, out: &Connection) -> Result<()> {
    let Ok(mut stmt) = source.prepare("SELECT name, seq FROM sqlite_sequence") else {
        // No AUTOINCREMENT table, or the counters are unreadable.
        return Ok(());
    };
    let Ok(mut rows) = stmt.query([]) else {
        return Ok(());
    };
    while let Ok(Some(row)) = rows.next() {
        let (Ok(name), Ok(seq)) = (row.get::<_, String>(0), row.get::<_, i64>(1)) else {
            continue;
        };
        let raised = out
            .execute(
                "UPDATE sqlite_sequence SET seq = ?2 WHERE name = ?1 AND seq < ?2",
                rusqlite::params![name, seq],
            )
            .and_then(|_| {
                out.execute(
                    "INSERT INTO sqlite_sequence (name, seq) SELECT ?1, ?2 \
                     WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = ?1)",
                    rusqlite::params![name, seq],
                )
            });
        match raised {
            Ok(_) => {}
            Err(error) if is_write_failure(&error) => return Err(error.into()),
            Err(error) => {
                tracing::debug!(%error, table = %name, "could not copy an AUTOINCREMENT counter")
            }
        }
    }
    Ok(())
}

/// Drops rows whose parent row didn't survive (a chat whose project was on a lost page, then that
/// chat's events), pass after pass, until `foreign_key_check` is clean. They can't be reached from
/// the UI, and leaving them would make every later migration's foreign key check fail. They are
/// still in the quarantined file. Returns the tables that lost rows this way.
fn drop_orphans(out: &Connection) -> Result<Vec<String>> {
    let mut dropped: Vec<String> = Vec::new();
    for _ in 0..MAX_ORPHAN_PASSES {
        let tables: rusqlite::Result<Vec<String>> = out
            .prepare("SELECT DISTINCT \"table\" FROM pragma_foreign_key_check")
            .and_then(|mut stmt| stmt.query_map([], |row| row.get(0))?.collect());
        let tables = match tables {
            Ok(tables) => tables,
            Err(error) if is_write_failure(&error) => return Err(error.into()),
            Err(error) => {
                tracing::warn!(%error, "could not check the salvaged rows' references");
                break;
            }
        };
        if tables.is_empty() {
            break;
        }
        let mut deleted = 0;
        for table in tables {
            let sql = format!(
                "DELETE FROM {} WHERE rowid IN (SELECT rowid FROM pragma_foreign_key_check(?1))",
                quote(&table)
            );
            match out.execute(&sql, [&table]) {
                Ok(count) => {
                    deleted += count;
                    if count > 0 && !dropped.contains(&table) {
                        dropped.push(table);
                    }
                }
                Err(error) if is_write_failure(&error) => return Err(error.into()),
                // A table without rowids can't be targeted this way; its orphans stay.
                Err(error) => {
                    tracing::warn!(%error, %table, "could not drop rows with broken references")
                }
            }
        }
        if deleted == 0 {
            break;
        }
    }
    Ok(dropped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    struct Fixture {
        _dir: tempfile::TempDir,
        db: PathBuf,
        out: PathBuf,
    }

    fn fixture() -> Fixture {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = dir.path().join("aura.db");
        let out = dir.path().join("aura.db.salvage.partial");
        Fixture { _dir: dir, db, out }
    }

    /// A v1 database (the real schema) with two projects, three chats, and `events` events spread
    /// over the chats, closed so every page is in the main file.
    fn populated(f: &Fixture, events: i64) {
        let (store, _) =
            super::super::Store::open_at(&f.db, &f.db.parent().expect("parent").join("backups"))
                .expect("create");
        let conn = store.conn();
        let tx = conn.unchecked_transaction().expect("tx");
        for (project, name) in [("p1", "Alpha"), ("p2", "Beta")] {
            tx.execute(
                "INSERT INTO projects (id, name, created_at, updated_at, device_id) VALUES (?1, ?2, 1, 1, 'd')",
                [project, name],
            )
            .expect("project");
        }
        for (chat, project) in [("c1", "p1"), ("c2", "p1"), ("c3", "p2")] {
            tx.execute(
                "INSERT INTO chats (id, project_id, created_at, updated_at, device_id) VALUES (?1, ?2, 1, 1, 'd')",
                [chat, project],
            )
            .expect("chat");
        }
        for seq in 0..events {
            let chat = ["c1", "c2", "c3"][usize::try_from(seq % 3).expect("small")];
            tx.execute(
                "INSERT INTO events (id, chat_id, seq, kind, payload, created_at, device_id) \
                 VALUES (?1, ?2, ?3, 'message_delta', ?4, 1, 'd')",
                rusqlite::params![
                    format!("e{seq:05}"),
                    chat,
                    seq,
                    format!("{{\"text\": \"padding padding padding {seq}\"}}")
                ],
            )
            .expect("event");
        }
        tx.execute(
            "INSERT INTO message_fts (chat_id, message_id, text) VALUES ('c1', 'm1', 'crème brûlée recipe')",
            [],
        )
        .expect("fts");
        tx.commit().expect("commit");
    }

    fn raw(path: &Path) -> Connection {
        Connection::open(path).expect("raw open")
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .expect("count")
    }

    fn quick_check(conn: &Connection) -> String {
        conn.query_row("PRAGMA quick_check", [], |row| row.get(0))
            .expect("quick_check")
    }

    /// Page numbers of a table's pages of one kind in key order (`dbstat`'s path), filtered by a
    /// LIKE pattern on that path.
    fn pages_like(path: &Path, name: &str, kind: &str, like: &str) -> Vec<i64> {
        let conn = raw(path);
        let mut stmt = conn
            .prepare(
                "SELECT pageno FROM dbstat WHERE name = ?1 AND pagetype = ?2 AND path LIKE ?3 ORDER BY path",
            )
            .expect("dbstat");
        stmt.query_map([name, kind, like], |row| row.get(0))
            .expect("pages")
            .map(|row| row.expect("page"))
            .collect()
    }

    fn pages(path: &Path, name: &str, kind: &str) -> Vec<i64> {
        pages_like(path, name, kind, "%")
    }

    /// Overwrites the start of page `page` (1-based) so SQLite can't parse it.
    fn smash(path: &Path, page: i64) {
        let page_size: i64 = raw(path)
            .query_row("PRAGMA page_size", [], |row| row.get(0))
            .expect("page_size");
        let mut bytes = fs::read(path).expect("read");
        let start = usize::try_from((page - 1) * page_size).expect("offset");
        bytes[start..start + 16].fill(0xA5);
        fs::write(path, bytes).expect("write");
    }

    /// A read-only connection to a WAL database creates an empty `-wal` (and `-shm`) when none
    /// exists, and can't delete them; nothing may be written into the WAL, though.
    fn nothing_written_to_the_wal(path: &Path) -> bool {
        fs::metadata(fsutil::with_suffix(path, "-wal")).map_or(true, |meta| meta.len() == 0)
    }

    #[test]
    fn leaked_pages_are_dropped_and_everything_else_is_kept() {
        let f = fixture();
        populated(&f, 50);
        {
            let conn = raw(&f.db);
            conn.execute_batch(
                "CREATE TABLE junk (x); WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 300) \
                 INSERT INTO junk SELECT printf('%0200d', i) FROM n; \
                 PRAGMA writable_schema = ON; DELETE FROM sqlite_schema WHERE name = 'junk'; PRAGMA writable_schema = OFF;",
            )
            .expect("leak the pages of a dropped table");
        }
        let check = quick_check(&raw(&f.db));
        assert!(check.contains("never used"), "{check}");
        let before = fs::read(&f.db).expect("read");

        assert_eq!(salvage(&f.db, &f.out).expect("salvage"), Salvage::Complete);
        assert_eq!(
            fs::read(&f.db).expect("read"),
            before,
            "the source is only read"
        );
        assert!(nothing_written_to_the_wal(&f.db));
        let copy = raw(&f.out);
        assert_eq!(quick_check(&copy), "ok");
        assert_eq!(count(&copy, "projects"), 2);
        assert_eq!(count(&copy, "events"), 50);
        let version: i64 = copy
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version");
        assert_eq!(version, 1, "user_version is kept");
    }

    #[test]
    fn one_bad_leaf_costs_only_its_rows() {
        let f = fixture();
        populated(&f, 3000);
        let leaves = pages(&f.db, "events", "leaf");
        assert!(leaves.len() > 10, "{leaves:?}");
        smash(&f.db, leaves[leaves.len() / 2]);
        let before = fs::read(&f.db).expect("read");

        let salvage = salvage(&f.db, &f.out).expect("salvage");
        assert_eq!(
            salvage,
            Salvage::Partial {
                tables: vec!["events".into()]
            }
        );
        assert_eq!(fs::read(&f.db).expect("read"), before);
        let copy = raw(&f.out);
        assert_eq!(quick_check(&copy), "ok");
        assert_eq!(count(&copy, "projects"), 2);
        assert_eq!(count(&copy, "chats"), 3);
        let events = count(&copy, "events");
        // One leaf holds a few dozen of these rows; everything before and after it survives.
        assert!((2800..3000).contains(&events), "{events} events kept");
        let first_and_last: i64 = copy
            .query_row(
                "SELECT count(*) FROM events WHERE id IN ('e00000', 'e02999')",
                [],
                |row| row.get(0),
            )
            .expect("ends");
        assert_eq!(
            first_and_last, 2,
            "rows past the bad page were reached by seeking past it"
        );
        let fts: i64 = copy
            .query_row(
                "SELECT count(*) FROM message_fts WHERE message_fts MATCH 'creme'",
                [],
                |row| row.get(0),
            )
            .expect("fts");
        assert_eq!(
            fts, 1,
            "the full-text index was rebuilt through its virtual table"
        );
        let version: i64 = copy
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("version");
        assert_eq!(version, 1);
    }

    #[test]
    fn a_bad_first_leaf_still_lets_the_rest_of_the_table_through() {
        let f = fixture();
        populated(&f, 3000);
        // In key order, so this is the leaf holding the smallest rowids, where every scan starts.
        let leaves = pages(&f.db, "events", "leaf");
        smash(&f.db, leaves[0]);
        let salvage = salvage(&f.db, &f.out).expect("salvage");
        assert!(matches!(salvage, Salvage::Partial { .. }), "{salvage:?}");
        let events = count(&raw(&f.out), "events");
        assert!((2800..3000).contains(&events), "{events} events kept");
    }

    #[test]
    fn a_bad_overflow_page_costs_only_its_row() {
        let f = fixture();
        populated(&f, 10);
        {
            let conn = raw(&f.db);
            for n in 0..5 {
                conn.execute(
                    "INSERT INTO events (id, chat_id, seq, kind, payload, created_at, device_id) \
                     VALUES (?1, 'c1', ?2, 'tool_update', ?3, 1, 'd')",
                    rusqlite::params![format!("big{n}"), 100 + n, "x".repeat(20_000)],
                )
                .expect("big event");
            }
        }
        // The first page of a chain: its next-page pointer is what SQLite follows (and rejects),
        // while the last page's pointer is never read.
        let overflow = pages_like(&f.db, "events", "overflow", "%+000000");
        assert!(overflow.len() >= 5, "{overflow:?}");
        smash(&f.db, overflow[overflow.len() / 2]);
        let salvage = salvage(&f.db, &f.out).expect("salvage");
        assert_eq!(
            salvage,
            Salvage::Partial {
                tables: vec!["events".into()]
            }
        );
        let copy = raw(&f.out);
        assert_eq!(count(&copy, "events"), 14, "15 events, one unreadable");
    }

    #[test]
    fn rows_whose_parent_was_lost_are_dropped() {
        let f = fixture();
        populated(&f, 30);
        let chats_root: i64 = raw(&f.db)
            .query_row(
                "SELECT rootpage FROM sqlite_schema WHERE name = 'chats'",
                [],
                |row| row.get(0),
            )
            .expect("rootpage");
        smash(&f.db, chats_root);
        let salvage = salvage(&f.db, &f.out).expect("salvage");
        assert_eq!(
            salvage,
            Salvage::Partial {
                tables: vec!["chats".into(), "events".into()]
            }
        );
        let copy = raw(&f.out);
        assert_eq!(
            count(&copy, "projects"),
            2,
            "parents above the damage are kept"
        );
        assert_eq!(count(&copy, "chats"), 0);
        assert_eq!(
            count(&copy, "events"),
            0,
            "their events had nowhere to belong"
        );
        let violations: i64 = copy
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .expect("fk check");
        assert_eq!(violations, 0);
    }

    #[test]
    fn a_malformed_schema_entry_costs_only_its_table() {
        let f = fixture();
        populated(&f, 20);
        {
            let conn = raw(&f.db);
            conn.execute_batch(
                "PRAGMA writable_schema = ON; \
                 INSERT INTO sqlite_schema (type, name, tbl_name, rootpage, sql) \
                 VALUES ('table', 'broken', 'broken', 0, 'CREATE TABLE broken (x MALFORMED ((');",
            )
            .expect("malformed entry");
        }
        let plain: rusqlite::Result<i64> =
            raw(&f.db).query_row("SELECT count(*) FROM projects", [], |row| row.get(0));
        assert!(
            plain.is_err(),
            "every statement fails on a malformed schema"
        );

        let salvage = salvage(&f.db, &f.out).expect("salvage");
        assert_eq!(
            salvage,
            Salvage::Partial {
                tables: vec!["broken".into()]
            }
        );
        let copy = raw(&f.out);
        assert_eq!(count(&copy, "projects"), 2);
        assert_eq!(count(&copy, "events"), 20);
    }

    #[test]
    fn tables_without_rowids_are_copied_too() {
        let f = fixture();
        populated(&f, 3000);
        {
            let conn = raw(&f.db);
            conn.execute_batch(
                "CREATE TABLE tags (name TEXT PRIMARY KEY, color TEXT) WITHOUT ROWID; \
                 INSERT INTO tags VALUES ('red', '#f00'), ('blue', '#00f');",
            )
            .expect("without rowid");
        }
        // Force the table-by-table path with a bad events leaf.
        let leaves = pages(&f.db, "events", "leaf");
        smash(&f.db, leaves[leaves.len() / 2]);
        assert!(matches!(
            salvage(&f.db, &f.out).expect("salvage"),
            Salvage::Partial { .. }
        ));
        let copy = raw(&f.out);
        assert_eq!(count(&copy, "tags"), 2);
    }

    #[test]
    fn random_bytes_salvage_nothing_and_leave_nothing_behind() {
        let f = fixture();
        fs::write(&f.db, vec![0x5a; 16 * 1024]).expect("garbage");
        assert_eq!(salvage(&f.db, &f.out).expect("salvage"), Salvage::Nothing);
        assert!(!f.out.exists());
        assert!(!fsutil::with_suffix(&f.out, "-journal").exists());
    }

    /// Only problems writing the copy are errors, and they leave the damaged file as it was.
    #[test]
    fn an_unwritable_output_is_an_error_and_the_source_is_untouched() {
        let f = fixture();
        populated(&f, 5);
        let before = fs::read(&f.db).expect("read");
        let out =
            f.db.with_file_name("no such folder")
                .join("aura.db.salvage-1.partial");
        let result = salvage(&f.db, &out);
        assert!(result.is_err(), "{result:?}");
        assert_eq!(fs::read(&f.db).expect("read"), before);
        assert!(!out.exists());
    }

    #[test]
    fn a_stale_output_is_replaced() {
        let f = fixture();
        populated(&f, 5);
        fs::write(&f.out, b"left over from an interrupted repair").expect("stale");
        assert_eq!(salvage(&f.db, &f.out).expect("salvage"), Salvage::Complete);
        assert_eq!(count(&raw(&f.out), "events"), 5);
    }

    #[test]
    fn the_wal_of_the_damaged_database_is_read_but_not_touched() {
        let f = fixture();
        populated(&f, 5);
        {
            let conn = raw(&f.db);
            conn.execute(
                "INSERT INTO projects (id, name, created_at, updated_at, device_id) VALUES ('p3', 'Only in the WAL', 1, 1, 'd')",
                [],
            )
            .expect("insert");
            conn.set_db_config(DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, true)
                .expect("keep the wal");
        }
        let wal = fsutil::with_suffix(&f.db, "-wal");
        let wal_before = fs::read(&wal).expect("wal");
        let db_before = fs::read(&f.db).expect("db");
        assert_eq!(salvage(&f.db, &f.out).expect("salvage"), Salvage::Complete);
        assert_eq!(fs::read(&wal).expect("wal"), wal_before);
        assert_eq!(fs::read(&f.db).expect("db"), db_before);
        assert_eq!(
            count(&raw(&f.out), "projects"),
            3,
            "the WAL's rows are salvaged"
        );
    }

    #[test]
    fn next_readable_bisects_to_the_first_reachable_rowid() {
        let conn = Connection::open_in_memory().expect("memory");
        conn.execute_batch(
            "CREATE TABLE t (v); WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100) \
             INSERT INTO t (rowid, v) SELECT i, i FROM n;",
        )
        .expect("rows");
        // A seek fails (json() of malformed text raises an error) for rowids up to 40, a stand-in
        // for a damaged page, and works from 41.
        let seek = "SELECT rowid FROM t WHERE rowid >= ?1 AND CASE WHEN ?1 <= 40 THEN json('x') ELSE 1 END ORDER BY rowid LIMIT 1";
        assert!(
            conn.query_row(seek, [5], |row| row.get::<_, i64>(0))
                .is_err()
        );
        assert_eq!(next_readable(&conn, seek, 10), Some(41));
        assert_eq!(next_readable(&conn, seek, i64::MIN), Some(41));
        // Nothing readable after the end.
        let none = "SELECT rowid FROM t WHERE rowid >= ?1 AND CASE WHEN ?1 <= 1000 THEN json('x') ELSE 1 END ORDER BY rowid LIMIT 1";
        assert_eq!(next_readable(&conn, none, 10), None);
        assert_eq!(next_readable(&conn, seek, i64::MAX), None);
    }

    #[test]
    fn write_failures_are_told_apart_from_rejected_statements() {
        let full = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_FULL),
            None,
        );
        assert!(is_write_failure(&full));
        let constraint = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
            None,
        );
        assert!(!is_write_failure(&constraint));
        assert!(!is_write_failure(&rusqlite::Error::QueryReturnedNoRows));
    }

    #[test]
    fn identifiers_are_quoted() {
        assert_eq!(quote("events"), "\"events\"");
        assert_eq!(quote("odd\"name"), "\"odd\"\"name\"");
    }
}
