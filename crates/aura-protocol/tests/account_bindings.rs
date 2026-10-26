//! Account DTO generation has no native webview, desktop runtime or plugin dependency.
#![allow(clippy::expect_used)]
use aura_protocol::account::*;

#[test]
fn export_account_bindings() {
    let types = specta::Types::default()
        .register::<AccountConfiguration>()
        .register::<AccountStatus>()
        .register::<SignInChallenge>()
        .register::<RecoverySetup>()
        .register::<AccountDevice>()
        .register::<AccountFailure>()
        .register::<AccountSignOut>();
    let generated = specta_typescript::Typescript::default()
        .header("// Generated from aura-protocol. Run cargo test -p aura-protocol export_account_bindings. Do not edit.")
        .export(&types, specta_serde::Format)
        .expect("Account DTOs export");
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/desktop/src/lib/account/bindings.ts");
    if std::env::var_os("CI").is_some() {
        assert_eq!(
            std::fs::read_to_string(path).expect("committed bindings"),
            generated,
            "Account DTOs drifted. Run cargo test -p aura-protocol export_account_bindings locally."
        );
    } else if std::fs::read_to_string(&path).ok().as_deref() != Some(&generated) {
        std::fs::create_dir_all(path.parent().expect("bindings folder"))
            .expect("create bindings folder");
        std::fs::write(path, generated).expect("write Account DTOs");
    }
}
