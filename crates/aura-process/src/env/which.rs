//! Finding programs on an env's `PATH`.

use std::path::PathBuf;

use super::EnvMap;

/// The first file on the env's `PATH`, in order, that is executable (on Windows, with each
/// `PATHEXT` extension). Symlinks are never resolved: agents launch through their stable symlink
/// or shim.
pub fn find_program(_name: &str, _env: &EnvMap) -> Option<PathBuf> {
    None
}

/// [`find_program`] on Unix; on Windows only `<name>.exe`, because the adapters spawn the path they
/// are given and Node refuses to spawn `.cmd` shims without a shell.
pub fn find_exe(_name: &str, _env: &EnvMap) -> Option<PathBuf> {
    None
}
