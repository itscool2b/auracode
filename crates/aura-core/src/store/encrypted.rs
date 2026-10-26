//! Account databases have a durable mode marker, including in builds without SQLCipher. This keeps
//! path-based plaintext opens and integrity checks out of the automatic plaintext recovery path.
use super::*;

fn marker_path(path: &Path) -> PathBuf {
    fsutil::with_suffix(path, ".encryption")
}

pub(super) fn require_plain(path: &Path) -> Result<()> {
    match fs::symlink_metadata(marker_path(path)) {
        Ok(_) => Err(CoreError::ProfileLocked {
            path: path.to_path_buf(),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(CoreError::io(marker_path(path))(error)),
    }
}

#[cfg(feature = "account-sync")]
pub(super) use keyed::{backup, check_integrity, open, unavailable};

#[cfg(feature = "account-sync")]
pub(super) fn check_profile_layout(profile: &Profile) -> Result<()> {
    let legacy = profile.dir.join(crate::profile::DB_FILE);
    for suffix in ["", "-wal", "-shm", "-journal", ".encryption"] {
        let candidate = fsutil::with_suffix(&legacy, suffix);
        match fs::symlink_metadata(&candidate) {
            Ok(_) => return Err(CoreError::AccountDatabaseLayout { path: legacy }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(CoreError::io(candidate)(error)),
        }
    }
    Ok(())
}

#[cfg(feature = "account-sync")]
mod keyed {
    use super::*;
    use aura_sync::{crypto::DatabaseKey, database};
    use std::{io::Read, sync::Arc};

    #[derive(Serialize, Deserialize, PartialEq)]
    #[serde(deny_unknown_fields)]
    struct Marker {
        version: u8,
        state: State,
    }
    #[derive(Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "snake_case")]
    enum State {
        Initializing,
        Ready,
    }

    pub(in crate::store) fn unavailable(path: &Path) -> CoreError {
        CoreError::EncryptedDatabase {
            path: path.to_path_buf(),
        }
    }

    fn read_marker(path: &Path) -> Result<Option<Marker>> {
        let marker = marker_path(path);
        let metadata = match fs::symlink_metadata(&marker) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(CoreError::io(&marker)(error)),
        };
        if !metadata.is_file() || metadata.len() > 256 {
            return Err(unavailable(path));
        }
        let mut bytes = Vec::new();
        File::open(&marker)
            .map_err(CoreError::io(&marker))?
            .take(257)
            .read_to_end(&mut bytes)
            .map_err(CoreError::io(&marker))?;
        let value: Marker = serde_json::from_slice(&bytes).map_err(|_| unavailable(path))?;
        if value.version != 1 {
            return Err(unavailable(path));
        }
        Ok(Some(value))
    }

    fn write_marker(path: &Path, state: State) -> Result<()> {
        fsutil::write_json_atomic(&marker_path(path), &Marker { version: 1, state })
    }

    fn configure(conn: &mut Connection, key: &DatabaseKey) -> Result<()> {
        database::configure(conn, key).map_err(CoreError::from)
    }

    fn failure(path: &Path, failure: Failure) -> CoreError {
        match failure {
            Failure::Damage(_) => unavailable(path),
            Failure::Error(error) => error,
        }
    }

    pub(in crate::store) fn open(
        path: &Path,
        backups: &Path,
        key: Arc<DatabaseKey>,
        migrations: &[M<'_>],
    ) -> Result<(Store, StoreInfo)> {
        let supported = u32::try_from(migrations.len()).map_err(|_| unavailable(path))?;
        fsutil::create_private_dir_all(fsutil::parent_dir(path))?;
        let lock = OpenLock::acquire(path, BUSY_TIMEOUT)?;
        let marker = read_marker(path)?;
        let existed = is_non_empty_file(path);
        if marker.as_ref().is_some_and(|m| m.state == State::Ready) && !existed {
            return Err(unavailable(path));
        }
        if recovery::recorded_damage(path).is_some()
            || recovery::newest_pending(path, backups).is_some()
        {
            return Err(unavailable(path));
        }
        let unclean_shutdown = lock.may_change() && left_unclean(path);
        if !existed && marker.is_none() {
            // Before SQLite creates any ciphertext, even if the process dies during migration 1.
            if !lock.may_change() {
                return Err(unavailable(path));
            }
            write_marker(path, State::Initializing)?;
        }
        let mut conn = Connection::open(path)?;
        conn.busy_timeout(BUSY_TIMEOUT)?;
        if let Err(error) = configure(&mut conn, &key) {
            close_without_checkpoint(conn);
            return Err(error);
        }
        if let Err(error) = check(&conn, supported) {
            close_without_checkpoint(conn);
            return Err(failure(path, error));
        }
        let ctx = Ctx {
            db_path: path,
            backups_dir: backups,
            migrations,
            supported,
            busy_timeout: BUSY_TIMEOUT,
            may_change: lock.may_change(),
            key: Some(&key),
        };
        let (from, schema_version, backup) = match prepare(&ctx, &mut conn) {
            Ok(value) => value,
            Err(error) => {
                close_without_checkpoint(conn);
                return Err(failure(path, error));
            }
        };
        if marker.as_ref().is_none_or(|m| m.state != State::Ready) {
            write_marker(path, State::Ready)?;
        }
        let opened = Opened {
            conn,
            from,
            schema_version,
            backup,
        };
        let (conn, info) = finish(&ctx, opened, None, unclean_shutdown);
        Ok((
            Store {
                conn,
                path: path.to_path_buf(),
                backups_dir: backups.to_path_buf(),
                key: Some(key),
                _lock: lock.into_store_hold(BUSY_TIMEOUT),
            },
            info,
        ))
    }

    pub(in crate::store) fn check_integrity(path: &Path, key: &DatabaseKey) -> Result<Integrity> {
        let mut conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.busy_timeout(BUSY_TIMEOUT)?;
        let checked = configure(&mut conn, key).and_then(|()| quick_check(&conn, SCHEMA_VERSION));
        close_without_checkpoint(conn);
        match checked? {
            None => Ok(Integrity::Ok),
            // Do not write a plaintext-recovery marker or include raw page/schema details.
            Some(_) => Err(unavailable(path)),
        }
    }

    pub(in crate::store) fn backup(
        conn: &Connection,
        path: &Path,
        key: &DatabaseKey,
    ) -> Result<()> {
        let mut target = Connection::open(path)?;
        configure(&mut target, key)?;
        let deadline = Instant::now() + Duration::from_secs(30);
        let backup = rusqlite::backup::Backup::new(conn, &mut target)?;
        loop {
            use rusqlite::backup::StepResult;
            let step = backup.step(128)?;
            if matches!(step, StepResult::Done) {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
                    Some("The encrypted backup did not finish within its deadline.".into()),
                )
                .into());
            }
            if matches!(step, StepResult::Busy | StepResult::Locked) {
                std::thread::sleep(lock::POLL);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn account_profiles_and_encryption_markers_block_plaintext_opens() {
        let temp = tempfile::tempdir().unwrap();
        let profile = Profile {
            meta: crate::profile::ProfileMeta {
                id: "account".into(),
                kind: ProfileKind::Account,
                display_name: "Account".into(),
                created_at: 0,
            },
            dir: temp.path().join("profile"),
        };
        assert!(matches!(
            Store::open(&profile),
            Err(CoreError::ProfileLocked { .. })
        ));
        assert!(!profile.dir.exists());
        fs::create_dir(&profile.dir).unwrap();
        // Even an unknown future or damaged marker cannot send ciphertext into plaintext repair.
        fs::write(marker_path(&profile.db_path()), b"future format").unwrap();
        fs::write(profile.db_path(), b"preserve encrypted bytes").unwrap();
        assert!(matches!(
            Store::open_at(&profile.db_path(), &profile.backups_dir()),
            Err(CoreError::ProfileLocked { .. })
        ));
        assert!(matches!(
            super::super::check_integrity(&profile.db_path()),
            Err(CoreError::ProfileLocked { .. })
        ));
        assert_eq!(
            fs::read(profile.db_path()).unwrap(),
            b"preserve encrypted bytes"
        );
        assert!(!profile.backups_dir().exists());
    }
}

#[cfg(test)]
#[cfg(feature = "account-sync")]
#[path = "encrypted_tests.rs"]
mod keyed_tests;
