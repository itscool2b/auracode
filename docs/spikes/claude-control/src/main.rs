//! M0 spike 3: Claude Code's stream-json control protocol, measured against the installed CLI.
//!
//! Each subcommand runs one experiment from `docs/spikes/claude-control.md` against the user's
//! real `claude` binary, writes redacted fixtures into `fixtures/`, and prints a redacted JSON
//! summary of what it saw. `p1` creates the session that the later experiments resume and records
//! it in `<root>/state.json`, so the order is: `probe`, `p1`, then any of the others.

mod env_scrub;
mod experiments;
mod framing;
mod procs;
mod protocol;
mod redact;
mod session;

use std::path::PathBuf;
use std::process::ExitCode;

/// Errors are only ever reported, never matched on, so one boxed type keeps `?` usable everywhere.
pub type Res<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

const USAGE: &str = "usage: claude-control-spike <probe|p1|interrupt|resume-worktree|resume-unrelated|resume-path|fork|env-compare|interrupt-permission|redact> \
--root <scratch dir> [--claude <path>] [--model <alias>] [--fixtures <dir>] [--with-model-prompt]";

struct Args {
    command: String,
    root: PathBuf,
    claude: Option<PathBuf>,
    fixtures: PathBuf,
    model: String,
    with_model_prompt: bool,
}

fn parse_args(raw: &[String]) -> Result<Args, String> {
    let mut it = raw.iter();
    let command = it.next().ok_or("missing command")?.clone();
    let mut root = None;
    let mut claude = None;
    let mut fixtures = None;
    let mut model = String::from("haiku");
    let mut with_model_prompt = false;
    while let Some(arg) = it.next() {
        let mut value = |flag: &str| it.next().cloned().ok_or(format!("{flag} needs a value"));
        match arg.as_str() {
            "--root" => root = Some(PathBuf::from(value("--root")?)),
            "--claude" => claude = Some(PathBuf::from(value("--claude")?)),
            "--fixtures" => fixtures = Some(PathBuf::from(value("--fixtures")?)),
            "--model" => model = value("--model")?,
            "--with-model-prompt" => with_model_prompt = true,
            other => return Err(format!("unexpected argument {other}")),
        }
    }
    Ok(Args {
        command,
        root: root.ok_or("--root is required")?,
        claude,
        // Fixtures belong next to this crate unless told otherwise.
        fixtures: fixtures.unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures")),
        model,
        with_model_prompt,
    })
}

#[tokio::main]
async fn main() -> ExitCode {
    let raw: Vec<String> = std::env::args().skip(1).collect();
    let args = match parse_args(&raw) {
        Ok(args) => args,
        Err(e) => {
            eprintln!("{e}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    let ctx = match experiments::Ctx::new(args.root, args.claude, args.fixtures, args.model) {
        Ok(ctx) => ctx,
        Err(e) => {
            eprintln!("setup failed: {e}");
            return ExitCode::FAILURE;
        }
    };
    let outcome = match args.command.as_str() {
        "probe" => experiments::probe(&ctx).await,
        "p1" => experiments::p1(&ctx).await,
        "interrupt" => experiments::interrupt(&ctx).await,
        "resume-worktree" => experiments::resume_worktree(&ctx).await,
        "resume-unrelated" => experiments::resume_unrelated(&ctx).await,
        "resume-path" => experiments::resume_path(&ctx).await,
        "fork" => experiments::fork(&ctx, args.with_model_prompt).await,
        "env-compare" => experiments::env_compare(&ctx).await,
        "interrupt-permission" => experiments::interrupt_permission(&ctx).await,
        "redact" => experiments::redact_fixtures(&ctx),
        other => {
            eprintln!("unknown command {other}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    match outcome.and_then(|summary| ctx.publish_summary(&args.command, &summary)) {
        Ok(text) => {
            println!("{text}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{} failed: {e}", args.command);
            ExitCode::FAILURE
        }
    }
}
