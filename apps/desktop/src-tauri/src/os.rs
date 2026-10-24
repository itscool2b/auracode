//! Which OS release this is: the window material depends on it (Liquid Glass needs macOS 26, Mica
//! needs Windows 11), and the info card shows it.
//!
//! Detection reads what the OS itself reports (`SystemVersion.plist`, the Windows build number,
//! `os-release`) without spawning processes or calling unsafe FFI. The parsers are separate pure
//! functions so they are tested on every platform.

/// A dotted OS version. Missing components are 0, so `15` and `15.0.0` compare equal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct OsVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl OsVersion {
    pub const fn new(major: u32, minor: u32, patch: u32) -> OsVersion {
        OsVersion {
            major,
            minor,
            patch,
        }
    }

    /// `"26.6.2"`, `"15"`, `"10.0.22631"`. Anything but one to three dot-separated decimal numbers
    /// (after trimming) is `None`.
    pub fn parse(text: &str) -> Option<OsVersion> {
        let mut parts = [0u32; 3];
        for (index, part) in text.trim().split('.').enumerate() {
            let slot = parts.get_mut(index)?;
            if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            *slot = part.parse().ok()?;
        }
        let [major, minor, patch] = parts;
        Some(OsVersion::new(major, minor, patch))
    }
}

impl std::fmt::Display for OsVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

/// The running OS, as detected once at startup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OsInfo {
    /// `std::env::consts::OS`: `"macos"`, `"windows"`, `"linux"`, ...
    pub os: &'static str,
    /// `None` when the OS did not say (or said something unparseable).
    pub version: Option<OsVersion>,
    /// What the info card shows: the version as the OS writes it, or the distribution name.
    pub display: String,
}

impl OsInfo {
    pub fn detect() -> OsInfo {
        let os = std::env::consts::OS;
        let (version, display) = detect_version();
        OsInfo {
            os,
            version,
            display,
        }
    }
}

#[cfg(target_os = "macos")]
fn detect_version() -> (Option<OsVersion>, String) {
    const PLIST: &str = "/System/Library/CoreServices/SystemVersion.plist";
    match std::fs::read_to_string(PLIST) {
        Ok(text) => match plist_string(&text, "ProductVersion") {
            Some(raw) => (OsVersion::parse(raw), raw.to_string()),
            None => (None, "unknown".to_string()),
        },
        Err(error) => {
            tracing::warn!(%error, "could not read the macOS version");
            (None, "unknown".to_string())
        }
    }
}

#[cfg(target_os = "windows")]
fn detect_version() -> (Option<OsVersion>, String) {
    let current = windows_version::OsVersion::current();
    let version = OsVersion::new(current.major, current.minor, current.build);
    (Some(version), version.to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn detect_version() -> (Option<OsVersion>, String) {
    let text = ["/etc/os-release", "/usr/lib/os-release"]
        .iter()
        .find_map(|path| std::fs::read_to_string(path).ok());
    match text {
        Some(text) => {
            let version = os_release_field(&text, "VERSION_ID").and_then(|v| OsVersion::parse(&v));
            let display = os_release_field(&text, "PRETTY_NAME")
                .or_else(|| os_release_field(&text, "NAME"))
                .unwrap_or_else(|| "unknown".to_string());
            (version, display)
        }
        None => (None, "unknown".to_string()),
    }
}

/// The `<string>` value that follows `<key>{key}</key>` in an XML property list. Enough for
/// `SystemVersion.plist`, which is a flat dictionary of strings.
pub fn plist_string<'a>(plist: &'a str, key: &str) -> Option<&'a str> {
    let marker = format!("<key>{key}</key>");
    let after_key = &plist[plist.find(&marker)? + marker.len()..];
    let open = after_key.find("<string>")?;
    // The value must be the very next element, not a string further down.
    if !after_key[..open].trim().is_empty() {
        return None;
    }
    let value = &after_key[open + "<string>".len()..];
    let close = value.find("</string>")?;
    Some(value[..close].trim())
}

/// A field from an `os-release` file (`KEY=value`, `KEY="value"` or `KEY='value'`).
pub fn os_release_field(text: &str, key: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let (name, value) = line.trim().split_once('=')?;
        if name != key {
            return None;
        }
        let value = value.trim();
        let unquoted = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
            .unwrap_or(value);
        (!unquoted.is_empty()).then(|| unquoted.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dotted_versions() {
        assert_eq!(OsVersion::parse("26.6.2"), Some(OsVersion::new(26, 6, 2)));
        assert_eq!(OsVersion::parse(" 15 "), Some(OsVersion::new(15, 0, 0)));
        assert_eq!(
            OsVersion::parse("10.0.22631"),
            Some(OsVersion::new(10, 0, 22631))
        );
        assert_eq!(OsVersion::parse("16.0"), Some(OsVersion::new(16, 0, 0)));
    }

    #[test]
    fn rejects_anything_else() {
        for text in ["", "abc", "26.", ".1", "1.2.3.4", "26.x", "-1", "26 beta"] {
            assert_eq!(OsVersion::parse(text), None, "{text:?}");
        }
    }

    #[test]
    fn versions_order_numerically() {
        assert!(OsVersion::new(26, 0, 0) > OsVersion::new(15, 7, 3));
        assert!(OsVersion::new(10, 0, 22000) > OsVersion::new(10, 0, 19045));
    }

    const SYSTEM_VERSION: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>ProductName</key>
	<string>macOS</string>
	<key>ProductUserVisibleVersion</key>
	<string>26.6.2</string>
	<key>ProductVersion</key>
	<string>26.6.2</string>
</dict>
</plist>"#;

    #[test]
    fn reads_the_product_version_from_the_plist() {
        assert_eq!(
            plist_string(SYSTEM_VERSION, "ProductVersion"),
            Some("26.6.2")
        );
        assert_eq!(plist_string(SYSTEM_VERSION, "ProductName"), Some("macOS"));
        assert_eq!(plist_string(SYSTEM_VERSION, "BuildID"), None);
    }

    #[test]
    fn a_key_without_its_own_string_is_none() {
        let odd = "<key>ProductVersion</key><integer>26</integer><key>X</key><string>1</string>";
        assert_eq!(plist_string(odd, "ProductVersion"), None);
    }

    #[test]
    fn reads_os_release_fields() {
        let text = "NAME=\"Ubuntu\"\nVERSION_ID='24.04'\nPRETTY_NAME=\"Ubuntu 24.04.1 LTS\"\nID=ubuntu\nEMPTY=\"\"\n";
        assert_eq!(
            os_release_field(text, "PRETTY_NAME").as_deref(),
            Some("Ubuntu 24.04.1 LTS")
        );
        assert_eq!(
            os_release_field(text, "VERSION_ID").as_deref(),
            Some("24.04")
        );
        assert_eq!(os_release_field(text, "ID").as_deref(), Some("ubuntu"));
        assert_eq!(os_release_field(text, "EMPTY"), None);
        assert_eq!(os_release_field(text, "MISSING"), None);
    }

    #[test]
    fn detects_something_on_this_machine() {
        let info = OsInfo::detect();
        assert_eq!(info.os, std::env::consts::OS);
        assert!(!info.display.is_empty());
        if cfg!(any(target_os = "macos", target_os = "windows")) {
            assert!(info.version.is_some(), "{info:?}");
        }
    }
}
