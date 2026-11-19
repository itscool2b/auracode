use std::{
    env,
    path::{Path, PathBuf},
};

use aura_release::publish::{Wrangler, publication_plan, publish, release_bucket};

fn main() -> anyhow::Result<()> {
    let args = env::args_os().skip(1).collect::<Vec<_>>();
    match args.as_slice() {
        [command] if command == "export-types" => {
            let output =
                Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/web/app/release-types.ts");
            std::fs::write(output, aura_release::typescript()?)?;
        }
        [command, plan, artifacts, destination] if command == "prepare" => {
            let plan = aura_release::read_plan(Path::new(plan))?;
            aura_release::prepare(&plan, Path::new(artifacts), Path::new(destination))?;
            println!(
                "Prepared a local release stage. Nothing was published; platform qualification is still required."
            );
        }
        [command, destination] if command == "verify" => {
            let expected_key = env::var("AURACODE_UPDATER_PUBLIC_KEY")
                .map_err(|_| anyhow::anyhow!("Set AURACODE_UPDATER_PUBLIC_KEY from the trusted release configuration before verifying a stage"))?;
            aura_release::verify(Path::new(destination), &expected_key)?;
            println!("Staged artifacts, signatures, version bindings and manifests match.");
        }
        [command, build, destination, tag, pub_date, notes] if command == "preview" => {
            let text = |value: &std::ffi::OsString, what: &str| {
                value
                    .to_str()
                    .map(str::to_owned)
                    .ok_or_else(|| anyhow::anyhow!("{what} must be valid UTF-8"))
            };
            let (tag, pub_date, notes) = (
                text(tag, "The tag")?,
                text(pub_date, "The date")?,
                text(notes, "The notes")?,
            );
            aura_release::preview::preview(
                &aura_release::preview::Preview {
                    tag: &tag,
                    version: env!("CARGO_PKG_VERSION"),
                    pub_date: &pub_date,
                    notes: &notes,
                },
                Path::new(build),
                Path::new(destination),
            )?;
            println!(
                "Gathered an unsigned preview build. Nothing was published: upload assets/ as release {tag}, then commit downloads.json as the website's catalog."
            );
        }
        [command, stage, rest @ ..] if command == "publish" => {
            let upload = match rest {
                [] => false,
                [flag] if flag == "--upload" => true,
                _ => anyhow::bail!("Usage: aura-release publish <stage-directory> [--upload]"),
            };
            let expected_key = env::var("AURACODE_UPDATER_PUBLIC_KEY")
                .map_err(|_| anyhow::anyhow!("Set AURACODE_UPDATER_PUBLIC_KEY from the trusted release configuration before publishing a stage"))?;
            let bucket = release_bucket(
                &env::var("AURACODE_RELEASE_BUCKET").unwrap_or_else(|_| "auracode-releases".into()),
            )?;
            let objects = publication_plan(Path::new(stage), &expected_key)?;
            for object in &objects {
                println!(
                    "{}  {}  {}",
                    object.key, object.content_type, object.cache_control
                );
            }
            if !upload {
                println!(
                    "Dry run: nothing was uploaded. Add --upload to publish these objects to {bucket}."
                );
                return Ok(());
            }
            let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
            let wrangler = Wrangler {
                node: env::var_os("AURACODE_NODE")
                    .map_or_else(|| PathBuf::from("node"), PathBuf::from),
                script: root.join("apps/web-worker/node_modules/wrangler/bin/wrangler.js"),
                bucket,
            };
            let report = publish(&objects, &wrangler)?;
            println!(
                "Published {} objects ({} were already present with identical bytes). latest.json went last.",
                report.uploaded.len(),
                report.already_present.len()
            );
        }
        _ => anyhow::bail!(
            "Usage: aura-release prepare <release-plan.json> <artifact-directory> <new-stage-directory>\n       aura-release verify <stage-directory>\n       aura-release publish <stage-directory> [--upload]\n       aura-release preview <build-directory> <new-directory> <build-YYYY-MM-DD> <RFC3339 date> <notes>\n       aura-release export-types"
        ),
    }
    Ok(())
}
