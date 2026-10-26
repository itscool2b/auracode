//! Static website responses only. Account operations belong to the separate Rust API Worker.

pub struct Asset {
    pub path: &'static str,
    pub route: Option<&'static str>,
    pub mime: &'static str,
    pub etag: &'static str,
    pub immutable: bool,
    pub headers: &'static [(&'static str, &'static str)],
    pub bytes: &'static [u8],
}

pub struct ResponsePlan {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: &'static [u8],
}

fn valid_path(path: &str) -> bool {
    path.starts_with('/')
        && !path.starts_with("//")
        && path.len() <= 2048
        && !path
            .bytes()
            .any(|b| b.is_ascii_control() || matches!(b, b'%' | b'\\' | b'?' | b'#'))
        && !path.split('/').any(|part| matches!(part, "." | ".."))
}

fn header(headers: &mut Vec<(String, String)>, name: &str, value: &str) {
    headers.retain(|(key, _)| key != name);
    headers.push((name.into(), value.into()));
}

fn error(status: u16, body: &'static [u8], head: bool, common: &[(&str, &str)]) -> ResponsePlan {
    let mut headers: Vec<_> = common
        .iter()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect();
    header(&mut headers, "cache-control", "no-store");
    header(&mut headers, "content-type", "text/plain; charset=utf-8");
    header(&mut headers, "content-length", &body.len().to_string());
    ResponsePlan {
        status,
        headers,
        body: if head { b"" } else { body },
    }
}

pub fn respond(
    method: &str,
    path: &str,
    if_none_match: Option<&str>,
    assets: &[Asset],
    common: &[(&str, &str)],
) -> ResponsePlan {
    let head = method == "HEAD";
    if !valid_path(path) {
        return error(400, b"Invalid path\n", head, common);
    }
    // The more-specific /api/* route belongs to auracode-api. Never serve a page or proxy an
    // account request if this catch-all is invoked without that deployment route installed.
    if path.eq_ignore_ascii_case("/api")
        || path
            .get(..5)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("/api/"))
    {
        return error(404, b"Not found\n", head, common);
    }
    if !matches!(method, "GET" | "HEAD") {
        let mut response = error(405, b"Method not allowed\n", false, common);
        header(&mut response.headers, "allow", "GET, HEAD");
        return response;
    }
    let Some(asset) = assets.iter().find(|asset| {
        asset.path == path
            || asset.route.is_some_and(|route| {
                route == path || (route != "/" && path.strip_suffix('/') == Some(route))
            })
    }) else {
        return error(404, b"Not found\n", head, common);
    };
    let mut headers: Vec<_> = asset
        .headers
        .iter()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect();
    header(&mut headers, "content-type", asset.mime);
    let no_store = headers.iter().any(|(key, value)| {
        key == "cache-control" && value.split(',').any(|part| part.trim() == "no-store")
    });
    if !headers.iter().any(|(key, _)| key == "cache-control") {
        header(
            &mut headers,
            "cache-control",
            if asset.immutable {
                "public, max-age=31536000, immutable"
            } else {
                "public, max-age=0, must-revalidate"
            },
        );
    }
    if !no_store {
        header(&mut headers, "etag", asset.etag);
        if if_none_match.is_some_and(|value| {
            value.split(',').any(|part| {
                let tag = part.trim();
                tag == "*" || tag.strip_prefix("W/").unwrap_or(tag) == asset.etag
            })
        }) {
            return ResponsePlan {
                status: 304,
                headers,
                body: b"",
            };
        }
    }
    header(
        &mut headers,
        "content-length",
        &asset.bytes.len().to_string(),
    );
    ResponsePlan {
        status: 200,
        headers,
        body: if head { b"" } else { asset.bytes },
    }
}

#[cfg(target_arch = "wasm32")]
mod edge {
    use worker::*;
    include!(concat!(env!("OUT_DIR"), "/assets.rs"));

    #[event(fetch)]
    async fn fetch(request: Request, _env: Env, _context: Context) -> Result<Response> {
        let path = request.path();
        let conditional = request.headers().get("If-None-Match")?;
        let plan = crate::respond(
            request.method().as_ref(),
            &path,
            conditional.as_deref(),
            ASSETS,
            COMMON,
        );
        let headers = Headers::new();
        for (name, value) in plan.headers {
            headers.set(&name, &value)?;
        }
        let response = if plan.body.is_empty() {
            Response::empty()?
        } else {
            Response::from_bytes(plan.body.to_vec())?
        };
        Ok(response.with_status(plan.status).with_headers(headers))
    }
}

#[cfg(test)]
mod manifest;

#[cfg(test)]
mod tests {
    use super::*;
    static ASSETS: &[Asset] = &[
        Asset {
            path: "/index.html",
            route: Some("/"),
            mime: "text/html; charset=utf-8",
            etag: "\"home\"",
            immutable: false,
            headers: &[],
            bytes: b"home",
        },
        Asset {
            path: "/account/index.html",
            route: Some("/account"),
            mime: "text/html; charset=utf-8",
            etag: "\"account\"",
            immutable: false,
            headers: &[("cache-control", "no-store")],
            bytes: b"account",
        },
        Asset {
            path: "/assets/app-12345678.js",
            route: None,
            mime: "text/javascript; charset=utf-8",
            etag: "\"js\"",
            immutable: true,
            headers: &[],
            bytes: b"js",
        },
    ];
    fn get(method: &str, path: &str, tag: Option<&str>) -> ResponsePlan {
        respond(
            method,
            path,
            tag,
            ASSETS,
            &[("x-content-type-options", "nosniff")],
        )
    }
    fn value<'a>(response: &'a ResponsePlan, name: &str) -> Option<&'a str> {
        response
            .headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    #[test]
    fn pretty_index_and_trailing_paths_share_auth_no_store() {
        for path in ["/account", "/account/", "/account/index.html"] {
            let response = get("GET", path, Some("*"));
            assert_eq!(response.status, 200);
            assert_eq!(response.body, b"account");
            assert_eq!(value(&response, "cache-control"), Some("no-store"));
            assert_eq!(value(&response, "etag"), None);
        }
        assert_eq!(get("GET", "/", None).body, b"home");
        assert_eq!(get("GET", "/index.html", None).body, b"home");
    }

    #[test]
    fn missing_assets_internal_files_and_api_are_not_spa_fallback() {
        for path in [
            "/missing",
            "/assets/missing.js",
            "/_headers",
            "/__spa-fallback.html",
            "/api",
            "/api/v1/config",
            "/API/v1/config",
        ] {
            let response = get("GET", path, None);
            assert_eq!(response.status, 404, "{path}");
            assert_eq!(value(&response, "cache-control"), Some("no-store"));
            assert_ne!(response.body, b"home");
        }
        assert_eq!(get("POST", "/api/v1/auth/start", None).status, 404);
        assert_eq!(
            value(&get("POST", "/account", None), "allow"),
            Some("GET, HEAD")
        );
    }

    #[test]
    fn traversal_encodings_and_ambiguous_paths_are_refused() {
        for path in [
            "/../index.html",
            "/assets/./app.js",
            "/%2e%2e/index.html",
            "/a%2fb",
            "/a\\b",
            "/a\0b",
            "//index.html",
            "/account?x",
            "/account#x",
        ] {
            assert_eq!(get("GET", path, None).status, 400, "{path}");
        }
    }

    #[test]
    fn head_conditional_and_content_addressed_cache_semantics() {
        let get_response = get("GET", "/assets/app-12345678.js", None);
        let head = get("HEAD", "/assets/app-12345678.js", None);
        assert!(head.body.is_empty());
        assert_eq!(head.headers, get_response.headers);
        assert_eq!(value(&head, "content-length"), Some("2"));
        assert_eq!(
            value(&head, "cache-control"),
            Some("public, max-age=31536000, immutable")
        );
        for tag in ["\"js\"", "\"other\", W/\"js\"", "*"] {
            let response = get("GET", "/assets/app-12345678.js", Some(tag));
            assert_eq!(response.status, 304);
            assert!(response.body.is_empty());
            assert_eq!(value(&response, "content-length"), None);
        }
        assert_eq!(
            value(&get("GET", "/", None), "cache-control"),
            Some("public, max-age=0, must-revalidate")
        );
        assert!(get("HEAD", "/missing", None).body.is_empty());
    }
}
