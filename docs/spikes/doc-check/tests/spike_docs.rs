//! Runs every rule against the real spike docs (docs/spikes/*.md), the repository's lockfiles, the
//! generated TypeScript bindings and the code they quote. A failure names the doc and line, and
//! says what to change.

use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

use spike_doc_check::{
    Finding, check_links, check_quoted_literals, check_status, check_union_listings,
    check_versions, locked_packages, union_values,
};

type TestResult = Result<(), Box<dyn Error>>;

/// docs/spikes, which holds the docs and this crate.
fn spikes_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn repo_root() -> PathBuf {
    spikes_dir().join("..").join("..")
}

/// Every spike doc and its text, by file name.
fn spike_docs() -> Result<Vec<(String, String)>, Box<dyn Error>> {
    let mut docs = Vec::new();
    for entry in fs::read_dir(spikes_dir())? {
        let path = entry?.path();
        if path.extension().is_some_and(|extension| extension == "md") {
            let name = path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            docs.push((name, fs::read_to_string(&path)?));
        }
    }
    docs.sort();
    if docs.len() < 4 {
        return Err(format!("expected the four M0 spike docs, found {}", docs.len()).into());
    }
    Ok(docs)
}

/// Crate name to every version locked by the root Cargo.lock and each spike's own.
fn locked_versions() -> Result<BTreeMap<String, BTreeSet<String>>, Box<dyn Error>> {
    let mut lockfiles = vec![repo_root().join("Cargo.lock")];
    for entry in fs::read_dir(spikes_dir())? {
        let lockfile = entry?.path().join("Cargo.lock");
        if lockfile.is_file() {
            lockfiles.push(lockfile);
        }
    }
    let mut locked: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for lockfile in &lockfiles {
        for (name, version) in locked_packages(&fs::read_to_string(lockfile)?) {
            locked.entry(name).or_default().insert(version);
        }
    }
    if !locked.contains_key("tauri") {
        return Err("no lockfile locks tauri; is the root Cargo.lock missing?".into());
    }
    Ok(locked)
}

/// Directories that hold build output or other people's code, never something a doc quotes.
const SKIPPED_DIRS: [&str; 10] = [
    "target",
    "node_modules",
    "dist",
    "gen",
    ".git",
    "runs",
    "render-power-results",
    "coverage",
    "playwright-report",
    "test-results",
];

/// Source, config and fixture files.
const CODE_EXTENSIONS: [&str; 17] = [
    "rs", "ts", "tsx", "js", "mjs", "json", "jsonl", "toml", "yml", "yaml", "ps1", "py", "swift",
    "c", "h", "css", "html",
];

/// Appends the text of every code file under `dir` to `out`, skipping build output and `this_crate`
/// (canonical path): the checker's own sources and fixtures quote the very values it must reject.
fn collect_code(dir: &Path, this_crate: &Path, out: &mut String) -> Result<(), Box<dyn Error>> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let kind = entry.file_type()?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if kind.is_dir() {
            if !SKIPPED_DIRS.contains(&name.as_str()) && fs::canonicalize(&path)? != this_crate {
                collect_code(&path, this_crate, out)?;
            }
        } else if kind.is_file()
            && path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| CODE_EXTENSIONS.contains(&extension))
        {
            // Lossy: a stray non-UTF-8 byte in a fixture must not hide the rest of the file.
            out.push_str(&String::from_utf8_lossy(&fs::read(&path)?));
            out.push('\n');
        }
    }
    Ok(())
}

/// The text of every source, config and fixture file a spike doc may quote.
fn code_corpus() -> Result<String, Box<dyn Error>> {
    let root = repo_root();
    let this_crate = fs::canonicalize(env!("CARGO_MANIFEST_DIR"))?;
    let mut corpus = String::new();
    for dir in [
        "apps",
        "crates",
        "packages",
        "services",
        ".github",
        "docs/spikes",
    ] {
        let dir = root.join(dir);
        if dir.is_dir() {
            collect_code(&dir, &this_crate, &mut corpus)?;
        }
    }
    if !corpus.contains("GlassEffect") {
        return Err("the code corpus does not contain the desktop shell's sources".into());
    }
    if corpus.contains("OLD_TITLEBAR") {
        return Err("the code corpus includes this checker's own sources".into());
    }
    Ok(corpus)
}

/// Runs `rule` over every doc and fails with all findings at once.
fn assert_no_findings(rule: &str, check: impl Fn(&str) -> Vec<Finding>) -> TestResult {
    let mut report = Vec::new();
    for (name, text) in spike_docs()? {
        for finding in check(&text) {
            report.push(format!("{name}: {finding}"));
        }
    }
    if report.is_empty() {
        Ok(())
    } else {
        Err(format!("{rule}:\n{}", report.join("\n")).into())
    }
}

#[test]
fn every_status_agrees_with_its_recorded_results() -> TestResult {
    assert_no_findings(
        "a spike doc's status, results or checklists are out of step",
        check_status,
    )
}

#[test]
fn every_cited_crate_version_is_a_locked_one() -> TestResult {
    let locked = locked_versions()?;
    assert_no_findings(
        "a spike doc cites a crate version no lockfile has",
        |text| check_versions(text, &locked),
    )
}

#[test]
fn every_quoted_value_exists_in_the_code() -> TestResult {
    let corpus = code_corpus()?;
    assert_no_findings(
        "a spike doc quotes a value the code does not have",
        |text| check_quoted_literals(text, &corpus),
    )
}

#[test]
fn listed_glass_effect_values_match_the_generated_bindings() -> TestResult {
    let bindings = fs::read_to_string(repo_root().join("apps/desktop/src/bindings.ts"))?;
    let values = union_values(&bindings, "GlassEffect")
        .ok_or("apps/desktop/src/bindings.ts has no GlassEffect union")?;
    assert_no_findings(
        "a spike doc lists GlassEffect values the generated type does not have",
        |text| check_union_listings(text, "GlassEffect", &values),
    )
}

#[test]
fn every_link_and_anchor_resolves() -> TestResult {
    let dir = spikes_dir();
    assert_no_findings("a spike doc has a broken link", |text| {
        check_links(text, &dir)
    })
}
