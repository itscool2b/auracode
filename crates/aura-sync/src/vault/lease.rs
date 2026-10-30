//! One permanent, empty coordination file for this user's native service, independent of roots.
//! Lock order: native lease, accounts.lock, state/write mutexes, NATIVE_ACCESS.
use super::{Result, VaultError};
use aura_process::locked_file::LockedFile;
use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use std::path::Path;

pub(super) fn acquire(path: &Path, exclusive: bool, create: bool) -> Result<LockedFile> {
    let dir = Dir::open_ambient_dir(
        path.parent().ok_or(VaultError::Busy)?,
        cap_std::ambient_authority(),
    )
    .map_err(|_| VaultError::Busy)?;
    let mut options = OpenOptions::new();
    options
        .read(true)
        .write(true)
        .create(create)
        .truncate(false)
        .follow(FollowSymlinks::No);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = dir
        .open_with(path.file_name().ok_or(VaultError::Busy)?, &options)
        .map_err(|_| VaultError::Busy)?
        .into_std();
    if !file.metadata().map_err(|_| VaultError::Busy)?.is_file() {
        return Err(VaultError::Busy);
    }
    if exclusive {
        file.try_lock()
    } else {
        file.try_lock_shared()
    }
    .map_err(|_| VaultError::Busy)?;
    Ok(LockedFile::new(file))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_readers_exclude_cleanup_and_release_explicitly() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("lease");
        assert!(acquire(&path, false, false).is_err());
        assert!(!path.exists());
        let one = acquire(&path, false, true).unwrap();
        let two = acquire(&path, false, true).unwrap();
        assert!(acquire(&path, true, true).is_err());
        drop(one);
        assert!(acquire(&path, true, true).is_err());
        drop(two);
        let cleanup = acquire(&path, true, true).unwrap();
        assert!(acquire(&path, false, true).is_err());
        assert!(acquire(&path, true, true).is_err());
        drop(cleanup);
        assert!(acquire(&path, false, false).is_ok());
        assert_eq!(std::fs::metadata(path).unwrap().len(), 0);
    }

    #[test]
    fn directories_are_refused() {
        let temp = tempfile::tempdir().unwrap();
        assert!(acquire(temp.path(), true, true).is_err());
    }

    // This subprocess opens only a caller-provided temporary lock, never NativeStore.
    #[test]
    fn lease_child() {
        use std::io::{Read, Write};
        let Some(path) = std::env::var_os("AURACODE_TEST_LEASE") else {
            return;
        };
        let _lease = acquire(Path::new(&path), false, true).unwrap();
        println!("lease-ready");
        std::io::stdout().flush().unwrap();
        let _ = std::io::stdin().read(&mut [0]);
    }

    #[test]
    fn subprocess_exit_releases_lease() {
        use std::io::{BufRead, BufReader};
        use std::process::{Command, Stdio};
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("lease");
        for killed in [false, true] {
            let mut child = Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "vault::lease::tests::lease_child", "--nocapture"])
                .env("AURACODE_TEST_LEASE", &path)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .unwrap();
            let mut output = BufReader::new(child.stdout.take().unwrap());
            loop {
                let mut line = String::new();
                assert_ne!(
                    output.read_line(&mut line).unwrap(),
                    0,
                    "child exited before acquiring its lease"
                );
                if line.contains("lease-ready") {
                    break;
                }
            }
            let reader = acquire(&path, false, false).unwrap();
            assert!(acquire(&path, true, false).is_err());
            drop(reader);
            if killed {
                child.kill().unwrap();
            } else {
                drop(child.stdin.take());
            }
            let status = child.wait().unwrap();
            if !killed {
                assert!(status.success());
            }
            assert!(acquire(&path, true, false).is_ok());
        }
    }

    #[cfg(unix)]
    #[test]
    fn symbolic_links_are_refused() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("target");
        std::fs::write(&target, []).unwrap();
        let link = temp.path().join("link");
        std::os::unix::fs::symlink(target, &link).unwrap();
        assert!(acquire(&link, true, true).is_err());
    }
}
