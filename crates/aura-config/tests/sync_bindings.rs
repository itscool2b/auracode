//! Configuration sync DTOs are generated without a desktop runtime.
#![allow(clippy::expect_used)]
#[test]
fn export_config_sync_bindings() {
    let types = specta::Types::default()
        .register::<aura_config::sync::ConfigSyncInventory>()
        .register::<aura_config::sync::ConfigSyncPreview>()
        .register::<aura_config::sync::ConfigSyncReceipt>()
        .register::<aura_config::sync::ConfigSyncOutcome>();
    let generated = specta_typescript::Typescript::default()
        .header("// Generated from aura-config. Run cargo test -p aura-config export_config_sync_bindings. Do not edit.")
        .export(&types, specta_serde::Format).expect("config sync DTOs export");
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/desktop/src/lib/config-sync/bindings.ts");
    if std::env::var_os("CI").is_some() {
        assert_eq!(
            std::fs::read_to_string(path).expect("committed DTOs"),
            generated
        );
    } else if std::fs::read_to_string(&path).ok().as_deref() != Some(&generated) {
        std::fs::create_dir_all(path.parent().expect("DTO folder")).expect("create DTO folder");
        std::fs::write(path, generated).expect("write DTOs");
    }
}
