//! The Windows environment: HKLM `SYSTEM\CurrentControlSet\Control\Session Manager\Environment`,
//! then HKCU `Environment` (the user wins), read through `winreg` on a blocking thread. `REG_EXPAND_SZ`
//! values are expanded; `PATH` is system, then user, then the entries of auracode's own `PATH` not
//! yet present. The merge and the expansion are pure and build on every OS, so their tests run
//! everywhere.

use std::collections::HashSet;

/// Expands `%NAME%` references with `lookup`, as `REG_EXPAND_SZ` values need. Names reach `lookup`
/// as written; Windows lookups ignore case. A value that `lookup` returns is expanded in turn,
/// except a name already being expanded (a cycle), which stays literally, as do unknown names and
/// an unpaired `%`. Pure.
pub fn expand_env_strings(value: &str, lookup: impl Fn(&str) -> Option<String>) -> String {
    expand(value, &lookup, &mut Vec::new())
}

fn expand(
    value: &str,
    lookup: &dyn Fn(&str) -> Option<String>,
    active: &mut Vec<String>,
) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(open) = rest.find('%') {
        out.push_str(rest.get(..open).unwrap_or_default());
        let after = rest.get(open + 1..).unwrap_or_default();
        let Some(close) = after.find('%') else {
            out.push('%');
            rest = after;
            break;
        };
        let name = after.get(..close).unwrap_or_default();
        let folded = name.to_ascii_uppercase();
        let found = if name.is_empty() || active.contains(&folded) {
            None
        } else {
            lookup(name)
        };
        match found {
            Some(found) => {
                active.push(folded);
                out.push_str(&expand(&found, lookup, active));
                active.pop();
                rest = after.get(close + 1..).unwrap_or_default();
            }
            None if name.is_empty() => {
                // `%%`: the second `%` may open a reference of its own.
                out.push('%');
                rest = after;
            }
            None => {
                out.push('%');
                out.push_str(name);
                out.push('%');
                rest = after.get(close + 1..).unwrap_or_default();
            }
        }
    }
    out.push_str(rest);
    out
}

/// `PATH` from the system, user and process values: system entries, then user entries, then
/// process entries not yet present, de-duplicated without case, the first occurrence kept. Pure.
pub fn merge_windows_path(
    machine: Option<&str>,
    user: Option<&str>,
    process: Option<&str>,
) -> String {
    let mut seen = HashSet::new();
    let mut merged: Vec<&str> = Vec::new();
    for entry in [machine, user, process]
        .into_iter()
        .flatten()
        .flat_map(|value| value.split(';'))
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
    {
        if seen.insert(entry.to_lowercase()) {
            merged.push(entry);
        }
    }
    merged.join(";")
}

/// The registry's environment over `base` (auracode's own env without its launch context).
#[cfg(windows)]
pub(crate) fn registry_env(base: &super::EnvMap) -> std::io::Result<super::EnvMap> {
    use super::EnvKey;
    use std::io;
    use winreg::enums::RegType;
    use winreg::types::FromRegValue;

    /// One registry value: its name, its text, and whether it is `REG_EXPAND_SZ`.
    type Value = (String, String, bool);

    fn read(key: &winreg::RegKey) -> Vec<Value> {
        key.enum_values()
            .flatten()
            .filter_map(|(name, value)| {
                let expand = matches!(value.vtype, RegType::REG_EXPAND_SZ);
                let text = match value.vtype {
                    RegType::REG_SZ | RegType::REG_EXPAND_SZ => {
                        String::from_reg_value(&value).ok()?
                    }
                    _ => return None,
                };
                Some((name, text, expand))
            })
            .collect()
    }

    let system = winreg::HKLM
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")
        .map(|key| read(&key))?;
    let user = match winreg::HKCU.open_subkey("Environment") {
        Ok(key) => read(&key),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(error),
    };
    let raw = |name: &str| -> Option<String> {
        user.iter()
            .chain(system.iter())
            .find(|(known, _, _)| known.eq_ignore_ascii_case(name))
            .map(|(_, text, _)| text.clone())
            .or_else(|| {
                base.get(&EnvKey::from(name))
                    .map(|value| value.to_string_lossy().into_owned())
            })
    };
    let resolve = |text: &str, expand: bool| -> String {
        if expand {
            expand_env_strings(text, raw)
        } else {
            text.to_owned()
        }
    };
    let path_of = |values: &[Value]| -> Option<String> {
        values
            .iter()
            .find(|(name, _, _)| name.eq_ignore_ascii_case("Path"))
            .map(|(_, text, expand)| resolve(text, *expand))
    };
    let mut vars = base.clone();
    for (name, text, expand) in system.iter().chain(user.iter()) {
        if name.eq_ignore_ascii_case("Path") {
            continue;
        }
        vars.insert(EnvKey::from(name.as_str()), resolve(text, *expand).into());
    }
    let process_path = base
        .get(&EnvKey::from("PATH"))
        .map(|value| value.to_string_lossy().into_owned());
    let path = merge_windows_path(
        path_of(&system).as_deref(),
        path_of(&user).as_deref(),
        process_path.as_deref(),
    );
    vars.insert(EnvKey::from("Path"), path.into());
    Ok(vars)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lookup(name: &str) -> Option<String> {
        let vars = [
            ("SystemRoot", "C:\\Windows"),
            ("USERPROFILE", "C:\\Users\\me"),
            ("JAVA_HOME", "%ProgramFiles%\\Java"),
            ("ProgramFiles", "C:\\Program Files"),
            ("LOOP_A", "%LOOP_B%"),
            ("LOOP_B", "x%LOOP_A%y"),
            ("SELF", "%self%"),
        ];
        vars.iter()
            .find(|(known, _)| known.eq_ignore_ascii_case(name))
            .map(|(_, value)| (*value).to_owned())
    }

    #[test]
    fn expansion_ignores_case_keeps_unknown_names_and_stops_cycles() {
        assert_eq!(
            expand_env_strings("%systemroot%\\System32;%USERPROFILE%\\bin", lookup),
            "C:\\Windows\\System32;C:\\Users\\me\\bin"
        );
        assert_eq!(
            expand_env_strings("%JAVA_HOME%\\bin", lookup),
            "C:\\Program Files\\Java\\bin",
            "a looked-up value is expanded too"
        );
        assert_eq!(expand_env_strings("%NOPE%\\x", lookup), "%NOPE%\\x");
        assert_eq!(expand_env_strings("100% sure", lookup), "100% sure");
        assert_eq!(expand_env_strings("%%SystemRoot%", lookup), "%C:\\Windows");
        assert_eq!(expand_env_strings("%LOOP_A%", lookup), "x%LOOP_A%y");
        assert_eq!(expand_env_strings("%SELF%", lookup), "%self%");
        assert_eq!(expand_env_strings("plain", lookup), "plain");
    }

    #[test]
    fn windows_path_merge() {
        let system = expand_env_strings(
            "%SystemRoot%\\system32;%SystemRoot%;C:\\Program Files\\Git\\cmd",
            lookup,
        );
        let user = expand_env_strings("%USERPROFILE%\\.local\\bin;C:\\WINDOWS\\SYSTEM32;", lookup);
        let process = "C:\\Windows\\system32;C:\\Users\\me\\AppData\\Local\\Temp\\npm-shim;C:\\users\\ME\\.local\\bin";
        assert_eq!(
            merge_windows_path(Some(&system), Some(&user), Some(process)),
            "C:\\Windows\\system32;C:\\Windows;C:\\Program Files\\Git\\cmd;C:\\Users\\me\\.local\\bin;C:\\Users\\me\\AppData\\Local\\Temp\\npm-shim"
        );
        assert_eq!(merge_windows_path(None, None, Some(" ; ;x ")), "x");
        assert_eq!(merge_windows_path(None, None, None), "");
    }

    #[cfg(windows)]
    #[test]
    fn windows_registry_read() {
        let mut base = super::super::process_env();
        super::super::strip_launch_context(&mut base);
        let vars = registry_env(&base).expect("the registry is readable");
        let path = vars
            .get(&super::super::EnvKey::from("PATH"))
            .expect("a PATH")
            .to_string_lossy()
            .into_owned();
        assert!(path.to_ascii_lowercase().contains("system32"), "{path}");
        assert!(!path.contains("%SystemRoot%"), "expanded: {path}");
        assert!(vars.contains_key(&super::super::EnvKey::from("SystemRoot")));
    }
}
