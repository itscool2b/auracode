//! Resolve reviewed npm package bins without interpreting shell shim contents.

use std::ffi::OsString;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use aura_process::{EnvMap, find_exe};

const MAX_MANIFEST: u64 = 64 * 1024;

fn package(agent: &str) -> Option<(&'static str, &'static str)> {
    match agent {
        "pi" => Some(("@earendil-works/pi-coding-agent", "pi")),
        "omp" => Some(("@oh-my-pi/pi-coding-agent", "omp")),
        "grok" | "grok-stream" => Some(("@xai-official/grok", "grok")),
        _ => None,
    }
}

pub(crate) fn is_shim(path: &Path) -> bool {
    path.extension().is_some_and(|extension| {
        ["cmd", "bat", "ps1"]
            .iter()
            .any(|known| extension.eq_ignore_ascii_case(known))
    })
}

/// Only package.json is read. A relative bin must remain inside this exact reviewed package.
pub(crate) fn entry(agent: &str, shim: &Path) -> Option<PathBuf> {
    let (package, command) = package(agent)?;
    if !is_shim(shim) || !shim.file_stem()?.eq_ignore_ascii_case(command) || !shim.is_file() {
        return None;
    }
    let prefix = shim.parent()?;
    // A project-local .bin must not be treated as a global installation or updated with npm -g.
    if prefix.file_name().is_some_and(|name| name == ".bin") {
        return None;
    }
    let root = std::fs::canonicalize(prefix.join("node_modules").join(package)).ok()?;
    let file = std::fs::File::open(root.join("package.json")).ok()?;
    let mut bytes = Vec::new();
    file.take(MAX_MANIFEST + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > MAX_MANIFEST {
        return None;
    }
    let manifest: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    if manifest.get("name")?.as_str()? != package {
        return None;
    }
    let bin = manifest.get("bin")?;
    let relative = bin.as_str().or_else(|| bin.get(command)?.as_str())?;
    if relative.is_empty()
        || relative.contains(['\\', '\0', ':'])
        || Path::new(relative)
            .components()
            .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
    {
        return None;
    }
    let entry = std::fs::canonicalize(root.join(relative)).ok()?;
    if !entry.starts_with(&root) || !entry.is_file() {
        return None;
    }
    entry
        .extension()
        .is_some_and(|extension| {
            ["js", "mjs", "cjs", "exe"]
                .iter()
                .any(|known| extension.eq_ignore_ascii_case(known))
        })
        .then_some(entry)
}

/// The stable shim identifies an installation, but the launched command never invokes its shell.
pub(crate) fn command(
    agent: &str,
    path: &Path,
    env: &EnvMap,
) -> Result<(PathBuf, Vec<OsString>), String> {
    if !cfg!(windows) || !is_shim(path) {
        return Ok((path.to_owned(), Vec::new()));
    }
    let entry = entry(agent, path).ok_or_else(|| {
        "The shell shim has no supported package bin. Install the vendor's executable or reviewed npm package."
            .to_owned()
    })?;
    if entry
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
    {
        return Ok((entry, Vec::new()));
    }
    let node = find_exe("node", env)
        .ok_or_else(|| "Node.js was not found for this npm package entry.".to_owned())?;
    Ok((node, vec![entry.into_os_string()]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_reviewed_package_bin_is_resolved_and_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let shim = dir.path().join("pi.cmd");
        std::fs::write(&shim, "never interpreted").unwrap();
        let root = dir
            .path()
            .join("node_modules/@earendil-works/pi-coding-agent");
        std::fs::create_dir_all(root.join("dist")).unwrap();
        let target = root.join("dist/cli.js");
        std::fs::write(&target, "owned fixture").unwrap();
        let write = |name: &str, bin: serde_json::Value| {
            std::fs::write(
                root.join("package.json"),
                serde_json::json!({"name":name,"bin":bin}).to_string(),
            )
            .unwrap();
        };
        write(
            "@earendil-works/pi-coding-agent",
            serde_json::json!({"pi":"dist/cli.js"}),
        );
        assert_eq!(
            entry("pi", &shim),
            Some(std::fs::canonicalize(&target).unwrap())
        );
        assert_eq!(entry("omp", &shim), None);
        for bin in [
            "../outside.js",
            "/outside.js",
            "C:/outside.js",
            "dist\\cli.js",
            "dist/missing.js",
        ] {
            write("@earendil-works/pi-coding-agent", serde_json::json!(bin));
            assert_eq!(entry("pi", &shim), None, "{bin}");
        }
        write(
            "@oh-my-pi/pi-coding-agent",
            serde_json::json!("dist/cli.js"),
        );
        assert_eq!(entry("pi", &shim), None);
        std::fs::write(
            root.join("package.json"),
            vec![b' '; MAX_MANIFEST as usize + 1],
        )
        .unwrap();
        assert_eq!(entry("pi", &shim), None);
    }

    #[cfg(unix)]
    #[test]
    fn a_package_bin_symlink_cannot_escape_its_package() {
        let dir = tempfile::tempdir().unwrap();
        let shim = dir.path().join("omp.cmd");
        std::fs::write(&shim, "fixture").unwrap();
        let root = dir.path().join("node_modules/@oh-my-pi/pi-coding-agent");
        std::fs::create_dir_all(&root).unwrap();
        let outside = dir.path().join("outside.js");
        std::fs::write(&outside, "fixture").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("cli.js")).unwrap();
        std::fs::write(
            root.join("package.json"),
            r#"{"name":"@oh-my-pi/pi-coding-agent","bin":{"omp":"cli.js"}}"#,
        )
        .unwrap();
        assert_eq!(entry("omp", &shim), None);
    }
}
