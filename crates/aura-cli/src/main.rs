//! The aura-cli executable. Everything lives in the library (`aura_cli`), where tests reach it.

fn main() -> std::process::ExitCode {
    aura_cli::main_with(std::env::args_os().skip(1))
}
