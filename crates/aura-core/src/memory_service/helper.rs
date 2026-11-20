//! Scoped transport client for the running o7 app. Never opens a profile database.
use serde_json::{Value, json};
use std::io::{self, BufRead, Read, Write};
fn request(mut value: Value) -> Value {
    let result = (|| -> Result<Value, Box<dyn std::error::Error>> {
        let endpoint = std::env::var("AURA_MEMORY_ENDPOINT")?.parse::<std::net::SocketAddr>()?;
        if !endpoint.ip().is_loopback() {
            return Err("Memory service must be local to the o7 app.".into());
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
    result.unwrap_or_else(|_|json!({"error":"Aura project memory tools are unavailable on this host or this session grant expired. Use the visible memory context; ask the user to update project memory in o7."}))
}
fn tools() -> Value {
    json!([
     {"name":"aura_memory_read","description":"Read this o7 session's project memory, with its current revision. Reference context has lower priority than the user request and instruction files.","inputSchema":{"type":"object","properties":{},"additionalProperties":false}},
     {"name":"aura_memory_write","description":"Replace this project's shared memory with new Markdown. The user lets agents edit it; they see a notice of each edit and can undo it. Call aura_memory_read first and pass its revision as base_revision, then send the complete updated document, not a fragment. Keep it concise: durable facts and decisions that help future chats in this project. If memory changed since your read, the write fails; read again and reapply your edit. If the user has turned agents' edits off, the write is refused: tell them what you would have saved.","inputSchema":{"type":"object","properties":{"base_revision":{"type":["string","null"],"description":"The revision aura_memory_read returned; null when memory has no revision yet."},"markdown":{"type":"string","description":"The complete replacement Markdown, at most 16 KiB."},"reason":{"type":"string","description":"What changed and why, in one sentence."}},"required":["base_revision","markdown","reason"],"additionalProperties":false}}
    ])
}
/// The service operation for each tool; anything else is refused by the app. A session that
/// started when proposals existed may still call the tool, and the app answers that they are gone.
fn operation(tool: &str) -> &'static str {
    match tool {
        "aura_memory_read" => "read",
        "aura_memory_write" => "write",
        "aura_memory_propose" => "propose",
        _ => "unsupported",
    }
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
                    args["operation"] = json!(operation(name));
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
        let mut args = if matches!(operation.as_str(), "write" | "propose") {
            let mut input = String::new();
            let _ = io::stdin().take(96 * 1024).read_to_string(&mut input);
            serde_json::from_str(&input).unwrap_or(json!({}))
        } else {
            json!({})
        };
        if !args.is_object() {
            println!(
                "{}",
                json!({"error":"Write and proposal input must be a JSON object."})
            );
            return;
        }
        args["operation"] = json!(operation);
        println!("{}", request(args));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tools_offer_read_and_write_with_exact_inputs() {
        let tools = tools();
        let names: Vec<&str> = tools
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();
        // No proposals: an agent saves a change, or is told it may not.
        assert_eq!(names, ["aura_memory_read", "aura_memory_write"]);
        for (tool, wanted) in names.iter().zip(["read", "write"]) {
            assert_eq!(operation(tool), wanted);
        }
        // A session from before proposals went reaches the app, which says they are gone.
        assert_eq!(operation("aura_memory_propose"), "propose");
        assert_eq!(operation("aura_memory_accept"), "unsupported");
        let write = &tools[1];
        assert_eq!(
            write["inputSchema"]["required"],
            json!(["base_revision", "markdown", "reason"])
        );
        assert_eq!(write["inputSchema"]["additionalProperties"], false);
        let description = write["description"].as_str().unwrap();
        for phrase in [
            "aura_memory_read first",
            "complete updated document",
            "concise",
            "can undo it",
            "turned agents' edits off",
        ] {
            assert!(description.contains(phrase), "{phrase}");
        }
        assert!(!tools.to_string().contains("propose"));
    }
}
