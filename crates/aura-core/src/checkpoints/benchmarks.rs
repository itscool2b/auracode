//! Opt-in end-to-end checkpoint measurements using disposable workspaces.
use super::*;
use crate::profile::{ProfileKind, ProfileMeta};
use aura_process::{EnvSource, ResolvedEnv, process_env};
use std::time::Instant;

#[tokio::test]
#[ignore = "manual checkpoint performance fixture"]
async fn checkpoint_performance() {
    let warm_samples = std::env::var("AURA_CHECKPOINT_BENCH_WARM")
        .map(|value| value.parse::<usize>().unwrap())
        .unwrap_or(1);
    assert!(warm_samples > 0);
    let counts =
        std::env::var("AURA_CHECKPOINT_BENCH_COUNTS").unwrap_or_else(|_| "1000,10000,20000".into());
    for count in counts
        .split(',')
        .map(|value| value.parse::<usize>().unwrap())
    {
        for account in [false, true] {
            #[cfg(not(feature = "account-sync"))]
            if account {
                continue;
            }
            let temp = tempfile::tempdir().unwrap();
            let work = temp.path().join("work");
            std::fs::create_dir(&work).unwrap();
            for index in 0..count {
                std::fs::write(
                    work.join(format!("file-{index:05}.txt")),
                    format!(
                        "fixture {index}\r\n{}",
                        "line of synthetic source\n".repeat(10)
                    ),
                )
                .unwrap();
            }
            let profile = Profile {
                meta: ProfileMeta {
                    id: crate::ids::new_id(),
                    kind: if account {
                        ProfileKind::Account
                    } else {
                        ProfileKind::Local
                    },
                    display_name: "benchmark".into(),
                    created_at: 0,
                },
                dir: temp.path().join("profile"),
            };
            let env = EnvResolver::fixed(ResolvedEnv {
                vars: process_env(),
                source: EnvSource::Fallback {
                    reason: "checkpoint benchmark".into(),
                },
                warnings: vec![],
                resolved_at_ms: 0,
            });
            #[cfg(feature = "account-sync")]
            let service = if account {
                let key = aura_sync::crypto::AccountKey::generate()
                    .unwrap()
                    .profile_file_key("benchmark", &profile.meta.id)
                    .unwrap();
                Checkpoints::new_account(&profile, env, LeftoverRegistry::disabled(), Arc::new(key))
                    .unwrap()
            } else {
                Checkpoints::new(&profile, env, LeftoverRegistry::disabled())
            };
            #[cfg(not(feature = "account-sync"))]
            let service = Checkpoints::new(&profile, env, LeftoverRegistry::disabled());
            let chat = crate::ids::new_id();
            let folder = crate::ids::new_id();
            for attempt in 0..warm_samples + 2 {
                let scenario = match attempt {
                    0 => "cold",
                    value if value == warm_samples + 1 => "one-file",
                    _ => "unchanged",
                };
                if attempt == warm_samples + 1 {
                    std::fs::write(work.join("file-00000.txt"), "changed\r\n").unwrap();
                }
                let started = Instant::now();
                let summary = service
                    .capture(&chat, &folder, &work, &crate::ids::new_id())
                    .await
                    .unwrap();
                assert_eq!(summary.file_count as usize, count);
                println!(
                    "CHECKPOINT_BENCH storage={} files={count} scenario={scenario} elapsed_ms={}",
                    if account { "account" } else { "local" },
                    started.elapsed().as_millis()
                );
            }
        }
    }
}
