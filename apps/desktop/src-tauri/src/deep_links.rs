//! Website links only request an Account screen. They never authenticate or change profiles.

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use specta::Type;
use tauri::{Emitter, Manager, Url};
use tauri_plugin_deep_link::DeepLinkExt;

const EVENT: &str = "auracode-sign-in-link";

#[derive(Clone, Debug, PartialEq, Serialize, Type)]
pub struct SignInLink {
    pub id: String,
    pub email: Option<String>,
}

/// One bounded, in-memory request. An older webview acknowledgement cannot erase a new link.
#[derive(Default)]
pub struct SignInLinks {
    next_id: AtomicU64,
    pending: Mutex<Option<SignInLink>>,
}

impl SignInLinks {
    fn offer(&self, url: &Url) -> bool {
        let Some(email) = sign_in_email(url) else {
            return false;
        };
        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        *self
            .pending
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(SignInLink { id, email });
        true
    }

    fn peek(&self) -> Option<SignInLink> {
        self.pending
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    fn acknowledge(&self, id: &str) {
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if pending.as_ref().is_some_and(|link| link.id == id) {
            *pending = None;
        }
    }
}

fn sign_in_email(url: &Url) -> Option<Option<String>> {
    if url.as_str().len() > 2048
        || url.scheme() != "auracode"
        || url.host_str() != Some("signin")
        || !matches!(url.path(), "" | "/")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let mut email = None;
    for (name, value) in url.query_pairs() {
        if name != "email" || email.is_some() {
            return None;
        }
        let (local, domain) = value.split_once('@')?;
        if value.len() > 254
            || local.is_empty()
            || domain.is_empty()
            || domain.contains('@')
            || value
                .chars()
                .any(|character| character.is_control() || character.is_whitespace())
        {
            return None;
        }
        email = Some(value.into_owned());
    }
    Some(email)
}

fn receive(app: &tauri::AppHandle, urls: Vec<Url>) {
    let links = app.state::<SignInLinks>();
    // OS batches are bounded before validation and never logged (they can contain an email).
    let mut accepted = false;
    for url in urls.into_iter().take(8) {
        accepted |= links.offer(&url);
    }
    if accepted {
        let _ = app.emit(EVENT, ());
    }
}

pub fn setup(app: &tauri::AppHandle) {
    let handle = app.clone();
    app.deep_link()
        .on_open_url(move |event| receive(&handle, event.urls()));
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        receive(app, urls);
    }
    // Installer configuration registers the scheme. Development never rewrites OS associations.
}

#[tauri::command]
#[specta::specta]
pub fn sign_in_link_pending(links: tauri::State<'_, SignInLinks>) -> Option<SignInLink> {
    links.peek()
}

#[tauri::command]
#[specta::specta]
pub fn sign_in_link_acknowledge(links: tauri::State<'_, SignInLinks>, id: String) {
    links.acknowledge(&id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_bounded_account_navigation() {
        for (url, expected) in [
            ("auracode://signin", None),
            ("auracode://signin/", None),
            (
                "auracode://signin?email=person%2Bdesk%40example.com",
                Some("person+desk@example.com"),
            ),
        ] {
            assert_eq!(
                sign_in_email(&Url::parse(url).unwrap()),
                Some(expected.map(str::to_owned))
            );
        }
        for url in [
            "https://signin",
            "auracode://settings",
            "auracode://signin/file",
            "auracode://person@signin",
            "auracode://signin:443",
            "auracode://signin#token",
            "auracode://signin?token=secret",
            "auracode://signin?email=a%40b&email=c%40d",
            "auracode://signin?email=",
            "auracode://signin?email=bad",
            "auracode://signin?email=%40example.com",
            "auracode://signin?email=a%40b%40c",
            "auracode://signin?email=a%40b%0A",
            "auracode://signin?email=a+b%40c",
        ] {
            assert_eq!(sign_in_email(&Url::parse(url).unwrap()), None, "{url}");
        }
        assert_eq!(
            sign_in_email(
                &Url::parse(&format!("auracode://signin?email={}@b", "x".repeat(255))).unwrap()
            ),
            None
        );
    }

    #[test]
    fn requests_survive_reload_and_stale_acknowledgements() {
        let links = SignInLinks::default();
        assert!(links.offer(&Url::parse("auracode://signin?email=first%40example.com").unwrap()));
        let first = links.peek().unwrap();
        assert_eq!(links.peek(), Some(first.clone()));
        assert!(!links.offer(&Url::parse("auracode://signin?token=secret").unwrap()));
        assert_eq!(links.peek(), Some(first.clone()));
        assert!(links.offer(&Url::parse("auracode://signin?email=second%40example.com").unwrap()));
        links.acknowledge(&first.id);
        let second = links.peek().unwrap();
        assert_eq!(second.email.as_deref(), Some("second@example.com"));
        links.acknowledge(&second.id);
        assert_eq!(links.peek(), None);
    }
}
