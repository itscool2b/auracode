//! An agent's pipes as the driver sees them.
//!
//! stdin is a [`LineSink`] that never blocks: a writer task drains an unbounded queue, writes
//! `line\n` and flushes per line, so a full stdin pipe can never stall the driver's stdout reading.
//! stdout is a [`LineSource`] bounded at [`STDOUT_CHANNEL_LINES`] lines and [`STDOUT_CHANNEL_BYTES`]
//! bytes (one longer line passes alone): a slow driver stops the reader, the pipe fills, and the
//! agent blocks on its own write, so memory stays bounded however fast the agent writes.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tokio::sync::{OwnedSemaphorePermit, Semaphore, mpsc};

use crate::{STDOUT_CHANNEL_BYTES, STDOUT_CHANNEL_LINES};

/// What an [`StdoutItem::Oversized`] item reserves of the byte budget: it carries no line.
#[cfg_attr(
    not(any(test, feature = "testing")),
    allow(
        dead_code,
        reason = "the spawn body (package A) uses it; until then only `testing` does"
    )
)]
const OVERSIZED_ITEM_BYTES: usize = 256;

/// The agent's pipes.
#[derive(Debug)]
pub struct AgentIo {
    pub stdin: LineSink,
    pub stdout: LineSource,
}

/// What the stdin writer task receives.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum StdinMsg {
    Line(String),
    /// End of file after the lines queued before it.
    Close,
}

/// Lines to the agent's stdin. Cloning shares the queue.
#[derive(Debug, Clone)]
pub struct LineSink {
    tx: mpsc::UnboundedSender<StdinMsg>,
    closed: Arc<AtomicBool>,
}

impl LineSink {
    /// A sink and the receiver its writer task drains.
    #[cfg_attr(
        not(any(test, feature = "testing")),
        allow(
            dead_code,
            reason = "the spawn body (package A) uses it; until then only `testing` does"
        )
    )]
    pub(crate) fn channel() -> (LineSink, mpsc::UnboundedReceiver<StdinMsg>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let sink = LineSink {
            tx,
            closed: Arc::new(AtomicBool::new(false)),
        };
        (sink, rx)
    }

    /// Queues one line (no trailing newline). Never blocks: a writer task writes `line\n` and
    /// flushes. Fails once stdin was closed or the writer stopped (the agent is gone).
    pub fn send(&self, line: String) -> Result<(), StdinClosed> {
        if self.closed.load(Ordering::Acquire) {
            return Err(StdinClosed);
        }
        self.tx.send(StdinMsg::Line(line)).map_err(|_| StdinClosed)
    }

    /// End of file after the queued lines. Later sends fail; calling it again does nothing.
    pub fn close(&self) {
        if !self.closed.swap(true, Ordering::AcqRel) {
            // The writer may be gone already, which closes stdin just the same.
            let _ = self.tx.send(StdinMsg::Close);
        }
    }

    /// Whether `close` was called on this sink or one of its clones.
    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Acquire) || self.tx.is_closed()
    }
}

/// The agent's stdin no longer takes lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("the agent's stdin is closed")]
pub struct StdinClosed;

/// Lines from the agent's stdout, bounded by count and bytes.
#[derive(Debug)]
pub struct LineSource {
    rx: mpsc::Receiver<(StdoutItem, OwnedSemaphorePermit)>,
    bytes: Arc<Semaphore>,
}

impl LineSource {
    /// The next line, or `None` at end of file (or a read error, which ends the stream the same
    /// way). Cancel-safe: use it in `select!`.
    pub async fn next(&mut self) -> Option<StdoutItem> {
        // The permit releases the line's bytes as it drops here.
        self.rx.recv().await.map(|(item, _permit)| item)
    }
}

impl Drop for LineSource {
    fn drop(&mut self) {
        // Wakes a reader waiting for byte budget, so it sees the closed channel and stops.
        self.bytes.close();
    }
}

/// The reader's end of a [`LineSource`].
#[derive(Debug)]
#[cfg_attr(
    not(any(test, feature = "testing")),
    allow(
        dead_code,
        reason = "the spawn body (package A) uses it; until then only `testing` does"
    )
)]
pub(crate) struct StdoutSender {
    tx: mpsc::Sender<(StdoutItem, OwnedSemaphorePermit)>,
    bytes: Arc<Semaphore>,
}

/// The driver dropped its [`LineSource`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    not(any(test, feature = "testing")),
    allow(
        dead_code,
        reason = "the spawn body (package A) uses it; until then only `testing` does"
    )
)]
pub(crate) struct SourceGone;

/// A bounded stdout channel: at most [`STDOUT_CHANNEL_LINES`] items and [`STDOUT_CHANNEL_BYTES`]
/// bytes in flight.
#[cfg_attr(
    not(any(test, feature = "testing")),
    allow(
        dead_code,
        reason = "the spawn body (package A) uses it; until then only `testing` does"
    )
)]
pub(crate) fn stdout_channel() -> (StdoutSender, LineSource) {
    let (tx, rx) = mpsc::channel(STDOUT_CHANNEL_LINES);
    let bytes = Arc::new(Semaphore::new(STDOUT_CHANNEL_BYTES));
    let sender = StdoutSender {
        tx,
        bytes: Arc::clone(&bytes),
    };
    (sender, LineSource { rx, bytes })
}

#[cfg_attr(
    not(any(test, feature = "testing")),
    allow(
        dead_code,
        reason = "the spawn body (package A) uses it; until then only `testing` does"
    )
)]
impl StdoutSender {
    /// Waits until the item fits, then queues it. An item larger than the whole byte budget waits
    /// for all of it and so passes alone.
    pub(crate) async fn send(&self, item: StdoutItem) -> Result<(), SourceGone> {
        let size = match &item {
            StdoutItem::Line(line) => line.len(),
            StdoutItem::Oversized { .. } => OVERSIZED_ITEM_BYTES,
        };
        let wanted = u32::try_from(size.min(STDOUT_CHANNEL_BYTES)).unwrap_or(u32::MAX);
        let permit = Arc::clone(&self.bytes)
            .acquire_many_owned(wanted)
            .await
            .map_err(|_| SourceGone)?;
        self.tx.send((item, permit)).await.map_err(|_| SourceGone)
    }
}

/// One item from stdout.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StdoutItem {
    /// A JSON line (its first non-space byte is `{` or `[`), lossily decoded, without its line
    /// ending.
    Line(String),
    /// A line over the cap: skipped, with the keys the sniffer found in it.
    Oversized { bytes: u64, keys: TopKeys },
}

/// The top-level keys of an oversized line, found in constant memory wherever they appear.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TopKeys {
    /// The raw top-level `"id"` value.
    pub id: Option<serde_json::Value>,
    pub method: Option<String>,
    /// The top-level `"type"`.
    pub kind: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_closed_sink_refuses_lines_and_sends_one_close() {
        let (sink, mut rx) = LineSink::channel();
        let clone = sink.clone();
        sink.send("one".into()).expect("open");
        clone.close();
        clone.close();
        assert!(sink.is_closed());
        assert_eq!(sink.send("two".into()), Err(StdinClosed));
        assert_eq!(rx.try_recv().ok(), Some(StdinMsg::Line("one".into())));
        assert_eq!(rx.try_recv().ok(), Some(StdinMsg::Close));
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn a_sink_whose_writer_stopped_refuses_lines() {
        let (sink, rx) = LineSink::channel();
        drop(rx);
        assert_eq!(sink.send("x".into()), Err(StdinClosed));
        assert!(sink.is_closed());
    }

    #[tokio::test]
    async fn stdout_items_arrive_in_order_and_end_with_the_sender() {
        let (sender, mut source) = stdout_channel();
        sender
            .send(StdoutItem::Line("{}".into()))
            .await
            .expect("send");
        sender
            .send(StdoutItem::Oversized {
                bytes: 70_000_000,
                keys: TopKeys {
                    id: Some(serde_json::json!(7)),
                    ..TopKeys::default()
                },
            })
            .await
            .expect("send");
        drop(sender);
        assert_eq!(source.next().await, Some(StdoutItem::Line("{}".into())));
        assert!(matches!(
            source.next().await,
            Some(StdoutItem::Oversized {
                bytes: 70_000_000,
                ..
            })
        ));
        assert_eq!(source.next().await, None);
    }

    #[tokio::test(start_paused = true)]
    async fn a_slow_reader_bounds_what_is_in_flight() {
        let (sender, mut source) = stdout_channel();
        // Sixteen lines fill the channel; the seventeenth waits for the reader.
        for index in 0..STDOUT_CHANNEL_LINES {
            sender
                .send(StdoutItem::Line(format!("[{index}]")))
                .await
                .expect("fits");
        }
        let blocked = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            sender.send(StdoutItem::Line("[16]".into())),
        )
        .await;
        assert!(blocked.is_err(), "the seventeenth line waits");
        assert_eq!(source.next().await, Some(StdoutItem::Line("[0]".into())));
        sender
            .send(StdoutItem::Line("[16]".into()))
            .await
            .expect("room now");

        // A line larger than the byte budget passes alone once everything else is read.
        let (sender, mut source) = stdout_channel();
        let huge = "x".repeat(STDOUT_CHANNEL_BYTES + 10);
        sender
            .send(StdoutItem::Line("[a]".into()))
            .await
            .expect("small");
        let pending = tokio::spawn(async move {
            sender
                .send(StdoutItem::Line(huge))
                .await
                .expect("passes alone");
            sender
        });
        assert_eq!(source.next().await, Some(StdoutItem::Line("[a]".into())));
        let sender = pending.await.expect("join");
        assert!(
            matches!(source.next().await, Some(StdoutItem::Line(line)) if line.len() > STDOUT_CHANNEL_BYTES)
        );
        drop(sender);
        assert_eq!(source.next().await, None);
    }

    #[tokio::test]
    async fn a_dropped_source_stops_a_waiting_sender() {
        let (sender, source) = stdout_channel();
        drop(source);
        assert_eq!(
            sender.send(StdoutItem::Line("{}".into())).await,
            Err(SourceGone)
        );
    }
}
