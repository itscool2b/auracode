use std::{env, path::Path};

fn main() -> anyhow::Result<()> {
    let args = env::args_os().skip(1).collect::<Vec<_>>();
    match args.as_slice() {
        [command] if command == "export-types" => {
            let output =
                Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/web/app/release-types.ts");
            std::fs::write(output, o7_release::typescript()?)?;
        }
        [command, plan, artifacts, destination] if command == "prepare" => {
            let plan = o7_release::read_plan(Path::new(plan))?;
            o7_release::prepare(&plan, Path::new(artifacts), Path::new(destination))?;
            println!(
                "Prepared a local release stage. Nothing was published; platform qualification is still required."
            );
        }
        [command, destination] if command == "verify" => {
            let expected_key = env::var("O7_UPDATER_PUBLIC_KEY")
                .map_err(|_| anyhow::anyhow!("Set O7_UPDATER_PUBLIC_KEY from the trusted release configuration before verifying a stage"))?;
            o7_release::verify(Path::new(destination), &expected_key)?;
            println!("Staged artifacts, signatures, version bindings and manifests match.");
        }
        _ => anyhow::bail!(
            "Usage: o7-release prepare <release-plan.json> <artifact-directory> <new-stage-directory>\n       o7-release verify <stage-directory>\n       o7-release export-types"
        ),
    }
    Ok(())
}
