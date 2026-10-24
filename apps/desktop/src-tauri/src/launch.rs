//! How this launch was asked to behave, read once from the environment at startup.
//!
//! These switches exist for automation, not for users: `AURACODE_SMOKE` runs a scripted check and
//! reports the result on stdout, `AURACODE_STRESS` opens straight into the stress view for the power
//! spike, and `AURACODE_NO_GLASS` turns the native window material off so its cost can be measured.
//! The frontend learns the outcome through `app_info` (`LaunchMode`), never by reading the
//! environment itself.
//!
//! `AURACODE_DATA_DIR` is aura-core's: it moves the data folder. This module only notes whether it
//! does, because a launch with its own data folder is its own instance
//! ([`LaunchOptions::single_instance`]).

use std::ffi::{OsStr, OsString};

use aura_core::paths::DATA_DIR_ENV;
use serde::{Deserialize, Serialize};

/// `1` runs the smoke check: a demo turn, a cancelled turn, and a short stress burst.
pub const SMOKE_ENV: &str = "AURACODE_SMOKE";
/// With smoke mode, `1` exits after the report: code 0 when it passed, 1 otherwise.
pub const SMOKE_EXIT_ENV: &str = "AURACODE_SMOKE_EXIT";
/// `orbs=24,rate=200,aura=1,seconds=0` opens the stress view with those settings.
pub const STRESS_ENV: &str = "AURACODE_STRESS";
/// `1` disables window effects and transparency (an opaque window).
pub const NO_GLASS_ENV: &str = "AURACODE_NO_GLASS";

/// Bounds for [`StressConfig`], shared with the stress view's controls.
pub const MIN_ORBS: u32 = 1;
pub const MAX_ORBS: u32 = 24;
pub const MIN_RATE: u32 = aura_drivers::mock::MIN_TOKENS_PER_SEC;
pub const MAX_RATE: u32 = aura_drivers::mock::MAX_TOKENS_PER_SEC;
/// A day. Longer runs use `seconds=0` (until the window closes).
pub const MAX_SECONDS: u32 = 86_400;

/// Settings for the stress view: `orbs` live orbs, a stream at `rate` tokens per second, the aura
/// field on or off, for `seconds` seconds (0 keeps streaming until the window closes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct StressConfig {
    pub orbs: u32,
    pub rate: u32,
    pub aura: bool,
    pub seconds: u32,
}

impl Default for StressConfig {
    fn default() -> StressConfig {
        StressConfig {
            orbs: 6,
            rate: 200,
            aura: true,
            seconds: 0,
        }
    }
}

/// Why an `AURACODE_STRESS` value was rejected. Rejected rather than clamped: the value drives a
/// power measurement, and a silently adjusted setting would measure something else.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StressConfigError {
    #[error("\"{0}\" is not a key=value pair")]
    NotAPair(String),
    #[error("unknown setting \"{0}\" (expected orbs, rate, aura or seconds)")]
    UnknownKey(String),
    #[error("\"{0}\" is set more than once")]
    Duplicate(String),
    #[error("{key} must be a whole number from {min} to {max}, not \"{value}\"")]
    OutOfRange {
        key: &'static str,
        value: String,
        min: u32,
        max: u32,
    },
    #[error("aura must be 1 or 0, not \"{0}\"")]
    NotABool(String),
}

/// Parses `AURACODE_STRESS`: comma-separated `key=value` pairs (`orbs`, `rate`, `aura`, `seconds`)
/// in any order, with defaults for missing keys. A bare `1`/`true`/`yes`/`on` means all defaults.
/// Keys are case-insensitive and whitespace around entries is ignored. The frontend's
/// `parseStressConfig` (lib/stress.ts) applies the same rules to the stress view's settings line,
/// and both test the same cases.
pub fn parse_stress_config(input: &str) -> Result<StressConfig, StressConfigError> {
    let trimmed = input.trim();
    let mut config = StressConfig::default();
    if is_truthy(trimmed) {
        return Ok(config);
    }
    let mut seen: Vec<&'static str> = Vec::new();
    for entry in trimmed.split(',').map(str::trim).filter(|e| !e.is_empty()) {
        let Some((raw_key, raw_value)) = entry.split_once('=') else {
            return Err(StressConfigError::NotAPair(entry.to_string()));
        };
        let key = match raw_key.trim().to_ascii_lowercase().as_str() {
            "orbs" => "orbs",
            "rate" => "rate",
            "aura" => "aura",
            "seconds" => "seconds",
            _ => return Err(StressConfigError::UnknownKey(raw_key.trim().to_string())),
        };
        if seen.contains(&key) {
            return Err(StressConfigError::Duplicate(key.to_string()));
        }
        seen.push(key);
        let value = raw_value.trim();
        match key {
            "orbs" => config.orbs = parse_bounded(key, value, MIN_ORBS, MAX_ORBS)?,
            "rate" => config.rate = parse_bounded(key, value, MIN_RATE, MAX_RATE)?,
            "seconds" => config.seconds = parse_bounded(key, value, 0, MAX_SECONDS)?,
            _ => config.aura = parse_bool(value)?,
        }
    }
    Ok(config)
}

/// Only plain decimal digits: `u32::from_str` would also take `+5`, which the frontend's parser
/// rejects, and the two must agree.
fn parse_bounded(
    key: &'static str,
    value: &str,
    min: u32,
    max: u32,
) -> Result<u32, StressConfigError> {
    let out_of_range = || StressConfigError::OutOfRange {
        key,
        value: value.to_string(),
        min,
        max,
    };
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
        return Err(out_of_range());
    }
    match value.parse::<u32>() {
        Ok(number) if (min..=max).contains(&number) => Ok(number),
        _ => Err(out_of_range()),
    }
}

fn parse_bool(value: &str) -> Result<bool, StressConfigError> {
    if is_truthy(value) {
        Ok(true)
    } else if is_falsy(value) {
        Ok(false)
    } else {
        Err(StressConfigError::NotABool(value.to_string()))
    }
}

fn is_truthy(value: &str) -> bool {
    ["1", "true", "yes", "on"]
        .iter()
        .any(|v| value.eq_ignore_ascii_case(v))
}

fn is_falsy(value: &str) -> bool {
    ["0", "false", "no", "off"]
        .iter()
        .any(|v| value.eq_ignore_ascii_case(v))
}

/// Whether an on/off environment variable is on. Unset, blank, and anything but `1`, `true`, `yes`
/// or `on` (any case) is off, so `AURACODE_SMOKE=0` really means off.
pub fn env_flag(value: Option<&str>) -> bool {
    value.is_some_and(|v| is_truthy(v.trim()))
}

/// Whether an `AURACODE_DATA_DIR` value moves the data folder, by the rule aura-core's
/// `DataRoot::resolve` applies: a value that is empty or only whitespace is ignored, and one that
/// is not valid Unicode counts unless it is empty. aura-core keeps the rule private, so
/// `own_data_dir_agrees_with_where_aura_core_puts_the_data` holds the two together.
fn moves_data_root(value: &OsStr) -> bool {
    match value.to_str() {
        Some(text) => !text.trim().is_empty(),
        None => !value.is_empty(),
    }
}

/// What the UI should open into. Smoke mode wins over the stress view, since it is the one that
/// exits by itself and a CI job is waiting on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LaunchMode {
    Normal,
    Smoke,
    Stress { config: StressConfig },
}

/// Every launch switch, read once.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchOptions {
    pub smoke: bool,
    pub smoke_exit: bool,
    pub no_glass: bool,
    /// `AURACODE_DATA_DIR` gives this launch its own data folder: a second dev instance, a portable
    /// install.
    pub own_data_dir: bool,
    /// `None` when `AURACODE_STRESS` is unset, blank (like `AURACODE_DATA_DIR`, an exported but
    /// empty variable must not change behaviour), or an explicit off (`0`, `false`, `no`, `off`).
    pub stress: Option<Result<StressConfig, StressConfigError>>,
}

impl LaunchOptions {
    pub fn from_env() -> LaunchOptions {
        LaunchOptions::from_lookup(|name| std::env::var_os(name))
    }

    /// [`LaunchOptions::from_env`] with the variables passed in, so tests never touch the process
    /// environment (shared by every test thread). Values come as the OS gave them: aura-core
    /// honours an `AURACODE_DATA_DIR` that is not valid Unicode, so this must see it too. The
    /// other switches treat such a value as unset.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<OsString>) -> LaunchOptions {
        let text = |name: &str| lookup(name).and_then(|value| value.into_string().ok());
        let smoke = env_flag(text(SMOKE_ENV).as_deref());
        LaunchOptions {
            smoke,
            smoke_exit: smoke && env_flag(text(SMOKE_EXIT_ENV).as_deref()),
            no_glass: env_flag(text(NO_GLASS_ENV).as_deref()),
            own_data_dir: lookup(DATA_DIR_ENV).is_some_and(|value| moves_data_root(&value)),
            stress: text(STRESS_ENV)
                .filter(|value| !value.trim().is_empty() && !is_falsy(value.trim()))
                .map(|value| parse_stress_config(&value)),
        }
    }

    /// Whether this launch registers the single-instance plugin, which makes a later launch focus
    /// this one's window and exit. The plugin recognizes the running instance by the bundle
    /// identifier alone, so every launch on the machine counts as the same app. Two kinds of
    /// launch run on their own instead: a smoke run, which has to run even while someone has
    /// auracode open, and a launch with its own data folder, which would otherwise exit without
    /// ever opening it. Such a launch never hands over to a running instance, and later launches
    /// never hand over to it. Sharing data with a running instance is safe: aura-core coordinates
    /// processes that open the same database.
    pub fn single_instance(&self) -> bool {
        !self.smoke && !self.own_data_dir
    }

    pub fn mode(&self) -> LaunchMode {
        if self.smoke {
            return LaunchMode::Smoke;
        }
        match &self.stress {
            Some(Ok(config)) => LaunchMode::Stress { config: *config },
            Some(Err(_)) | None => LaunchMode::Normal,
        }
    }

    /// Sentences for the UI's notices list: settings that were present but could not be used.
    pub fn notices(&self) -> Vec<String> {
        let mut notices = Vec::new();
        if let Some(Err(error)) = &self.stress {
            notices.push(format!(
                "{STRESS_ENV} was ignored because it is not valid: {error}."
            ));
        }
        if self.no_glass {
            notices.push(format!(
                "Window glass is off because {NO_GLASS_ENV} is set."
            ));
        }
        notices
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config(orbs: u32, rate: u32, aura: bool, seconds: u32) -> StressConfig {
        StressConfig {
            orbs,
            rate,
            aura,
            seconds,
        }
    }

    #[test]
    fn parses_the_documented_example() {
        assert_eq!(
            parse_stress_config("orbs=24,rate=200,aura=1,seconds=0"),
            Ok(config(24, 200, true, 0))
        );
    }

    #[test]
    fn missing_keys_take_defaults_and_order_does_not_matter() {
        assert_eq!(
            parse_stress_config("seconds=30, orbs=3"),
            Ok(config(3, 200, true, 30))
        );
        assert_eq!(parse_stress_config("aura=0"), Ok(config(6, 200, false, 0)));
    }

    #[test]
    fn a_bare_flag_means_all_defaults() {
        for flag in ["1", "true", "YES", " on "] {
            assert_eq!(
                parse_stress_config(flag),
                Ok(StressConfig::default()),
                "{flag}"
            );
        }
    }

    #[test]
    fn whitespace_case_and_empty_entries_are_tolerated() {
        assert_eq!(
            parse_stress_config(" ORBS = 2 ,, Rate=10 , aura = off ,"),
            Ok(config(2, 10, false, 0))
        );
    }

    #[test]
    fn bounds_are_inclusive() {
        assert_eq!(
            parse_stress_config("orbs=1,rate=1,seconds=86400"),
            Ok(config(1, 1, true, 86_400))
        );
        assert_eq!(
            parse_stress_config("orbs=24,rate=5000"),
            Ok(config(24, 5000, true, 0))
        );
    }

    #[test]
    fn out_of_range_and_malformed_numbers_are_rejected() {
        for input in [
            "orbs=0",
            "orbs=25",
            "rate=0",
            "rate=5001",
            "seconds=86401",
            "orbs=-1",
            "orbs=+5",
            "orbs=2.5",
            "orbs=",
            "rate=99999999999",
            "orbs=1e3",
        ] {
            assert!(
                matches!(
                    parse_stress_config(input),
                    Err(StressConfigError::OutOfRange { .. })
                ),
                "{input}"
            );
        }
    }

    #[test]
    fn unknown_duplicate_and_unpaired_entries_are_rejected() {
        assert_eq!(
            parse_stress_config("orbs=2,speed=3"),
            Err(StressConfigError::UnknownKey("speed".into()))
        );
        assert_eq!(
            parse_stress_config("orbs=2,ORBS=3"),
            Err(StressConfigError::Duplicate("orbs".into()))
        );
        assert_eq!(
            parse_stress_config("orbs"),
            Err(StressConfigError::NotAPair("orbs".into()))
        );
        assert_eq!(
            parse_stress_config("aura=maybe"),
            Err(StressConfigError::NotABool("maybe".into()))
        );
    }

    #[test]
    fn errors_read_as_sentences_in_the_notice() {
        let options =
            LaunchOptions::from_lookup(|name| (name == STRESS_ENV).then(|| "orbs=99".into()));
        assert_eq!(options.mode(), LaunchMode::Normal);
        assert_eq!(
            options.notices(),
            vec![
                "AURACODE_STRESS was ignored because it is not valid: orbs must be a whole number from 1 to 24, not \"99\"."
                    .to_string()
            ]
        );
    }

    fn options(vars: &[(&str, &str)]) -> LaunchOptions {
        let map: HashMap<String, OsString> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), OsString::from(v)))
            .collect();
        LaunchOptions::from_lookup(|name| map.get(name).cloned())
    }

    #[test]
    fn flags_need_an_explicit_on_value() {
        assert!(env_flag(Some("1")));
        assert!(env_flag(Some(" TRUE ")));
        assert!(!env_flag(Some("0")));
        assert!(!env_flag(Some("")));
        assert!(!env_flag(Some("off")));
        assert!(!env_flag(None));
    }

    #[test]
    fn smoke_wins_over_stress_and_exit_needs_smoke() {
        let both = options(&[
            (SMOKE_ENV, "1"),
            (SMOKE_EXIT_ENV, "1"),
            (STRESS_ENV, "orbs=3"),
        ]);
        assert_eq!(both.mode(), LaunchMode::Smoke);
        assert!(both.smoke_exit);

        let exit_alone = options(&[(SMOKE_EXIT_ENV, "1")]);
        assert!(!exit_alone.smoke_exit, "exit without smoke must do nothing");
        assert_eq!(exit_alone.mode(), LaunchMode::Normal);
    }

    #[test]
    fn stress_mode_carries_its_config() {
        let stress = options(&[(STRESS_ENV, "orbs=12,rate=400,aura=0,seconds=60")]);
        assert_eq!(
            stress.mode(),
            LaunchMode::Stress {
                config: config(12, 400, false, 60)
            }
        );
        assert!(stress.notices().is_empty());
    }

    #[test]
    fn a_blank_or_off_stress_variable_is_ignored() {
        for value in ["  ", "0", "off", "FALSE"] {
            let off = options(&[(STRESS_ENV, value)]);
            assert_eq!(off.stress, None, "{value:?}");
            assert_eq!(off.mode(), LaunchMode::Normal);
            assert!(off.notices().is_empty());
        }
    }

    /// Every launch registered the single-instance plugin, so a second one with its own data folder
    /// focused the running window and exited before opening that folder.
    #[test]
    fn a_launch_with_its_own_data_folder_is_its_own_instance() {
        let plain = options(&[]);
        assert!(!plain.own_data_dir);
        assert!(
            plain.single_instance(),
            "a plain launch hands over to a running one"
        );

        // "0" is not a flag here: aura-core reads it as a folder named 0.
        for value in [
            "/tmp/second instance",
            " relative ",
            r"D:\portable\data",
            "0",
        ] {
            let own = options(&[(DATA_DIR_ENV, value)]);
            assert!(own.own_data_dir, "{value:?}");
            assert!(!own.single_instance(), "{value:?}");
            assert!(own.notices().is_empty(), "nothing to report: {value:?}");
        }
        // aura-core ignores these, so the launch opens the default folder like any other.
        for value in ["", "   ", "\t\n"] {
            let blank = options(&[(DATA_DIR_ENV, value)]);
            assert!(!blank.own_data_dir, "{value:?}");
            assert!(blank.single_instance(), "{value:?}");
        }

        assert!(
            !options(&[(SMOKE_ENV, "1")]).single_instance(),
            "a smoke run"
        );
        let both = options(&[(SMOKE_ENV, "1"), (DATA_DIR_ENV, "/tmp/smoke data")]);
        assert!(!both.single_instance());
    }

    /// `prefix` followed by a folder name that is not valid Unicode, which the OS allows in a
    /// variable: invalid UTF-8 on Unix, a lone surrogate on Windows.
    #[cfg(unix)]
    fn not_unicode(prefix: &OsStr) -> OsString {
        use std::os::unix::ffi::OsStrExt;
        let mut value = prefix.to_os_string();
        value.push(OsStr::from_bytes(b"/caf\xe9"));
        value
    }

    #[cfg(windows)]
    fn not_unicode(prefix: &OsStr) -> OsString {
        use std::os::windows::ffi::{OsStrExt, OsStringExt};
        let mut wide: Vec<u16> = prefix.encode_wide().collect();
        wide.extend(r"\caf".encode_utf16());
        wide.push(0xD800);
        OsString::from_wide(&wide)
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn a_data_folder_that_is_not_unicode_still_counts() {
        let folder = not_unicode(OsStr::new("data"));
        assert_eq!(folder.to_str(), None);
        let own = LaunchOptions::from_lookup(|name| (name == DATA_DIR_ENV).then(|| folder.clone()));
        assert!(own.own_data_dir, "aura-core moves the data there");
        assert!(!own.single_instance());

        // The other switches read such a value as unset, as they always have.
        let garbled = LaunchOptions::from_lookup(|name| {
            (name != DATA_DIR_ENV).then(|| not_unicode(OsStr::new("1")))
        });
        assert!(!garbled.smoke && !garbled.no_glass && !garbled.own_data_dir);
        assert_eq!(garbled.stress, None);
    }

    /// Marks a re-executed copy of the test binary (see the next test).
    const CHILD_CHECKS_DATA_DIR: &str = "AURACODE_DESKTOP_TEST_CHECK_DATA_DIR";

    /// aura-core keeps its rule for `AURACODE_DATA_DIR` private and `moves_data_root` restates it.
    /// If the two drifted apart, a launch on the default folder would skip the single-instance
    /// plugin, or one with its own folder would hand over and exit. So for each value a child
    /// process (this process's environment must not change) checks that `own_data_dir` holds
    /// exactly when aura-core resolves a folder other than its default, the only one named
    /// `si.auracode.desktop`. Resolving only computes the path; nothing is created.
    #[test]
    fn own_data_dir_agrees_with_where_aura_core_puts_the_data() {
        if std::env::var_os(CHILD_CHECKS_DATA_DIR).is_some() {
            let root = aura_core::paths::DataRoot::resolve().expect("resolve the data folder");
            let default = root.root().ends_with(aura_core::paths::APP_IDENTIFIER);
            assert_eq!(
                LaunchOptions::from_env().own_data_dir,
                !default,
                "{}",
                root.root().display()
            );
            return;
        }

        let dir = tempfile::tempdir().expect("tempdir");
        let folder = dir.path().join("own data").into_os_string();
        let mut padded = OsString::from("  ");
        padded.push(&folder);
        padded.push(" \t");
        let mut values = vec![
            OsString::new(),
            OsString::from("   "),
            OsString::from("\t\n"),
            OsString::from("0"),
            folder,
            padded,
        ];
        #[cfg(any(unix, windows))]
        values.push(not_unicode(dir.path().as_os_str()));
        for value in values {
            crate::test_support::run_child(
                "launch::tests::own_data_dir_agrees_with_where_aura_core_puts_the_data",
                |child| {
                    child
                        .env(CHILD_CHECKS_DATA_DIR, "1")
                        .env(DATA_DIR_ENV, &value);
                },
            );
        }
    }

    #[test]
    fn no_glass_is_reported_as_a_notice() {
        let opaque = options(&[(NO_GLASS_ENV, "1")]);
        assert!(opaque.no_glass);
        assert_eq!(
            opaque.notices(),
            vec!["Window glass is off because AURACODE_NO_GLASS is set.".to_string()]
        );
    }

    #[test]
    fn launch_mode_serializes_with_a_type_tag() {
        assert_eq!(
            serde_json::to_value(LaunchMode::Stress {
                config: config(2, 50, true, 0)
            })
            .expect("serialize"),
            serde_json::json!({
                "type": "stress",
                "config": { "orbs": 2, "rate": 50, "aura": true, "seconds": 0 }
            })
        );
        assert_eq!(
            serde_json::to_value(LaunchMode::Normal).expect("serialize"),
            serde_json::json!({ "type": "normal" })
        );
    }
}
