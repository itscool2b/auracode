use super::{db::Db, unavailable};
use crate::policy::Result;
use serde_json::{Value, json};
use worker::{Env, ScheduleContext, ScheduledEvent, event};

#[event(scheduled)]
pub async fn scheduled(_event: ScheduledEvent, env: Env, _context: ScheduleContext) {
    // Fixed diagnostic only. Provider errors may include object keys or SQL arguments.
    if cleanup(env).await.is_err() {
        worker::console_error!("account storage cleanup failed; next scheduled run will retry");
    }
}
async fn cleanup(env: Env) -> Result<()> {
    let now = (js_sys::Date::now() / 1000.0) as i64;
    let db = Db(env.d1("DB").map_err(unavailable)?);
    let bucket = env.bucket("BLOBS").map_err(unavailable)?;
    let deleting: Vec<Value> = db
        .all(
            "SELECT id,purged_at FROM users WHERE deletion_requested_at IS NOT NULL AND cleanup_after<=?1 ORDER BY cleanup_after LIMIT 10",
            vec![json!(now)],
        )
        .await?;
    for user in deleting {
        let id = user["id"]
            .as_str()
            .ok_or(crate::policy::ApiError::Unavailable)?;
        let objects = bucket
            .list()
            .prefix(format!("{id}/"))
            .limit(100)
            .execute()
            .await
            .map_err(unavailable)?;
        for object in objects.objects() {
            bucket.delete(object.key()).await.map_err(unavailable)?;
        }
        if !objects.truncated() && user["purged_at"].is_null() {
            // Retain only a random account-ID tombstone. A write already in flight when revocation
            // occurred can finish after this scan, so future scans must retain its R2 prefix.
            let mut batch = vec![];
            for table in [
                "sync_heads",
                "sync_changes",
                "blobs",
                "blob_objects",
                "user_keys",
                "devices",
                "sessions",
            ] {
                let sql = match table {
                    "sync_heads" => "DELETE FROM sync_heads WHERE user_id=?1",
                    "sync_changes" => "DELETE FROM sync_changes WHERE user_id=?1",
                    "blobs" => "DELETE FROM blobs WHERE user_id=?1",
                    "blob_objects" => "DELETE FROM blob_objects WHERE user_id=?1",
                    "user_keys" => "DELETE FROM user_keys WHERE user_id=?1",
                    "devices" => "DELETE FROM devices WHERE user_id=?1",
                    _ => "DELETE FROM sessions WHERE user_id=?1",
                };
                batch.push((sql, vec![json!(id)]));
            }
            batch.push((
                "DELETE FROM auth_challenges WHERE email=(SELECT email FROM users WHERE id=?1)",
                vec![json!(id)],
            ));
            batch.push(("UPDATE users SET email='deleted-'||id||'@invalid',email_key='deleted-'||id,purged_at=?2,sync_used_bytes=0 WHERE id=?1",vec![json!(id),json!(now)]));
            db.batch(batch).await?;
        }
        db.run(
            "UPDATE users SET cleanup_after=?2 WHERE id=?1",
            vec![
                json!(id),
                json!(now + if objects.truncated() { 300 } else { 86400 }),
            ],
        )
        .await?;
    }
    let abandoned:Vec<Value>=db.all("SELECT object_key FROM blob_objects o WHERE collect_after<?1 AND NOT EXISTS(SELECT 1 FROM blobs b WHERE b.object_key=o.object_key) LIMIT 100",vec![json!(now)]).await?;
    for row in abandoned {
        let key = row["object_key"]
            .as_str()
            .ok_or(crate::policy::ApiError::Unavailable)?;
        bucket.delete(key).await.map_err(unavailable)?;
        db.run("DELETE FROM blob_objects WHERE object_key=?1 AND NOT EXISTS(SELECT 1 FROM blobs b WHERE b.object_key=?1)",vec![json!(key)]).await?;
    }
    db.batch(vec![
        (
            "DELETE FROM auth_challenges WHERE expires_at<?1",
            vec![json!(now - 3600)],
        ),
        (
            "DELETE FROM rate_limits WHERE expires_at<?1",
            vec![json!(now)],
        ),
        (
            "DELETE FROM sessions WHERE expires_at<?1 OR revoked_at<?2",
            vec![json!(now), json!(now - 86400)],
        ),
    ])
    .await?;
    Ok(())
}
