//! Checks the M0 spike docs (`docs/spikes/*.md`) against what they cite, so a doc can neither claim
//! more than was verified nor quote versions and values the code no longer has.
//!
//! Every rule exists because a spike doc once broke it:
//!
//! - **An explicit status that agrees with the results.** Each doc has exactly one `**Status:**`
//!   line whose first word is `decided`, `pending` or `open`. Results are table columns whose
//!   header ends in "result", each cell starting with `pass`, `fail`, `pending`, `done` or `n/a`.
//!   A doc is `decided` exactly when no result is `pending` or `fail`, and a section headed as a
//!   checklist or a verification must record its results that way. Two Windows spikes once read
//!   "Decided" over checklists that nobody had run.
//! - **Cited crate versions are the locked ones.** A crate name followed by a version
//!   (`tauri 2.12.5`, `` `windows` 0.62 ``) must match a version that some Cargo.lock in the
//!   repository locks; a two-part version stands for its patch releases. A doc once cited the
//!   patch releases before the locked ones.
//! - **Quoted values exist in the code.** An inline code span holding one quoted word (`"mica"`)
//!   names a value the code uses, so the code must contain that literal. A doc once told the UI it
//!   would receive `"opaque"`, which nothing sends.
//! - **Listed union values match the generated bindings.** A line that names a generated union
//!   type (`GlassEffect`) and lists values must list exactly the type's values.
//! - **Links resolve.** Relative links point at files that exist, and anchors at headings that
//!   exist.
//!
//! Fenced code blocks are skipped throughout: they hold commands and examples, not claims.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::Path;

/// One problem in one doc, at a 1-based line (0 when it concerns the whole doc).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    pub line: usize,
    pub message: String,
}

impl Finding {
    fn new(line: usize, message: impl Into<String>) -> Finding {
        Finding {
            line,
            message: message.into(),
        }
    }
}

impl fmt::Display for Finding {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.line == 0 {
            write!(f, "{}", self.message)
        } else {
            write!(f, "line {}: {}", self.line, self.message)
        }
    }
}

/// A line outside fenced code blocks. `region` counts the stretches of prose between code
/// blocks, so text on either side of a block is never read as one sentence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProseLine<'a> {
    pub number: usize,
    pub region: usize,
    pub text: &'a str,
}

/// The doc's lines outside fenced code blocks (``` or ~~~, indented or not), numbered from 1.
pub fn prose_lines(doc: &str) -> Vec<ProseLine<'_>> {
    let mut lines = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    let mut region = 0;
    for (index, text) in doc.lines().enumerate() {
        let trimmed = text.trim_start();
        let marker = trimmed.chars().next().filter(|c| *c == '`' || *c == '~');
        let run = marker.map_or(0, |m| trimmed.chars().take_while(|c| *c == m).count());
        match (fence, marker) {
            (None, Some(m)) if run >= 3 => {
                fence = Some((m, run));
                region += 1;
            }
            (Some((m, length)), Some(c))
                if c == m && run >= length && trimmed.trim_start_matches(m).trim().is_empty() =>
            {
                fence = None;
            }
            (None, _) => lines.push(ProseLine {
                number: index + 1,
                region,
                text,
            }),
            (Some(_), _) => {}
        }
    }
    lines
}

/// The inline code spans of one line. A span opens with a run of backticks and closes at the next
/// run of the same length; a run that never closes is plain text. Contents are trimmed.
pub fn code_spans(line: &str) -> Vec<&str> {
    code_span_ranges(line)
        .into_iter()
        .map(|(start, end)| line[start..end].trim())
        .collect()
}

/// Byte ranges of the code spans' contents (without their backticks).
fn code_span_ranges(line: &str) -> Vec<(usize, usize)> {
    let bytes = line.as_bytes();
    let mut ranges = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'`' {
            i += 1;
            continue;
        }
        let open = i;
        while i < bytes.len() && bytes[i] == b'`' {
            i += 1;
        }
        let run = i - open;
        let mut j = i;
        while j < bytes.len() {
            if bytes[j] != b'`' {
                j += 1;
                continue;
            }
            let close = j;
            while j < bytes.len() && bytes[j] == b'`' {
                j += 1;
            }
            if j - close == run {
                ranges.push((i, close));
                i = j;
                break;
            }
        }
    }
    ranges
}

/// The line with every code span (backticks included) replaced by spaces, so syntax inside code,
/// such as `[x](y)`, is not read as a link.
fn without_code_spans(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut last = 0;
    for (start, end) in code_span_ranges(line) {
        let open = line[..start].trim_end_matches('`').len();
        let close = end + (line[end..].len() - line[end..].trim_start_matches('`').len());
        out.push_str(&line[last..open]);
        out.push_str(&" ".repeat(close - open));
        last = close;
    }
    out.push_str(&line[last..]);
    out
}

/// The first word of `text`, lower-cased, without surrounding punctuation or emphasis.
fn first_word(text: &str) -> String {
    text.split_whitespace()
        .next()
        .map(|word| {
            word.trim_matches(|c: char| !c.is_alphanumeric() && c != '/')
                .to_lowercase()
        })
        .unwrap_or_default()
}

/// What a spike doc says about itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// Everything it relies on has been verified.
    Decided,
    /// Drafted, waiting for named verification.
    Pending,
    /// Still being measured or explored.
    Open,
}

impl Status {
    fn name(self) -> &'static str {
        match self {
            Status::Decided => "decided",
            Status::Pending => "pending",
            Status::Open => "open",
        }
    }
}

const STATUS_MARKER: &str = "**Status:**";

/// The doc's status and the line it is on.
pub fn status(doc: &str) -> Result<(Status, usize), Finding> {
    let found: Vec<(usize, &str)> = prose_lines(doc)
        .into_iter()
        .filter_map(|line| {
            line.text
                .trim_start()
                .strip_prefix(STATUS_MARKER)
                .map(|rest| (line.number, rest))
        })
        .collect();
    match found.as_slice() {
        [] => Err(Finding::new(
            0,
            "no status line: add `**Status:** decided`, `**Status:** pending ...` or \
             `**Status:** open ...` near the top",
        )),
        [(number, rest)] => match first_word(rest).as_str() {
            "decided" => Ok((Status::Decided, *number)),
            "pending" => Ok((Status::Pending, *number)),
            "open" => Ok((Status::Open, *number)),
            other => Err(Finding::new(
                *number,
                format!("unknown status \"{other}\": use decided, pending or open"),
            )),
        },
        [_, (second, _), ..] => Err(Finding::new(
            *second,
            "a second status line: keep exactly one",
        )),
    }
}

/// What one result cell records.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Pass,
    Fail,
    Pending,
    Done,
    NotApplicable,
}

impl Outcome {
    fn parse(word: &str) -> Option<Outcome> {
        match word {
            "pass" => Some(Outcome::Pass),
            "fail" => Some(Outcome::Fail),
            "pending" => Some(Outcome::Pending),
            "done" => Some(Outcome::Done),
            "n/a" => Some(Outcome::NotApplicable),
            _ => None,
        }
    }

    /// Still in the way of a decision: not run yet, or run and failed.
    pub fn is_open(self) -> bool {
        matches!(self, Outcome::Pending | Outcome::Fail)
    }
}

/// One result cell and the line it is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResultCell {
    pub line: usize,
    pub outcome: Outcome,
}

/// A Markdown table: its header line, header cells, the columns that hold results, and its rows.
struct Table {
    line: usize,
    header: Vec<String>,
    result_columns: Vec<usize>,
    rows: Vec<(usize, Vec<String>)>,
}

/// The cells of a table row (a line that starts with `|`), split on pipes that are not escaped.
fn table_row(line: &str) -> Option<Vec<String>> {
    let inner = line.trim().strip_prefix('|')?;
    let mut cells = Vec::new();
    let mut current = String::new();
    let mut chars = inner.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' if chars.peek() == Some(&'|') => {
                current.push('|');
                chars.next();
            }
            '|' => cells.push(std::mem::take(&mut current)),
            _ => current.push(c),
        }
    }
    // A row may leave out its closing pipe.
    if !current.trim().is_empty() {
        cells.push(current);
    }
    Some(cells)
}

fn is_separator_row(cells: &[String]) -> bool {
    !cells.is_empty()
        && cells.iter().all(|cell| {
            let cell = cell.trim();
            cell.contains('-') && cell.chars().all(|c| c == '-' || c == ':')
        })
}

/// Every table in the doc's prose: a header row, a separator row, then rows until the first line
/// that is not a row.
fn tables(doc: &str) -> Vec<Table> {
    let lines = prose_lines(doc);
    let mut found = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let header_line = lines[i];
        let header = table_row(header_line.text);
        let separator = lines
            .get(i + 1)
            .filter(|next| next.region == header_line.region);
        let (Some(header), Some(separator)) = (header, separator) else {
            i += 1;
            continue;
        };
        if !table_row(separator.text).is_some_and(|cells| is_separator_row(&cells)) {
            i += 1;
            continue;
        }
        let result_columns = header
            .iter()
            .enumerate()
            .filter(|(_, title)| title.trim().to_lowercase().ends_with("result"))
            .map(|(column, _)| column)
            .collect();
        let mut rows = Vec::new();
        i += 2;
        while let Some(line) = lines.get(i) {
            if line.region != header_line.region {
                break;
            }
            let Some(cells) = table_row(line.text) else {
                break;
            };
            rows.push((line.number, cells));
            i += 1;
        }
        found.push(Table {
            line: header_line.number,
            header,
            result_columns,
            rows,
        });
    }
    found
}

/// Every result cell in the doc, and a finding for each cell that is empty or does not start with
/// a known outcome.
pub fn result_cells(doc: &str) -> (Vec<ResultCell>, Vec<Finding>) {
    let mut cells = Vec::new();
    let mut findings = Vec::new();
    for table in tables(doc) {
        for (line, row) in &table.rows {
            for &column in &table.result_columns {
                let title = table.header.get(column).map_or("", |t| t.trim());
                let cell = row.get(column).map_or("", |c| c.trim());
                match Outcome::parse(&first_word(cell)) {
                    Some(outcome) => cells.push(ResultCell {
                        line: *line,
                        outcome,
                    }),
                    None if cell.is_empty() => findings.push(Finding::new(
                        *line,
                        format!("the \"{title}\" cell is empty"),
                    )),
                    None => findings.push(Finding::new(
                        *line,
                        format!(
                            "\"{cell}\" under \"{title}\" does not start with pass, fail, pending, \
                             done or n/a"
                        ),
                    )),
                }
            }
        }
    }
    (cells, findings)
}

/// A heading: its line, level (number of `#`) and text.
struct Heading<'a> {
    line: usize,
    level: usize,
    title: &'a str,
}

fn headings(doc: &str) -> Vec<Heading<'_>> {
    prose_lines(doc)
        .into_iter()
        .filter_map(|line| {
            let trimmed = line.text.trim_start();
            let level = trimmed.chars().take_while(|c| *c == '#').count();
            if level == 0 || level > 6 {
                return None;
            }
            let title = trimmed[level..].strip_prefix(' ')?;
            Some(Heading {
                line: line.number,
                level,
                title: title.trim().trim_end_matches('#').trim(),
            })
        })
        .collect()
}

/// Sections headed as a checklist or a verification must hold a table with a result column: a list
/// of steps with nowhere to write their outcome reads as done when nothing was run.
pub fn check_checklists(doc: &str) -> Vec<Finding> {
    let all_headings = headings(doc);
    let all_tables = tables(doc);
    let mut findings = Vec::new();
    for (index, heading) in all_headings.iter().enumerate() {
        let title = heading.title.to_lowercase();
        if !title.contains("checklist") && !title.contains("verification") {
            continue;
        }
        let end = all_headings
            .iter()
            .skip(index + 1)
            .find(|next| next.level <= heading.level)
            .map_or(usize::MAX, |next| next.line);
        let recorded = all_tables.iter().any(|table| {
            table.line > heading.line && table.line < end && !table.result_columns.is_empty()
        });
        if !recorded {
            findings.push(Finding::new(
                heading.line,
                format!(
                    "\"{}\" has no table with a result column: record each check's outcome \
                     (pass, fail, pending, done or n/a)",
                    heading.title
                ),
            ));
        }
    }
    findings
}

/// The status line agrees with the results, every result cell is readable, and every checklist
/// records its outcomes.
pub fn check_status(doc: &str) -> Vec<Finding> {
    let (cells, mut findings) = result_cells(doc);
    findings.extend(check_checklists(doc));
    match status(doc) {
        Err(finding) => findings.push(finding),
        Ok((current, line)) => {
            let open: Vec<String> = cells
                .iter()
                .filter(|cell| cell.outcome.is_open())
                .map(|cell| cell.line.to_string())
                .collect();
            match current {
                Status::Decided if !open.is_empty() => findings.push(Finding::new(
                    line,
                    format!(
                        "the status says decided, but {} result(s) are still pending or failed \
                         (lines {})",
                        open.len(),
                        open.join(", ")
                    ),
                )),
                Status::Pending | Status::Open if open.is_empty() => findings.push(Finding::new(
                    line,
                    format!(
                        "the status says {}, but no result is pending or failed: set it to \
                         decided, or record what is still open in a result column",
                        current.name()
                    ),
                )),
                _ => {}
            }
        }
    }
    findings
}

/// Every (name, version) that a Cargo.lock locks, in file order.
pub fn locked_packages(lockfile: &str) -> Vec<(String, String)> {
    let mut packages = Vec::new();
    for block in lockfile.split("[[package]]").skip(1) {
        let mut name = None;
        let mut version = None;
        for line in block.lines() {
            let line = line.trim();
            if line.starts_with('[') {
                break;
            }
            if let Some(value) = toml_string(line, "name") {
                name = Some(value);
            } else if let Some(value) = toml_string(line, "version") {
                version = Some(value);
            }
        }
        if let (Some(name), Some(version)) = (name, version) {
            packages.push((name, version));
        }
    }
    packages
}

/// The value of `key = "value"`.
fn toml_string(line: &str, key: &str) -> Option<String> {
    let value = line
        .strip_prefix(key)?
        .trim_start()
        .strip_prefix('=')?
        .trim();
    Some(value.strip_prefix('"')?.strip_suffix('"')?.to_string())
}

/// A crate name followed by a version in a doc's prose.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Citation {
    pub line: usize,
    pub name: String,
    pub version: String,
}

/// Every place where a word that `is_crate` accepts is followed by a version: `tauri 2.12.5`,
/// `` `windows` 0.62 ``, `wry 0.57.1,`. Names compare in lower case; table cells never pair up
/// (the pipe between them is a word).
pub fn crate_citations(doc: &str, is_crate: impl Fn(&str) -> bool) -> Vec<Citation> {
    let mut words: Vec<(usize, usize, &str)> = Vec::new();
    for line in prose_lines(doc) {
        for word in line.text.split_whitespace() {
            words.push((line.region, line.number, word));
        }
    }
    let mut citations = Vec::new();
    for pair in words.windows(2) {
        let [(region, line, name), (next_region, _, version)] = pair else {
            continue;
        };
        if region != next_region {
            continue;
        }
        let name = clean_name(name);
        let Some(version) = clean_version(version) else {
            continue;
        };
        if is_crate(&name) {
            citations.push(Citation {
                line: *line,
                name,
                version,
            });
        }
    }
    citations
}

/// Markdown and punctuation around a crate name: `` `windows` ``, `(tao`, `**wry**,`.
const AROUND_NAME: [char; 12] = ['`', '*', '_', '(', ')', '[', ']', '"', '\'', ',', ';', ':'];
/// What may open a version: `` `0.62 ``, `(2.12.5`.
const BEFORE_VERSION: [char; 5] = ['`', '*', '(', '[', '"'];
/// A version never ends in punctuation, so everything trailing goes (`0.37.2).`, `0.62,`).
const AFTER_VERSION: [char; 10] = ['`', '*', ')', ']', '"', '\'', ',', ';', ':', '.'];

fn clean_name(word: &str) -> String {
    word.trim_matches(AROUND_NAME).to_lowercase()
}

fn clean_version(word: &str) -> Option<String> {
    let word = word
        .trim_start_matches(BEFORE_VERSION)
        .trim_end_matches(AFTER_VERSION);
    // A possessive (`2.10.2's`) goes too, with whatever punctuation came before it.
    let word = word
        .strip_suffix("'s")
        .unwrap_or(word)
        .trim_end_matches(AFTER_VERSION);
    let word = word.strip_prefix('=').unwrap_or(word);
    let word = word.strip_prefix('v').unwrap_or(word);
    is_version(word).then(|| word.to_string())
}

/// `1.2`, `1.2.3`, `2.0.0-rc.26`, `1.0.0+build.5`: two or three numbers, then an optional
/// pre-release or build suffix.
fn is_version(text: &str) -> bool {
    let (core, suffix) = match text.find(['-', '+']) {
        Some(at) => (&text[..at], Some(&text[at + 1..])),
        None => (text, None),
    };
    let parts: Vec<&str> = core.split('.').collect();
    let numeric = (2..=3).contains(&parts.len())
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()));
    let suffix_ok = suffix.is_none_or(|s| {
        !s.is_empty()
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'+'))
    });
    numeric && suffix_ok
}

/// Whether a cited version names a locked one: the same string, or a two-part version whose
/// patch releases include it (`0.62` names `0.62.2`, but `0.6` does not).
pub fn version_matches(cited: &str, locked: &str) -> bool {
    if cited == locked {
        return true;
    }
    let two_part = cited.split('.').count() == 2 && !cited.contains(['-', '+']);
    two_part
        && locked
            .strip_prefix(cited)
            .is_some_and(|rest| rest.starts_with('.'))
}

/// Every crate version the doc cites must be one that `locked` (name to versions, merged over
/// the repository's lockfiles) has.
pub fn check_versions(doc: &str, locked: &BTreeMap<String, BTreeSet<String>>) -> Vec<Finding> {
    crate_citations(doc, |name| locked.contains_key(name))
        .into_iter()
        .filter_map(|citation| {
            let versions = locked.get(&citation.name)?;
            if versions
                .iter()
                .any(|version| version_matches(&citation.version, version))
            {
                return None;
            }
            let list: Vec<&str> = versions.iter().map(String::as_str).collect();
            Some(Finding::new(
                citation.line,
                format!(
                    "cites {} {}, but the lockfiles lock {} {}: re-check what the doc says \
                     against the locked version and update it (or reword it, if this is not a \
                     crate version)",
                    citation.name,
                    citation.version,
                    citation.name,
                    list.join(", ")
                ),
            ))
        })
        .collect()
}

/// Inline code spans that hold exactly one quoted word, the way docs write values that the code
/// sends or reads (`"mica"`, `"Overlay"`), with their quotes.
pub fn quoted_literals(doc: &str) -> Vec<(usize, String)> {
    let mut found = Vec::new();
    for line in prose_lines(doc) {
        for span in code_spans(line.text) {
            let Some(word) = span.strip_prefix('"').and_then(|s| s.strip_suffix('"')) else {
                continue;
            };
            if !word.is_empty()
                && word
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
            {
                found.push((line.number, span.to_string()));
            }
        }
    }
    found
}

/// Every quoted value the doc cites must appear, quotes included, somewhere in `code` (the text
/// of the repository's sources, configs and fixtures).
pub fn check_quoted_literals(doc: &str, code: &str) -> Vec<Finding> {
    quoted_literals(doc)
        .into_iter()
        .filter(|(_, literal)| !code.contains(literal.as_str()))
        .map(|(line, literal)| {
            Finding::new(
                line,
                format!(
                    "cites the value {literal}, which no source, config or fixture contains: \
                     use the value the code really has"
                ),
            )
        })
        .collect()
}

/// The values of a string-literal union in generated TypeScript:
/// `export type GlassEffect = "liquid_glass" | "vibrancy" | "mica" | "none";`.
pub fn union_values(typescript: &str, type_name: &str) -> Option<BTreeSet<String>> {
    let marker = format!("export type {type_name} =");
    let start = typescript.find(&marker)? + marker.len();
    let rest = &typescript[start..];
    let body = &rest[..rest.find(';')?];
    let mut values = BTreeSet::new();
    for part in body.split('|') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        values.insert(part.strip_prefix('"')?.strip_suffix('"')?.to_string());
    }
    (!values.is_empty()).then_some(values)
}

fn is_value_word(text: &str) -> bool {
    text.starts_with(|c: char| c.is_ascii_lowercase())
        && text
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// A line that names `type_name` in a code span and also lists values (other code spans holding a
/// lower-case word, quoted or not) must list exactly `values`.
pub fn check_union_listings(doc: &str, type_name: &str, values: &BTreeSet<String>) -> Vec<Finding> {
    let mut findings = Vec::new();
    for line in prose_lines(doc) {
        let spans = code_spans(line.text);
        if !spans.contains(&type_name) {
            continue;
        }
        let listed: BTreeSet<String> = spans
            .iter()
            .filter(|span| **span != type_name)
            .map(|span| span.trim_matches('"'))
            .filter(|span| is_value_word(span))
            .map(str::to_string)
            .collect();
        if !listed.is_empty() && &listed != values {
            let listed: Vec<&str> = listed.iter().map(String::as_str).collect();
            let wanted: Vec<&str> = values.iter().map(String::as_str).collect();
            findings.push(Finding::new(
                line.number,
                format!(
                    "lists {type_name} values {}, but the generated type has {}",
                    listed.join(", "),
                    wanted.join(", ")
                ),
            ));
        }
    }
    findings
}

/// An inline link or image target and the line it is on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Link {
    pub line: usize,
    pub target: String,
}

/// Every `[text](target)` outside code, with an optional title dropped.
pub fn links(doc: &str) -> Vec<Link> {
    let mut found = Vec::new();
    for line in prose_lines(doc) {
        let text = without_code_spans(line.text);
        let mut rest = text.as_str();
        while let Some(at) = rest.find("](") {
            let after = &rest[at + 2..];
            let Some(close) = after.find(')') else {
                break;
            };
            let target = after[..close]
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_matches(['<', '>']);
            if !target.is_empty() {
                found.push(Link {
                    line: line.number,
                    target: target.to_string(),
                });
            }
            rest = &after[close + 1..];
        }
    }
    found
}

/// GitHub's anchors for the doc's headings: lower case, punctuation dropped (letters, digits,
/// hyphens and underscores kept), each space turned into a hyphen, and `-1`, `-2`, ... appended
/// to repeats.
pub fn heading_anchors(doc: &str) -> BTreeSet<String> {
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    let mut anchors = BTreeSet::new();
    for heading in headings(doc) {
        let base: String = heading
            .title
            .to_lowercase()
            .chars()
            .filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_'))
            .map(|c| if c == ' ' { '-' } else { c })
            .collect();
        let repeats = seen.entry(base.clone()).or_insert(0);
        let anchor = if *repeats == 0 {
            base
        } else {
            format!("{base}-{repeats}")
        };
        *repeats += 1;
        anchors.insert(anchor);
    }
    anchors
}

/// Relative links must point at files or folders that exist (resolved against `doc_dir`), and
/// anchors at headings that exist: in this doc for `#anchor`, in the linked Markdown file for
/// `other.md#anchor`. Web and mail links are not checked.
pub fn check_links(doc: &str, doc_dir: &Path) -> Vec<Finding> {
    let own = heading_anchors(doc);
    let mut findings = Vec::new();
    for link in links(doc) {
        let target = link.target.as_str();
        if target.contains("://") || target.starts_with("mailto:") {
            continue;
        }
        let (path, anchor) = match target.split_once('#') {
            Some((path, anchor)) => (path, Some(anchor)),
            None => (target, None),
        };
        if path.is_empty() {
            if let Some(anchor) = anchor
                && !own.contains(anchor)
            {
                findings.push(Finding::new(
                    link.line,
                    format!("links to #{anchor}, but no heading here has that anchor"),
                ));
            }
            continue;
        }
        let resolved = doc_dir.join(path);
        if !resolved.exists() {
            findings.push(Finding::new(
                link.line,
                format!("links to {path}, which does not exist"),
            ));
            continue;
        }
        let Some(anchor) = anchor else {
            continue;
        };
        if resolved
            .extension()
            .is_none_or(|extension| extension != "md")
        {
            continue;
        }
        match std::fs::read_to_string(&resolved) {
            Ok(other) if heading_anchors(&other).contains(anchor) => {}
            Ok(_) => findings.push(Finding::new(
                link.line,
                format!("links to {path}#{anchor}, but {path} has no heading with that anchor"),
            )),
            Err(error) => findings.push(Finding::new(
                link.line,
                format!("links to {path}, which cannot be read: {error}"),
            )),
        }
    }
    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The Windows titlebar doc as it stood before review: "Decided" over a checklist nobody ran,
    /// patch releases older than the locked ones, and a value the UI never receives.
    const OLD_TITLEBAR: &str = "# Spike: the Windows titlebar

M0 spike 4. Decided 2026-10-24. There is no spike code: the outcome is window configuration for
the Tauri shell, checked against the sources of the versions pinned at M0 (tauri 2.12.4,
tauri-utils 2.10.2, tao 0.37.1, wry 0.57.0, window-vibrancy 0.8.1).

- The UI asks once which material it got (`\"mica\"` or `\"opaque\"`) and paints its opaque base on
  Windows 10.

## Manual checklist (once the Tauri shell lands)

- Windows 11: hover maximize, the Snap Layouts flyout appears, and choosing a zone snaps the window.
";

    /// The Windows spawning doc's header and checklist before review.
    const OLD_SPAWN: &str = "# Spike: spawning agents on Windows

M0 spike 2 (\"Windows spawning: hidden console, git child\"). Decided 2026-10-24.

## Manual checklist (the user's Windows PC)

1. `cargo test --manifest-path docs/spikes/windows-spawn/Cargo.toml -- --skip control_`: every test
   passes and no console window appears.
";

    /// The render and power doc's header before review: half a spike, no status.
    const OLD_RENDER: &str = "# Spike: render cost and power

M0 spike 1 (\"worst-case render on WebKit and WebView2 with idle power\"). macOS half measured
2026-10-24 on the development Mac; the Windows (WebView2) half has to run on the user's Windows
PC.
";

    fn locked_fixture() -> BTreeMap<String, BTreeSet<String>> {
        let mut locked: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for (name, version) in [
            ("tauri", "2.12.5"),
            ("tauri-utils", "2.10.2"),
            ("tao", "0.37.2"),
            ("wry", "0.57.1"),
            ("window-vibrancy", "0.8.1"),
            ("windows", "0.61.3"),
            ("windows", "0.62.2"),
            ("time", "0.3.47"),
        ] {
            locked
                .entry(name.to_string())
                .or_default()
                .insert(version.to_string());
        }
        locked
    }

    fn messages(findings: &[Finding]) -> String {
        findings
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn the_old_titlebar_doc_fails_every_rule_it_broke() {
        let status = check_status(OLD_TITLEBAR);
        let text = messages(&status);
        assert!(text.contains("no status line"), "{text}");
        assert!(text.contains("has no table with a result column"), "{text}");

        let versions = check_versions(OLD_TITLEBAR, &locked_fixture());
        let cited: Vec<&str> = versions
            .iter()
            .map(|f| f.message.split(", but").next().unwrap_or(""))
            .collect();
        assert_eq!(
            cited,
            vec!["cites tauri 2.12.4", "cites tao 0.37.1", "cites wry 0.57.0"]
        );

        let literals = check_quoted_literals(OLD_TITLEBAR, r#"enum { "mica", "none" }"#);
        assert_eq!(literals.len(), 1, "{}", messages(&literals));
        assert!(literals[0].message.contains("\"opaque\""));
        assert_eq!(literals[0].line, 7);
    }

    #[test]
    fn the_old_spawn_and_render_docs_fail_for_their_status() {
        let spawn = messages(&check_status(OLD_SPAWN));
        assert!(spawn.contains("no status line"), "{spawn}");
        assert!(spawn.contains("Manual checklist"), "{spawn}");
        let render = messages(&check_status(OLD_RENDER));
        assert!(render.contains("no status line"), "{render}");
    }

    #[test]
    fn prose_skips_fenced_blocks_of_any_fence_and_indent() {
        let doc = "a\n```sh\nb\n```\nc\n   ~~~~\nd\n   ~~~\ne\n~~~~\nf\n";
        let lines = prose_lines(doc);
        let text: Vec<&str> = lines.iter().map(|l| l.text).collect();
        assert_eq!(text, vec!["a", "c", "f"]);
        assert_eq!(lines[0].region, 0);
        assert_eq!(lines[1].region, 1);
        assert_eq!(lines[2].region, 2);
        assert_eq!(lines[2].number, 11);
    }

    #[test]
    fn an_unclosed_fence_hides_the_rest_of_the_doc() {
        let lines = prose_lines("a\n```\nb\n");
        assert_eq!(lines.len(), 1);
    }

    #[test]
    fn code_spans_match_backtick_runs_by_length() {
        assert_eq!(code_spans("a `b` c ``d ` e`` f"), vec!["b", "d ` e"]);
        assert_eq!(code_spans("an unclosed ` tick"), Vec::<&str>::new());
        assert_eq!(code_spans("``"), Vec::<&str>::new());
        assert_eq!(
            without_code_spans("x `[a](b)` y"),
            format!("x{}y", " ".repeat(10))
        );
        assert_eq!(without_code_spans("``a``b"), format!("{}b", " ".repeat(5)));
    }

    #[test]
    fn the_status_is_one_known_word_on_one_line() {
        assert_eq!(
            status("**Status:** pending Windows verification.\n"),
            Ok((Status::Pending, 1))
        );
        assert_eq!(
            status("x\n**Status:** decided.\n"),
            Ok((Status::Decided, 2))
        );
        assert_eq!(
            status("**Status:** **open** for now\n"),
            Ok((Status::Open, 1))
        );
        assert!(status("no status here\n").is_err());
        assert!(status("**Status:** maybe\n").is_err());
        assert_eq!(
            status("**Status:** open\n\n**Status:** decided\n").map_err(|f| f.line),
            Err(3)
        );
        // A status inside a code block is an example, not the doc's status.
        assert!(status("```\n**Status:** decided\n```\n").is_err());
    }

    const RESULTS: &str = "\
| Check | Pass when | Result |
|---|---|---|
| one | x | pass |
| two | x | pending: needs Windows |
| three | x | **fail** (build 22631) |
| four | x | n/a (Windows 10 only) |
| five | x | done |
";

    #[test]
    fn result_cells_take_the_first_word_of_result_columns() {
        let (cells, findings) = result_cells(RESULTS);
        assert!(findings.is_empty(), "{}", messages(&findings));
        let outcomes: Vec<Outcome> = cells.iter().map(|c| c.outcome).collect();
        assert_eq!(
            outcomes,
            vec![
                Outcome::Pass,
                Outcome::Pending,
                Outcome::Fail,
                Outcome::NotApplicable,
                Outcome::Done
            ]
        );
        assert_eq!(cells[1].line, 4);
    }

    #[test]
    fn several_result_columns_and_escaped_pipes_are_read() {
        let doc = "| Test | macOS result | windows-latest result |\n| :--- | :---: | ---: |\n| `a \\| b` | pass | pending |\n";
        let (cells, findings) = result_cells(doc);
        assert!(findings.is_empty(), "{}", messages(&findings));
        assert_eq!(cells.len(), 2);
        assert_eq!(cells[1].outcome, Outcome::Pending);
    }

    #[test]
    fn unreadable_and_empty_result_cells_are_findings() {
        let doc = "| Check | Result |\n|---|---|\n| a | maybe |\n| b |  |\n| c\n";
        let (cells, findings) = result_cells(doc);
        assert!(cells.is_empty());
        let text = messages(&findings);
        assert!(text.contains("\"maybe\" under \"Result\""), "{text}");
        assert_eq!(findings.len(), 3, "{text}");
    }

    #[test]
    fn tables_without_a_result_column_or_a_separator_are_not_results() {
        let doc = "| Test | Proves |\n|---|---|\n| a | pending |\n\n| Result |\n| not a separator |\n| pending |\n";
        let (cells, findings) = result_cells(doc);
        assert!(cells.is_empty());
        assert!(findings.is_empty());
    }

    #[test]
    fn the_status_must_agree_with_the_results() {
        let decided_but_pending = format!("**Status:** decided.\n\n{RESULTS}");
        let text = messages(&check_status(&decided_but_pending));
        assert!(
            text.contains("decided, but 2 result(s) are still pending or failed (lines 6, 7)"),
            "{text}"
        );

        let all_done = "**Status:** open.\n\n| Part | Result |\n|---|---|\n| a | done |\n";
        let text = messages(&check_status(all_done));
        assert!(
            text.contains("says open, but no result is pending"),
            "{text}"
        );

        let consistent = format!("**Status:** pending Windows verification.\n\n{RESULTS}");
        assert!(check_status(&consistent).is_empty());
        assert!(check_status("**Status:** decided.\n").is_empty());
    }

    #[test]
    fn checklist_and_verification_sections_need_a_result_column() {
        let doc = "**Status:** pending.\n\n## Verification\n\nprose only\n\n## Manual checklist\n\n| Step | Result |\n|---|---|\n| a | pending |\n\n### Notes\n";
        let findings = check_checklists(doc);
        assert_eq!(findings.len(), 1, "{}", messages(&findings));
        assert_eq!(findings[0].line, 3);
        // A results table under a deeper heading inside the section still counts.
        let nested =
            "## Verification\n\n### Windows\n\n| Step | Result |\n|---|---|\n| a | pass |\n";
        assert!(check_checklists(nested).is_empty());
        // One after the next same-level heading does not.
        let later = "## Verification\n\n## Other\n\n| Step | Result |\n|---|---|\n| a | pass |\n";
        assert_eq!(check_checklists(later).len(), 1);
    }

    #[test]
    fn lockfiles_yield_every_package_including_repeats() {
        let lock = "version = 4\r\n\r\n[[package]]\r\nname = \"windows\"\r\nversion = \"0.61.3\"\r\nsource = \"registry\"\r\ndependencies = [\r\n \"x\",\r\n]\r\n\r\n[[package]]\r\nname = \"windows\"\r\nversion = \"0.62.2\"\r\n\r\n[[package]]\r\nname = \"no-version\"\r\n\r\n[metadata]\r\nname = \"ignored\"\r\nversion = \"9.9.9\"\r\n";
        assert_eq!(
            locked_packages(lock),
            vec![
                ("windows".to_string(), "0.61.3".to_string()),
                ("windows".to_string(), "0.62.2".to_string()),
            ]
        );
    }

    #[test]
    fn citations_pair_a_crate_name_with_the_next_word_only() {
        let locked = locked_fixture();
        let doc = "Locked: Tauri 2.12.5, `windows` 0.62 crate, wry\n0.57.1. tauri-utils 2.10.2's docs, (tao 0.37.2).\n\
                   Not citations: Windows 11, time 23 ms, macOS 26.6.2, | tauri | 2.12.5 |, tauri's 2.12.1 notes.\n\
                   ```\ntauri 9.9.9\n```\nwry\n```\n```\n0.1.0\n";
        let found: Vec<(String, String, usize)> =
            crate_citations(doc, |name| locked.contains_key(name))
                .into_iter()
                .map(|c| (c.name, c.version, c.line))
                .collect();
        assert_eq!(
            found,
            vec![
                ("tauri".to_string(), "2.12.5".to_string(), 1),
                ("windows".to_string(), "0.62".to_string(), 1),
                ("wry".to_string(), "0.57.1".to_string(), 1),
                ("tauri-utils".to_string(), "2.10.2".to_string(), 2),
                ("tao".to_string(), "0.37.2".to_string(), 2),
            ]
        );
        assert!(check_versions(doc, &locked).is_empty());
    }

    #[test]
    fn versions_and_their_matching_rules() {
        for version in ["1.2", "1.2.3", "2.0.0-rc.26", "1.0.0+build.5", "10.0.1"] {
            assert!(is_version(version), "{version}");
        }
        for not_version in ["1", "1.2.3.4", "1..2", "a.b", "1.2-", "22000+", "1.2.x"] {
            assert!(!is_version(not_version), "{not_version}");
        }
        assert_eq!(
            clean_version("`=2.0.0-rc.26`,").as_deref(),
            Some("2.0.0-rc.26")
        );
        assert_eq!(clean_version("v0.57.1).").as_deref(), Some("0.57.1"));
        assert!(version_matches("0.62", "0.62.2"));
        assert!(version_matches("2.12.5", "2.12.5"));
        assert!(!version_matches("0.6", "0.62.2"));
        assert!(!version_matches("2.12.4", "2.12.5"));
        assert!(!version_matches("2.0.0-rc.26", "2.0.0-rc.27"));
    }

    #[test]
    fn a_crate_with_several_locked_versions_accepts_any_of_them() {
        let locked = locked_fixture();
        assert!(check_versions("the windows 0.61.3 crate", &locked).is_empty());
        assert_eq!(check_versions("the windows 0.60.0 crate", &locked).len(), 1);
    }

    #[test]
    fn quoted_literals_are_single_quoted_words_in_code_spans() {
        let doc = "`\"mica\"`, `\"Overlay\"`, `\"create\": false`, `mica`, `\"a b\"`, `\"\"`\n```\n`\"inside\"`\n```\n";
        let found: Vec<String> = quoted_literals(doc).into_iter().map(|(_, l)| l).collect();
        assert_eq!(found, vec!["\"mica\"", "\"Overlay\""]);
        let findings = check_quoted_literals(doc, "titleBarStyle: \"Overlay\"");
        assert_eq!(findings.len(), 1);
        assert!(findings[0].message.contains("\"mica\""));
    }

    const BINDINGS: &str = "export type AppInfo = { glass: GlassEffect };\n\
        export type GlassEffect = \"liquid_glass\" | \"vibrancy\" |\n  \"mica\" | \"none\";\n\
        export type GlassEffectNot = \"x\";\n";

    #[test]
    fn union_values_come_from_the_generated_type() {
        let values = union_values(BINDINGS, "GlassEffect");
        let expected: BTreeSet<String> = ["liquid_glass", "vibrancy", "mica", "none"]
            .into_iter()
            .map(String::from)
            .collect();
        assert_eq!(values, Some(expected));
        assert_eq!(union_values(BINDINGS, "Missing"), None);
        assert_eq!(
            union_values("export type Mixed = \"a\" | number;", "Mixed"),
            None
        );
    }

    #[test]
    fn a_line_listing_union_values_must_list_exactly_them() {
        let values = union_values(BINDINGS, "GlassEffect").unwrap_or_default();
        let right = "All values (`GlassEffect`): `liquid_glass`, `vibrancy`, `mica`, `none`.\n";
        assert!(check_union_listings(right, "GlassEffect", &values).is_empty());
        let mentions = "The UI reads `app_info().glass`, a `GlassEffect`.\n";
        assert!(check_union_listings(mentions, "GlassEffect", &values).is_empty());
        let wrong = "`GlassEffect` is `\"mica\"` or `\"opaque\"`.\n";
        let findings = check_union_listings(wrong, "GlassEffect", &values);
        assert_eq!(findings.len(), 1);
        assert!(
            findings[0].message.contains("values mica, opaque"),
            "{}",
            messages(&findings)
        );
    }

    #[test]
    fn links_outside_code_are_found_with_titles_dropped() {
        let doc = "See [a](a.md#x \"title\"), ![img](pic.png), `[no](code)`, [web](https://x.y).\n```\n[no](fence)\n```\n";
        let targets: Vec<String> = links(doc).into_iter().map(|l| l.target).collect();
        assert_eq!(targets, vec!["a.md#x", "pic.png", "https://x.y"]);
    }

    #[test]
    fn anchors_follow_github() {
        let doc = "# Spike: render cost and power\n## Windows (WebView2) half: still to run\n\
                   ### A. The real app, window not visible (locked screen)\n## Manual checklist (the user's Windows PC)\n\
                   ## What `GlassEffect` means ##\n## Repeat\n## Repeat\n#not a heading\n```\n## inside code\n```\n";
        let anchors = heading_anchors(doc);
        for anchor in [
            "spike-render-cost-and-power",
            "windows-webview2-half-still-to-run",
            "a-the-real-app-window-not-visible-locked-screen",
            "manual-checklist-the-users-windows-pc",
            "what-glasseffect-means",
            "repeat",
            "repeat-1",
        ] {
            assert!(
                anchors.contains(anchor),
                "{anchor} missing from {anchors:?}"
            );
        }
        assert_eq!(anchors.len(), 7, "{anchors:?}");
    }

    #[test]
    fn links_must_reach_existing_files_and_headings() -> std::io::Result<()> {
        let dir = std::env::temp_dir().join(format!("spike-doc-check-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("folder"))?;
        std::fs::write(dir.join("other.md"), "# Other\n## Part two\n")?;
        let doc = "# Here\n[ok](#here) [ok](other.md#part-two) [ok](folder/) [ok](other.md)\n\
                   [bad](#nowhere) [bad](missing.md) [bad](other.md#nope) [web](https://example.com/x#y)\n";
        let findings = check_links(doc, &dir);
        std::fs::remove_dir_all(&dir)?;
        let text = messages(&findings);
        assert_eq!(findings.len(), 3, "{text}");
        assert!(text.contains("#nowhere"), "{text}");
        assert!(text.contains("missing.md, which does not exist"), "{text}");
        assert!(text.contains("other.md#nope"), "{text}");
        Ok(())
    }
}
