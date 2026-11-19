//! Unsigned preview builds: the Build workflow's installers, gathered for one GitHub release.
//!
//! The signed path (`prepare`, `verify`, `publish`) refuses a package without its updater
//! signature. A preview build has none: it is built without an updater key, so it never updates
//! itself, and nothing vouches for its bytes beyond a checksum. This module therefore checks no
//! signature and writes no updater manifest. It copies the six installers into a new directory,
//! hashes the exact bytes it copied, and writes their checksums and the website's catalog with
//! `signed: false`, which the download page turns into a plain warning.
//!
//! Nothing here uploads. The operator publishes `assets/` as the release named by the tag and
//! commits `downloads.json` as the website's catalog (docs/releases.md).
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail, ensure};
use sha2::{Digest, Sha256};

use crate::{
    ArtifactKind, Catalog, CatalogRelease, Channel, Download, MAX_ARTIFACT, json, open_regular,
    portable_name, validate_description, write_new,
};

/// Where a GitHub release serves its files: `<this>/<tag>/<file>`.
const RELEASES: &str = "https://github.com/itscool2b/auracode/releases/download";
/// `gh run download` puts each installer two folders down: the artifact, then its bundle format.
const MAX_DEPTH: u8 = 3;
/// Every installer a preview release offers, one of each.
const DOWNLOADS: [ArtifactKind; 6] = [
    ArtifactKind::MacosUniversalDmg,
    ArtifactKind::WindowsX64Nsis,
    ArtifactKind::WindowsArm64Nsis,
    ArtifactKind::LinuxX64Appimage,
    ArtifactKind::LinuxX64Deb,
    ArtifactKind::LinuxX64Rpm,
];

/// What a preview release says about itself.
#[derive(Debug, Clone, Copy)]
pub struct Preview<'a> {
    /// The release's tag: `build-YYYY-MM-DD`, with `.N` after it for a later build that day.
    pub tag: &'a str,
    /// The version the installers were built as. Every installer's filename must carry it.
    pub version: &'a str,
    /// RFC3339, on the tag's day.
    pub pub_date: &'a str,
    pub notes: &'a str,
}

fn validate(release: &Preview) -> Result<()> {
    validate_description(release.version, release.pub_date, release.notes)?;
    let day = release
        .tag
        .strip_prefix("build-")
        .context("A preview tag starts with build-")?;
    let (day, sequence) = match day.split_once('.') {
        Some((day, sequence)) => (day, Some(sequence)),
        None => (day, None),
    };
    let digits = |text: &str| !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit());
    let parts = day.split('-').collect::<Vec<_>>();
    ensure!(
        day.len() == 10
            && parts.len() == 3
            && parts.iter().all(|part| digits(part))
            && sequence.is_none_or(|n| digits(n) && n.len() <= 2 && !n.starts_with('0')),
        "A preview tag is build-YYYY-MM-DD, with .N after it for a later build that day"
    );
    ensure!(
        release.pub_date.starts_with(day),
        "The release date must fall on the tag's day"
    );
    Ok(())
}

/// The installer a filename is, or `None` for any other file a build folder holds.
fn installer_kind(name: &str) -> Result<Option<ArtifactKind>> {
    let kind = if name.ends_with(".dmg") {
        ArtifactKind::MacosUniversalDmg
    } else if name.ends_with(".exe") {
        match (name.contains("x64"), name.contains("arm64")) {
            (true, false) => ArtifactKind::WindowsX64Nsis,
            (false, true) => ArtifactKind::WindowsArm64Nsis,
            _ => bail!("{name}: a Windows installer's name must say x64 or arm64, and only one"),
        }
    } else if name.ends_with(".AppImage") {
        ArtifactKind::LinuxX64Appimage
    } else if name.ends_with(".deb") {
        ArtifactKind::LinuxX64Deb
    } else if name.ends_with(".rpm") {
        ArtifactKind::LinuxX64Rpm
    } else {
        return Ok(None);
    };
    Ok(Some(kind))
}

/// Finds the installers under `root`, which must be canonical. Links are refused, not followed,
/// so every path found stays inside the folder the operator named.
fn installers(root: &Path, depth: u8, found: &mut BTreeMap<ArtifactKind, PathBuf>) -> Result<()> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        ensure!(
            !file_type.is_symlink(),
            "{}: a build folder must not contain links",
            path.display()
        );
        if file_type.is_dir() {
            ensure!(depth > 0, "{}: nested too deeply", path.display());
            installers(&path, depth - 1, found)?;
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let Some(kind) = installer_kind(&name)? else {
            continue;
        };
        if let Some(other) = found.insert(kind, path.clone()) {
            bail!(
                "Two installers for {}: {} and {}",
                kind.label(),
                other.display(),
                path.display()
            );
        }
    }
    Ok(())
}

/// Gathers one unsigned build's installers into a new directory:
///
/// - `assets/`: the six installers and their `SHA256SUMS`, the files of the GitHub release.
/// - `downloads.json`: the website's catalog, pointing at that release. It is written last, so a
///   directory without it is incomplete and must not be published.
///
/// Never signs, uploads, overwrites or deletes.
pub fn preview(release: &Preview, build: &Path, destination: &Path) -> Result<()> {
    validate(release)?;
    let mut found = BTreeMap::new();
    installers(&fs::canonicalize(build)?, MAX_DEPTH, &mut found)?;
    for kind in DOWNLOADS {
        ensure!(
            found.contains_key(&kind),
            "No installer for {}",
            kind.label()
        );
    }
    // Every name is checked before anything is written.
    let mut names = BTreeSet::new();
    let mut sources = Vec::new();
    for (kind, path) in &found {
        let (Some(root), Some(name)) = (path.parent(), path.file_name().and_then(|n| n.to_str()))
        else {
            bail!("{}: not a file in a folder", path.display());
        };
        ensure!(portable_name(name), "{name}: not a portable filename");
        ensure!(
            name.contains(release.version),
            "{name} does not carry version {}",
            release.version
        );
        ensure!(
            names.insert(name.to_ascii_lowercase()),
            "{name}: two installers share a filename"
        );
        sources.push((*kind, root, name));
    }
    fs::create_dir(destination)
        .context("Output must be a new directory under an existing parent")?;
    let assets = destination.join("assets");
    fs::create_dir(&assets)?;

    let mut downloads = Vec::new();
    let mut checksums = BTreeMap::new();
    for (kind, root, name) in sources {
        let mut input = open_regular(root, name, MAX_ARTIFACT)?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(assets.join(name))?;
        let mut hash = Sha256::new();
        let mut total = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = input.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            total += read as u64;
            ensure!(total <= MAX_ARTIFACT, "{name} grew beyond the size limit");
            hash.update(&buffer[..read]);
            output.write_all(&buffer[..read])?;
        }
        ensure!(total > 0, "{name} became empty");
        output.sync_all()?;
        let digest = format!("{:x}", hash.finalize());
        checksums.insert(name.to_owned(), digest.clone());
        downloads.push(Download {
            kind,
            label: kind.label(),
            requirements: kind.requirements(),
            file: name.to_owned(),
            url: format!("{RELEASES}/{}/{name}", release.tag),
            sha256: digest,
            bytes: u32::try_from(total)?,
        });
    }
    let checksum_text = checksums
        .iter()
        .map(|(file, hash)| format!("{hash}  {file}\n"))
        .collect::<String>();
    write_new(&assets.join("SHA256SUMS"), checksum_text.as_bytes())?;
    write_new(
        &destination.join("downloads.json"),
        &json(&Catalog {
            release: Some(CatalogRelease {
                channel: Channel::Stable,
                signed: false,
                version: release.version,
                pub_date: release.pub_date,
                notes: release.notes,
                checksums_url: format!("{RELEASES}/{}/SHA256SUMS", release.tag),
                downloads,
            }),
        })?,
    )
}
