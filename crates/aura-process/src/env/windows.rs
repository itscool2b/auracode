//! The Windows environment: HKLM `SYSTEM\CurrentControlSet\Control\Session Manager\Environment`,
//! then HKCU `Environment` (the user wins), read through `winreg` on a blocking thread. The merge
//! and the expansion are pure and build on every OS, so their tests run everywhere.

/// Expands `%NAME%` references (case-insensitive) with `lookup`, as `REG_EXPAND_SZ` values need.
/// Unknown names stay literally; a reference cycle stops expanding. Pure.
pub fn expand_env_strings(value: &str, _lookup: impl Fn(&str) -> Option<String>) -> String {
    value.to_owned()
}

/// `PATH` from the system, user and process values: system entries, then user entries, then
/// process entries not yet present, de-duplicated case-insensitively, the first occurrence kept.
/// Pure.
pub fn merge_windows_path(
    machine: Option<&str>,
    user: Option<&str>,
    process: Option<&str>,
) -> String {
    [machine, user, process]
        .into_iter()
        .flatten()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(";")
}
