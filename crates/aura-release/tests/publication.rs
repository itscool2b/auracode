//! Publication runs against an in-memory bucket. Synthetic bytes and a public test key only.
#![allow(clippy::unwrap_used)]
use std::{cell::RefCell, collections::BTreeMap, fs, path::PathBuf};

use anyhow::Result;
use aura_release::{
    Artifact, ArtifactKind, Channel, ReleasePlan,
    publish::{
        IMMUTABLE, MANIFEST, PublicObject, Transport, publication_plan, publish, release_bucket,
    },
};
use serde_json::Value;

fn stage(channel: Channel) -> (tempfile::TempDir, PathBuf, String) {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/signatures.json")).unwrap();
    let temp = tempfile::tempdir().unwrap();
    let artifacts = temp.path().join("artifacts");
    fs::create_dir(&artifacts).unwrap();
    let list = [
        (ArtifactKind::MacosUniversalDmg, "auracode-universal.dmg"),
        (ArtifactKind::MacosUniversalUpdater, "auracode.app.tar.gz"),
        (ArtifactKind::WindowsX64Nsis, "auracode-x64.exe"),
        (ArtifactKind::WindowsArm64Nsis, "auracode-arm64.exe"),
    ]
    .into_iter()
    .map(|(kind, file)| {
        fs::write(artifacts.join(file), fixture["artifact"].as_str().unwrap()).unwrap();
        let signature = (kind != ArtifactKind::MacosUniversalDmg).then(|| {
            let name = format!("{file}.sig");
            fs::write(
                artifacts.join(&name),
                fixture["signature"].as_str().unwrap(),
            )
            .unwrap();
            name
        });
        Artifact {
            kind,
            file: file.into(),
            signature,
        }
    })
    .collect();
    let plan = ReleasePlan {
        channel,
        version: "0.1.0".into(),
        pub_date: "2026-10-26T12:00:00Z".into(),
        notes: "Synthetic test release.".into(),
        public_key: fixture["public_key"].as_str().unwrap().into(),
        artifacts: list,
    };
    let stage = temp.path().join("stage");
    aura_release::prepare(&plan, &artifacts, &stage).unwrap();
    (temp, stage, plan.public_key)
}

/// A bucket in memory. `corrupt` makes one key read back with other bytes.
#[derive(Default)]
struct Bucket {
    objects: RefCell<BTreeMap<String, Vec<u8>>>,
    puts: RefCell<Vec<String>>,
    corrupt: Option<String>,
}

impl Transport for Bucket {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        let found = self.objects.borrow().get(key).cloned();
        Ok(found.map(|bytes| {
            if self.corrupt.as_deref() == Some(key) {
                b"tampered".to_vec()
            } else {
                bytes
            }
        }))
    }
    fn put(&self, object: &PublicObject, bytes: &[u8]) -> Result<()> {
        self.objects
            .borrow_mut()
            .insert(object.key.clone(), bytes.to_vec());
        self.puts.borrow_mut().push(object.key.clone());
        Ok(())
    }
}

#[test]
fn plan_lists_versioned_objects_first_and_latest_last() {
    let (_temp, stage, key) = stage(Channel::Stable);
    let objects = publication_plan(&stage, &key).unwrap();
    let keys: Vec<&str> = objects.iter().map(|object| object.key.as_str()).collect();
    assert_eq!(
        keys,
        [
            "releases/0.1.0/SHA256SUMS",
            "releases/0.1.0/auracode-arm64.exe",
            "releases/0.1.0/auracode-arm64.exe.sig",
            "releases/0.1.0/auracode-universal.dmg",
            "releases/0.1.0/auracode-x64.exe",
            "releases/0.1.0/auracode-x64.exe.sig",
            "releases/0.1.0/auracode.app.tar.gz",
            "releases/0.1.0/auracode.app.tar.gz.sig",
            "SHA256SUMS",
            "downloads.json",
            "latest.json",
        ]
    );
    for object in &objects {
        let versioned = object.key.starts_with("releases/");
        assert_eq!(
            object.cache_control,
            if versioned { IMMUTABLE } else { MANIFEST }
        );
        assert!(!object.key.contains("release-plan") && !object.key.contains("COMPLETE"));
    }
    let dmg = objects.iter().find(|o| o.key.ends_with(".dmg")).unwrap();
    assert_eq!(dmg.content_type, "application/x-apple-diskimage");
    let latest = objects.last().unwrap();
    assert_eq!(latest.content_type, "application/json; charset=utf-8");
}

#[test]
fn staging_objects_stay_under_their_prefix() {
    let (_temp, stage, key) = stage(Channel::Staging);
    let objects = publication_plan(&stage, &key).unwrap();
    assert!(
        objects
            .iter()
            .all(|object| object.key.starts_with("staging/"))
    );
    assert_eq!(objects.last().unwrap().key, "staging/latest.json");
}

#[test]
fn plan_refuses_a_stage_that_does_not_match_the_pinned_key() {
    let (_temp, stage, _key) = stage(Channel::Stable);
    assert!(publication_plan(&stage, "untrusted").is_err());
}

#[test]
fn publish_uploads_everything_in_order_and_reads_each_back() {
    let (_temp, stage, key) = stage(Channel::Stable);
    let objects = publication_plan(&stage, &key).unwrap();
    let bucket = Bucket::default();
    let report = publish(&objects, &bucket).unwrap();
    assert_eq!(report.uploaded.len(), objects.len());
    assert!(report.already_present.is_empty());
    assert_eq!(bucket.puts.borrow().last().unwrap(), "latest.json");
    assert_eq!(
        bucket.objects.borrow()["latest.json"],
        fs::read(stage.join("latest.json")).unwrap()
    );
}

#[test]
fn a_resumed_publication_skips_identical_versioned_objects() {
    let (_temp, stage, key) = stage(Channel::Stable);
    let objects = publication_plan(&stage, &key).unwrap();
    let bucket = Bucket::default();
    let dmg = objects.iter().find(|o| o.key.ends_with(".dmg")).unwrap();
    bucket.objects.borrow_mut().insert(
        dmg.key.clone(),
        fs::read(stage.join("releases/0.1.0/auracode-universal.dmg")).unwrap(),
    );
    let report = publish(&objects, &bucket).unwrap();
    assert_eq!(report.already_present, std::slice::from_ref(&dmg.key));
    assert!(!bucket.puts.borrow().contains(&dmg.key));
}

#[test]
fn a_different_published_version_stops_before_anything_is_written() {
    let (_temp, stage, key) = stage(Channel::Stable);
    let objects = publication_plan(&stage, &key).unwrap();
    let bucket = Bucket::default();
    bucket.objects.borrow_mut().insert(
        "releases/0.1.0/auracode-x64.exe".into(),
        b"older bytes".to_vec(),
    );
    let error = publish(&objects, &bucket).unwrap_err().to_string();
    assert!(error.contains("never overwritten"), "{error}");
    assert!(bucket.puts.borrow().is_empty());
}

#[test]
fn a_bad_read_back_stops_before_latest_json() {
    let (_temp, stage, key) = stage(Channel::Stable);
    let objects = publication_plan(&stage, &key).unwrap();
    let bucket = Bucket {
        corrupt: Some("downloads.json".into()),
        ..Bucket::default()
    };
    assert!(publish(&objects, &bucket).is_err());
    assert!(!bucket.puts.borrow().contains(&"latest.json".to_string()));
}

#[test]
fn a_stage_changed_after_planning_is_refused() {
    let (_temp, stage, key) = stage(Channel::Stable);
    let objects = publication_plan(&stage, &key).unwrap();
    fs::write(stage.join("releases/0.1.0/auracode-x64.exe"), b"swapped").unwrap();
    let bucket = Bucket::default();
    let error = publish(&objects, &bucket).unwrap_err().to_string();
    assert!(
        error.contains("changed after the stage was verified"),
        "{error}"
    );
    // Every object is checked before the first upload, so nothing reached the bucket.
    assert!(bucket.puts.borrow().is_empty());
}

#[test]
fn manifests_upload_the_verified_bytes_even_if_the_stage_file_changes() {
    let (_temp, stage, key) = stage(Channel::Stable);
    let objects = publication_plan(&stage, &key).unwrap();
    let verified = fs::read(stage.join("downloads.json")).unwrap();
    fs::write(stage.join("downloads.json"), b"{}").unwrap();
    let bucket = Bucket::default();
    publish(&objects, &bucket).unwrap();
    assert_eq!(bucket.objects.borrow()["downloads.json"], verified);
}

#[test]
fn latest_json_must_come_last() {
    let (_temp, stage, key) = stage(Channel::Stable);
    let mut objects = publication_plan(&stage, &key).unwrap();
    objects.rotate_right(1);
    assert!(publish(&objects, &Bucket::default()).is_err());
}

#[test]
fn only_release_buckets_are_publication_targets() {
    assert_eq!(
        release_bucket(" auracode-releases ").unwrap(),
        "auracode-releases"
    );
    assert_eq!(
        release_bucket("auracode-releases-test").unwrap(),
        "auracode-releases-test"
    );
    for name in ["auracode-blobs", "auracode-releases-", "", "releases"] {
        assert!(release_bucket(name).is_err(), "{name}");
    }
}
