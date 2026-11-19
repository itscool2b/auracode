//! Synthetic bytes only. No installer is built, run or published here.
#![allow(clippy::unwrap_used)]
use std::{fs, path::Path};

use aura_release::preview::{Preview, preview};
use serde_json::Value;
use sha2::{Digest, Sha256};

const RELEASE: Preview = Preview {
    tag: "build-2026-11-19",
    version: "0.1.0",
    pub_date: "2026-11-19T02:00:00Z",
    notes: "Preview build of main.",
};

/// A build folder as `gh run download` leaves it: one folder per target, then one per format.
const BUILD: [(&str, &str); 6] = [
    (
        "auracode-unsigned-universal-apple-darwin-abc/dmg",
        "auracode_0.1.0_universal.dmg",
    ),
    (
        "auracode-unsigned-x86_64-pc-windows-msvc-abc/nsis",
        "auracode_0.1.0_x64-setup.exe",
    ),
    (
        "auracode-unsigned-aarch64-pc-windows-msvc-abc/nsis",
        "auracode_0.1.0_arm64-setup.exe",
    ),
    (
        "auracode-unsigned-x86_64-unknown-linux-gnu-abc/appimage",
        "auracode_0.1.0_amd64.AppImage",
    ),
    (
        "auracode-unsigned-x86_64-unknown-linux-gnu-abc/deb",
        "auracode_0.1.0_amd64.deb",
    ),
    (
        "auracode-unsigned-x86_64-unknown-linux-gnu-abc/rpm",
        "auracode-0.1.0-1.x86_64.rpm",
    ),
];

fn build(root: &Path) {
    for (folder, file) in BUILD {
        fs::create_dir_all(root.join(folder)).unwrap();
        fs::write(root.join(folder).join(file), format!("bytes of {file}")).unwrap();
    }
}

fn refused(release: &Preview, root: &Path) -> String {
    let stage = root.join("stage");
    let error = preview(release, &root.join("build"), &stage).unwrap_err();
    assert!(
        !stage.join("downloads.json").exists(),
        "a refused build leaves no catalog"
    );
    format!("{error:#}")
}

#[test]
fn a_build_becomes_release_files_and_an_unsigned_catalog() {
    let temp = tempfile::tempdir().unwrap();
    build(&temp.path().join("build"));
    // Anything else a build folder holds is left out.
    fs::write(temp.path().join("build/notes.txt"), "not an installer").unwrap();
    let stage = temp.path().join("stage");
    preview(&RELEASE, &temp.path().join("build"), &stage).unwrap();

    let mut assets = fs::read_dir(stage.join("assets"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect::<Vec<_>>();
    assets.sort();
    let mut expected = BUILD.map(|(_, file)| file.to_owned()).to_vec();
    expected.push("SHA256SUMS".into());
    expected.sort();
    assert_eq!(assets, expected);

    let text = fs::read_to_string(stage.join("downloads.json")).unwrap();
    assert!(!text.contains(&temp.path().to_string_lossy().to_string()));
    let catalog: Value = serde_json::from_str(&text).unwrap();
    let release = &catalog["release"];
    assert_eq!(release["signed"], false);
    assert_eq!(release["channel"], "stable");
    assert_eq!(release["version"], "0.1.0");
    assert_eq!(
        release["checksums_url"],
        "https://github.com/itscool2b/auracode/releases/download/build-2026-11-19/SHA256SUMS"
    );
    let downloads = release["downloads"].as_array().unwrap();
    assert_eq!(
        downloads
            .iter()
            .map(|download| download["kind"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "macos_universal_dmg",
            "windows_x64_nsis",
            "windows_arm64_nsis",
            "linux_x64_appimage",
            "linux_x64_deb",
            "linux_x64_rpm"
        ]
    );
    let sums = fs::read_to_string(stage.join("assets/SHA256SUMS")).unwrap();
    assert_eq!(sums.lines().count(), 6);
    for download in downloads {
        let file = download["file"].as_str().unwrap();
        let bytes = fs::read(stage.join("assets").join(file)).unwrap();
        assert_eq!(bytes, format!("bytes of {file}").as_bytes());
        let digest = format!("{:x}", Sha256::digest(&bytes));
        assert_eq!(download["sha256"], digest.as_str());
        assert_eq!(download["bytes"], bytes.len());
        assert_eq!(
            download["url"],
            format!(
                "https://github.com/itscool2b/auracode/releases/download/build-2026-11-19/{file}"
            )
            .as_str()
        );
        assert!(sums.contains(&format!("{digest}  {file}\n")));
    }
}

#[test]
fn a_preview_has_no_updater_manifest_and_is_not_a_signed_stage() {
    // An unsigned build never updates itself, and `verify` and `publish` must not accept it.
    let temp = tempfile::tempdir().unwrap();
    build(&temp.path().join("build"));
    let stage = temp.path().join("stage");
    preview(&RELEASE, &temp.path().join("build"), &stage).unwrap();
    assert!(!stage.join("latest.json").exists(), "no updater manifest");
    assert!(!stage.join("COMPLETE").exists(), "not a signed stage");
    let error = aura_release::verify(&stage, "any pinned key").unwrap_err();
    assert!(!format!("{error:#}").is_empty());
}

#[test]
fn an_incomplete_or_ambiguous_build_is_refused() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("build");
    build(&root);
    let rpm = root.join(BUILD[5].0).join(BUILD[5].1);
    fs::remove_file(&rpm).unwrap();
    assert!(refused(&RELEASE, temp.path()).contains("No installer for Linux · Fedora"));

    fs::write(&rpm, "rpm").unwrap();
    fs::write(root.join("auracode_0.1.0_other.dmg"), "second dmg").unwrap();
    assert!(refused(&RELEASE, temp.path()).contains("Two installers for macOS"));
    fs::remove_file(root.join("auracode_0.1.0_other.dmg")).unwrap();

    fs::write(root.join("auracode_0.1.0-setup.exe"), "which machine?").unwrap();
    assert!(refused(&RELEASE, temp.path()).contains("must say x64 or arm64"));
    fs::remove_file(root.join("auracode_0.1.0-setup.exe")).unwrap();

    // An installer of another version is a build of another checkout.
    fs::rename(&rpm, rpm.with_file_name("auracode-0.2.0-1.x86_64.rpm")).unwrap();
    assert!(refused(&RELEASE, temp.path()).contains("does not carry version 0.1.0"));
}

#[test]
fn an_empty_installer_is_refused() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("build");
    build(&root);
    fs::write(root.join(BUILD[0].0).join(BUILD[0].1), "").unwrap();
    let stage = temp.path().join("stage");
    let error = preview(&RELEASE, &root, &stage).unwrap_err();
    assert!(format!("{error:#}").contains("empty or exceeds"));
    assert!(!stage.join("downloads.json").exists());
}

#[test]
fn the_tag_date_and_destination_are_checked() {
    let temp = tempfile::tempdir().unwrap();
    build(&temp.path().join("build"));
    for tag in [
        "v0.1.0",
        "build-2026-11-19/..",
        "build-2026-1-19",
        "build-2026-11-19.",
        "build-2026-11-19.0",
        "build-2026-11-19.100",
        "build-latest",
    ] {
        let release = Preview { tag, ..RELEASE };
        assert!(
            refused(&release, temp.path()).contains("preview tag"),
            "{tag}"
        );
    }
    let another_day = Preview {
        pub_date: "2026-11-20T02:00:00Z",
        ..RELEASE
    };
    assert!(refused(&another_day, temp.path()).contains("tag's day"));
    let no_notes = Preview {
        notes: " ",
        ..RELEASE
    };
    assert!(refused(&no_notes, temp.path()).contains("Release notes"));

    // A later build on the same day takes .N, and an existing directory is never written into.
    let second = Preview {
        tag: "build-2026-11-19.2",
        ..RELEASE
    };
    let stage = temp.path().join("stage");
    preview(&second, &temp.path().join("build"), &stage).unwrap();
    let error = preview(&second, &temp.path().join("build"), &stage).unwrap_err();
    assert!(format!("{error:#}").contains("new directory"));
}

#[cfg(unix)]
#[test]
fn links_in_a_build_folder_are_refused() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("build");
    build(&root);
    let outside = temp.path().join("outside.dmg");
    fs::write(&outside, "elsewhere").unwrap();
    let dmg = root.join(BUILD[0].0).join(BUILD[0].1);
    fs::remove_file(&dmg).unwrap();
    std::os::unix::fs::symlink(&outside, &dmg).unwrap();
    assert!(refused(&RELEASE, temp.path()).contains("must not contain links"));
}
