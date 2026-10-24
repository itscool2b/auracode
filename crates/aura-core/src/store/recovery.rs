//! Repairing a damaged database, and remembering that it happened.
//!
//! Two small files carry the state from one open to the next, so neither a repair nor its notice
//! can get lost:
//! - `<db>.damaged`: damage that [`check_integrity`](super::check_integrity) or a failed query
//!   found while the database was in use. The next open that has the database to itself repairs it.
//! - `backups/<db>.corrupt-<millis>.json`, next to the moved file: a repair happened. Every open
//!   reports it as [`OpenOutcome::RecoveredFromCorruption`] until
//!   [`Store::acknowledge_recovery`](super::Store::acknowledge_recovery) removes it. It is written
//!   before the damaged file is moved, so the file is never moved without it.
//!
//! A repair copies what can be read into `<db>.salvage-<millis>.partial` (the damaged file is only
//! read), writes the record, moves the damaged file and its sidecars into `backups/`, and renames the
//! copy into place. Until the move, a failure changes nothing. After it, a failure leaves the record
//! and the copy in place, and the next open installs the copy and reports the repair.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{OpenOutcome, Salvage, db_file_name, is_non_empty_file, remove_with_sidecars, salvage};
use crate::error::{CoreError, Result};
use crate::fsutil::{self, JsonFile, PARTIAL_SUFFIX, SQLITE_SIDECARS};
use crate::time::now_millis;

const DAMAGE_SUFFIX: &str = ".damaged";
const SALVAGE_INFIX: &str = ".salvage-";
const RECORD_SUFFIX: &str = ".json";
const QUARANTINE_INFIX: &str = ".corrupt-";

/// A repair that moved a damaged database aside.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Recovery {
    pub(super) quarantined: PathBuf,
    pub(super) salvage: Salvage,
}

impl Recovery {
    pub(super) fn outcome(&self) -> OpenOutcome {
        OpenOutcome::RecoveredFromCorruption {
            quarantined: self.quarantined.display().to_string(),
            salvage: self.salvage.clone(),
        }
    }
}

/// The contents of `<db>.damaged`.
#[derive(Debug, Serialize, Deserialize)]
struct DamageMarker {
    problem: String,
    /// Unix ms.
    found_at: i64,
}

/// The contents of `<quarantined>.json`.
#[derive(Debug, Serialize, Deserialize)]
struct RecoveryRecord {
    /// What the probe, check, or query reported.
    problem: String,
    salvage: Salvage,
    /// Unix ms.
    recovered_at: i64,
}

/// `<db>.damaged`
pub(super) fn damage_marker(db_path: &Path) -> PathBuf {
    fsutil::with_suffix(db_path, DAMAGE_SUFFIX)
}

/// Where the repair that moves the database to `quarantined` builds its copy:
/// `<db>.salvage-<millis>.partial`, next to the database so installing it is a rename within one
/// folder, and named after that repair so a copy left waiting is never taken for another repair's.
pub(super) fn salvage_path(db_path: &Path, quarantined: &Path) -> PathBuf {
    let name = fsutil::file_name_lossy(quarantined);
    let key = name
        .rsplit_once(QUARANTINE_INFIX)
        .map_or(name.as_str(), |(_, key)| key);
    fsutil::with_suffix(db_path, &format!("{SALVAGE_INFIX}{key}{PARTIAL_SUFFIX}"))
}

/// Every salvage copy of this database, with sidecars folded into the file they belong to.
fn salvage_copies(db_path: &Path) -> Vec<PathBuf> {
    let dir = fsutil::parent_dir(db_path);
    let prefix = format!("{}{SALVAGE_INFIX}", db_file_name(db_path));
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut copies: Vec<PathBuf> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let base = SQLITE_SIDECARS
                .iter()
                .find_map(|suffix| name.strip_suffix(suffix))
                .unwrap_or(&name);
            (base.starts_with(prefix.as_str()) && base.ends_with(PARTIAL_SUFFIX))
                .then(|| dir.join(base))
        })
        .collect();
    copies.sort();
    copies.dedup();
    copies
}

/// Deletes salvage copies an interrupted repair left, except `keep`.
fn remove_salvage_copies(db_path: &Path, keep: Option<&Path>) {
    for copy in salvage_copies(db_path) {
        if Some(copy.as_path()) != keep {
            tracing::info!(copy = %copy.display(), "removing what an interrupted repair left");
            remove_with_sidecars(&copy);
        }
    }
}

/// Records damage found while the database was in use, for the next exclusive open to repair. The
/// first problem found is kept, since it is the closest to the cause.
pub(super) fn mark_damaged(db_path: &Path, problem: &str) -> Result<()> {
    let marker = damage_marker(db_path);
    if fs::symlink_metadata(&marker).is_ok() {
        return Ok(());
    }
    fsutil::write_json_atomic(
        &marker,
        &DamageMarker {
            problem: problem.to_string(),
            found_at: now_millis(),
        },
    )?;
    tracing::warn!(%problem, db = %db_path.display(), "recorded damage; the next open repairs the database");
    Ok(())
}

/// The damage recorded by [`mark_damaged`], if any.
pub(super) fn recorded_damage(db_path: &Path) -> Option<String> {
    match fsutil::read_json::<DamageMarker>(&damage_marker(db_path)) {
        JsonFile::Missing => None,
        JsonFile::Valid(marker) => Some(marker.problem),
        // Something is there, so damage was recorded even if the details are lost.
        JsonFile::Unusable(error) | JsonFile::Unreadable(error) => {
            Some(format!("damage was recorded earlier ({error})"))
        }
    }
}

pub(super) fn clear_recorded_damage(db_path: &Path) {
    let marker = damage_marker(db_path);
    match fs::remove_file(&marker) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            tracing::warn!(marker = %marker.display(), %error, "could not remove the damage record")
        }
    }
}

/// A recovery record in `backups/`.
#[derive(Debug)]
struct RecordFile {
    quarantined: PathBuf,
    path: PathBuf,
    /// The quarantine's millisecond, then `free_path`'s collision counter: newer sorts greater.
    key: (i64, u32),
}

/// This database's recovery records, newest first.
fn record_files(db_path: &Path, backups_dir: &Path) -> Vec<RecordFile> {
    let prefix = format!("{}{QUARANTINE_INFIX}", db_file_name(db_path));
    let Ok(entries) = fs::read_dir(backups_dir) else {
        return Vec::new();
    };
    let mut files: Vec<RecordFile> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let stem = name.strip_suffix(RECORD_SUFFIX)?;
            let rest = stem.strip_prefix(prefix.as_str())?;
            let (millis, counter) = match rest.split_once('.') {
                Some((millis, counter)) => (millis, counter.parse().unwrap_or(0)),
                None => (rest, 0),
            };
            Some(RecordFile {
                quarantined: backups_dir.join(stem),
                path: entry.path(),
                key: (millis.parse().ok()?, counter),
            })
        })
        .collect();
    files.sort_by_key(|file| std::cmp::Reverse(file.key));
    files
}

fn read_record(file: &RecordFile) -> Option<RecoveryRecord> {
    match fsutil::read_json::<RecoveryRecord>(&file.path) {
        JsonFile::Valid(record) => Some(record),
        JsonFile::Missing => None,
        JsonFile::Unusable(error) | JsonFile::Unreadable(error) => {
            tracing::warn!(%error, "skipping an unreadable repair record");
            None
        }
    }
}

fn exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

/// The newest repair the UI hasn't acknowledged yet, whose damaged copy is still there.
pub(super) fn newest_pending(db_path: &Path, backups_dir: &Path) -> Option<Recovery> {
    record_files(db_path, backups_dir)
        .into_iter()
        .filter(|file| exists(&file.quarantined))
        .find_map(|file| {
            read_record(&file).map(|record| Recovery {
                quarantined: file.quarantined,
                salvage: record.salvage,
            })
        })
}

/// Finishes a repair an earlier open couldn't complete (the damaged file was moved, but its copy
/// never went in), drops records whose damaged copy is gone, and deletes salvage copies that
/// interrupted repairs left. Returns the repair it finished. Only called while holding the open
/// lock exclusively.
///
/// A copy is only waiting while the database is missing, and a repair only starts on a database
/// that exists, so at most one copy can be waiting. It is found by name rather than by taking the
/// newest record, which a clock set back between two repairs would get wrong.
pub(super) fn resume(db_path: &Path, backups_dir: &Path) -> Result<Option<Recovery>> {
    let mut waiting = None;
    let database_missing = !is_non_empty_file(db_path);
    for file in record_files(db_path, backups_dir) {
        if !exists(&file.quarantined) {
            // The repair stopped between writing the record and moving the file (which is still in
            // place), or the user deleted the damaged copy: nothing left to report.
            if let Err(error) = fs::remove_file(&file.path) {
                tracing::warn!(record = %file.path.display(), %error, "could not remove a stale repair record");
            }
            continue;
        }
        let copy = salvage_path(db_path, &file.quarantined);
        if waiting.is_none() && database_missing && exists(&copy) {
            match read_record(&file) {
                Some(record) if record.salvage != Salvage::Nothing => {
                    waiting = Some((copy, file.quarantined, record.salvage));
                }
                _ => {}
            }
        }
    }
    let Some((copy, quarantined, salvage)) = waiting else {
        remove_salvage_copies(db_path, None);
        return Ok(None);
    };
    remove_salvage_copies(db_path, Some(&copy));
    install(&copy, db_path).map_err(|error| incomplete(db_path, &quarantined, error))?;
    clear_recorded_damage(db_path);
    tracing::info!(quarantined = %quarantined.display(), "finished an interrupted repair");
    Ok(Some(Recovery {
        quarantined,
        salvage,
    }))
}

/// Repairs the damaged database at `db_path` (the steps are in the module docs). Only called while
/// holding the open lock exclusively, so no other auracode process has the file open.
pub(super) fn recover(db_path: &Path, backups_dir: &Path, problem: &str) -> Result<Recovery> {
    let failed = |source: CoreError| CoreError::RepairFailed {
        path: db_path.to_path_buf(),
        source: Box::new(source),
    };
    fsutil::create_private_dir_all(backups_dir).map_err(failed)?;
    let base = format!(
        "{}{QUARANTINE_INFIX}{}",
        db_file_name(db_path),
        now_millis()
    );
    let target = fsutil::free_path(backups_dir, &base, "");
    let record_path = fsutil::with_suffix(&target, RECORD_SUFFIX);
    let copy = salvage_path(db_path, &target);

    tracing::warn!(%problem, db = %db_path.display(), "the database is damaged; copying out what can be read");
    let salvage = salvage::salvage(db_path, &copy).map_err(failed)?;
    let record = RecoveryRecord {
        problem: problem.to_string(),
        salvage: salvage.clone(),
        recovered_at: now_millis(),
    };
    if let Err(error) = fsutil::write_json_atomic(&record_path, &record) {
        remove_with_sidecars(&copy);
        return Err(failed(error));
    }
    // Nothing has changed until this rename succeeds.
    if let Err(source) = fs::rename(db_path, &target) {
        if let Err(error) = fs::remove_file(&record_path) {
            tracing::warn!(record = %record_path.display(), %error, "could not remove the record of a repair that didn't happen");
        }
        remove_with_sidecars(&copy);
        return Err(failed(CoreError::Io {
            path: db_path.to_path_buf(),
            source,
        }));
    }
    fsutil::sync_dir(backups_dir);
    fsutil::sync_dir(fsutil::parent_dir(db_path));
    tracing::warn!(quarantined = %target.display(), ?salvage, "moved the damaged database aside");

    let incomplete = |error| incomplete(db_path, &target, error);
    move_sidecars(db_path, &target).map_err(incomplete)?;
    if salvage != Salvage::Nothing {
        install(&copy, db_path).map_err(incomplete)?;
    }
    clear_recorded_damage(db_path);
    Ok(Recovery {
        quarantined: target,
        salvage,
    })
}

/// Moves the damaged database's `-wal`, `-shm`, and `-journal` next to it, keeping their suffixes
/// so SQLite can still open the set. One that can't be renamed is copied, then removed (the `-shm`,
/// an index SQLite rebuilds, is just removed): left behind, it would be replayed into the new
/// database.
fn move_sidecars(db_path: &Path, target: &Path) -> Result<()> {
    for suffix in SQLITE_SIDECARS {
        let sidecar = fsutil::with_suffix(db_path, suffix);
        if !exists(&sidecar) {
            continue;
        }
        let moved = fsutil::with_suffix(target, suffix);
        if let Err(error) = fs::rename(&sidecar, &moved) {
            tracing::warn!(%error, sidecar = %sidecar.display(), "could not move a sidecar of the damaged database; copying it instead");
            if suffix != "-shm" {
                fs::copy(&sidecar, &moved).map_err(CoreError::io(&sidecar))?;
            }
            fs::remove_file(&sidecar).map_err(CoreError::io(&sidecar))?;
        }
    }
    Ok(())
}

/// Renames a salvaged copy into place. Stale sidecars go first: SQLite can't tell which database a
/// `-wal` belongs to, and would replay an old one into the new file.
fn install(copy: &Path, db_path: &Path) -> Result<()> {
    for suffix in SQLITE_SIDECARS {
        let sidecar = fsutil::with_suffix(db_path, suffix);
        match fs::remove_file(&sidecar) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(source) => {
                return Err(CoreError::Io {
                    path: sidecar,
                    source,
                });
            }
        }
    }
    fs::rename(copy, db_path).map_err(CoreError::io(db_path))?;
    fsutil::sync_dir(fsutil::parent_dir(db_path));
    Ok(())
}

/// The error for a failure after the damaged file was moved. It names where the file went, and
/// rephrases errors whose own message would claim the database "was left unchanged".
pub(super) fn incomplete(db_path: &Path, quarantined: &Path, error: CoreError) -> CoreError {
    let reason = match &error {
        CoreError::Migration(detail) => format!("upgrading it failed: {detail}"),
        CoreError::Backup { path, source } => format!(
            "backing it up to {} before upgrading it failed: {source}",
            path.display()
        ),
        other => other.to_string(),
    };
    CoreError::RecoveryIncomplete {
        path: db_path.to_path_buf(),
        quarantined: quarantined.to_path_buf(),
        reason,
        source: Box::new(error),
    }
}

/// Removes the record of the repair that moved the database to `quarantined` (as reported in
/// [`OpenOutcome::RecoveredFromCorruption`]), so opens stop reporting it. Only records of this
/// database in its own backups folder can match; the damaged copy itself is kept. Returns whether
/// a record was removed.
pub(super) fn acknowledge(db_path: &Path, backups_dir: &Path, quarantined: &str) -> Result<bool> {
    let Some(file) = record_files(db_path, backups_dir)
        .into_iter()
        .find(|file| file.quarantined.display().to_string() == quarantined)
    else {
        return Ok(false);
    };
    match fs::remove_file(&file.path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(source) => Err(CoreError::Io {
            path: file.path,
            source,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Paths {
        _dir: tempfile::TempDir,
        db: PathBuf,
        backups: PathBuf,
    }

    fn paths() -> Paths {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = dir.path().join("aura.db");
        let backups = dir.path().join("backups");
        fs::create_dir_all(&backups).expect("mkdir");
        Paths {
            _dir: dir,
            db,
            backups,
        }
    }

    fn write_record(p: &Paths, stem: &str, salvage: Salvage) -> PathBuf {
        let quarantined = p.backups.join(stem);
        fsutil::write_json_atomic(
            &fsutil::with_suffix(&quarantined, RECORD_SUFFIX),
            &RecoveryRecord {
                problem: "test".into(),
                salvage,
                recovered_at: 1,
            },
        )
        .expect("record");
        quarantined
    }

    #[test]
    fn damage_records_keep_the_first_problem_and_clear() {
        let p = paths();
        assert_eq!(recorded_damage(&p.db), None);
        mark_damaged(&p.db, "Page 39: never used").expect("mark");
        mark_damaged(&p.db, "a later problem").expect("mark again");
        assert_eq!(
            recorded_damage(&p.db).as_deref(),
            Some("Page 39: never used")
        );
        clear_recorded_damage(&p.db);
        assert_eq!(recorded_damage(&p.db), None);
        clear_recorded_damage(&p.db);
    }

    #[test]
    fn an_unparsable_damage_record_still_counts_as_damage() {
        let p = paths();
        fs::write(damage_marker(&p.db), b"{ torn").expect("write");
        assert!(recorded_damage(&p.db).is_some());
    }

    #[test]
    fn records_sort_newest_first_and_ignore_other_files() {
        let p = paths();
        for stem in [
            "aura.db.corrupt-100",
            "aura.db.corrupt-300",
            "aura.db.corrupt-300.1",
            "aura.db.corrupt-200",
        ] {
            write_record(&p, stem, Salvage::Complete);
        }
        for other in [
            "other.db.corrupt-999.json",
            "aura.db.corrupt-abc.json",
            "aura.db.v1-5.bak",
            "notes.json",
        ] {
            fs::write(p.backups.join(other), b"{}").expect("write");
        }
        let names: Vec<String> = record_files(&p.db, &p.backups)
            .iter()
            .map(|file| fsutil::file_name_lossy(&file.quarantined))
            .collect();
        assert_eq!(
            names,
            [
                "aura.db.corrupt-300.1",
                "aura.db.corrupt-300",
                "aura.db.corrupt-200",
                "aura.db.corrupt-100"
            ]
        );
    }

    #[test]
    fn pending_needs_the_damaged_copy_to_still_exist() {
        let p = paths();
        let gone = write_record(&p, "aura.db.corrupt-200", Salvage::Complete);
        let kept = write_record(
            &p,
            "aura.db.corrupt-100",
            Salvage::Partial {
                tables: vec!["events".into()],
            },
        );
        fs::write(&kept, b"damaged bytes").expect("quarantined file");
        let pending = newest_pending(&p.db, &p.backups).expect("pending");
        assert_eq!(pending.quarantined, kept);
        assert!(!gone.exists());
    }

    #[test]
    fn salvage_copies_are_named_after_their_repair() {
        let p = paths();
        assert_eq!(
            salvage_path(&p.db, &p.backups.join("aura.db.corrupt-1730000000000.2")),
            p.db.with_file_name("aura.db.salvage-1730000000000.2.partial")
        );
    }

    #[test]
    fn resume_drops_records_whose_copy_is_gone_and_stale_salvage_copies() {
        let p = paths();
        let stale = write_record(&p, "aura.db.corrupt-5", Salvage::Complete);
        fs::write(&p.db, b"the database is in place").expect("db");
        let copy = salvage_path(&p.db, &stale);
        fs::write(&copy, b"half a copy").expect("stale copy");
        fs::write(fsutil::with_suffix(&copy, "-journal"), b"journal").expect("stale journal");
        let orphan = salvage_path(&p.db, &p.backups.join("aura.db.corrupt-9"));
        fs::write(&orphan, b"from a repair interrupted mid-copy").expect("orphan");
        let unrelated = p.db.with_file_name("notes.salvage-1.partial");
        fs::write(&unrelated, b"not ours").expect("unrelated");

        assert_eq!(resume(&p.db, &p.backups).expect("resume"), None);
        assert!(!fsutil::with_suffix(&stale, RECORD_SUFFIX).exists());
        assert!(!copy.exists());
        assert!(!fsutil::with_suffix(&copy, "-journal").exists());
        assert!(!orphan.exists());
        assert!(unrelated.exists());
        assert_eq!(fs::read(&p.db).expect("db"), b"the database is in place");
    }

    #[test]
    fn resume_installs_a_copy_the_last_repair_left_waiting() {
        let p = paths();
        let quarantined = write_record(&p, "aura.db.corrupt-7", Salvage::Complete);
        fs::write(&quarantined, b"damaged").expect("quarantined");
        let copy = salvage_path(&p.db, &quarantined);
        fs::write(&copy, b"salvaged database").expect("copy");
        fs::write(fsutil::with_suffix(&p.db, "-wal"), b"stale wal").expect("stale wal");
        mark_damaged(&p.db, "found earlier").expect("mark");

        let finished = resume(&p.db, &p.backups)
            .expect("resume")
            .expect("finished the repair");
        assert_eq!(finished.quarantined, quarantined);
        assert_eq!(finished.salvage, Salvage::Complete);
        assert_eq!(fs::read(&p.db).expect("installed"), b"salvaged database");
        assert!(!copy.exists());
        assert!(
            !fsutil::with_suffix(&p.db, "-wal").exists(),
            "a stale -wal must never meet the new file"
        );
        assert_eq!(recorded_damage(&p.db), None);
        // Still reported until acknowledged.
        assert_eq!(newest_pending(&p.db, &p.backups), Some(finished));
    }

    /// With the clock set back between two repairs, the repair whose copy is waiting can have the
    /// older timestamp. Its copy is found by name, not by assuming the newest record owns it.
    #[test]
    fn resume_installs_the_waiting_copy_even_when_it_is_not_the_newest_record() {
        let p = paths();
        let earlier_clock = write_record(&p, "aura.db.corrupt-100", Salvage::Complete);
        let later_clock = write_record(&p, "aura.db.corrupt-900", Salvage::Nothing);
        for quarantined in [&earlier_clock, &later_clock] {
            fs::write(quarantined, b"damaged").expect("quarantined");
        }
        fs::write(salvage_path(&p.db, &earlier_clock), b"the waiting copy").expect("copy");
        let finished = resume(&p.db, &p.backups)
            .expect("resume")
            .expect("finished");
        assert_eq!(finished.quarantined, earlier_clock);
        assert_eq!(fs::read(&p.db).expect("installed"), b"the waiting copy");
    }

    #[test]
    fn a_repair_that_salvaged_nothing_leaves_no_copy_to_install() {
        let p = paths();
        let quarantined = write_record(&p, "aura.db.corrupt-7", Salvage::Nothing);
        fs::write(&quarantined, b"damaged").expect("quarantined");
        assert_eq!(resume(&p.db, &p.backups).expect("resume"), None);
        assert!(!p.db.exists(), "the open creates the new database");
        assert_eq!(
            newest_pending(&p.db, &p.backups).map(|pending| pending.salvage),
            Some(Salvage::Nothing),
            "and the repair is still reported"
        );
    }

    #[test]
    fn a_database_removed_by_hand_after_a_finished_repair_is_not_resurrected() {
        let p = paths();
        let quarantined = write_record(&p, "aura.db.corrupt-7", Salvage::Complete);
        fs::write(&quarantined, b"damaged").expect("quarantined");
        assert_eq!(resume(&p.db, &p.backups).expect("resume"), None);
        assert!(!p.db.exists());
        assert!(newest_pending(&p.db, &p.backups).is_some());
    }

    #[test]
    fn acknowledging_removes_only_the_matching_record() {
        let p = paths();
        let first = write_record(&p, "aura.db.corrupt-1", Salvage::Complete);
        let second = write_record(&p, "aura.db.corrupt-2", Salvage::Nothing);
        for quarantined in [&first, &second] {
            fs::write(quarantined, b"damaged").expect("quarantined");
        }
        assert!(!acknowledge(&p.db, &p.backups, "/somewhere/else").expect("ack"));
        assert!(
            !acknowledge(&p.db, &p.backups, "aura.db.corrupt-2").expect("ack"),
            "a bare name is not the path the outcome reported"
        );
        assert!(acknowledge(&p.db, &p.backups, &second.display().to_string()).expect("ack"));
        assert!(second.exists(), "the damaged copy itself is kept");
        assert_eq!(
            newest_pending(&p.db, &p.backups).map(|pending| pending.quarantined),
            Some(first.clone())
        );
        assert!(!acknowledge(&p.db, &p.backups, &second.display().to_string()).expect("again"));
    }

    #[test]
    fn incomplete_errors_name_the_quarantine_and_drop_left_unchanged() {
        let error = incomplete(
            Path::new("/p/aura.db"),
            Path::new("/p/backups/aura.db.corrupt-1"),
            CoreError::Migration("version 1 to 2: no such table: x".into()),
        );
        let text = error.to_string();
        assert!(text.contains("/p/backups/aura.db.corrupt-1"), "{text}");
        assert!(text.contains("no such table: x"), "{text}");
        assert!(!text.contains("left unchanged"), "{text}");
    }
}
