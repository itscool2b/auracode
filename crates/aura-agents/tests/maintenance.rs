//! Maintenance uses owned fake binaries. No native login, account, installer or paid prompt runs.
#![cfg(test)]
mod common;
use aura_agents::maintenance::MaintenanceError;
use aura_protocol::agents::AgentAuthStatus;
use common::Machine;

fn vendor_machine() -> (Machine, std::path::PathBuf) {
    let machine = Machine::with_tools(&[]);
    let bin = machine.home.join(".local/share/claude/versions/fixture");
    machine.install_tool(&bin, "claude");
    (machine, bin)
}

#[tokio::test]
async fn status_runs_the_exact_vendor_command_and_drops_account_details() {
    let (machine, bin) = vendor_machine();
    let detector = machine.detector(machine.env_with_path(&[&bin], &[]));
    assert_eq!(
        detector.auth_status("claude").await,
        AgentAuthStatus::CredentialsPresent
    );
    assert!(
        machine
            .runs("claude")
            .iter()
            .any(|run| run["argv"] == serde_json::json!(["auth", "status", "--json"]))
    );
    std::fs::write(machine.fake.join("claude.maintenance"), "fail").unwrap();
    let status = detector.auth_status("claude").await;
    assert!(matches!(status, AgentAuthStatus::Unknown { .. }));
    assert!(!format!("{status:?}").contains("private"));
}

#[tokio::test]
async fn vendor_update_serializes_aliases_and_rechecks_the_resulting_installation() {
    let (machine, bin) = vendor_machine();
    machine.install_tool(&machine.bin, "node");
    machine.install_tool(&machine.bin, "npm");
    std::fs::write(machine.fake.join("claude.maintenance"), "slow").unwrap();
    let detector = machine.detector(machine.env_with_path(&[&bin, &machine.bin], &[]));
    let alias = aura_agents::get("claude-acp").unwrap();
    detector.detect(alias).await;
    let worker = std::sync::Arc::clone(&detector);
    let update = tokio::spawn(async move { worker.update("claude").await });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while !machine
            .runs("claude")
            .iter()
            .any(|run| run["argv"] == serde_json::json!(["update"]))
        {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        detector.update("claude-acp").await,
        Err(MaintenanceError::AlreadyRunning)
    );
    assert_eq!(update.await.unwrap(), Ok(()));
    let entry = detector
        .cached()
        .into_iter()
        .find(|entry| entry.id == "claude")
        .unwrap();
    assert_eq!(entry.installation.unwrap().version, "2.1.310");
    // An alias's completed probe must not survive the update's cache invalidation.
    let before = machine.runs("claude").len();
    detector.detect(alias).await;
    assert!(machine.runs("claude").len() > before);
    std::fs::write(machine.fake.join("claude.maintenance"), "break-version").unwrap();
    assert_eq!(
        detector.update("claude").await,
        Err(MaintenanceError::VerificationFailed)
    );
}
