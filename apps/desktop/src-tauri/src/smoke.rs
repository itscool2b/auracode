//! Smoke mode (`AURACODE_SMOKE=1`): the UI runs a scripted check against the real shell and
//! reports here; this side prints one machine-readable line and, with `AURACODE_SMOKE_EXIT=1`, exits
//! with the verdict.
//!
//! The line is `AURACODE_SMOKE_RESULT <json>` on stdout. The verdict is re-checked here rather than
//! taken on trust, and a watchdog reports a failure if the UI never reports at all, so a frontend
//! that is broken badly enough to never get there still ends the run with a clear result.

use std::io::Write as _;
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// Starts the stdout line, so automation can find it among the logs.
pub const RESULT_PREFIX: &str = "AURACODE_SMOKE_RESULT";

/// How long the UI has to report. Covers a cold Vite dev server and the whole scripted run (a few
/// seconds) with a wide margin.
pub const WATCHDOG: Duration = Duration::from_secs(120);

/// What the UI's smoke run measured.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct SmokeReport {
    pub ok: bool,
    /// Events applied across every stream of the run.
    pub events_received: u32,
    /// Frames (`EventBatch`es) received across every stream of the run.
    pub frames_received: u32,
    /// Sequence gaps the stream reducer detected. Any gap fails the run.
    pub seq_gaps: u32,
    /// Characters of streamed answer text present in the rendered DOM.
    pub rendered_chars: u32,
    /// Lowest frame rate over half-second windows of the stress burst.
    pub fps_min: f64,
    /// Average frame rate over the stress burst.
    pub fps_avg: f64,
    pub errors: Vec<String>,
}

/// The report as printed: `ok` holds only if the UI said so and the numbers agree.
pub fn finalize(mut report: SmokeReport) -> SmokeReport {
    let mut problems = Vec::new();
    if report.events_received == 0 {
        problems.push("no stream events were received".to_string());
    }
    if report.frames_received == 0 {
        problems.push("no stream frames were received".to_string());
    }
    if report.seq_gaps > 0 {
        problems.push(format!(
            "the stream skipped sequence numbers {} time(s)",
            report.seq_gaps
        ));
    }
    if report.rendered_chars == 0 {
        problems.push("no streamed text was rendered".to_string());
    }
    for fps in [&mut report.fps_min, &mut report.fps_avg] {
        // JSON has no NaN or infinity; serde would write null and break consumers expecting numbers.
        if !fps.is_finite() {
            *fps = 0.0;
        }
    }
    report.ok = report.ok && report.errors.is_empty() && problems.is_empty();
    report.errors.extend(problems);
    report
}

/// The report the watchdog prints when the UI never reported.
pub fn timed_out(after: Duration) -> SmokeReport {
    SmokeReport {
        ok: false,
        events_received: 0,
        frames_received: 0,
        seq_gaps: 0,
        rendered_chars: 0,
        fps_min: 0.0,
        fps_avg: 0.0,
        errors: vec![format!(
            "the UI did not report a smoke result within {} seconds",
            after.as_secs()
        )],
    }
}

/// The report printed when the app could not create its window, so the UI never ran: the run
/// still ends with a result line rather than only an exit code.
pub fn no_window(reason: &str) -> SmokeReport {
    SmokeReport {
        errors: vec![format!("auracode could not create its window: {reason}")],
        ..timed_out(Duration::ZERO)
    }
}

/// `AURACODE_SMOKE_RESULT {"ok":true,...}`
pub fn result_line(report: &SmokeReport) -> String {
    let json = serde_json::to_string(report).unwrap_or_else(|error| {
        // Unreachable for this struct (finite numbers, string keys); still a valid failing line.
        format!(r#"{{"ok":false,"errors":["could not serialize the report: {error}"]}}"#)
    });
    format!("{RESULT_PREFIX} {json}")
}

pub fn exit_code(report: &SmokeReport) -> i32 {
    if report.ok { 0 } else { 1 }
}

/// Prints the result line on stdout and flushes, so it is out before any exit.
pub fn print(report: &SmokeReport) {
    let line = result_line(report);
    let mut stdout = std::io::stdout().lock();
    if let Err(error) = writeln!(stdout, "{line}").and_then(|()| stdout.flush()) {
        tracing::error!(%error, "could not print the smoke result");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn passing() -> SmokeReport {
        SmokeReport {
            ok: true,
            events_received: 120,
            frames_received: 40,
            seq_gaps: 0,
            rendered_chars: 900,
            fps_min: 55.0,
            fps_avg: 59.8,
            errors: Vec::new(),
        }
    }

    #[test]
    fn a_clean_report_passes_unchanged() {
        let report = finalize(passing());
        assert_eq!(report, passing());
        assert_eq!(exit_code(&report), 0);
    }

    #[test]
    fn the_ui_cannot_claim_success_with_bad_numbers() {
        let report = finalize(SmokeReport {
            seq_gaps: 2,
            rendered_chars: 0,
            ..passing()
        });
        assert!(!report.ok);
        assert_eq!(exit_code(&report), 1);
        assert_eq!(report.errors.len(), 2, "{:?}", report.errors);
    }

    #[test]
    fn reported_errors_fail_the_run() {
        let report = finalize(SmokeReport {
            errors: vec!["demo turn timed out".into()],
            ..passing()
        });
        assert!(!report.ok);
        assert_eq!(report.errors, vec!["demo turn timed out".to_string()]);
    }

    #[test]
    fn a_failing_verdict_stays_failing() {
        let report = finalize(SmokeReport {
            ok: false,
            ..passing()
        });
        assert!(!report.ok);
    }

    #[test]
    fn non_finite_frame_rates_become_zero() {
        let report = finalize(SmokeReport {
            fps_min: f64::NAN,
            fps_avg: f64::INFINITY,
            ..passing()
        });
        assert_eq!((report.fps_min, report.fps_avg), (0.0, 0.0));
        assert!(result_line(&report).contains(r#""fps_min":0.0"#));
    }

    #[test]
    fn the_line_is_the_prefix_and_one_json_object() {
        let line = result_line(&passing());
        let json = line.strip_prefix("AURACODE_SMOKE_RESULT ").expect("prefix");
        assert!(!json.contains('\n'));
        let parsed: SmokeReport = serde_json::from_str(json).expect("json");
        assert_eq!(parsed, passing());
    }

    #[test]
    fn a_missing_window_fails_with_its_reason() {
        let report = finalize(no_window("WebView2 is not installed"));
        assert!(!report.ok);
        assert_eq!(exit_code(&report), 1);
        assert_eq!(
            report.errors[0],
            "auracode could not create its window: WebView2 is not installed"
        );
        assert!(
            !report.errors.iter().any(|e| e.contains("seconds")),
            "not reported as a timeout: {:?}",
            report.errors
        );
    }

    #[test]
    fn the_watchdog_report_fails() {
        let report = finalize(timed_out(WATCHDOG));
        assert!(!report.ok);
        assert!(report.errors[0].contains("120 seconds"));
        assert_eq!(exit_code(&report), 1);
    }
}
