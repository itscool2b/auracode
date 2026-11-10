//! The one email auracode sends: a six-digit code, to sign in or to confirm a new address.
//!
//! It goes out as plain text and as HTML, side by side, so a client shows whichever it prefers.
//! The HTML loads nothing: no image, font or link to fetch, so opening it tells nobody anything.
//! Everything here is ASCII in short lines, which needs no transfer encoding.

/// Why a code is being sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Purpose {
    SignIn,
    /// Confirming the address an account is changing to.
    NewEmail,
}

impl Purpose {
    fn subject(self) -> &'static str {
        match self {
            Self::SignIn => "Your auracode sign-in code",
            Self::NewEmail => "Confirm your new auracode email",
        }
    }

    fn heading(self) -> &'static str {
        match self {
            Self::SignIn => "Your sign-in code",
            Self::NewEmail => "Confirm your new email",
        }
    }

    fn lead(self) -> &'static str {
        match self {
            Self::SignIn => "Enter this code in auracode to finish signing in.",
            Self::NewEmail => "Enter this code in auracode to use this address for your account.",
        }
    }

    fn ignore(self) -> &'static str {
        match self {
            Self::SignIn => {
                "If you did not ask for it, ignore this email. Nobody can sign in without the code."
            }
            Self::NewEmail => {
                "If you did not ask for it, ignore this email. Your account's address stays as it is."
            }
        }
    }
}

/// What goes into one message besides the code. All of it is the server's own, except `to`.
pub struct Envelope<'a> {
    pub sender: &'a str,
    pub to: &'a str,
    /// An RFC 5322 date.
    pub date: &'a str,
    pub message_id: &'a str,
    pub domain: &'a str,
    /// A random token: the line that separates the two parts.
    pub boundary: &'a str,
}

/// The whole message, headers and both bodies. `None` when a value could break out of its place:
/// a code that is not six digits, or anything with a control character, which in a header would
/// start a new one.
pub fn message(
    purpose: Purpose,
    envelope: &Envelope<'_>,
    code: &str,
    minutes: i64,
) -> Option<String> {
    let Envelope {
        sender,
        to,
        date,
        message_id,
        domain,
        boundary,
    } = envelope;
    let plain = |text: &str| !text.is_empty() && text.chars().all(|c| c.is_ascii_graphic());
    let token = |text: &str| !text.is_empty() && text.chars().all(|c| c.is_ascii_alphanumeric());
    if code.len() != 6
        || !code.chars().all(|c| c.is_ascii_digit())
        || !plain(sender)
        || !plain(to)
        || !plain(domain)
        || !token(message_id)
        || !token(boundary)
        || date.is_empty()
        || !date.chars().all(|c| c.is_ascii_graphic() || c == ' ')
        || !(1..=60).contains(&minutes)
    {
        return None;
    }
    let (heading, lead, ignore) = (purpose.heading(), purpose.lead(), purpose.ignore());
    let expires = format!(
        "It expires in {minutes} minute{}.",
        if minutes == 1 { "" } else { "s" }
    );
    // Three digits, a gap, three digits: easier to read and to type.
    let (first, second) = code.split_at(3);
    let text = format!("{heading}\r\n\r\n{code}\r\n\r\n{lead}\r\n{expires}\r\n\r\n{ignore}\r\n");
    let html = [
        "<!doctype html>",
        "<html lang=\"en\">",
        "<head>",
        "<meta charset=\"utf-8\">",
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
        "<meta name=\"color-scheme\" content=\"light dark\">",
        "<meta name=\"supported-color-schemes\" content=\"light dark\">",
        &format!("<title>{heading}</title>"),
        "<style>",
        "@media (prefers-color-scheme: dark) {",
        "  .page { background: #0a0a0a !important; }",
        "  .card { background: #1a1a1a !important; }",
        "  .ink { color: #ffffff !important; }",
        "  .soft { color: #8d9199 !important; }",
        "  .code { background: #0a0a0a !important; color: #ffffff !important; }",
        "  .rule { border-color: #2e2e30 !important; }",
        "}",
        "@media (max-width: 480px) {",
        "  .card { padding: 28px 22px !important; border-radius: 20px !important; }",
        "  .code { font-size: 30px !important; letter-spacing: 4px !important; }",
        "}",
        "</style>",
        "</head>",
        "<body class=\"page\" style=\"margin:0;padding:0;background:#f4f4f5;\">",
        // What a mail list shows beside the subject.
        "<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;\">",
        &format!("{code} is your code. {expires}"),
        "</div>",
        "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\"",
        " class=\"page\" style=\"background:#f4f4f5;\">",
        "<tr><td align=\"center\" style=\"padding:40px 16px;\">",
        "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\"",
        " style=\"max-width:480px;\">",
        "<tr><td class=\"ink\" style=\"padding:0 8px 20px;color:#0a0a0a;",
        "font-family:Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;",
        "font-size:17px;line-height:24px;font-weight:600;letter-spacing:-0.02em;\">",
        "auracode",
        "</td></tr>",
        "<tr><td class=\"card\" style=\"padding:36px 32px;border-radius:24px;background:#ffffff;",
        "font-family:Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;\">",
        "<h1 class=\"ink\" style=\"margin:0 0 8px;color:#0a0a0a;font-size:24px;line-height:30px;",
        "font-weight:500;letter-spacing:-0.02em;\">",
        heading,
        "</h1>",
        "<p class=\"soft\" style=\"margin:0 0 24px;color:#6b6f76;font-size:16px;line-height:24px;\">",
        lead,
        "</p>",
        "<div class=\"code\" style=\"margin:0 0 24px;padding:20px 12px;border-radius:16px;",
        "background:#f4f4f5;color:#0a0a0a;text-align:center;",
        "font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;",
        "font-size:36px;line-height:44px;font-weight:500;letter-spacing:6px;\">",
        &format!("{first}&nbsp;{second}"),
        "</div>",
        "<p class=\"ink\" style=\"margin:0 0 20px;color:#0a0a0a;font-size:15px;line-height:22px;\">",
        &expires,
        "</p>",
        "<p class=\"soft rule\" style=\"margin:0;padding-top:20px;border-top:1px solid #e4e4e7;",
        "color:#6b6f76;font-size:13px;line-height:20px;\">",
        ignore,
        "</p>",
        "</td></tr>",
        "<tr><td class=\"soft\" style=\"padding:20px 8px 0;color:#6b6f76;",
        "font-family:Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;",
        "font-size:12px;line-height:18px;\">",
        "Sent by auracode, the desktop app for coding agents, because this address was entered",
        "there. auracode never asks for this code by email, chat or phone.",
        "</td></tr>",
        "</table>",
        "</td></tr>",
        "</table>",
        "</body>",
        "</html>",
    ]
    .join("\r\n");
    Some(format!(
        "From: auracode <{sender}>\r\nTo: {to}\r\nDate: {date}\r\nMessage-ID: <{message_id}@{domain}>\r\nSubject: {subject}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"{boundary}\"\r\n\r\n--{boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\n{text}\r\n--{boundary}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\n{html}\r\n\r\n--{boundary}--\r\n",
        subject = purpose.subject(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn envelope<'a>(to: &'a str) -> Envelope<'a> {
        Envelope {
            sender: "signin@auracode.si",
            to,
            date: "Tue, 10 Nov 2026 19:00:00 GMT",
            message_id: "abc123",
            domain: "auracode.si",
            boundary: "b0undary",
        }
    }

    #[test]
    fn carries_the_code_as_text_and_as_html_in_lines_any_server_takes() {
        for purpose in [Purpose::SignIn, Purpose::NewEmail] {
            let raw =
                message(purpose, &envelope("person@example.com"), "042917", 10).expect("a message");
            assert!(raw.is_ascii());
            // RFC 5322: no line over 998 characters, and CRLF line ends only.
            assert!(!raw.replace("\r\n", "").contains(['\r', '\n']));
            for line in raw.split("\r\n") {
                assert!(line.len() <= 200, "{} characters: {line}", line.len());
            }
            let (headers, body) = raw.split_once("\r\n\r\n").expect("headers and body");
            assert!(headers.contains("To: person@example.com"));
            assert!(headers.contains("Content-Type: multipart/alternative; boundary=\"b0undary\""));
            assert!(headers.contains(&format!("Subject: {}", purpose.subject())));
            let parts: Vec<&str> = body.split("--b0undary").collect();
            // Before the first part, the text, the HTML, and the closing mark.
            assert_eq!(parts.len(), 4, "{parts:?}");
            assert!(parts[1].contains("Content-Type: text/plain"));
            assert!(parts[1].contains("\r\n042917\r\n"));
            assert!(parts[1].contains("It expires in 10 minutes."));
            assert!(parts[2].contains("Content-Type: text/html"));
            assert!(parts[2].contains("042&nbsp;917"));
            assert!(parts[2].contains(purpose.heading()));
            assert!(parts[3].starts_with("--"));
            // Opening it fetches nothing.
            for fetched in [
                "<img", "src=", "href=", "url(", "@import", "<link", "<script",
            ] {
                assert!(!raw.contains(fetched), "{fetched}");
            }
        }
        // The two reasons read differently.
        let change = message(Purpose::NewEmail, &envelope("new@example.com"), "111111", 1)
            .expect("a message");
        assert!(change.contains("Subject: Confirm your new auracode email"));
        assert!(change.contains("It expires in 1 minute."));
        assert!(!change.contains("sign-in code"));
    }

    /// `AURACODE_EMAIL_PREVIEW=<file> cargo test -p auracode-api --lib mail` writes the HTML part,
    /// to look at in a browser.
    #[test]
    fn writes_a_preview_when_asked() {
        let Ok(path) = std::env::var("AURACODE_EMAIL_PREVIEW") else {
            return;
        };
        let raw = message(
            Purpose::SignIn,
            &envelope("person@example.com"),
            "042917",
            10,
        )
        .expect("a message");
        let html = raw
            .split("--b0undary")
            .nth(2)
            .and_then(|part| part.split_once("\r\n\r\n"))
            .map(|(_, html)| html.to_owned())
            .expect("the HTML part");
        std::fs::write(path, html).expect("written");
    }

    #[test]
    fn refuses_anything_that_could_leave_its_place() {
        let good = envelope("person@example.com");
        assert!(message(Purpose::SignIn, &good, "042917", 10).is_some());
        // A code is six digits.
        for code in ["", "04291", "0429177", "04291a", "<b>123", "12 456"] {
            assert!(
                message(Purpose::SignIn, &good, code, 10).is_none(),
                "{code:?}"
            );
        }
        // An address with a line break would start a header of its own.
        for to in [
            "person@example.com\r\nBcc: other@example.com",
            "person@example.com\nSubject: x",
            "person @example.com",
            "",
        ] {
            assert!(
                message(Purpose::SignIn, &envelope(to), "042917", 10).is_none(),
                "{to:?}"
            );
        }
        for (field, value) in [
            ("boundary", "b--x"),
            ("message_id", "a\r\nb"),
            ("date", "x\r\ny"),
        ] {
            let mut bad = envelope("person@example.com");
            match field {
                "boundary" => bad.boundary = value,
                "message_id" => bad.message_id = value,
                _ => bad.date = value,
            }
            assert!(
                message(Purpose::SignIn, &bad, "042917", 10).is_none(),
                "{field}"
            );
        }
        assert!(message(Purpose::SignIn, &good, "042917", 0).is_none());
    }
}
