//! What the address bar (and an agent's `browser_navigate`) means by its words, and which
//! addresses the browser may open itself.

use tauri::Url;

/// Where a search goes when the words are not an address.
pub const SEARCH: &str = "https://www.google.com/search?q=";

/// The longest address the browser takes from a person or an agent.
pub const MAX_ADDRESS: usize = 8 * 1024;

/// What the browser does with an address a page navigates to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Policy {
    /// A page of the web or a local file: the browser opens it.
    Open,
    /// Another program's link (`mailto:`, `vscode:`, `slack:`): the person may open it outside.
    Outside,
    /// Never (`javascript:`, the engine's own pages, anything unreadable).
    Refuse,
}

/// The address `input` stands for: an address as typed, a host to complete, a file path, or words
/// to search for. `None` for empty input or an address the browser never opens.
pub fn resolve(input: &str) -> Option<String> {
    let text = input.trim();
    if text.is_empty() || text.len() > MAX_ADDRESS || text.chars().any(char::is_control) {
        return None;
    }
    // A Windows path, or an absolute one elsewhere: the local file.
    if let Some(file) = file_url(text) {
        return Some(file);
    }
    if let Ok(url) = Url::parse(text)
        && matches!(url.scheme(), "http" | "https" | "file" | "about")
    {
        return match policy(url.as_str()) {
            Policy::Open => Some(url.into()),
            _ => None,
        };
    }
    if let Some(rest) = text.strip_prefix("//")
        && let Ok(url) = Url::parse(&format!("https://{rest}"))
    {
        return Some(url.into());
    }
    if !text.contains(char::is_whitespace)
        && let Some(url) = host_url(text)
    {
        return Some(url);
    }
    let mut search = Url::parse(SEARCH).ok()?;
    search.query_pairs_mut().clear().append_pair("q", text);
    Some(search.into())
}

/// `localhost:5173`, `127.0.0.1:8080/app`, `example.com`, `my-app.test`: an address without its
/// scheme. Local and private hosts get `http`, everything else `https`.
fn host_url(text: &str) -> Option<String> {
    let probe = Url::parse(&format!("http://{text}")).ok()?;
    let host = probe.host_str()?.to_ascii_lowercase();
    let v6 = host
        .strip_prefix('[')
        .and_then(|inner| inner.strip_suffix(']'))
        .and_then(|inner| inner.parse::<std::net::Ipv6Addr>().ok());
    let local = match (host.parse::<std::net::Ipv4Addr>(), v6) {
        (Ok(ip), _) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        (_, Some(ip)) => ip.is_loopback(),
        _ => {
            let name = host;
            if name == "localhost"
                || name.ends_with(".localhost")
                || name.ends_with(".local")
                || name.ends_with(".test")
                || name.ends_with(".internal")
            {
                true
            } else if !name.contains('.') {
                // A dotless word is a search unless it names a port (`devbox:3000`).
                if probe.port().is_none() {
                    return None;
                }
                true
            } else {
                // A real domain ends in a country's two letters or a known generic name, so
                // `file.txt` and `v1.2` stay searches.
                if !known_tld(name.rsplit('.').next().unwrap_or("")) {
                    return None;
                }
                false
            }
        }
    };
    let scheme = if local { "http" } else { "https" };
    Url::parse(&format!("{scheme}://{text}")).ok().map(Into::into)
}

/// Generic top-level domains people type (country codes are any two letters).
const GENERIC_TLDS: &[&str] = &[
    "com", "org", "net", "edu", "gov", "mil", "int", "app", "dev", "page", "info", "biz", "xyz",
    "site", "online", "tech", "store", "shop", "blog", "cloud", "design", "studio", "art", "live",
    "news", "wiki", "pro", "name", "mobi", "agency", "digital", "media", "systems", "software",
    "codes", "tools", "run", "build", "chat", "bot", "inc", "llc", "company", "world", "space",
    "today", "life", "website", "team", "work", "works", "zone", "network", "email", "link",
    "click", "fun", "games", "game", "video", "music", "photo", "photos", "solutions", "services",
    "help", "support", "academy", "school", "rocks", "ninja", "guru", "lol", "wtf", "cool", "one",
    "new", "top", "vip", "plus", "global", "google", "amazon", "microsoft", "apple", "museum",
    "aero", "coop", "jobs", "travel", "cat", "asia", "eus", "berlin", "london", "nyc", "paris",
    "tokyo", "africa", "onion",
];

fn known_tld(tld: &str) -> bool {
    let tld = tld.to_ascii_lowercase();
    (tld.len() == 2 && tld.chars().all(|c| c.is_ascii_alphabetic()))
        || GENERIC_TLDS.contains(&tld.as_str())
        || (tld.starts_with("xn--") && tld.len() > 4)
}

/// A local file's address from its path, when `text` is one.
fn file_url(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let windows_drive = bytes.len() > 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/');
    if cfg!(windows) {
        // Never a network share (\\server\share): opening one sends the person's Windows
        // credentials to that server.
        if !windows_drive {
            return None;
        }
    } else if !text.starts_with('/') || text.starts_with("//") {
        return None;
    }
    Url::from_file_path(std::path::Path::new(text))
        .ok()
        .map(Into::into)
}

/// Whether the browser opens `address` itself, hands it to another program, or refuses it.
pub fn policy(address: &str) -> Policy {
    let Ok(url) = Url::parse(address) else {
        return Policy::Refuse;
    };
    match url.scheme() {
        "http" | "https" => {
            if url.host_str().is_some_and(str::is_empty) {
                Policy::Refuse
            } else {
                Policy::Open
            }
        }
        // A file on this computer only: `file://server/share` reaches out over the network with
        // the person's Windows credentials.
        "file" => {
            if url.host_str().is_none_or(|host| host.is_empty() || host == "localhost") {
                Policy::Open
            } else {
                Policy::Refuse
            }
        }
        "data" | "blob" => Policy::Open,
        "about" => {
            if matches!(url.as_str(), "about:blank" | "about:srcdoc") {
                Policy::Open
            } else {
                Policy::Refuse
            }
        }
        // The engines' own pages, script and anything that would read local data are never pages
        // of this browser.
        "javascript" | "vbscript" | "chrome" | "edge" | "devtools" | "chrome-extension"
        | "view-source" | "filesystem" | "ws" | "wss" | "intent" | "ms-settings" => {
            Policy::Refuse
        }
        scheme
            if scheme.len() >= 2
                && scheme
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.')) =>
        {
            Policy::Outside
        }
        _ => Policy::Refuse,
    }
}

/// What an agent may open: pages of the web (and the blank page), never a local file or anything
/// else a person could open themselves. An agent reads and edits files with its own tools, under
/// its own access; the browser is no way around that.
pub fn resolve_for_agent(input: &str) -> Result<String, String> {
    let url = resolve(input).ok_or_else(|| format!("{input} is not an address the browser can open."))?;
    let scheme = url.split(':').next().unwrap_or("");
    if matches!(scheme, "http" | "https") || url == "about:blank" {
        Ok(url)
    } else {
        Err("Agents open web pages only (http and https). To look at a local page, serve its folder (for example with npx serve) and open its localhost address, or ask the person to open the file in the browser.".into())
    }
}

/// Whether `address` is worth keeping in history: a web page or a local file.
pub fn remembered(address: &str) -> bool {
    address.len() <= 4096
        && Url::parse(address).is_ok_and(|url| matches!(url.scheme(), "http" | "https" | "file"))
}

/// The host a person recognises an address by (`localhost:5173`, `github.com`), or the file name.
pub fn site(address: &str) -> String {
    let Ok(url) = Url::parse(address) else {
        return address.to_owned();
    };
    if url.scheme() == "file" {
        return url
            .path_segments()
            .and_then(|mut segments| segments.next_back().map(str::to_owned))
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "Local file".into());
    }
    match (url.host_str(), url.port()) {
        (Some(host), Some(port)) => format!("{}:{port}", host.trim_start_matches("www.")),
        (Some(host), None) => host.trim_start_matches("www.").to_owned(),
        _ => address.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_open_as_typed() {
        assert_eq!(
            resolve("https://example.com/a?b=1").as_deref(),
            Some("https://example.com/a?b=1")
        );
        assert_eq!(
            resolve("  http://localhost:3000/  ").as_deref(),
            Some("http://localhost:3000/")
        );
        assert_eq!(resolve("about:blank").as_deref(), Some("about:blank"));
    }

    #[test]
    fn hosts_get_the_scheme_they_need() {
        for (typed, wanted) in [
            ("localhost:5173", "http://localhost:5173/"),
            ("localhost", "http://localhost/"),
            ("127.0.0.1:8080/app", "http://127.0.0.1:8080/app"),
            ("192.168.1.20:3000", "http://192.168.1.20:3000/"),
            ("api.localhost:4000", "http://api.localhost:4000/"),
            ("devbox:3000", "http://devbox:3000/"),
            ("my-app.test", "http://my-app.test/"),
            ("example.com", "https://example.com/"),
            ("github.com/itscool2b", "https://github.com/itscool2b"),
            ("[::1]:8000", "http://[::1]:8000/"),
            ("//example.org/x", "https://example.org/x"),
        ] {
            assert_eq!(resolve(typed).as_deref(), Some(wanted), "{typed}");
        }
    }

    #[test]
    fn words_are_searched() {
        for typed in [
            "rust borrow checker",
            "react",
            "what is 1.5",
            "v1.2",
            "file.txt",
            "ls -la",
        ] {
            let address = resolve(typed).expect("a search");
            assert!(address.starts_with(SEARCH), "{typed} -> {address}");
        }
        assert_eq!(
            resolve("a&b c").as_deref(),
            Some("https://www.google.com/search?q=a%26b+c")
        );
    }

    #[test]
    fn nothing_dangerous_is_typed_in() {
        for typed in [
            "",
            "   ",
            "javascript:alert(1)",
            "about:config",
            "data:text/html,hi",
        ] {
            let resolved = resolve(typed);
            assert!(
                resolved.is_none() || resolved.as_deref().is_some_and(|a| a.starts_with(SEARCH)),
                "{typed} -> {resolved:?}"
            );
        }
        assert_eq!(resolve(&"x".repeat(MAX_ADDRESS + 1)), None);
        assert_eq!(resolve("a\u{0}b"), None);
    }

    #[cfg(windows)]
    #[test]
    fn a_windows_path_opens_the_file() {
        assert_eq!(
            resolve(r"C:\site\index.html").as_deref(),
            Some("file:///C:/site/index.html")
        );
        assert_eq!(
            resolve("C:/site/a b.html").as_deref(),
            Some("file:///C:/site/a%20b.html")
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn an_absolute_path_opens_the_file() {
        assert_eq!(
            resolve("/home/me/site/index.html").as_deref(),
            Some("file:///home/me/site/index.html")
        );
    }

    #[test]
    fn network_shares_never_open() {
        for typed in [r"\\server\share\page.html", "//server/share", "file://server/share/x.html"] {
            let resolved = resolve(typed);
            assert!(
                resolved.as_deref().is_none_or(|address| !address.starts_with("file:")),
                "{typed} -> {resolved:?}"
            );
        }
        assert_eq!(policy("file://server/share/x.html"), Policy::Refuse);
        assert_eq!(policy("file://localhost/C:/a.html"), Policy::Open);
    }

    #[test]
    fn agents_open_the_web_only() {
        assert_eq!(
            resolve_for_agent("localhost:5173").as_deref(),
            Ok("http://localhost:5173/")
        );
        assert!(resolve_for_agent("https://example.com").is_ok());
        assert!(resolve_for_agent("rust borrow checker").is_ok(), "a search is a web page");
        assert!(resolve_for_agent("about:blank").is_ok());
        for local in ["file:///C:/Users/me/.ssh/id_rsa", "C:/Users/me/secret.html", "/etc/passwd"] {
            let refused = resolve_for_agent(local);
            assert!(
                refused.is_err() || refused.as_deref().is_ok_and(|a| a.starts_with(SEARCH)),
                "{local} -> {refused:?}"
            );
        }
        assert!(resolve_for_agent("file:///C:/x.html").is_err());
    }

    #[test]
    fn pages_may_only_open_pages() {
        for address in [
            "https://example.com",
            "http://localhost:3000/x",
            "file:///C:/a.html",
            "about:blank",
            "data:text/html,hi",
            "blob:https://example.com/123",
        ] {
            assert_eq!(policy(address), Policy::Open, "{address}");
        }
        for address in [
            "mailto:someone@example.com",
            "vscode://file/c:/x",
            "slack://open",
            "zoommtg://zoom.us/join",
            "tel:+15551234",
        ] {
            assert_eq!(policy(address), Policy::Outside, "{address}");
        }
        for address in [
            "javascript:alert(1)",
            "edge://settings",
            "chrome://flags",
            "about:config",
            "view-source:https://example.com",
            "not an address",
            "ws://localhost:1",
        ] {
            assert_eq!(policy(address), Policy::Refuse, "{address}");
        }
    }

    #[test]
    fn history_keeps_pages_and_files_only() {
        assert!(remembered("https://example.com/"));
        assert!(remembered("file:///C:/a.html"));
        assert!(!remembered("about:blank"));
        assert!(!remembered("data:text/html,hi"));
        assert!(!remembered(&format!("https://e.com/{}", "a".repeat(5000))));
    }

    #[test]
    fn sites_read_as_people_name_them() {
        assert_eq!(site("https://www.github.com/x"), "github.com");
        assert_eq!(site("http://localhost:5173/app"), "localhost:5173");
        assert_eq!(site("file:///C:/site/index.html"), "index.html");
    }
}
