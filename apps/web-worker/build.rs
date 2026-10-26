#[path = "src/manifest.rs"]
mod manifest;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo:rerun-if-changed=src/manifest.rs");
    // Native workspace checks exercise the planner with synthetic assets. Only the actual Wasm
    // build consumes the public prerender output, which the package build command creates first.
    let out = std::path::PathBuf::from(
        std::env::var_os("OUT_DIR").ok_or("missing Cargo output directory")?,
    );
    let source = if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("wasm32") {
        let root = std::path::PathBuf::from(
            std::env::var_os("CARGO_MANIFEST_DIR").ok_or("missing Cargo manifest directory")?,
        )
        .join("../web/build/client");
        println!("cargo:rerun-if-changed={}", root.display());
        manifest::generate(&root)?
    } else {
        "pub static ASSETS: &[crate::Asset] = &[];\npub static COMMON: &[(&str, &str)] = &[];\n"
            .into()
    };
    std::fs::write(out.join("assets.rs"), source)?;
    Ok(())
}
