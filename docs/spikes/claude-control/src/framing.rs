//! Newline framing for the CLI's stdout and stderr.
//!
//! Claude Code writes one JSON message per line. Lines are split on `\n` only (a `\r` before it
//! is dropped so Windows output frames the same way), decoded lossily because a tool can echo
//! invalid UTF-8 into a message and that must never end a session, and bounded: a line larger
//! than the limit is dropped with a marker instead of growing memory without end. Image results
//! arrive base64-encoded inside one line, so the limit has to be generous.

/// One complete unit read from a pipe.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    Line(String),
    /// A line over the limit; only its size survives.
    Oversized {
        bytes: usize,
    },
}

/// Reassembles lines from read chunks that can split anywhere, even inside a UTF-8 sequence.
#[derive(Debug)]
pub struct LineFramer {
    pending: Vec<u8>,
    max_line: usize,
    /// Bytes of the current line skipped so far, once it went over the limit.
    skipping: Option<usize>,
}

impl LineFramer {
    pub fn new(max_line: usize) -> Self {
        Self { pending: Vec::new(), max_line, skipping: None }
    }

    /// Adds a chunk and returns every line it completed.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<Frame> {
        let mut frames = Vec::new();
        let mut rest = chunk;
        while let Some(newline) = rest.iter().position(|&b| b == b'\n') {
            let (head, tail) = rest.split_at(newline);
            frames.push(self.complete(head));
            rest = tail.get(1..).unwrap_or_default();
        }
        self.extend(rest);
        frames
    }

    /// The trailing partial line at end of stream, if any. Claude Code ends every message with a
    /// newline, so a tail here means the writer was cut off mid-line.
    pub fn finish(&mut self) -> Option<Frame> {
        if self.pending.is_empty() && self.skipping.is_none() {
            return None;
        }
        Some(self.complete(&[]))
    }

    fn extend(&mut self, bytes: &[u8]) {
        if let Some(skipped) = self.skipping.as_mut() {
            *skipped += bytes.len();
        } else if self.pending.len() + bytes.len() > self.max_line {
            self.skipping = Some(self.pending.len() + bytes.len());
            // Release the partial line now; holding it would defeat the bound.
            self.pending = Vec::new();
        } else {
            self.pending.extend_from_slice(bytes);
        }
    }

    fn complete(&mut self, tail: &[u8]) -> Frame {
        self.extend(tail);
        if let Some(bytes) = self.skipping.take() {
            return Frame::Oversized { bytes };
        }
        let mut line = std::mem::take(&mut self.pending);
        if line.last() == Some(&b'\r') {
            line.pop();
        }
        Frame::Line(String::from_utf8_lossy(&line).into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(text: &str) -> Frame {
        Frame::Line(text.to_owned())
    }

    #[test]
    fn lines_split_across_chunks_are_reassembled() {
        let mut framer = LineFramer::new(1024);
        assert_eq!(framer.push(b"{\"a\":"), vec![]);
        assert_eq!(framer.push(b"1}\n{\"b\""), vec![line("{\"a\":1}")]);
        assert_eq!(framer.push(b":2}\n"), vec![line("{\"b\":2}")]);
        assert_eq!(framer.finish(), None);
    }

    #[test]
    fn several_lines_in_one_chunk_come_out_in_order() {
        let mut framer = LineFramer::new(1024);
        assert_eq!(framer.push(b"one\ntwo\n\nthree"), vec![line("one"), line("two"), line("")]);
        assert_eq!(framer.finish(), Some(line("three")));
    }

    #[test]
    fn crlf_is_framed_like_lf() {
        let mut framer = LineFramer::new(1024);
        assert_eq!(framer.push(b"windows\r\nunix\n"), vec![line("windows"), line("unix")]);
    }

    #[test]
    fn invalid_utf8_is_replaced_not_fatal() {
        let mut framer = LineFramer::new(1024);
        assert_eq!(framer.push(b"ok \xff\xfe end\n"), vec![line("ok \u{fffd}\u{fffd} end")]);
    }

    #[test]
    fn a_multibyte_character_split_between_chunks_survives() {
        let mut framer = LineFramer::new(1024);
        let rocket = "🚀".as_bytes();
        assert_eq!(framer.push(&rocket[..2]), vec![]);
        assert_eq!(framer.push(&[&rocket[2..], b"\n"].concat()), vec![line("🚀")]);
    }

    #[test]
    fn an_oversized_line_is_dropped_and_the_next_line_is_intact() {
        let mut framer = LineFramer::new(8);
        assert_eq!(framer.push(b"0123456"), vec![]);
        assert_eq!(framer.push(b"789abc"), vec![]);
        assert_eq!(framer.push(b"def\nnext\n"), vec![Frame::Oversized { bytes: 16 }, line("next")]);
    }

    #[test]
    fn an_oversized_tail_at_eof_is_reported() {
        let mut framer = LineFramer::new(4);
        assert_eq!(framer.push(b"too long"), vec![]);
        assert_eq!(framer.finish(), Some(Frame::Oversized { bytes: 8 }));
        assert_eq!(framer.finish(), None);
    }
}
