//! The JSON-RPC peer (package B): parsing stdout lines into requests, notifications and responses
//! (batches in order; `jsonrpc` not required), and `RpcOut`, which writes requests with integer ids
//! counting from 1 per process, notifications and replies through the agent's never-blocking stdin.
//! Ids from the agent are echoed exactly as received; invalid lines are logged, never answered. The
//! same peer serves Codex app-server in M1c, which omits the `jsonrpc` field.
