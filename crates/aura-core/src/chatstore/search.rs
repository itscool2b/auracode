//! Literal, bounded search of metadata and the profile's completed-message index.
use aura_protocol::search::{ChatSearchHit, ProjectSearchHit, SearchResults};
use rusqlite::{Connection, params};

pub(crate) fn execute(
    conn: &Connection,
    query: &str,
    include_archived: bool,
) -> rusqlite::Result<SearchResults> {
    let literal = query.trim();
    // Quoting individual alphanumeric tokens makes FTS operators ordinary input. Prefix matching
    // keeps incremental search useful without passing caller syntax to the FTS parser.
    let terms = literal
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .take(8)
        .map(|word| format!("\"{}\"*", word.chars().take(64).collect::<String>()))
        .collect::<Vec<_>>()
        .join(" AND ");
    let mut projects = conn.prepare_cached(
        "SELECT id,substr(name,1,160) FROM projects WHERE deleted=0
         AND (?1='' OR instr(lower(name),lower(?1))>0) ORDER BY updated_at DESC,id LIMIT 20",
    )?;
    let projects = projects
        .query_map([literal], |row| {
            Ok(ProjectSearchHit {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut statement = conn.prepare_cached(
        "SELECT c.id,substr(COALESCE(c.title,'New chat'),1,180),substr(p.name,1,160),c.archived
         FROM chats c JOIN projects p ON p.id=c.project_id
         WHERE c.deleted=0 AND p.deleted=0 AND (?2 OR c.archived=0)
         AND (?1='' OR instr(lower(COALESCE(c.title,'')),lower(?1))>0
              OR instr(lower(p.name),lower(?1))>0 OR instr(lower(COALESCE(c.active_agent,'')),lower(?1))>0)
         ORDER BY c.updated_at DESC,c.id LIMIT 40",
    )?;
    let mut chats = statement
        .query_map(params![literal, include_archived], |row| {
            Ok(ChatSearchHit {
                id: row.get(0)?,
                title: row.get(1)?,
                project: row.get(2)?,
                archived: row.get(3)?,
                snippet: None,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if !terms.is_empty() {
        let mut statement = conn.prepare_cached(
            "SELECT c.id,substr(COALESCE(c.title,'New chat'),1,180),substr(p.name,1,160),c.archived,
             snippet(message_fts,2,'','','…',24)
             FROM message_fts JOIN chats c ON c.id=message_fts.chat_id
             JOIN projects p ON p.id=c.project_id WHERE message_fts MATCH ?1
             AND c.deleted=0 AND p.deleted=0 AND (?2 OR c.archived=0)
             ORDER BY rank LIMIT 80",
        )?;
        let rows = statement.query_map(params![terms, include_archived], |row| {
            Ok(ChatSearchHit {
                id: row.get(0)?,
                title: row.get(1)?,
                project: row.get(2)?,
                archived: row.get(3)?,
                snippet: Some(row.get::<_, String>(4)?.chars().take(240).collect()),
            })
        })?;
        for row in rows {
            let hit = row?;
            if let Some(existing) = chats.iter_mut().find(|chat| chat.id == hit.id) {
                if existing.snippet.is_none() {
                    existing.snippet = hit.snippet;
                }
            } else if chats.len() < 40 {
                chats.push(hit);
            }
        }
    }
    Ok(SearchResults { chats, projects })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chatstore::test_support::TestDb;

    #[test]
    fn literal_fts_search_folds_accents_and_hides_deleted_and_archived_chats() {
        let db = TestDb::new();
        let chat = db.chat("/work");
        db.conn().execute("INSERT INTO message_fts(chat_id,message_id,text) VALUES(?1,'m','Crème brûlée render pipeline')",[&chat]).expect("message");
        let result = execute(db.conn(), "creme", false).expect("search");
        assert_eq!(result.chats[0].id, chat);
        assert!(
            result.chats[0]
                .snippet
                .as_ref()
                .expect("snippet")
                .contains("Crème")
        );
        assert!(
            execute(db.conn(), "\" OR * : (", false)
                .expect("literal")
                .chats
                .is_empty()
        );
        db.conn()
            .execute("UPDATE chats SET archived=1 WHERE id=?1", [&chat])
            .expect("archive");
        assert!(
            execute(db.conn(), "render", false)
                .expect("hidden")
                .chats
                .is_empty()
        );
        assert_eq!(
            execute(db.conn(), "render", true)
                .expect("archive search")
                .chats
                .len(),
            1
        );
        db.conn()
            .execute("UPDATE chats SET deleted=1 WHERE id=?1", [&chat])
            .expect("delete");
        assert!(
            execute(db.conn(), "render", true)
                .expect("deleted")
                .chats
                .is_empty()
        );
    }
}
