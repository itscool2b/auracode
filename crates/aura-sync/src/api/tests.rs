use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::mpsc,
};

fn token() -> SessionToken {
    SessionToken::parse(crypto::encode(&[7; 32])).unwrap()
}
fn server(status: &str, headers: &str, body: &str) -> (ApiClient, mpsc::Receiver<Vec<u8>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}/", listener.local_addr().unwrap());
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\n{headers}Connection: close\r\n\r\n{body}",
        body.len()
    );
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let mut request = Vec::new();
        let mut buffer = [0; 4096];
        loop {
            let count = stream.read(&mut buffer).unwrap();
            if count == 0 {
                break;
            }
            request.extend_from_slice(&buffer[..count]);
            if let Some(end) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                let header = String::from_utf8_lossy(&request[..end]);
                let length: usize = header
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length: ")
                            .map(str::to_owned)
                    })
                    .map(|value| value.parse().unwrap())
                    .unwrap_or(0);
                if request.len() >= end + 4 + length {
                    break;
                }
            }
        }
        stream.write_all(response.as_bytes()).unwrap();
        let _ = send.send(request);
    });
    (ApiClient::build(&origin, true).unwrap(), receive)
}

#[test]
fn production_origin_rejects_plain_http_credentials_and_paths() {
    for origin in [
        "http://example.com",
        "http://127.0.0.1",
        "https://user:secret@example.com/",
        "https://example.com/api/",
        "https://example.com/?token=x",
        "https://example.com/#x",
    ] {
        assert!(matches!(ApiClient::new(origin), Err(ApiError::Origin)));
    }
    let client = ApiClient::new("https://example.com").unwrap();
    let token = token();
    let request = client
        .request(Method::GET, "auth/session", Some(&token), None)
        .unwrap();
    assert_eq!(
        request.url().as_str(),
        "https://example.com/api/v1/auth/session"
    );
    assert!(request.headers()[AUTHORIZATION].is_sensitive());
    assert!(!format!("{token:?}").contains(token.expose()));
}

#[tokio::test]
async fn auth_wire_is_desktop_only_and_uses_seconds_without_exposing_tokens() {
    let challenge = crypto::encode(&[2; 32]);
    let response = serde_json::json!({"challenge_id":challenge,"expires_in":600,"resend_after":60})
        .to_string();
    let (client, request) = server("200 OK", "Content-Type: application/json\r\n", &response);
    let answer = client
        .begin_auth("test@example.invalid", "synthetic-turnstile-token")
        .await
        .unwrap();
    assert_eq!(answer.expires_in, 600);
    let request = String::from_utf8(request.recv_timeout(Duration::from_secs(3)).unwrap()).unwrap();
    let body: serde_json::Value =
        serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(body["client_kind"], "desktop");
    assert!(request.starts_with("POST /api/v1/auth/challenges HTTP/1.1"));
    assert!(!request.to_ascii_lowercase().contains("authorization:"));
    let response = serde_json::json!({"user_id":"account","expires_at":1795600000,"token":crypto::encode(&[3;32]),"csrf_token":"ignored-desktop-csrf"}).to_string();
    let (client, _) = server("200 OK", "", &response);
    let session = client.verify_auth(&challenge, "123456").await.unwrap();
    assert_eq!(session.expires_at, 1795600000);
    assert_eq!(session.token.expose(), crypto::encode(&[3; 32]));
}

#[tokio::test]
async fn redirects_errors_and_server_messages_do_not_escape_transport_policy() {
    let (client, _) = server(
        "302 Found",
        "Location: https://example.invalid/private\r\n",
        "",
    );
    assert!(matches!(
        client.keys(&token()).await,
        Err(ApiError::Protocol)
    ));
    let (client, _) = server("401 Unauthorized", "", "private-account-information");
    let error = client.keys(&token()).await.unwrap_err();
    assert_eq!(error, ApiError::Unauthorized);
    assert!(!error.to_string().contains("private-account"));
    let (client, _) = server(
        "429 Too Many Requests",
        "Retry-After: 120\r\n",
        "{\"error\":\"rate_limited\"}",
    );
    assert!(matches!(
        client.keys(&token()).await,
        Err(ApiError::RateLimited {
            retry_after_seconds: 120
        })
    ));
    let (client, _) = server(
        "503 Unavailable",
        "",
        "{\"error\":\"delivery_failed\",\"message\":\"secret\"}",
    );
    assert!(matches!(
        client.keys(&token()).await,
        Err(ApiError::DeliveryFailed {
            retry_after_seconds: 60
        })
    ));
}

#[tokio::test]
async fn pull_rejects_cursor_gaps_in_the_response_contract_and_nonboolean_tombstones() {
    let (client, _) = server(
        "200 OK",
        "",
        "{\"records\":[],\"next_cursor\":8,\"has_more\":false}",
    );
    assert!(matches!(
        client.pull(&token(), 7).await,
        Err(ApiError::Protocol)
    ));
    let (client, _) = server(
        "200 OK",
        "",
        "{\"records\":[],\"next_cursor\":7,\"has_more\":true}",
    );
    assert!(matches!(
        client.pull(&token(), 7).await,
        Err(ApiError::Protocol)
    ));
    let body = serde_json::json!({"records":[{"server_seq":8,"device_id":"device","collection":"chats","id":"chat","hlc":"1793000000000:0000000001:device","deleted":0,"nonce":crypto::encode(&[0;24]),"ciphertext":crypto::encode(&[0;16]),"key_version":1}],"next_cursor":8,"has_more":false});
    let (client, _) = server("200 OK", "", &body.to_string());
    assert!(matches!(
        client.pull(&token(), 7).await,
        Err(ApiError::Protocol)
    ));
    let (client, _) = server(
        "200 OK",
        "",
        "{\"records\":[],\"next_cursor\":7,\"has_more\":false}",
    );
    assert_eq!(client.pull(&token(), 7).await.unwrap().next_cursor, 7);
}

#[tokio::test]
async fn sync_accepts_authoritative_stale_heads_but_rejects_wrong_device_clocks_and_duplicates() {
    let record = EncryptedRecord {
        collection: "chats".into(),
        id: "chat".into(),
        hlc: "1793000000000:0000000001:device".into(),
        deleted: false,
        nonce: crypto::encode(&[0; 24]),
        ciphertext: crypto::encode(&[1; 16]),
        key_version: 1,
    };
    let mut newer = record.clone();
    newer.hlc = "1793000000001:0000000000:another".into();
    let mut head = serde_json::to_value(&newer).unwrap();
    head["server_seq"] = 10.into();
    head["device_id"] = "another".into();
    let body = serde_json::json!({"heads":[head]}).to_string();
    let (client, _) = server("200 OK", "", &body);
    assert_eq!(
        client
            .push(&token(), std::slice::from_ref(&record))
            .await
            .unwrap()
            .heads[0]
            .record,
        newer
    );

    // Global sequence gaps can belong to another account. They are valid, but the clock must
    // identify the author reported in this account's change, not an attacker-selected device.
    let body = serde_json::json!({"records":[head],"next_cursor":10,"has_more":false}).to_string();
    let (client, _) = server("200 OK", "", &body);
    assert_eq!(client.pull(&token(), 7).await.unwrap().next_cursor, 10);
    head["device_id"] = "wrong".into();
    let body = serde_json::json!({"records":[head],"next_cursor":10,"has_more":false}).to_string();
    let (client, _) = server("200 OK", "", &body);
    assert!(matches!(
        client.pull(&token(), 7).await,
        Err(ApiError::Protocol)
    ));

    let client = ApiClient::new("https://example.invalid").unwrap();
    assert!(matches!(
        client.push(&token(), &[record.clone(), record]).await,
        Err(ApiError::InvalidInput)
    ));
}
#[tokio::test]
async fn rebind_wire_binds_the_expected_device_and_accepts_only_a_positive_consumption_reply() {
    let challenge_id = crypto::encode(&[3; 32]);
    let body = serde_json::json!({
        "challenge_id":challenge_id,"device_id":"device","expires_in":300,
        "envelope":{"algorithm":crypto::REBIND_ALGORITHM,"nonce":crypto::encode(&[4;24]),"ciphertext":crypto::encode(&[5;48]),"ephemeral_public_key":crypto::encode(&[6;32])},
    });
    let (client, request) = server("200 OK", "", &body.to_string());
    let challenge = client.begin_rebind(&token(), "device").await.unwrap();
    let request = String::from_utf8(request.recv_timeout(Duration::from_secs(3)).unwrap()).unwrap();
    assert!(request.starts_with("POST /api/v1/devices/rebind/challenges "));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(request.split_once("\r\n\r\n").unwrap().1)
            .unwrap(),
        serde_json::json!({"device_id":"device"})
    );
    let (client, request) = server("200 OK", "", "{\"device_id\":\"device\",\"rebound\":true}");
    let proof = crypto::encode(&[7; 32]);
    client
        .verify_rebind(&token(), &challenge, &proof)
        .await
        .unwrap();
    let request = String::from_utf8(request.recv_timeout(Duration::from_secs(3)).unwrap()).unwrap();
    assert!(request.starts_with("POST /api/v1/devices/rebind/verify "));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(request.split_once("\r\n\r\n").unwrap().1)
            .unwrap(),
        serde_json::json!({"challenge_id":challenge_id,"proof":proof})
    );
    let (client, _) = server("200 OK", "", "{\"device_id\":\"wrong\",\"rebound\":true}");
    assert!(matches!(
        client.verify_rebind(&token(), &challenge, &proof).await,
        Err(ApiError::Protocol)
    ));
}
