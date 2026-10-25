//! The login shell (macOS and Linux): which shell, its argv per family, and parsing its output.
//!
//! The command prints a fresh nonce marker, `/usr/bin/env -0`, and a second marker, so whatever the
//! user's rc files print around it is ignored: `<shell> -i -l -c "printf '%s' 'S'; /usr/bin/env -0;
//! printf '%s' 'E'"` for the POSIX family and fish, `-i -c` for csh and tcsh.

use super::EnvMap;

/// Parses the env between the last `start` marker before the last `end` marker and that `end`:
/// NUL-separated `NAME=value` entries, split at the first `=`; entries without `=` or with an empty
/// name are skipped, and a later duplicate wins. `None` when a marker is missing. Pure.
pub fn parse_env0(_output: &[u8], _start: &str, _end: &str) -> Option<EnvMap> {
    None
}
