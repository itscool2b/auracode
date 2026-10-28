//! Where auracode's data lives on each platform.
//!
//! Every folder here is named after the bundle identifier, so it is auracode's alone; a data folder
//! chosen with `AURACODE_DATA_DIR` is not, and only the entries auracode made in it go.

use std::path::PathBuf;

use super::Scope;
use crate::paths::APP_IDENTIFIER;

/// The platform whose layout to use. Tests pick one; the app uses [`Os::current`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Windows,
    Macos,
    Other,
}

impl Os {
    pub fn current() -> Os {
        if cfg!(windows) {
            Os::Windows
        } else if cfg!(target_os = "macos") {
            Os::Macos
        } else {
            Os::Other
        }
    }
}

/// The platform folders the layout builds on: `dirs`' answers in the app, temporary folders in
/// tests.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PlatformDirs {
    pub home: Option<PathBuf>,
    /// The local, never roaming, app data folder: the data root's parent.
    pub local_data: Option<PathBuf>,
    /// Where Tauri keeps per-app configuration (the window state): Roaming AppData on Windows.
    pub config: Option<PathBuf>,
    pub cache: Option<PathBuf>,
    pub temp: Option<PathBuf>,
}

impl PlatformDirs {
    pub fn current() -> PlatformDirs {
        PlatformDirs {
            home: dirs::home_dir(),
            local_data: dirs::data_local_dir(),
            config: dirs::config_dir(),
            cache: dirs::cache_dir(),
            temp: Some(std::env::temp_dir()),
        }
    }
}

/// What a cleanup looks at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Targets {
    pub scope: Scope,
    /// Folders named after auracode, removed whole (around kept worktrees). In machine scope the
    /// first is the default data folder.
    pub owned_dirs: Vec<PathBuf>,
    /// Files named after auracode: macOS preferences and cookies, the single-instance socket.
    pub owned_files: Vec<PathBuf>,
    /// Data folders chosen with `AURACODE_DATA_DIR`: only [`super::DATA_ENTRIES`] go.
    pub shared_roots: Vec<PathBuf>,
    /// Every data folder, for worktrees and secure-store index entries.
    pub data_roots: Vec<PathBuf>,
    /// The temporary folder, for the updater's leftovers.
    pub temp_dir: Option<PathBuf>,
}

impl Targets {
    /// Everything for this user on this machine: the default data folder, the platform's folders
    /// for auracode, and `env_root` (a data folder from `AURACODE_DATA_DIR`) when there is one.
    pub fn machine(os: Os, dirs: &PlatformDirs, env_root: Option<PathBuf>) -> Targets {
        let id = APP_IDENTIFIER;
        let mut owned_dirs = Vec::new();
        let mut owned_files = Vec::new();
        let mut data_roots = Vec::new();
        let default_root = dirs.local_data.as_ref().map(|dir| dir.join(id));
        if let Some(root) = &default_root {
            owned_dirs.push(root.clone());
            data_roots.push(root.clone());
        }
        let mut add = |path: Option<PathBuf>| {
            if let Some(path) = path
                && !owned_dirs.contains(&path)
            {
                owned_dirs.push(path);
            }
        };
        match os {
            Os::Windows => {
                // Roaming AppData: the window-state plugin's `.window-state.json`. The webview
                // profile (EBWebView) and caches are inside the data folder.
                add(dirs.config.as_ref().map(|dir| dir.join(id)));
                add(dirs.cache.as_ref().map(|dir| dir.join(id)));
            }
            Os::Macos => {
                let library = dirs.home.as_ref().map(|home| home.join("Library"));
                add(dirs.cache.as_ref().map(|dir| dir.join(id)));
                for folder in ["WebKit", "HTTPStorages", "Logs"] {
                    add(library
                        .as_ref()
                        .map(|library| library.join(folder).join(id)));
                }
                add(library.as_ref().map(|library| {
                    library
                        .join("Saved Application State")
                        .join(format!("{id}.savedState"))
                }));
                if let Some(library) = &library {
                    owned_files.push(
                        library
                            .join("HTTPStorages")
                            .join(format!("{id}.binarycookies")),
                    );
                    owned_files.push(library.join("Preferences").join(format!("{id}.plist")));
                }
                // tauri-plugin-single-instance's socket, left behind if the app was killed.
                owned_files.push(PathBuf::from("/tmp/si_auracode_desktop_si.sock"));
            }
            Os::Other => {
                add(dirs.config.as_ref().map(|dir| dir.join(id)));
                add(dirs.cache.as_ref().map(|dir| dir.join(id)));
            }
        }
        let mut shared_roots = Vec::new();
        if let Some(root) = env_root
            && Some(&root) != default_root.as_ref()
            && !owned_dirs.contains(&root)
        {
            shared_roots.push(root.clone());
            data_roots.push(root);
        }
        Targets {
            scope: Scope::Machine,
            owned_dirs,
            owned_files,
            shared_roots,
            data_roots,
            temp_dir: dirs.temp.clone(),
        }
    }

    /// One data folder chosen with `AURACODE_DATA_DIR`, alone: what auracode made in it, nothing
    /// of the installed app's.
    pub fn data_folder(root: PathBuf) -> Targets {
        Targets {
            scope: Scope::DataFolder,
            owned_dirs: Vec::new(),
            owned_files: Vec::new(),
            shared_roots: vec![root.clone()],
            data_roots: vec![root],
            temp_dir: None,
        }
    }
}
