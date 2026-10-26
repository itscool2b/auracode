//! The normalizer: fits every non-delta event within the event budget (fixed caps, then raw input,
//! locations, content and option names, in that order), spills full originals to blobs, and tracks
//! open messages, thoughts, cards and questions so turn ends and driver exits close them.
//!
//! After normalizing, every non-delta event serializes within [`EVENT_BUDGET`] (7 KiB of JSON),
//! except a permission request or question whose option ids or choices alone exceed it: ids are
//! echoed exactly, so such an event goes out alone in an oversized frame (logged). Text deltas have
//! no cap; the frame batcher splits them on grapheme boundaries.
//!
//! Fixed caps come first, without blobs: titles 256 characters, tool names 128, option names and
//! question choices 64, each location path 512 bytes, notice and error messages and error detail
//! 2 KiB each, `SessionInfo` strings (detail 256 characters, title 200, labels and names 128,
//! version 64). Then a tool call, tool update or permission request still over the budget is cut, in
//! this order, until it fits:
//!
//! 1. its raw input becomes `{"_auracode_truncated": true, "bytes": n, "preview": "<first 512 bytes of its JSON>"}`;
//! 2. its locations keep the longest prefix within 1 KiB of JSON;
//! 3. its content shares what is left: each text keeps its head and each terminal output its tail
//!    (the end explains failures), never below 256 bytes, with a blob of the full text; a diff that
//!    does not fit inline keeps empty texts and a blob of both texts; entries that do not fit even at
//!    256 bytes are dropped, the last first;
//! 4. option names shrink to 24 characters.
//!
//! When anything besides an entry's text was cut, the complete original event goes to one blob
//! named by the event's `truncated`; when only entry texts were cut, their own blobs hold
//! everything, so a large output is stored once. Sizes are measured as serde writes the JSON,
//! escapes included.

use std::io;
use std::sync::Arc;

use aura_protocol::{
    AuraEvent, EVENT_BUDGET, Millis, PermissionDecision, PermissionRequest, PlanEntry, PlanStatus,
    ResolvedBy, SessionInfo, ToolCall, ToolContent, ToolLocation, ToolUpdate, Truncation, UiAnswer,
    UiPrompt, UiRequest,
};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::chatstore::Op;
use crate::chatstore::blobs::MAX_BLOB_BYTES;
use crate::chatstore::rows::hex;

const TITLE_CHARS: usize = 256;
const TOOL_NAME_CHARS: usize = 128;
const OPTION_NAME_CHARS: usize = 64;
const OPTION_NAME_SHORT_CHARS: usize = 24;
const LOCATION_PATH_BYTES: usize = 512;
/// Notice and error messages, error detail, question messages, typed answers.
pub(crate) const MESSAGE_BYTES: usize = 2 * 1024;
const RAW_PREVIEW_BYTES: usize = 512;
const LOCATIONS_BYTES: usize = 1024;
/// A cut text or terminal output keeps at least this much.
const MIN_ENTRY_TEXT: usize = 256;
const PLAN_ENTRY_CHARS: usize = 500;
const INFO_DETAIL_CHARS: usize = 256;
const INFO_TITLE_CHARS: usize = 200;
const INFO_NAME_CHARS: usize = 128;
const INFO_VERSION_CHARS: usize = 64;
const CURRENCY_CHARS: usize = 16;
const LIMIT_LABEL_CHARS: usize = 128;
const PLACEHOLDER_CHARS: usize = 256;

/// Room kept for the event's own `truncated` field while its content is fitted.
const TRUNCATION_ROOM: usize = 160;

/// An open message or thought.
#[derive(Debug, Clone)]
struct OpenText {
    id: String,
    tag: Option<String>,
    thought: bool,
    started: Millis,
}

/// A permission card waiting for an answer.
#[derive(Debug, Clone)]
pub(crate) struct OpenCard {
    /// As shown (normalized).
    pub(crate) request: PermissionRequest,
    pub(crate) tag: Option<String>,
}

/// A question waiting for an answer.
#[derive(Debug, Clone)]
pub(crate) struct OpenQuestion {
    pub(crate) request: UiRequest,
    pub(crate) tag: Option<String>,
}

/// Normalizes one chat's events and keeps what is open.
#[derive(Debug, Default)]
pub(crate) struct Normalizer {
    texts: Vec<OpenText>,
    cards: Vec<OpenCard>,
    questions: Vec<OpenQuestion>,
}

impl Normalizer {
    /// Normalizes one event; returns the events to push and the `PutBlob` ops to queue before them.
    pub(crate) fn apply(
        &mut self,
        event: AuraEvent,
        turn: Option<&str>,
        now: Millis,
    ) -> (Vec<AuraEvent>, Vec<Op>) {
        let mut blobs = Vec::new();
        let tag = turn.map(str::to_owned);
        let event = match event {
            AuraEvent::MessageDelta { message_id, text } => {
                self.open_text(&message_id, tag, false, now);
                AuraEvent::MessageDelta { message_id, text }
            }
            AuraEvent::ThoughtDelta { thought_id, text } => {
                self.open_text(&thought_id, tag, true, now);
                AuraEvent::ThoughtDelta { thought_id, text }
            }
            AuraEvent::MessageCompleted { message_id } => {
                self.texts.retain(|text| text.id != message_id);
                AuraEvent::MessageCompleted { message_id }
            }
            AuraEvent::ThoughtCompleted {
                thought_id,
                duration_ms,
            } => {
                self.texts.retain(|text| text.id != thought_id);
                AuraEvent::ThoughtCompleted {
                    thought_id,
                    duration_ms,
                }
            }
            AuraEvent::ToolCall(call) => AuraEvent::ToolCall(fit_tool_call(call, &mut blobs)),
            AuraEvent::ToolUpdate(update) => {
                AuraEvent::ToolUpdate(fit_tool_update(update, &mut blobs))
            }
            AuraEvent::PermissionRequested(request) => {
                let request = fit_permission(request, &mut blobs);
                self.cards
                    .retain(|card| card.request.request_id != request.request_id);
                self.cards.push(OpenCard {
                    request: request.clone(),
                    tag,
                });
                AuraEvent::PermissionRequested(request)
            }
            AuraEvent::PermissionResolved {
                request_id,
                decision,
                by,
            } => {
                self.cards
                    .retain(|card| card.request.request_id != request_id);
                AuraEvent::PermissionResolved {
                    request_id,
                    decision,
                    by,
                }
            }
            AuraEvent::UiRequest(request) => {
                let request = fit_question(request);
                self.questions
                    .retain(|question| question.request.request_id != request.request_id);
                // Nothing answers a notification, so it is never open.
                if !matches!(request.prompt, UiPrompt::Notify { .. }) {
                    self.questions.push(OpenQuestion {
                        request: request.clone(),
                        tag,
                    });
                }
                AuraEvent::UiRequest(request)
            }
            AuraEvent::UiResolved {
                request_id,
                answer,
                by,
            } => {
                self.questions
                    .retain(|question| question.request.request_id != request_id);
                let answer = answer.map(|answer| fit_answer(answer, &request_id, by));
                AuraEvent::UiResolved {
                    request_id,
                    answer,
                    by,
                }
            }
            AuraEvent::PlanUpdated { entries } => AuraEvent::PlanUpdated {
                entries: fit_plan(entries),
            },
            AuraEvent::Notice { level, message } => AuraEvent::Notice {
                level,
                message: cap_escaped(message, MESSAGE_BYTES),
            },
            AuraEvent::Error {
                kind,
                message,
                detail,
                recoverable,
            } => AuraEvent::Error {
                kind,
                message: cap_escaped(message, MESSAGE_BYTES),
                detail: detail.map(|detail| cap_escaped(detail, MESSAGE_BYTES)),
                recoverable,
            },
            AuraEvent::SessionUpdated(info) => AuraEvent::SessionUpdated(fit_info(info)),
            AuraEvent::UsageUpdated(mut usage) => {
                if let Some(cost) = &mut usage.cost {
                    cost.currency = cap_chars(std::mem::take(&mut cost.currency), CURRENCY_CHARS);
                }
                AuraEvent::UsageUpdated(usage)
            }
            AuraEvent::LimitsUpdated { mut windows } => {
                for window in &mut windows {
                    window.label = cap_chars(std::mem::take(&mut window.label), LIMIT_LABEL_CHARS);
                }
                AuraEvent::LimitsUpdated { windows }
            }
            other @ (AuraEvent::TurnStarted { .. }
            | AuraEvent::TurnEnded { .. }
            | AuraEvent::UserMessageDelta { .. }
            | AuraEvent::PromptLifecycle { .. }) => other,
        };
        if !is_delta(&event) {
            let size = json_len(&event);
            if size > EVENT_BUDGET {
                tracing::warn!(
                    kind = event.kind(),
                    size,
                    "an event is larger than a frame after normalizing; it goes out alone"
                );
            }
        }
        (vec![event], blobs)
    }

    fn open_text(&mut self, id: &str, tag: Option<String>, thought: bool, now: Millis) {
        if !self.texts.iter().any(|text| text.id == id) {
            self.texts.push(OpenText {
                id: id.to_owned(),
                tag,
                thought,
                started: now,
            });
        }
    }

    /// `MessageCompleted`/`ThoughtCompleted` for what is still open in `turn`, and resolutions `by`
    /// for its open cards and questions; called before every `TurnEnded` the actor pushes.
    pub(crate) fn close_turn(&mut self, turn: &str, by: ResolvedBy, now: Millis) -> Vec<AuraEvent> {
        let mut out = self.close_texts(|tag| tag == Some(turn), now);
        out.extend(self.resolve(|tag| tag == Some(turn), by));
        out
    }

    /// The same for what is open outside any turn, when the driver ends.
    pub(crate) fn close_untagged(&mut self, by: ResolvedBy, now: Millis) -> Vec<AuraEvent> {
        let mut out = self.close_texts(|tag| tag.is_none(), now);
        out.extend(self.resolve(|tag| tag.is_none(), by));
        out
    }

    /// Resolutions `by` for the open cards and questions of `turn` only (an interrupt).
    pub(crate) fn resolve_turn_requests(&mut self, turn: &str, by: ResolvedBy) -> Vec<AuraEvent> {
        self.resolve(|tag| tag == Some(turn), by)
    }

    fn close_texts(
        &mut self,
        matches: impl Fn(Option<&str>) -> bool,
        now: Millis,
    ) -> Vec<AuraEvent> {
        let mut out = Vec::new();
        self.texts.retain(|text| {
            if !matches(text.tag.as_deref()) {
                return true;
            }
            out.push(if text.thought {
                AuraEvent::ThoughtCompleted {
                    thought_id: text.id.clone(),
                    duration_ms: Some(
                        u32::try_from(now.saturating_sub(text.started).max(0)).unwrap_or(u32::MAX),
                    ),
                }
            } else {
                AuraEvent::MessageCompleted {
                    message_id: text.id.clone(),
                }
            });
            false
        });
        out
    }

    fn resolve(
        &mut self,
        matches: impl Fn(Option<&str>) -> bool,
        by: ResolvedBy,
    ) -> Vec<AuraEvent> {
        let mut out = Vec::new();
        self.cards.retain(|card| {
            if !matches(card.tag.as_deref()) {
                return true;
            }
            out.push(AuraEvent::PermissionResolved {
                request_id: card.request.request_id.clone(),
                decision: PermissionDecision::Cancelled,
                by,
            });
            false
        });
        self.questions.retain(|question| {
            if !matches(question.tag.as_deref()) {
                return true;
            }
            out.push(AuraEvent::UiResolved {
                request_id: question.request.request_id.clone(),
                answer: None,
                by,
            });
            false
        });
        out
    }

    pub(crate) fn card(&self, request_id: &str) -> Option<&OpenCard> {
        self.cards
            .iter()
            .find(|card| card.request.request_id == request_id)
    }

    pub(crate) fn question(&self, request_id: &str) -> Option<&OpenQuestion> {
        self.questions
            .iter()
            .find(|question| question.request.request_id == request_id)
    }

    /// Every open card, oldest first.
    pub(crate) fn cards(&self) -> &[OpenCard] {
        &self.cards
    }

    pub(crate) fn has_open_requests(&self) -> bool {
        !self.cards.is_empty() || !self.questions.is_empty()
    }
}

fn is_delta(event: &AuraEvent) -> bool {
    matches!(
        event,
        AuraEvent::MessageDelta { .. }
            | AuraEvent::ThoughtDelta { .. }
            | AuraEvent::UserMessageDelta { .. }
    )
}

/// Counts bytes instead of storing them.
struct ByteCount(usize);

impl io::Write for ByteCount {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0 = self.0.saturating_add(buf.len());
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// The JSON length of `value`, as serde writes it.
pub(crate) fn json_len<T: Serialize + ?Sized>(value: &T) -> usize {
    let mut count = ByteCount(0);
    match serde_json::to_writer(&mut count, value) {
        Ok(()) => count.0,
        Err(_) => usize::MAX,
    }
}

/// The length a variant's `"type":"<tag>",` adds to the JSON of the struct it carries.
fn tag_len(tag: &str) -> usize {
    tag.len() + r#""type":"","#.len()
}

fn call_len(call: &ToolCall) -> usize {
    json_len(call) + tag_len("tool_call")
}

fn update_len(update: &ToolUpdate) -> usize {
    json_len(update) + tag_len("tool_update")
}

fn permission_len(request: &PermissionRequest) -> usize {
    json_len(request) + tag_len("permission_requested")
}

/// Bytes `c` takes inside a JSON string the way serde_json writes it.
fn escaped_len(c: char) -> usize {
    match c {
        '"' | '\\' | '\u{08}' | '\t' | '\n' | '\u{0c}' | '\r' => 2,
        '\u{00}'..='\u{1f}' => 6,
        _ => c.len_utf8(),
    }
}

fn escaped_str_len(text: &str) -> usize {
    text.chars().map(escaped_len).fold(0, usize::saturating_add)
}

/// The first `chars` characters of `text`.
pub(crate) fn cap_chars(text: String, chars: usize) -> String {
    match text.char_indices().nth(chars) {
        Some((end, _)) => text[..end].to_owned(),
        None => text,
    }
}

/// The longest prefix of `text` whose JSON-escaped form takes at most `bytes`.
fn prefix_escaped(text: &str, bytes: usize) -> &str {
    let mut used = 0usize;
    for (index, c) in text.char_indices() {
        used = used.saturating_add(escaped_len(c));
        if used > bytes {
            return &text[..index];
        }
    }
    text
}

/// The longest suffix of `text` whose JSON-escaped form takes at most `bytes`.
pub(crate) fn suffix_escaped(text: &str, bytes: usize) -> &str {
    let mut used = 0usize;
    for (index, c) in text.char_indices().rev() {
        used = used.saturating_add(escaped_len(c));
        if used > bytes {
            return &text[index + c.len_utf8()..];
        }
    }
    text
}

/// `text` cut so its JSON-escaped form takes at most `bytes`.
pub(crate) fn cap_escaped(text: String, bytes: usize) -> String {
    if text.len() <= bytes / 6 || escaped_str_len(&text) <= bytes {
        return text;
    }
    prefix_escaped(&text, bytes).to_owned()
}

/// The longest prefix of at most `bytes` bytes that ends on a character boundary.
fn prefix_bytes(text: &str, bytes: usize) -> &str {
    if text.len() <= bytes {
        return text;
    }
    let mut end = bytes;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// The longest suffix of at most `bytes` bytes that starts on a character boundary.
fn suffix_bytes(text: &str, bytes: usize) -> &str {
    if text.len() <= bytes {
        return text;
    }
    let mut start = text.len() - bytes;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    &text[start..]
}

/// A `PutBlob` for `bytes` (at most 64 MiB stored) and the `Truncation` that names it.
fn spill(bytes: &[u8], mime: &str, blobs: &mut Vec<Op>) -> Truncation {
    let stored = &bytes[..bytes.len().min(MAX_BLOB_BYTES)];
    let sha256 = hex(&Sha256::digest(stored));
    if !blobs
        .iter()
        .any(|op| matches!(op, Op::PutBlob { sha256: queued, .. } if *queued == sha256))
    {
        blobs.push(Op::PutBlob {
            sha256: sha256.clone(),
            mime: mime.to_owned(),
            bytes: Arc::from(stored),
        });
    }
    Truncation {
        total_bytes: bytes.len() as u64,
        blob: Some(sha256),
    }
}

/// The complete original event in one blob.
fn event_blob(original: &AuraEvent, blobs: &mut Vec<Op>) -> Truncation {
    let json = serde_json::to_vec(original).unwrap_or_default();
    spill(&json, "application/json", blobs)
}

fn cap_paths(locations: &mut [ToolLocation]) {
    for location in locations {
        if location.path.len() > LOCATION_PATH_BYTES {
            location.path = prefix_bytes(&location.path, LOCATION_PATH_BYTES).to_owned();
        }
    }
}

/// Step 1: a raw input larger than its preview becomes the preview.
fn shrink_raw(raw: &mut Option<serde_json::Value>) -> bool {
    let Some(value) = raw else {
        return false;
    };
    let json = serde_json::to_string(value).unwrap_or_default();
    if json.len() <= RAW_PREVIEW_BYTES + 64 {
        return false;
    }
    *raw = Some(serde_json::json!({
        "_auracode_truncated": true,
        "bytes": json.len(),
        "preview": prefix_bytes(&json, RAW_PREVIEW_BYTES),
    }));
    true
}

/// Step 2: the longest prefix of the locations within 1 KiB of JSON.
fn shrink_locations(locations: &mut Vec<ToolLocation>) -> bool {
    if json_len(locations) <= LOCATIONS_BYTES {
        return false;
    }
    let mut size = 2usize;
    let mut keep = 0;
    for (index, location) in locations.iter().enumerate() {
        let next = size + json_len(location) + usize::from(index > 0);
        if next > LOCATIONS_BYTES {
            break;
        }
        size = next;
        keep = index + 1;
    }
    locations.truncate(keep);
    true
}

/// One content entry while the content is fitted.
struct Fit {
    entry: ToolContent,
    /// Its JSON as it is.
    full: usize,
    /// Its JSON at its smallest cut (a short entry cannot be cut: `full`).
    min: usize,
}

impl Fit {
    fn new(entry: ToolContent) -> Fit {
        let full = json_len(&entry);
        let min = match &entry {
            ToolContent::Text { text, .. } => {
                let cut = cut_text(&entry, prefix_bytes(text, MIN_ENTRY_TEXT));
                if text.len() <= MIN_ENTRY_TEXT {
                    full
                } else {
                    json_len(&cut).min(full)
                }
            }
            ToolContent::Terminal { output, .. } => {
                let cut = cut_text(&entry, suffix_bytes(output, MIN_ENTRY_TEXT));
                if output.len() <= MIN_ENTRY_TEXT {
                    full
                } else {
                    json_len(&cut).min(full)
                }
            }
            ToolContent::Diff { .. } => json_len(&emptied_diff(&entry, placeholder_truncation())),
        };
        Fit { entry, full, min }
    }

    /// Its size when every entry may take `cap` bytes.
    fn cost(&self, cap: usize) -> usize {
        if self.full <= cap {
            return self.full;
        }
        match self.entry {
            ToolContent::Text { .. } | ToolContent::Terminal { .. } => cap.max(self.min),
            ToolContent::Diff { .. } => self.min,
        }
    }
}

/// A truncation as long as a real one, for measuring.
fn placeholder_truncation() -> Truncation {
    Truncation {
        total_bytes: u64::MAX,
        blob: Some("0".repeat(64)),
    }
}

/// `entry` with its text replaced by `text` and a placeholder truncation, for measuring.
fn cut_text(entry: &ToolContent, text: &str) -> ToolContent {
    match entry {
        ToolContent::Text { .. } => ToolContent::Text {
            text: text.to_owned(),
            truncated: Some(placeholder_truncation()),
        },
        ToolContent::Terminal { exit_code, .. } => ToolContent::Terminal {
            output: text.to_owned(),
            exit_code: *exit_code,
            truncated: Some(placeholder_truncation()),
        },
        ToolContent::Diff { .. } => entry.clone(),
    }
}

fn emptied_diff(entry: &ToolContent, truncated: Truncation) -> ToolContent {
    match entry {
        ToolContent::Diff { path, old_text, .. } => ToolContent::Diff {
            path: path.clone(),
            old_text: old_text.as_ref().map(|_| String::new()),
            new_text: String::new(),
            truncated: Some(truncated),
        },
        other => other.clone(),
    }
}

/// JSON length of an array of entries of these sizes.
fn array_len(sizes: impl Iterator<Item = usize>) -> usize {
    let mut total = 2usize;
    let mut count = 0usize;
    for size in sizes {
        total = total.saturating_add(size);
        count += 1;
    }
    total.saturating_add(count.saturating_sub(1))
}

/// Step 3: fits `content` within `room` bytes of JSON. Returns the entries and whether any entry
/// was dropped.
fn share_content(
    content: Vec<ToolContent>,
    room: usize,
    blobs: &mut Vec<Op>,
) -> (Vec<ToolContent>, bool) {
    let mut fits: Vec<Fit> = content.into_iter().map(Fit::new).collect();
    if array_len(fits.iter().map(|fit| fit.full)) <= room {
        return (fits.into_iter().map(|fit| fit.entry).collect(), false);
    }
    let mut dropped = false;
    while !fits.is_empty() && array_len(fits.iter().map(|fit| fit.min.min(fit.full))) > room {
        fits.pop();
        dropped = true;
    }
    // The largest per-entry cap at which everything fits.
    let total_at = |cap: usize| array_len(fits.iter().map(|fit| fit.cost(cap)));
    let mut low = 0usize;
    let mut high = fits.iter().map(|fit| fit.full).max().unwrap_or(0);
    while low < high {
        let mid = low + (high - low).div_ceil(2);
        if total_at(mid) <= room {
            low = mid;
        } else {
            high = mid - 1;
        }
    }
    let cap = low;
    let entries = fits
        .into_iter()
        .map(|fit| {
            if fit.full <= cap {
                return fit.entry;
            }
            let target = cap.max(fit.min);
            cut_entry(fit.entry, target, blobs)
        })
        .collect();
    (entries, dropped)
}

/// Cuts one entry to at most `target` bytes of JSON, spilling the full text to a blob.
fn cut_entry(entry: ToolContent, target: usize, blobs: &mut Vec<Op>) -> ToolContent {
    match entry {
        ToolContent::Text { text, .. } => {
            let base = json_len(&ToolContent::Text {
                text: String::new(),
                truncated: Some(placeholder_truncation()),
            });
            let head = prefix_escaped(&text, target.saturating_sub(base)).to_owned();
            let truncated = spill(text.as_bytes(), "text/plain", blobs);
            ToolContent::Text {
                text: head,
                truncated: Some(truncated),
            }
        }
        ToolContent::Terminal {
            output, exit_code, ..
        } => {
            let base = json_len(&ToolContent::Terminal {
                output: String::new(),
                exit_code,
                truncated: Some(placeholder_truncation()),
            });
            let tail = suffix_escaped(&output, target.saturating_sub(base)).to_owned();
            let truncated = spill(output.as_bytes(), "text/plain", blobs);
            ToolContent::Terminal {
                output: tail,
                exit_code,
                truncated: Some(truncated),
            }
        }
        ToolContent::Diff {
            ref old_text,
            ref new_text,
            ..
        } => {
            let both = serde_json::to_vec(
                &serde_json::json!({ "old_text": old_text, "new_text": new_text }),
            )
            .unwrap_or_default();
            let truncated = spill(&both, "application/json", blobs);
            emptied_diff(&entry, truncated)
        }
    }
}

fn fit_tool_call(mut call: ToolCall, blobs: &mut Vec<Op>) -> ToolCall {
    let untouched = call.clone();
    call.title = cap_chars(call.title, TITLE_CHARS);
    call.tool_name = call.tool_name.map(|name| cap_chars(name, TOOL_NAME_CHARS));
    cap_paths(&mut call.locations);
    // The content is measured once; the rest of the event is cheap to measure again after each cut.
    let content = std::mem::take(&mut call.content);
    let content_len = json_len(&content);
    if call_len(&call) - 2 + content_len <= EVENT_BUDGET {
        call.content = content;
        return call;
    }
    // From here on something is cut, so the event may carry its own `truncated`.
    let limit = EVENT_BUDGET - TRUNCATION_ROOM;
    let mut cut = shrink_raw(&mut call.raw_input);
    if call_len(&call) - 2 + content_len > limit {
        cut |= shrink_locations(&mut call.locations);
    }
    if call_len(&call) - 2 + content_len > limit {
        let room = limit.saturating_sub(call_len(&call) - 2);
        let (content, dropped) = share_content(content, room, blobs);
        call.content = content;
        cut |= dropped;
    } else {
        call.content = content;
    }
    if cut {
        call.truncated = Some(event_blob(&AuraEvent::ToolCall(untouched), blobs));
    }
    call
}

fn fit_tool_update(mut update: ToolUpdate, blobs: &mut Vec<Op>) -> ToolUpdate {
    let untouched = update.clone();
    update.title = update.title.map(|title| cap_chars(title, TITLE_CHARS));
    update.tool_name = update
        .tool_name
        .map(|name| cap_chars(name, TOOL_NAME_CHARS));
    if let Some(locations) = &mut update.locations {
        cap_paths(locations);
    }
    // `Some([])` while measuring: the same JSON shape as any content, 2 bytes for the brackets.
    let content = update.content.take();
    let content_len = content
        .as_ref()
        .map_or(0, |content| json_len(content).saturating_sub(2));
    if content.is_some() {
        update.content = Some(Vec::new());
    }
    let len = |update: &ToolUpdate| update_len(update) + content_len;
    if len(&update) <= EVENT_BUDGET {
        update.content = content;
        return update;
    }
    let limit = EVENT_BUDGET - TRUNCATION_ROOM;
    let mut cut = shrink_raw(&mut update.raw_input);
    if len(&update) > limit
        && let Some(locations) = &mut update.locations
    {
        cut |= shrink_locations(locations);
    }
    match content {
        Some(content) if len(&update) > limit => {
            let room = limit.saturating_sub(update_len(&update) - 2);
            let (content, dropped) = share_content(content, room, blobs);
            update.content = Some(content);
            cut |= dropped;
        }
        content => update.content = content,
    }
    if cut {
        update.truncated = Some(event_blob(&AuraEvent::ToolUpdate(untouched), blobs));
    }
    update
}

fn fit_permission(mut request: PermissionRequest, blobs: &mut Vec<Op>) -> PermissionRequest {
    let untouched = request.clone();
    request.title = cap_chars(request.title, TITLE_CHARS);
    for option in &mut request.options {
        option.label = cap_chars(std::mem::take(&mut option.label), OPTION_NAME_CHARS);
    }
    cap_paths(&mut request.locations);
    let content = std::mem::take(&mut request.content);
    let content_len = json_len(&content);
    if permission_len(&request) - 2 + content_len <= EVENT_BUDGET {
        request.content = content;
        return request;
    }
    let limit = EVENT_BUDGET - TRUNCATION_ROOM;
    let mut cut = shrink_raw(&mut request.raw_input);
    if permission_len(&request) - 2 + content_len > limit {
        cut |= shrink_locations(&mut request.locations);
    }
    if permission_len(&request) - 2 + content_len > limit {
        let room = limit.saturating_sub(permission_len(&request) - 2);
        let (content, dropped) = share_content(content, room, blobs);
        request.content = content;
        cut |= dropped;
    } else {
        request.content = content;
    }
    if permission_len(&request) > limit {
        for option in &mut request.options {
            option.label = cap_chars(std::mem::take(&mut option.label), OPTION_NAME_SHORT_CHARS);
        }
        cut = true;
    }
    if permission_len(&request) > limit {
        // Still too big with many long option names: the title and then the names share what the
        // ids leave. Only ids that alone exceed the budget can keep it over.
        request.raw_input = None;
        request.locations.clear();
        request.content.clear();
        let room = EVENT_BUDGET.saturating_sub(TRUNCATION_ROOM);
        let without_title = permission_len(&PermissionRequest {
            title: String::new(),
            ..request.clone()
        });
        request.title =
            prefix_escaped(&request.title, room.saturating_sub(without_title)).to_owned();
        if permission_len(&request) > room && !request.options.is_empty() {
            let mut bare = request.clone();
            for option in &mut bare.options {
                option.label.clear();
            }
            let each = room.saturating_sub(permission_len(&bare)) / request.options.len();
            for option in &mut request.options {
                option.label = prefix_escaped(&option.label, each).to_owned();
            }
        }
    }
    if cut {
        request.truncated = Some(event_blob(
            &AuraEvent::PermissionRequested(untouched),
            blobs,
        ));
    }
    request
}

fn fit_question(mut request: UiRequest) -> UiRequest {
    request.prompt = match request.prompt {
        UiPrompt::Confirm { message } => UiPrompt::Confirm {
            message: cap_escaped(message, MESSAGE_BYTES),
        },
        UiPrompt::Select { message, options } => UiPrompt::Select {
            message: cap_escaped(message, MESSAGE_BYTES),
            options: options
                .into_iter()
                .map(|option| cap_chars(option, OPTION_NAME_CHARS))
                .collect(),
        },
        UiPrompt::Input {
            message,
            placeholder,
        } => UiPrompt::Input {
            message: cap_escaped(message, MESSAGE_BYTES),
            placeholder: placeholder.map(|text| cap_chars(text, PLACEHOLDER_CHARS)),
        },
        UiPrompt::Notify { message } => UiPrompt::Notify {
            message: cap_escaped(message, MESSAGE_BYTES),
        },
        UiPrompt::Questions {
            message,
            mut questions,
        } => {
            for question in &mut questions {
                question.header =
                    cap_chars(std::mem::take(&mut question.header), OPTION_NAME_CHARS);
                question.question =
                    cap_escaped(std::mem::take(&mut question.question), MESSAGE_BYTES);
                for option in &mut question.options {
                    option.label = cap_chars(std::mem::take(&mut option.label), OPTION_NAME_CHARS);
                    option.description =
                        cap_escaped(std::mem::take(&mut option.description), MESSAGE_BYTES);
                }
            }
            UiPrompt::Questions {
                message: cap_escaped(message, MESSAGE_BYTES),
                questions,
            }
        }
    };
    let size = |request: &UiRequest| json_len(request) + tag_len("ui_request");
    if size(&request) > EVENT_BUDGET && matches!(request.prompt, UiPrompt::Questions { .. }) {
        let mut bare = request.clone();
        let strings = question_strings(&mut bare.prompt);
        let count = strings.len();
        for text in strings {
            text.clear();
        }
        let each = EVENT_BUDGET.saturating_sub(size(&bare)) / count.max(1);
        for text in question_strings(&mut request.prompt) {
            *text = prefix_escaped(text, each).to_owned();
        }
    }
    if size(&request) > EVENT_BUDGET
        && let UiPrompt::Select { options, .. } = &mut request.prompt
    {
        for option in options.iter_mut() {
            *option = cap_chars(std::mem::take(option), OPTION_NAME_SHORT_CHARS);
        }
    }
    if size(&request) > EVENT_BUDGET
        && let UiPrompt::Select { message, options } = &request.prompt
    {
        // Still too big with many choices: the message and then the choices share what is left.
        // Answers are indexes, so no choice is ever dropped.
        let count = options.len();
        let bare = UiRequest {
            request_id: request.request_id.clone(),
            prompt: UiPrompt::Select {
                message: String::new(),
                options: vec![String::new(); count],
            },
        };
        let room = EVENT_BUDGET.saturating_sub(size(&bare));
        let with_choices = size(&UiRequest {
            request_id: request.request_id.clone(),
            prompt: UiPrompt::Select {
                message: String::new(),
                options: options.clone(),
            },
        });
        let message_room = EVENT_BUDGET.saturating_sub(with_choices);
        let message = prefix_escaped(message, message_room).to_owned();
        let options = if with_choices > EVENT_BUDGET && count > 0 {
            let each = room / count;
            options
                .iter()
                .map(|option| prefix_escaped(option, each).to_owned())
                .collect()
        } else {
            options.clone()
        };
        request.prompt = UiPrompt::Select { message, options };
    }
    request
}

fn fit_answer(answer: UiAnswer, request_id: &str, by: ResolvedBy) -> UiAnswer {
    match answer {
        UiAnswer::Input { text } => UiAnswer::Input {
            text: cap_escaped(text, MESSAGE_BYTES),
        },
        UiAnswer::Questions { mut answers } => {
            let mut bare = answers.clone();
            for answer in &mut bare {
                if let Some(text) = &mut answer.text {
                    text.clear();
                }
            }
            let count = answers
                .iter()
                .filter(|answer| answer.text.is_some())
                .count();
            let bare = AuraEvent::UiResolved {
                request_id: request_id.to_owned(),
                answer: Some(UiAnswer::Questions { answers: bare }),
                by,
            };
            let each = EVENT_BUDGET.saturating_sub(json_len(&bare)) / count.max(1);
            for answer in &mut answers {
                if let Some(text) = &mut answer.text {
                    *text = prefix_escaped(text, each.min(MESSAGE_BYTES)).to_owned();
                }
            }
            UiAnswer::Questions { answers }
        }
        other => other,
    }
}

/// Only display text may shrink. Question IDs and option positions remain exact for answers.
fn question_strings(prompt: &mut UiPrompt) -> Vec<&mut String> {
    let UiPrompt::Questions { message, questions } = prompt else {
        return Vec::new();
    };
    let mut strings = vec![message];
    for question in questions {
        strings.push(&mut question.header);
        strings.push(&mut question.question);
        for option in &mut question.options {
            strings.push(&mut option.label);
            strings.push(&mut option.description);
        }
    }
    strings
}

/// Entries cut to 500 characters, then trailing entries folded into one "+ n more" entry.
fn fit_plan(entries: Vec<PlanEntry>) -> Vec<PlanEntry> {
    let mut entries: Vec<PlanEntry> = entries
        .into_iter()
        .map(|entry| PlanEntry {
            content: cap_chars(entry.content, PLAN_ENTRY_CHARS),
            ..entry
        })
        .collect();
    // `{"type":"plan_updated","entries":[...]}` around the entries and their commas.
    let wrapper = r#"{"type":"plan_updated","entries":[]}"#.len();
    let sizes: Vec<usize> = entries.iter().map(json_len).collect();
    let all = wrapper + sizes.iter().sum::<usize>() + sizes.len().saturating_sub(1);
    if all <= EVENT_BUDGET {
        return entries;
    }
    let total = entries.len();
    // The most leading entries that fit with the summary after them.
    let mut kept_size = sizes.iter().sum::<usize>();
    let mut keep = total;
    while keep > 0 {
        keep -= 1;
        kept_size -= sizes[keep];
        let size = wrapper + kept_size + json_len(&more(total - keep)) + keep;
        if size <= EVENT_BUDGET {
            break;
        }
    }
    entries.truncate(keep);
    entries.push(more(total - keep));
    entries
}

fn more(count: usize) -> PlanEntry {
    PlanEntry {
        content: format!("+ {count} more"),
        status: PlanStatus::Pending,
        priority: None,
    }
}

fn fit_info(info: SessionInfo) -> SessionInfo {
    let cap = |text: Option<String>, chars: usize| text.map(|text| cap_chars(text, chars));
    SessionInfo {
        detail: cap(info.detail, INFO_DETAIL_CHARS),
        native_session_id: cap(info.native_session_id, INFO_NAME_CHARS),
        agent_name: cap(info.agent_name, INFO_NAME_CHARS),
        agent_version: cap(info.agent_version, INFO_VERSION_CHARS),
        title: cap(info.title, INFO_TITLE_CHARS),
        model: cap(info.model, INFO_NAME_CHARS),
        effort: cap(info.effort, INFO_NAME_CHARS),
        mode: cap(info.mode, INFO_NAME_CHARS),
        ..info
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use aura_protocol::{
        ErrorKind, NoticeLevel, PermissionOption, PermissionOptionKind, SessionStatus, ToolKind,
        ToolStatus,
    };

    use super::*;

    /// The blobs queued, by address, checked against their content.
    fn blob_map(ops: &[Op]) -> HashMap<String, Vec<u8>> {
        ops.iter()
            .map(|op| match op {
                Op::PutBlob { sha256, bytes, .. } => {
                    assert_eq!(*sha256, hex(&Sha256::digest(bytes)), "content-addressed");
                    (sha256.clone(), bytes.to_vec())
                }
                other => panic!("only blobs, got {other:?}"),
            })
            .collect()
    }

    fn big_call(content: Vec<ToolContent>) -> ToolCall {
        ToolCall {
            tool_call_id: "turn.tool-1".into(),
            kind: ToolKind::Execute,
            title: "t".repeat(1000),
            status: ToolStatus::InProgress,
            locations: (0..50)
                .map(|i| ToolLocation {
                    path: format!("/very/long/path/{i}/{}", "p".repeat(600)),
                    line: Some(i),
                })
                .collect(),
            raw_input: Some(serde_json::json!({ "command": "x".repeat(20_000) })),
            tool_name: Some("n".repeat(500)),
            content,
            truncated: None,
        }
    }

    #[test]
    fn small_events_pass_unchanged() {
        let mut normalizer = Normalizer::default();
        let call = ToolCall {
            tool_call_id: "t.1".into(),
            kind: ToolKind::Read,
            title: "Read a file".into(),
            status: ToolStatus::Pending,
            locations: Vec::new(),
            raw_input: Some(serde_json::json!({"path": "a"})),
            tool_name: None,
            content: vec![ToolContent::Text {
                text: "short".into(),
                truncated: None,
            }],
            truncated: None,
        };
        let (events, blobs) = normalizer.apply(AuraEvent::ToolCall(call.clone()), Some("t"), 1);
        assert_eq!(events, [AuraEvent::ToolCall(call)]);
        assert!(blobs.is_empty());
    }

    /// Only entry text was cut: the entry's own blob holds the full text, and the event carries no
    /// blob of its own.
    #[test]
    fn a_large_output_is_stored_once() {
        let mut normalizer = Normalizer::default();
        let output = "line of output\n".repeat(20_000);
        let call = ToolCall {
            tool_call_id: "t.1".into(),
            kind: ToolKind::Execute,
            title: "Run tests".into(),
            status: ToolStatus::Completed,
            locations: Vec::new(),
            raw_input: None,
            tool_name: None,
            content: vec![ToolContent::Terminal {
                output: output.clone(),
                exit_code: Some(1),
                truncated: None,
            }],
            truncated: None,
        };
        let (events, ops) = normalizer.apply(AuraEvent::ToolCall(call), Some("t"), 1);
        let blobs = blob_map(&ops);
        assert_eq!(blobs.len(), 1);
        let AuraEvent::ToolCall(fitted) = &events[0] else {
            panic!("a tool call")
        };
        assert!(json_len(&events[0]) <= EVENT_BUDGET);
        assert_eq!(fitted.truncated, None);
        let ToolContent::Terminal {
            output: tail,
            truncated: Some(truncation),
            ..
        } = &fitted.content[0]
        else {
            panic!("a cut terminal")
        };
        assert!(output.ends_with(tail.as_str()), "the tail is kept");
        assert!(tail.len() >= MIN_ENTRY_TEXT);
        assert_eq!(truncation.total_bytes, output.len() as u64);
        assert_eq!(
            blobs[truncation.blob.as_ref().expect("blob")],
            output.as_bytes()
        );
    }

    #[test]
    fn raw_input_and_locations_are_cut_first_and_the_original_is_kept() {
        let mut normalizer = Normalizer::default();
        let call = big_call(Vec::new());
        let (events, ops) = normalizer.apply(AuraEvent::ToolCall(call.clone()), None, 1);
        let blobs = blob_map(&ops);
        assert!(json_len(&events[0]) <= EVENT_BUDGET);
        let AuraEvent::ToolCall(fitted) = &events[0] else {
            panic!("a tool call")
        };
        assert_eq!(fitted.title.chars().count(), TITLE_CHARS);
        assert_eq!(
            fitted.tool_name.as_ref().map(|name| name.chars().count()),
            Some(TOOL_NAME_CHARS)
        );
        let raw = fitted.raw_input.as_ref().expect("raw input");
        assert_eq!(raw["_auracode_truncated"], true);
        assert!(
            raw["preview"]
                .as_str()
                .is_some_and(|preview| preview.len() <= RAW_PREVIEW_BYTES)
        );
        assert!(json_len(&fitted.locations) <= LOCATIONS_BYTES);
        let truncated = fitted
            .truncated
            .as_ref()
            .expect("the event names its original");
        let original: AuraEvent =
            serde_json::from_slice(&blobs[truncated.blob.as_ref().expect("blob")]).expect("json");
        assert_eq!(original, AuraEvent::ToolCall(call));
    }

    #[test]
    fn a_diff_that_does_not_fit_keeps_empty_texts_and_a_blob() {
        let mut normalizer = Normalizer::default();
        let old = "old ".repeat(3000);
        let new = "new ".repeat(3000);
        let update = ToolUpdate {
            tool_call_id: "t.1".into(),
            status: None,
            title: None,
            kind: None,
            locations: None,
            raw_input: None,
            tool_name: None,
            content: Some(vec![ToolContent::Diff {
                path: "src/a.rs".into(),
                old_text: Some(old.clone()),
                new_text: new.clone(),
                truncated: None,
            }]),
            truncated: None,
        };
        let (events, ops) = normalizer.apply(AuraEvent::ToolUpdate(update), Some("t"), 1);
        let blobs = blob_map(&ops);
        let AuraEvent::ToolUpdate(fitted) = &events[0] else {
            panic!("an update")
        };
        let Some(
            [
                ToolContent::Diff {
                    old_text,
                    new_text,
                    truncated: Some(truncation),
                    ..
                },
            ],
        ) = fitted.content.as_deref()
        else {
            panic!("an emptied diff: {fitted:?}")
        };
        assert_eq!((old_text.as_deref(), new_text.as_str()), (Some(""), ""));
        let both: serde_json::Value =
            serde_json::from_slice(&blobs[truncation.blob.as_ref().expect("blob")]).expect("json");
        assert_eq!(both, serde_json::json!({"old_text": old, "new_text": new}));
        assert_eq!(fitted.truncated, None, "only entry text was cut");
    }

    #[test]
    fn permission_option_names_shrink_last_and_ids_stay_exact() {
        let mut normalizer = Normalizer::default();
        let options: Vec<PermissionOption> = (0..60)
            .map(|i| PermissionOption {
                option_id: format!("option-{i}"),
                kind: PermissionOptionKind::AllowOnce,
                label: format!("{i} {}", "label ".repeat(30)),
            })
            .collect();
        let request = PermissionRequest {
            request_id: "t.p1".into(),
            tool_call_id: None,
            title: "Pick".into(),
            kind: Some(ToolKind::Other),
            raw_input: None,
            content: vec![ToolContent::Text {
                text: "body ".repeat(2000),
                truncated: None,
            }],
            locations: Vec::new(),
            options: options.clone(),
            truncated: None,
        };
        let (events, _) = normalizer.apply(AuraEvent::PermissionRequested(request), Some("t"), 1);
        let AuraEvent::PermissionRequested(fitted) = &events[0] else {
            panic!("a request")
        };
        assert!(json_len(&events[0]) <= EVENT_BUDGET);
        let ids: Vec<&str> = fitted
            .options
            .iter()
            .map(|option| option.option_id.as_str())
            .collect();
        let original: Vec<&str> = options
            .iter()
            .map(|option| option.option_id.as_str())
            .collect();
        assert_eq!(ids, original);
        assert!(
            fitted
                .options
                .iter()
                .all(|option| option.label.chars().count() <= OPTION_NAME_SHORT_CHARS)
        );
        assert!(fitted.truncated.is_some());
        assert!(normalizer.card("t.p1").is_some(), "tracked as open");
    }

    #[test]
    fn plans_fold_trailing_entries() {
        let mut normalizer = Normalizer::default();
        let entries: Vec<PlanEntry> = (0..100)
            .map(|i| PlanEntry {
                content: format!("{i} {}", "step ".repeat(200)),
                status: PlanStatus::Pending,
                priority: None,
            })
            .collect();
        let (events, _) = normalizer.apply(AuraEvent::PlanUpdated { entries }, Some("t"), 1);
        assert!(json_len(&events[0]) <= EVENT_BUDGET);
        let AuraEvent::PlanUpdated { entries } = &events[0] else {
            panic!("a plan")
        };
        let last = entries.last().expect("entries");
        let kept = entries.len() - 1;
        assert_eq!(last.content, format!("+ {} more", 100 - kept));
        assert!(entries[0].content.chars().count() <= PLAN_ENTRY_CHARS);
    }

    #[test]
    fn turn_ends_close_what_is_open_in_that_turn() {
        let mut normalizer = Normalizer::default();
        let question = |id: &str, prompt: UiPrompt| {
            AuraEvent::UiRequest(UiRequest {
                request_id: id.into(),
                prompt,
            })
        };
        let card = |id: &str| {
            AuraEvent::PermissionRequested(PermissionRequest {
                request_id: id.into(),
                tool_call_id: None,
                title: "x".into(),
                kind: Some(ToolKind::Edit),
                raw_input: None,
                content: Vec::new(),
                locations: Vec::new(),
                options: Vec::new(),
                truncated: None,
            })
        };
        normalizer.apply(
            AuraEvent::MessageDelta {
                message_id: "t.m1".into(),
                text: "a".into(),
            },
            Some("t"),
            100,
        );
        normalizer.apply(
            AuraEvent::ThoughtDelta {
                thought_id: "t.t1".into(),
                text: "b".into(),
            },
            Some("t"),
            100,
        );
        normalizer.apply(
            AuraEvent::MessageDelta {
                message_id: "s.m1".into(),
                text: "late".into(),
            },
            None,
            100,
        );
        normalizer.apply(card("t.p1"), Some("t"), 100);
        normalizer.apply(card("s.p1"), None, 100);
        normalizer.apply(
            question(
                "t.p2",
                UiPrompt::Confirm {
                    message: "?".into(),
                },
            ),
            Some("t"),
            100,
        );
        normalizer.apply(
            question(
                "t.n",
                UiPrompt::Notify {
                    message: "fyi".into(),
                },
            ),
            Some("t"),
            100,
        );
        assert!(
            normalizer.question("t.n").is_none(),
            "notifications are never open"
        );
        let closed = normalizer.close_turn("t", ResolvedBy::Turn, 350);
        assert_eq!(
            closed,
            [
                AuraEvent::MessageCompleted {
                    message_id: "t.m1".into()
                },
                AuraEvent::ThoughtCompleted {
                    thought_id: "t.t1".into(),
                    duration_ms: Some(250)
                },
                AuraEvent::PermissionResolved {
                    request_id: "t.p1".into(),
                    decision: PermissionDecision::Cancelled,
                    by: ResolvedBy::Turn
                },
                AuraEvent::UiResolved {
                    request_id: "t.p2".into(),
                    answer: None,
                    by: ResolvedBy::Turn
                },
            ]
        );
        assert!(normalizer.has_open_requests());
        let untagged = normalizer.close_untagged(ResolvedBy::System, 400);
        assert_eq!(
            untagged,
            [
                AuraEvent::MessageCompleted {
                    message_id: "s.m1".into()
                },
                AuraEvent::PermissionResolved {
                    request_id: "s.p1".into(),
                    decision: PermissionDecision::Cancelled,
                    by: ResolvedBy::System
                },
            ]
        );
        assert!(!normalizer.has_open_requests());
    }

    /// A deterministic pseudo-random source (xorshift).
    struct Rng(u64);

    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }

        fn below(&mut self, n: u64) -> u64 {
            self.next() % n.max(1)
        }

        /// Adversarial text: ASCII, quotes and backslashes, control characters (six bytes each in
        /// JSON), multi-byte and astral characters.
        fn text(&mut self, max: u64) -> String {
            const PIECES: [&str; 9] = ["a", "\"", "\\", "\u{1}", "\n", "é", "😀", "    ", "word "];
            let len = self.below(max + 1);
            (0..len)
                .map(|_| PIECES[self.below(PIECES.len() as u64) as usize])
                .collect()
        }

        fn content(&mut self) -> Vec<ToolContent> {
            (0..self.below(6))
                .map(|_| match self.below(3) {
                    0 => ToolContent::Text {
                        text: self.text(6_000),
                        truncated: None,
                    },
                    1 => ToolContent::Terminal {
                        output: self.text(6_000),
                        exit_code: Some(2),
                        truncated: None,
                    },
                    _ => ToolContent::Diff {
                        path: self.text(800),
                        old_text: (self.below(2) == 0).then(|| self.text(3_000)),
                        new_text: self.text(3_000),
                        truncated: None,
                    },
                })
                .collect()
        }

        fn locations(&mut self) -> Vec<ToolLocation> {
            (0..self.below(40))
                .map(|_| ToolLocation {
                    path: self.text(900),
                    line: Some(7),
                })
                .collect()
        }

        fn raw(&mut self) -> Option<serde_json::Value> {
            (self.below(3) > 0)
                .then(|| serde_json::json!({ "input": self.text(8_000), "n": [1, 2, 3] }))
        }
    }

    /// The text the event's blobs say the original held, for every cut entry.
    fn check_entry_blobs(
        entries: &[ToolContent],
        originals: &[ToolContent],
        blobs: &HashMap<String, Vec<u8>>,
    ) {
        for entry in entries {
            match entry {
                ToolContent::Text {
                    truncated: Some(truncation),
                    ..
                }
                | ToolContent::Terminal {
                    truncated: Some(truncation),
                    ..
                } => {
                    let full = &blobs[truncation.blob.as_ref().expect("blob")];
                    assert!(
                        originals.iter().any(|original| match original {
                            ToolContent::Text { text, .. } => text.as_bytes() == full.as_slice(),
                            ToolContent::Terminal { output, .. } =>
                                output.as_bytes() == full.as_slice(),
                            ToolContent::Diff { .. } => false,
                        }),
                        "a cut entry's blob holds its full text"
                    );
                }
                ToolContent::Diff {
                    truncated: Some(truncation),
                    ..
                } => {
                    assert!(blobs.contains_key(truncation.blob.as_ref().expect("blob")));
                }
                _ => {}
            }
        }
    }

    /// A28: every non-delta event fits the budget after normalizing, whatever its field sizes (every
    /// field at its maximum, randomized multi-entry content), except a request whose option ids
    /// alone exceed it; full originals are in blobs.
    #[test]
    fn normalized_events_fit_budget() {
        let mut rng = Rng(0x2545_F491_4F6C_DD1D);
        for round in 0..200 {
            let mut normalizer = Normalizer::default();
            let options: Vec<PermissionOption> = (0..rng.below(30))
                .map(|i| PermissionOption {
                    option_id: format!("opt-{i}"),
                    kind: PermissionOptionKind::AllowOnce,
                    label: rng.text(300),
                })
                .collect();
            let content = rng.content();
            let events = vec![
                AuraEvent::ToolCall(ToolCall {
                    tool_call_id: format!("turn.{}", "c".repeat(96)),
                    kind: ToolKind::Execute,
                    title: rng.text(2_000),
                    status: ToolStatus::InProgress,
                    locations: rng.locations(),
                    raw_input: rng.raw(),
                    tool_name: Some(rng.text(400)),
                    content: content.clone(),
                    truncated: None,
                }),
                AuraEvent::ToolUpdate(ToolUpdate {
                    tool_call_id: "turn.tool".into(),
                    status: Some(ToolStatus::Completed),
                    title: Some(rng.text(2_000)),
                    kind: Some(ToolKind::Edit),
                    locations: Some(rng.locations()),
                    raw_input: rng.raw(),
                    tool_name: Some(rng.text(400)),
                    content: Some(content.clone()),
                    truncated: None,
                }),
                AuraEvent::PermissionRequested(PermissionRequest {
                    request_id: format!("turn.p{round}"),
                    tool_call_id: Some("turn.tool".into()),
                    title: rng.text(2_000),
                    kind: Some(ToolKind::Edit),
                    raw_input: rng.raw(),
                    content: content.clone(),
                    locations: rng.locations(),
                    options,
                    truncated: None,
                }),
                AuraEvent::UiRequest(UiRequest {
                    request_id: format!("turn.q{round}"),
                    prompt: UiPrompt::Select {
                        message: rng.text(5_000),
                        options: (0..rng.below(20)).map(|_| rng.text(200)).collect(),
                    },
                }),
                AuraEvent::PlanUpdated {
                    entries: (0..rng.below(60))
                        .map(|_| PlanEntry {
                            content: rng.text(2_000),
                            status: PlanStatus::InProgress,
                            priority: None,
                        })
                        .collect(),
                },
                AuraEvent::Notice {
                    level: NoticeLevel::Warning,
                    message: rng.text(4_000),
                },
                AuraEvent::Error {
                    kind: ErrorKind::AgentExited,
                    message: rng.text(4_000),
                    detail: Some(rng.text(4_000)),
                    recoverable: true,
                },
                AuraEvent::SessionUpdated(SessionInfo {
                    status: SessionStatus::Running,
                    detail: Some(rng.text(2_000)),
                    native_session_id: Some(rng.text(500)),
                    agent_name: Some(rng.text(500)),
                    agent_version: Some(rng.text(500)),
                    title: Some(rng.text(2_000)),
                    model: Some(rng.text(500)),
                    effort: Some(rng.text(500)),
                    mode: Some(rng.text(500)),
                    ..SessionInfo::default()
                }),
                AuraEvent::UiResolved {
                    request_id: "q".into(),
                    answer: Some(UiAnswer::Input {
                        text: rng.text(6_000),
                    }),
                    by: ResolvedBy::User,
                },
            ];
            for event in events {
                let original = event.clone();
                let (out, ops) = normalizer.apply(event, Some("turn"), 1);
                let blobs = blob_map(&ops);
                let size = json_len(&out[0]);
                assert!(
                    size <= EVENT_BUDGET,
                    "round {round}: {} is {size} bytes",
                    out[0].kind()
                );
                let (entries, originals, truncated) = match (&out[0], &original) {
                    (AuraEvent::ToolCall(fitted), AuraEvent::ToolCall(original)) => (
                        fitted.content.clone(),
                        original.content.clone(),
                        fitted.truncated.clone(),
                    ),
                    (AuraEvent::ToolUpdate(fitted), AuraEvent::ToolUpdate(original)) => (
                        fitted.content.clone().unwrap_or_default(),
                        original.content.clone().unwrap_or_default(),
                        fitted.truncated.clone(),
                    ),
                    (
                        AuraEvent::PermissionRequested(fitted),
                        AuraEvent::PermissionRequested(original),
                    ) => (
                        fitted.content.clone(),
                        original.content.clone(),
                        fitted.truncated.clone(),
                    ),
                    _ => continue,
                };
                check_entry_blobs(&entries, &originals, &blobs);
                if let Some(truncation) = truncated {
                    let stored: AuraEvent =
                        serde_json::from_slice(&blobs[truncation.blob.as_ref().expect("blob")])
                            .expect("json");
                    assert_eq!(stored, original, "round {round}: the complete original");
                }
            }
        }
    }
}
