//! Publication of a verified stage to the dedicated public release bucket. The stage is verified
//! again first; versioned objects go up before the channel's manifests, every upload is read back
//! and compared, and `latest.json` is written last, so no client ever sees a manifest that points at
//! a missing or different file. Published versions are never overwritten.
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{Context, Result, bail, ensure};
use sha2::{Digest, Sha256};

use crate::{Channel, read_plan, verify};

/// Versioned objects never change once published.
pub const IMMUTABLE: &str = "public, max-age=31536000, immutable";
/// Channel manifests change with every release, so caches revalidate quickly.
pub const MANIFEST: &str = "public, max-age=60, must-revalidate";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicObject {
    /// Bucket key, under the channel's prefix.
    pub key: String,
    pub path: PathBuf,
    pub content_type: &'static str,
    pub cache_control: &'static str,
    pub sha256: String,
}

impl PublicObject {
    fn immutable(&self) -> bool {
        self.cache_control == IMMUTABLE
    }
}

/// Re-verifies the stage against the pinned key and lists its public objects in upload order:
/// every versioned object, then the channel's `SHA256SUMS` and `downloads.json`, then
/// `latest.json`. Local records (`release-plan.json`, `COMPLETE`) are never listed.
pub fn publication_plan(stage: &Path, expected_public_key: &str) -> Result<Vec<PublicObject>> {
    verify(stage, expected_public_key)?;
    let root = fs::canonicalize(stage)?;
    let plan = read_plan(&root.join("release-plan.json"))?;
    let prefix = match plan.channel {
        Channel::Stable => "",
        Channel::Staging => "staging/",
    };
    let payload = root.join("releases").join(&plan.version);
    let mut names = Vec::new();
    for entry in fs::read_dir(&payload)? {
        let entry = entry?;
        ensure!(
            entry.file_type()?.is_file(),
            "The versioned payload may hold only regular files"
        );
        names.push(
            entry
                .file_name()
                .into_string()
                .map_err(|_| anyhow::anyhow!("A staged file name is not valid UTF-8"))?,
        );
    }
    names.sort();
    let mut objects = Vec::with_capacity(names.len() + 3);
    for name in names {
        objects.push(object(
            format!("{prefix}releases/{}/{name}", plan.version),
            payload.join(&name),
            IMMUTABLE,
        )?);
    }
    for name in ["SHA256SUMS", "downloads.json", "latest.json"] {
        objects.push(object(
            format!("{prefix}{name}"),
            root.join(name),
            MANIFEST,
        )?);
    }
    Ok(objects)
}

fn object(key: String, path: PathBuf, cache_control: &'static str) -> Result<PublicObject> {
    let bytes = fs::read(&path).with_context(|| format!("Could not read {}", path.display()))?;
    Ok(PublicObject {
        content_type: content_type(&key),
        sha256: hex(&bytes),
        key,
        path,
        cache_control,
    })
}

fn content_type(key: &str) -> &'static str {
    if key.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if key.ends_with("SHA256SUMS") || key.ends_with(".sig") {
        "text/plain; charset=utf-8"
    } else if key.ends_with(".dmg") {
        "application/x-apple-diskimage"
    } else if key.ends_with(".exe") {
        "application/vnd.microsoft.portable-executable"
    } else if key.ends_with(".tar.gz") {
        "application/gzip"
    } else {
        "application/octet-stream"
    }
}

fn hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Where public objects are written and read back.
pub trait Transport {
    /// The object's bytes, or `None` when the key does not exist.
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>>;
    fn put(&self, object: &PublicObject) -> Result<()>;
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Report {
    pub uploaded: Vec<String>,
    /// Versioned objects already published with identical bytes (a resumed publication).
    pub already_present: Vec<String>,
}

/// Uploads `objects` in order. Every versioned key is checked before anything is written: an
/// existing key must already hold identical bytes, or publication stops untouched. Each upload is
/// read back and compared before the next, so a failure always stops before `latest.json`.
pub fn publish(objects: &[PublicObject], transport: &impl Transport) -> Result<Report> {
    ensure!(
        objects
            .last()
            .is_some_and(|last| last.key.ends_with("latest.json")),
        "latest.json must be the last object published"
    );
    let mut present = Vec::new();
    for object in objects.iter().filter(|object| object.immutable()) {
        if let Some(existing) = transport.get(&object.key)? {
            ensure!(
                hex(&existing) == object.sha256,
                "{} is already published with different bytes. Published versions are never overwritten; choose a new version.",
                object.key
            );
            present.push(object.key.clone());
        }
    }
    let mut report = Report::default();
    for object in objects {
        if present.contains(&object.key) {
            report.already_present.push(object.key.clone());
            continue;
        }
        let bytes = fs::read(&object.path)?;
        ensure!(
            hex(&bytes) == object.sha256,
            "{} changed after the stage was verified",
            object.path.display()
        );
        transport.put(object)?;
        let Some(back) = transport.get(&object.key)? else {
            bail!("{} is missing right after upload", object.key);
        };
        ensure!(
            hex(&back) == object.sha256,
            "{} reads back with different bytes; publication stopped before latest.json",
            object.key
        );
        report.uploaded.push(object.key.clone());
    }
    Ok(report)
}

/// The repository's pinned Wrangler, run through Node directly so no shell parses the arguments.
/// It uses the release operator's own Cloudflare sign-in; no credential passes through here.
pub struct Wrangler {
    pub node: PathBuf,
    pub script: PathBuf,
    pub bucket: String,
}

impl Wrangler {
    fn run(&self, args: &[&str]) -> Result<std::process::Output> {
        Command::new(&self.node)
            .arg(&self.script)
            .args(args)
            .output()
            .with_context(|| format!("Could not start Wrangler at {}", self.script.display()))
    }
}

impl Transport for Wrangler {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        let target = format!("{}/{key}", self.bucket);
        let output = self.run(&["r2", "object", "get", &target, "--pipe", "--remote"])?;
        if output.status.success() {
            return Ok(Some(output.stdout));
        }
        let error = String::from_utf8_lossy(&output.stderr);
        if error.contains("does not exist") || error.contains("NoSuchKey") {
            return Ok(None);
        }
        bail!("Wrangler could not read {target}: {}", error.trim())
    }

    fn put(&self, object: &PublicObject) -> Result<()> {
        let target = format!("{}/{}", self.bucket, object.key);
        let file = object.path.to_string_lossy();
        let output = self.run(&[
            "r2",
            "object",
            "put",
            &target,
            "--file",
            &file,
            "--content-type",
            object.content_type,
            "--cache-control",
            object.cache_control,
            "--remote",
        ])?;
        ensure!(
            output.status.success(),
            "Wrangler could not upload {target}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
        Ok(())
    }
}
