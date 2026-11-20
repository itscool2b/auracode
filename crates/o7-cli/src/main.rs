//! The o7-cli executable. Everything lives in the library (`o7_cli`), where tests reach it.

fn main() -> std::process::ExitCode {
    o7_cli::main_with(std::env::args_os().skip(1))
}
