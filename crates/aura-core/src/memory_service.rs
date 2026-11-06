//! App-owned memory service. A grant owns one generation's listener and revokes on drop.
//! No database paths or account keys cross the process boundary.
use crate::chatstore::{
    ChatStore,
    memory::{Command, Reply},
};
use aura_protocol::{
    mcp::{McpCredentials, McpDefinition, McpTransport, ResolvedMcpServer},
    memory::{ProposeProjectMemory, SaveProjectMemory},
};
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
    task::AbortHandle,
};

pub(crate) struct MemoryGrant {
    endpoint: String,
    token: String,
    abort: AbortHandle,
}
impl std::fmt::Debug for MemoryGrant {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MemoryGrant").finish_non_exhaustive()
    }
}
impl Drop for MemoryGrant {
    fn drop(&mut self) {
        self.abort.abort();
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    token: String,
    operation: String,
    #[serde(default)]
    base_revision: Option<String>,
    /// Absent is not empty: a write must name its whole replacement, even an empty one.
    #[serde(default)]
    markdown: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    idempotency_key: String,
}
/// What an agent reads when the profile keeps memory review-only.
pub(crate) const REVIEW_ONLY: &str = "Direct memory edits are off: the user reviews every update in Aura. Use aura_memory_propose to propose this change instead.";
impl MemoryGrant {
    /// `direct_writes` is the profile's switch, read on every request, so turning it off or on
    /// applies to running chats at once.
    pub(crate) fn start(
        store: Arc<ChatStore>,
        chat_id: String,
        direct_writes: Arc<AtomicBool>,
        rt: &tokio::runtime::Handle,
    ) -> std::io::Result<Self> {
        let socket = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
        socket.set_nonblocking(true)?;
        let endpoint = socket.local_addr()?.to_string();
        let token = format!("{}{}", crate::ids::new_id(), crate::ids::new_id());
        let credential = token.clone();
        let task=rt.spawn(async move {
            let Ok(listener)=TcpListener::from_std(socket) else {return;};
            let project_id = match store.memory(Command::ReadChat(chat_id.clone())).await { Ok(Reply::Memory(memory)) => memory.project_id, _ => return };
            let mut changes = store.workspace_changes();
            loop {
                let accepted = tokio::select! {
                    accepted = listener.accept() => accepted,
                    changed = changes.changed() => { if changed.is_err() || !store.workspace_available(&chat_id) { return; } continue; }
                };
                let Ok((mut stream,_))=accepted else {return;};
                let mut revoked = false;
                // Bound both bytes and wall time, including unauthenticated local callers.
                let result=tokio::time::timeout(std::time::Duration::from_secs(3),async {
                    use tokio::io::AsyncReadExt;
                    let mut input=Vec::new();
                    let mut reader=BufReader::new((&mut stream).take(96*1024));
                    reader.read_until(b'\n',&mut input).await?;
                    if input.len()>=96*1024 || input.last()!=Some(&b'\n'){return Ok::<_,std::io::Error>(serde_json::json!({"error":"Invalid bounded memory request."}));}
                    let request:Request=match serde_json::from_slice(&input){Ok(v)=>v,Err(_)=>return Ok(serde_json::json!({"error":"Invalid memory request."}))};
                    if !same_token(&credential,&request.token){return Ok(serde_json::json!({"error":"Memory access expired. Restart the Aura session."}));}
                    let project=match store.memory(Command::ReadChat(chat_id.clone())).await {Ok(Reply::Memory(memory)) if memory.project_id == project_id =>Some(memory.project_id),_=>None};
                    let Some(project)=project else {revoked=true;return Ok(serde_json::json!({"error":"The project is unavailable."}));};
                    // Scope is derived from the app-owned chat, never a client supplied project ID.
                    let command=match request.operation.as_str(){
                        "read"=>Command::Read(project),
                        "write"=>{
                            if !direct_writes.load(Ordering::Acquire){return Ok(serde_json::json!({"error":REVIEW_ONLY}));}
                            let (Some(markdown),Some(reason))=(request.markdown,request.reason) else {return Ok(serde_json::json!({"error":"A memory write needs the complete replacement Markdown, its base revision and a reason."}));};
                            Command::AgentSave{input:SaveProjectMemory{project_id:project,expected_revision:request.base_revision,markdown,reason},chat_id:chat_id.clone()}
                        }
                        "propose"=>Command::Propose(ProposeProjectMemory{project_id:project,base_revision:request.base_revision,markdown:request.markdown.unwrap_or_default(),reason:request.reason.unwrap_or_default(),chat_id:Some(chat_id.clone()),idempotency_key:request.idempotency_key}),
                        _=>return Ok(serde_json::json!({"error":"Unsupported memory operation. Use read, write or propose."}))
                    };
                    Ok(match store.memory(command).await {Ok(Reply::Memory(v))=>serde_json::json!({"result":v}),Ok(Reply::Proposal(v))=>serde_json::json!({"result":v}),Ok(_)=>serde_json::json!({"error":"Unexpected memory response."}),Err(error)=>serde_json::json!({"error":error.to_string()})})
                }).await;
                let response=match result{Ok(Ok(v))=>v,_=>serde_json::json!({"error":"The Aura memory service is unavailable."})};
                if let Ok(mut bytes)=serde_json::to_vec(&response){bytes.push(b'\n');let _=tokio::time::timeout(std::time::Duration::from_secs(1),stream.write_all(&bytes)).await;}
                if revoked { return; }
            }
        });
        Ok(Self {
            endpoint,
            token,
            abort: task.abort_handle(),
        })
    }
    pub(crate) fn mcp(&self, project: Option<String>) -> Option<ResolvedMcpServer> {
        let exe = std::env::current_exe().ok()?;
        let path = exe;
        if !path.is_file() {
            return None;
        }
        Some(ResolvedMcpServer {
            definition: McpDefinition {
                id: "aura-project-memory".into(),
                name: "aura_project_memory".into(),
                project_id: project,
                enabled: true,
                transport: McpTransport::Stdio {
                    command: path.to_string_lossy().into_owned(),
                    args: vec!["--aura-memory-helper".into(), "--mcp".into()],
                },
                env_keys: vec!["AURA_MEMORY_ENDPOINT".into(), "AURA_MEMORY_TOKEN".into()],
                header_keys: vec![],
                agents: None,
            },
            revision: 1,
            credentials: McpCredentials {
                env: BTreeMap::from([
                    ("AURA_MEMORY_ENDPOINT".into(), self.endpoint.clone()),
                    ("AURA_MEMORY_TOKEN".into(), self.token.clone()),
                ]),
                headers: BTreeMap::new(),
            },
        })
    }
}
fn same_token(a: &str, b: &str) -> bool {
    let mut diff = a.len() ^ b.len();
    for (i, x) in a.bytes().enumerate() {
        diff |= usize::from(x ^ b.as_bytes().get(i).copied().unwrap_or(0));
    }
    diff == 0
}
#[cfg(test)]
mod tests;

mod helper;
pub use helper::run_helper;
