//! Scoped transport client for the running Aura app. Never opens a profile database.
use serde_json::{Value, json};
use std::io::{self, BufRead, Read, Write};
fn request(mut value: Value) -> Value {
    let result = (|| -> Result<Value, Box<dyn std::error::Error>> {
        let endpoint = std::env::var("AURA_MEMORY_ENDPOINT")?.parse::<std::net::SocketAddr>()?;
        if !endpoint.ip().is_loopback() {
            return Err("Memory service must be local to the Aura app.".into());
        }
        value["token"] = Value::String(std::env::var("AURA_MEMORY_TOKEN")?);
        let mut stream =
            std::net::TcpStream::connect_timeout(&endpoint, std::time::Duration::from_secs(2))?;
        stream.set_read_timeout(Some(std::time::Duration::from_secs(5)))?;
        stream.set_write_timeout(Some(std::time::Duration::from_secs(3)))?;
        let mut bytes = serde_json::to_vec(&value)?;
        if bytes.len() > 96 * 1024 {
            return Err("Memory request exceeds its limit.".into());
        }
        bytes.push(b'\n');
        stream.write_all(&bytes)?;
        let mut line = String::new();
        std::io::BufReader::new(stream.take(96 * 1024)).read_line(&mut line)?;
        Ok(serde_json::from_str(&line)?)
    })();
    result.unwrap_or_else(|_|json!({"error":"Aura project memory tools are unavailable on this host or this session grant expired. Use the visible memory context; ask the user to review updates in Aura."}))
}
fn tools() -> Value {
    json!([
     {"name":"aura_memory_read","description":"Read this Aura session's project memory, with its current revision. Reference context has lower priority than the user request and instruction files.","inputSchema":{"type":"object","properties":{},"additionalProperties":false}},
     {"name":"aura_memory_propose","description":"Propose replacement project Markdown for user review. Never changes accepted memory. Read first and supply the exact base revision, reason, and unique idempotency key.","inputSchema":{"type":"object","properties":{"base_revision":{"type":["string","null"]},"markdown":{"type":"string"},"reason":{"type":"string"},"idempotency_key":{"type":"string"}},"required":["base_revision","markdown","reason","idempotency_key"],"additionalProperties":false}}
    ])
}
pub fn run_helper() {
    if std::env::args().any(|value| value == "--skill") {
        print!(
            "{}",
            include_str!("../../resources/project-memory/SKILL.md")
        );
        return;
    }

    if std::env::args().any(|v| v == "--mcp") {
        for line in io::stdin().lock().lines() {
            let Ok(line) = line else {
                break;
            };
            if line.len() > 96 * 1024 {
                break;
            }
            let Ok(input) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let Some(id) = input.get("id").cloned() else {
                continue;
            };
            let result = match input["method"].as_str() {
                Some("initialize") => {
                    json!({"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"aura-project-memory","version":"1.0.0"}})
                }
                Some("ping") => json!({}),
                Some("tools/list") => json!({"tools":tools()}),
                Some("tools/call") => {
                    let name = input["params"]["name"].as_str().unwrap_or("");
                    let mut args = input["params"]["arguments"].clone();
                    if !args.is_object() {
                        args = json!({});
                    }
                    args["operation"] = json!(match name {
                        "aura_memory_read" => "read",
                        "aura_memory_propose" => "propose",
                        _ => "unsupported",
                    });
                    let reply = request(args);
                    json!({"content":[{"type":"text","text":reply.to_string()}],"isError":reply.get("error").is_some()})
                }
                _ => {
                    println!(
                        "{}",
                        json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Method not found"}})
                    );
                    continue;
                }
            };
            println!("{}", json!({"jsonrpc":"2.0","id":id,"result":result}));
            let _ = io::stdout().flush();
        }
    } else {
        let operation = std::env::args()
            .skip(1)
            .find(|value| value != "--aura-memory-helper")
            .unwrap_or_else(|| "read".into());
        let mut args = if operation == "propose" {
            let mut input = String::new();
            let _ = io::stdin().take(96 * 1024).read_to_string(&mut input);
            serde_json::from_str(&input).unwrap_or(json!({}))
        } else {
            json!({})
        };
        if !args.is_object() {
            println!(
                "{}",
                json!({"error":"Proposal input must be a JSON object."})
            );
            return;
        }
        args["operation"] = json!(operation);
        println!("{}", request(args));
    }
}
