use super::*;
use crate::{
    chatstore::{NewChat, rows},
    owner::ProfileOwner,
    paths::DataRoot,
    profile::Profiles,
    store::Store,
};
use tokio::io::AsyncBufReadExt;
fn fixture() -> (tempfile::TempDir, Arc<ChatStore>, String) {
    let temp = tempfile::tempdir().unwrap();
    let profile = Profiles::new(DataRoot::at(temp.path()))
        .open_active()
        .unwrap();
    let owner = ProfileOwner::acquire(&profile).unwrap();
    let (store, _) = Store::open(&profile).unwrap();
    let chat = rows::create_chat(
        store.conn(),
        &NewChat {
            folder: "/service-memory".into(),
            agent_id: "mock".into(),
            agent_host: Default::default(),
            device_id: "device".into(),
            now: 1,
        },
    )
    .unwrap();
    let store = ChatStore::start(
        store,
        owner,
        &profile,
        "device".into(),
        tokio::runtime::Handle::current(),
    )
    .unwrap();
    (temp, store, chat.id)
}
async fn call(endpoint: &str, token: &str, mut value: serde_json::Value) -> serde_json::Value {
    let mut stream = tokio::net::TcpStream::connect(endpoint).await.unwrap();
    value["token"] = serde_json::json!(token);
    let mut bytes = serde_json::to_vec(&value).unwrap();
    bytes.push(b'\n');
    stream.write_all(&bytes).await.unwrap();
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line).await.unwrap();
    serde_json::from_str(&line).unwrap()
}
#[test]
fn token_comparison_rejects_prefix_and_wrong_bytes() {
    assert!(same_token("abc", "abc"));
    assert!(!same_token("abc", "ab"));
    assert!(!same_token("abc", "abd"));
    assert!(!same_token("abc", "abcd"));
}
#[tokio::test]
async fn scoped_memory_service_only_reads_and_proposes_and_drop_revokes_credential() {
    let (_dir, store, chat) = fixture();
    let grant =
        MemoryGrant::start(store.clone(), chat, &tokio::runtime::Handle::current()).unwrap();
    let endpoint = grant.endpoint.clone();
    let token = grant.token.clone();
    assert!(!format!("{grant:?}").contains(&token));
    let denied = call(&endpoint, "wrong", serde_json::json!({"operation":"read"})).await;
    assert!(denied.get("error").is_some());
    let read = call(&endpoint, &token, serde_json::json!({"operation":"read"})).await;
    assert_eq!(read["result"]["markdown"], "");
    let proposed=call(&endpoint,&token,serde_json::json!({"operation":"propose","base_revision":null,"markdown":"Proposed durable fact","reason":"Useful across chats","idempotency_key":"service-test"})).await;
    assert_eq!(proposed["result"]["state"], "pending");
    let read = call(&endpoint, &token, serde_json::json!({"operation":"read"})).await;
    assert_eq!(read["result"]["markdown"], "");
    let accept = call(&endpoint, &token, serde_json::json!({"operation":"accept"})).await;
    assert!(accept.get("error").is_some());
    let cross = call(
        &endpoint,
        &token,
        serde_json::json!({"operation":"read","project_id":"foreign"}),
    )
    .await;
    assert!(cross.get("error").is_some());
    drop(grant);
    tokio::task::yield_now().await;
    assert!(tokio::net::TcpStream::connect(&endpoint).await.is_err());
    store.shutdown(std::time::Duration::from_secs(5)).await;
}
