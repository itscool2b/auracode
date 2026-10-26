//! Extension dialogs are explicit user interactions, never permissions that Full auto can answer.
use super::wire::text;
use aura_protocol::{UiAnswer, UiPrompt};
use serde_json::{Value, json};

pub fn prompt(frame: &Value) -> Option<UiPrompt> {
    let title = text(frame, "title").unwrap_or("Pi extension");
    match text(frame, "method")? {
        "confirm" => Some(UiPrompt::Confirm {
            message: match text(frame, "message") {
                Some(message) => format!("{title}\n\n{message}"),
                None => title.into(),
            },
        }),
        "select" => {
            let options = frame["options"].as_array()?;
            if options.is_empty() || options.len() > 1000 {
                return None;
            }
            let options: Option<Vec<_>> = options
                .iter()
                .map(|v| v.as_str().map(str::to_owned))
                .collect();
            Some(UiPrompt::Select {
                message: title.into(),
                options: options?,
            })
        }
        "input" => Some(UiPrompt::Input {
            message: title.into(),
            placeholder: frame["placeholder"].as_str().map(str::to_owned),
        }),
        // The current product input has no editable prefill/multiline contract. Cancelling is
        // honest; presenting an empty input would silently lose the editor's original content.
        _ => None,
    }
}
pub fn response(frame: &Value, answer: Option<UiAnswer>) -> Value {
    let mut response = json!({"type":"extension_ui_response","id":frame["id"],"cancelled":true});
    let field = match (text(frame, "method"), answer) {
        (Some("confirm"), Some(UiAnswer::Confirm { yes })) => Some(("confirmed", json!(yes))),
        (Some("input"), Some(UiAnswer::Input { text })) => Some(("value", json!(text))),
        (Some("select"), Some(UiAnswer::Select { index })) => frame["options"]
            .get(index as usize)
            .and_then(Value::as_str)
            .map(|s| ("value", json!(s))),
        _ => None,
    };
    if let Some((key, value)) = field {
        if let Some(object) = response.as_object_mut() {
            object.remove("cancelled");
        }
        response[key] = value;
    }
    response
}
pub fn blocking(method: &str) -> bool {
    matches!(method, "select" | "confirm" | "input" | "editor")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selection_returns_the_original_value_and_bad_answers_cancel() {
        let frame = json!({"type":"extension_ui_request","id":"q1","method":"select","title":"Choose","options":["A","B"]});
        assert_eq!(
            response(&frame, Some(UiAnswer::Select { index: 1 }))["value"],
            "B"
        );
        assert_eq!(
            response(&frame, Some(UiAnswer::Select { index: 10 }))["cancelled"],
            true
        );
        assert_eq!(
            response(&frame, Some(UiAnswer::Confirm { yes: true }))["cancelled"],
            true
        );
        assert!(prompt(&json!({"method":"editor","prefill":"important"})).is_none());
    }
}
