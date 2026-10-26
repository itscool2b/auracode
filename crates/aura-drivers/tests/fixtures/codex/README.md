# Native Codex fixtures

The seven synthetic scenarios cover text, result before idle, resume, interrupt, approval withdrawal,
grouped questions, and quota/token updates. They use the installed 0.162.1 generated schema.

`probe-session`, `probe-interrupted-start`, and `probe-restart` were recorded from the installed
Windows Codex 0.162.1 executable on 2026-10-26 using `aura-cli probe codex`. The free probe passed
20 checks with zero failures and six explicit skips. No prompt or steer was sent. These recordings
prove controls and process lifecycle only; they do not prove prompted resume or turn settings.

Curation replaced home, host, session and spawn identities. Account usage and plan values,
installation identity, configured MCP server names and incidental stderr were sanitized. Native
request/response ordering and shapes remain intact. Model metadata is the public advertised catalog.
Generated goldens are reviewed outputs of the actual Rust driver running against fake pipes.

The interrupted-start recording intentionally closes before Ready. Its recorded shutdown command
and closed exit distinguish cancellation from startup failure. The replay selects the recorded
client version in `initialize` and still compares complete native request payloads.
