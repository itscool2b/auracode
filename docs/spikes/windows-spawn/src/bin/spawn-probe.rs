//! A small, predictable child process for the spawn spike's tests.
//!
//! Real tools (git, sh, cmd, ping) cover the realistic cases. This covers what they cannot express
//! portably: exact output volumes, the console a process received, and a parent that dies without
//! cleaning up.
//!
//! Modes (the first argument):
//! - `spew <stderr-bytes> <stdout-bytes>`: writes all the stderr bytes first, then the stdout
//!   bytes. A parent that only reads stdout deadlocks on this unless stderr is drained too.
//! - `sleep <seconds>`
//! - `cwd`: prints the working directory.
//! - `env <NAME>...`: prints `NAME=value` or `NAME unset` for each name.
//! - `echo-stdin`: copies stdin to stdout until end-of-file.
//! - `console [--grandchild]`: prints a `ConsoleReport` (Windows). With `--grandchild` it then
//!   starts itself the way a shell starts git, with no creation flags, and relays that report too.
//! - `orphan <seconds>`: starts `sleep <seconds>` with `spawn_hidden`, prints its pid, waits for a
//!   line on stdin, then exits without running destructors, the way a crashing app would.

use std::{
    env,
    error::Error,
    io::{self, BufRead, Write},
    process::ExitCode,
    time::Duration,
};

use windows_spawn::spawn_hidden;

type ProbeResult = Result<ExitCode, Box<dyn Error>>;

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    match run(&args) {
        Ok(code) => code,
        Err(err) => {
            eprintln!("spawn-probe: {err}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: &[String]) -> ProbeResult {
    let (mode, rest) = match args.split_first() {
        Some((mode, rest)) => (mode.as_str(), rest),
        None => return Err("missing mode; see the module docs".into()),
    };
    match mode {
        "spew" => spew(number(rest, 0)?, number(rest, 1)?),
        "sleep" => {
            std::thread::sleep(Duration::from_secs(number(rest, 0)?));
            Ok(ExitCode::SUCCESS)
        }
        "cwd" => {
            println!("{}", env::current_dir()?.display());
            Ok(ExitCode::SUCCESS)
        }
        "env" => {
            for name in rest {
                match env::var_os(name) {
                    Some(value) => println!("{name}={}", value.to_string_lossy()),
                    None => println!("{name} unset"),
                }
            }
            Ok(ExitCode::SUCCESS)
        }
        "echo-stdin" => {
            io::copy(&mut io::stdin().lock(), &mut io::stdout().lock())?;
            Ok(ExitCode::SUCCESS)
        }
        "console" => console(rest.iter().any(|arg| arg == "--grandchild")),
        "orphan" => orphan(number(rest, 0)?),
        other => Err(format!("unknown mode {other:?}").into()),
    }
}

fn number(args: &[String], index: usize) -> Result<u64, Box<dyn Error>> {
    let raw = args.get(index).ok_or("missing numeric argument")?;
    Ok(raw.parse()?)
}

fn spew(stderr_bytes: u64, stdout_bytes: u64) -> ProbeResult {
    write_repeated(&mut io::stderr().lock(), b'e', stderr_bytes)?;
    write_repeated(&mut io::stdout().lock(), b'o', stdout_bytes)?;
    Ok(ExitCode::SUCCESS)
}

fn write_repeated(out: &mut impl Write, byte: u8, mut remaining: u64) -> io::Result<()> {
    let chunk = [byte; 8192];
    while remaining > 0 {
        let len = usize::try_from(remaining).map_or(chunk.len(), |left| left.min(chunk.len()));
        out.write_all(&chunk[..len])?;
        remaining -= len as u64;
    }
    out.flush()
}

#[cfg(windows)]
fn console(grandchild: bool) -> ProbeResult {
    println!("{}", windows_spawn::inspect::ConsoleReport::current());
    if grandchild {
        // Plain CreateProcess with no creation flags, exactly how bash or cmd start git: the new
        // process attaches to whatever console this one has.
        let output = std::process::Command::new(env::current_exe()?)
            .arg("console")
            .output()?;
        io::stdout().write_all(&output.stdout)?;
        io::stderr().write_all(&output.stderr)?;
        if !output.status.success() {
            return Err(format!("grandchild console probe failed: {}", output.status).into());
        }
    }
    io::stdout().flush()?;
    Ok(ExitCode::SUCCESS)
}

#[cfg(not(windows))]
fn console(_grandchild: bool) -> ProbeResult {
    eprintln!("spawn-probe: console reports only mean something on Windows");
    Ok(ExitCode::from(2))
}

fn orphan(seconds: u64) -> ProbeResult {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let _context = runtime.enter();
    let seconds = seconds.to_string();
    let sleeper = spawn_hidden(env::current_exe()?, ["sleep", seconds.as_str()], None, &[])?;
    println!("{}", sleeper.id());
    io::stdout().flush()?;

    // Wait until the test is watching the sleeper, so it cannot die unobserved.
    let mut line = String::new();
    io::stdin().lock().read_line(&mut line)?;

    // Leave without dropping `sleeper` or the runtime, exactly like a crash: no destructor runs,
    // so only the kernel can clean up. Windows does, because the job handle closes with this
    // process; Unix does not.
    std::process::exit(0)
}
