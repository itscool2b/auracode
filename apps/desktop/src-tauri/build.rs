use std::env;
use std::fs;
use std::path::{Path, PathBuf};

/// The Windows application manifest, next to this file.
const WINDOWS_MANIFEST: &str = "windows-app-manifest.xml";

fn main() {
    // tauri-build embeds its Windows manifest in binaries only, so this crate's own test binaries
    // started without Common Controls v6 and Windows refused to load them (exit 0xc0000139,
    // STATUS_ENTRYPOINT_NOT_FOUND, on an import only v6 exports). Tauri's manifest is switched off
    // here and the same manifest is embedded in every linked target instead: the app and its test
    // binaries alike. Embedding both would give the app two manifest resources.
    let attributes = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    if let Err(error) = tauri_build::try_build(attributes) {
        panic!("tauri-build failed: {error:#}");
    }
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        embed_windows_manifest();
    }
}

fn embed_windows_manifest() {
    println!("cargo:rerun-if-changed={WINDOWS_MANIFEST}");
    let crate_dir = env_path("CARGO_MANIFEST_DIR");
    let manifest = crate_dir.join(WINDOWS_MANIFEST);
    // Resource 1 of type 24 (RT_MANIFEST) is the manifest Windows reads when it starts an exe. The
    // path is absolute so the resource compiler finds it from any working directory.
    let rc = format!("1 24 \"{}\"\n", rc_string(&manifest));
    let rc_file = env_path("OUT_DIR").join("app-manifest.rc");
    if let Err(error) = fs::write(&rc_file, rc) {
        panic!("could not write {}: {error}", rc_file.display());
    }
    if let Err(result) =
        embed_resource::compile_for_everything(&rc_file, embed_resource::NONE).manifest_required()
    {
        panic!("could not embed the Windows application manifest: {result}");
    }
}

fn env_path(name: &str) -> PathBuf {
    match env::var_os(name) {
        Some(value) => PathBuf::from(value),
        None => panic!("Cargo did not set {name} for the build script"),
    }
}

/// `path` as the body of a resource-script string: backslashes doubled, quotes doubled.
fn rc_string(path: &Path) -> String {
    path.display()
        .to_string()
        .replace('\\', "\\\\")
        .replace('"', "\"\"")
}
