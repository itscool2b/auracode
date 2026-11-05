//! Live dictation text from a model that transcribes whole clips (owner, 4 November 2026: words
//! appear while you talk, with no time limit).
//!
//! Voice activity splits speech into phrases at pauses. The phrase in progress is transcribed
//! again whenever enough new audio has arrived, and the words two passes agree on become stable
//! while the rest stays tentative (the "local agreement" policy of streaming Whisper). A pause, or
//! a phrase that runs too long, settles the phrase with one pass over all of it.
//!
//! Settled phrases keep their audio for the last half minute. Finishing transcribes that window in
//! one pass, so a pause in the middle of a sentence cannot split its words; older phrases keep the
//! text they settled with and their audio is wiped. Memory and the cost of every pass therefore
//! stay bounded however long a recording runs.
use super::Failure;
use serde::Serialize;
use std::collections::VecDeque;
use zeroize::Zeroize;

/// Samples per second of the audio this module receives: what the models expect.
pub const SAMPLE_RATE: usize = 16_000;

/// The text so far: phrases already settled, then the phrase in progress split into the words two
/// passes agreed on and the rest, which can still change.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, specta::Type)]
pub struct LiveText {
    pub settled: String,
    pub stable: String,
    pub tentative: String,
}

/// Transcribes one clip of 16 kHz mono audio.
pub trait Decoder {
    fn decode(&mut self, pcm: &[f32]) -> Result<String, Failure>;
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LiveConfig {
    /// A frame at or above this speech probability opens a phrase and resets its pause.
    pub speech_on: f32,
    /// A frame below this probability counts towards the pause that ends a phrase.
    pub speech_off: f32,
    /// The silence, in samples, that settles a phrase.
    pub pause: usize,
    /// Audio kept before a phrase's first speech frame, so its first sound is not clipped.
    pub preroll: usize,
    /// New audio, in samples, before the phrase in progress is transcribed again.
    pub interval: usize,
    /// The longest phrase, in samples, before it settles without a pause.
    pub max_phrase: usize,
    /// The settled audio, in samples, that finishing transcribes again in one pass.
    pub window: usize,
}

impl Default for LiveConfig {
    fn default() -> Self {
        Self {
            speech_on: 0.5,
            speech_off: 0.35,
            pause: SAMPLE_RATE * 7 / 10,
            preroll: SAMPLE_RATE / 4,
            interval: SAMPLE_RATE * 8 / 10,
            max_phrase: SAMPLE_RATE * 20,
            window: SAMPLE_RATE * 30,
        }
    }
}

pub struct Live<D> {
    config: LiveConfig,
    decoder: D,
    /// Text of phrases that left the window: final.
    settled: String,
    /// The settled phrases of the last `config.window` samples, with their text.
    window: VecDeque<(Vec<f32>, String)>,
    window_len: usize,
    /// The phrase in progress; empty between phrases.
    phrase: Vec<f32>,
    /// Recent audio before speech, at most `config.preroll` samples.
    before: VecDeque<f32>,
    silence: usize,
    fresh: usize,
    /// The words of the last pass over the phrase in progress.
    previous: Vec<String>,
    /// The phrase's stable words; they never become tentative again.
    stable: Vec<String>,
    /// Whether any phrase held speech: a recording without one has nothing to add.
    heard: bool,
}

impl<D> Drop for Live<D> {
    fn drop(&mut self) {
        self.phrase.zeroize();
        for sample in self.before.iter_mut() {
            *sample = 0.0;
        }
        for (audio, _) in self.window.iter_mut() {
            audio.zeroize();
        }
    }
}

fn words(text: &str) -> Vec<String> {
    text.split_whitespace().map(str::to_owned).collect()
}

/// `parts` joined by single spaces, skipping empty ones.
fn joined<'a>(parts: impl IntoIterator<Item = &'a str>) -> String {
    let mut out = String::new();
    for part in parts {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(part);
    }
    out
}

impl<D: Decoder> Live<D> {
    pub fn new(config: LiveConfig, decoder: D) -> Self {
        Self {
            config,
            decoder,
            settled: String::new(),
            window: VecDeque::new(),
            window_len: 0,
            phrase: Vec::new(),
            before: VecDeque::new(),
            silence: 0,
            fresh: 0,
            previous: Vec::new(),
            stable: Vec::new(),
            heard: false,
        }
    }

    /// Whether a phrase is in progress.
    pub fn speaking(&self) -> bool {
        !self.phrase.is_empty()
    }

    /// Takes one voice-activity frame with its speech probability. Returns the new text when it
    /// changed.
    pub fn feed(&mut self, frame: &[f32], speech: f32) -> Result<Option<LiveText>, Failure> {
        if !self.speaking() {
            if speech < self.config.speech_on {
                self.before.extend(frame.iter().copied());
                while self.before.len() > self.config.preroll {
                    self.before.pop_front();
                }
                return Ok(None);
            }
            self.heard = true;
            self.phrase.extend(self.before.drain(..));
            self.fresh = self.phrase.len();
            self.silence = 0;
        }
        self.phrase.extend_from_slice(frame);
        self.fresh += frame.len();
        if speech < self.config.speech_off {
            self.silence += frame.len();
        } else if speech >= self.config.speech_on {
            self.silence = 0;
        }
        if self.silence >= self.config.pause || self.phrase.len() >= self.config.max_phrase {
            self.settle()?;
            return Ok(Some(self.text()));
        }
        if self.fresh < self.config.interval {
            return Ok(None);
        }
        self.fresh = 0;
        let current = words(&self.decoder.decode(&self.phrase)?);
        // Local agreement: a word joins the stable prefix once two passes in a row put it there.
        // Stable words stay; a pass that rewrites them only changes what follows.
        let agreed = self
            .previous
            .iter()
            .zip(&current)
            .take_while(|(a, b)| a == b)
            .count();
        if agreed > self.stable.len() {
            self.stable = current[..agreed].to_vec();
        }
        self.previous = current;
        Ok(Some(self.text()))
    }

    /// The phrase in progress, settled by one pass over all of it and kept in the window.
    fn settle(&mut self) -> Result<(), Failure> {
        // Leave out most of the closing pause: it holds no words and only costs time.
        let keep = self
            .phrase
            .len()
            .saturating_sub(self.silence.saturating_sub(SAMPLE_RATE / 5))
            .max(1);
        let mut audio = std::mem::take(&mut self.phrase);
        audio.truncate(keep);
        let text = self.decoder.decode(&audio)?;
        self.window_len += audio.len();
        self.window.push_back((audio, text));
        while self.window_len > self.config.window
            && let Some((mut audio, text)) = self.window.pop_front()
        {
            self.window_len -= audio.len();
            audio.zeroize();
            self.settled = joined([self.settled.as_str(), text.as_str()]);
        }
        self.previous.clear();
        self.stable.clear();
        self.silence = 0;
        self.fresh = 0;
        Ok(())
    }

    pub fn text(&self) -> LiveText {
        let stable = self.stable.join(" ");
        let tentative = self.previous[self.stable.len().min(self.previous.len())..].join(" ");
        LiveText {
            settled: joined(
                std::iter::once(self.settled.as_str())
                    .chain(self.window.iter().map(|(_, text)| text.as_str())),
            ),
            stable,
            tentative,
        }
    }

    /// Ends the recording: the phrase in progress settles, the window is transcribed again in one
    /// pass, and the whole text is returned.
    pub fn finish(mut self) -> Result<String, Failure> {
        if self.speaking() {
            self.settle()?;
        }
        if !self.window.is_empty() {
            let audio: Vec<f32> = self
                .window
                .iter()
                .flat_map(|(audio, _)| audio.iter().copied())
                .collect();
            let mut audio = audio;
            let again = self.decoder.decode(&audio);
            audio.zeroize();
            let recent = match again {
                Ok(text) if !text.trim().is_empty() => text,
                // A failed or empty last pass keeps the phrases' own text.
                _ => joined(self.window.iter().map(|(_, text)| text.as_str())),
            };
            self.settled = joined([self.settled.as_str(), recent.as_str()]);
        }
        if !self.heard || self.settled.trim().is_empty() {
            return Err(Failure::no_speech(
                "No speech was detected. Check that the right microphone is selected and not muted.",
            ));
        }
        Ok(std::mem::take(&mut self.settled))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Says one word per tenth of a second of audio, so passes over a growing phrase extend the
    /// same words, as a model does, and records every clip it was given.
    struct Counting {
        clips: Vec<usize>,
        rewrite_first: bool,
    }

    impl Decoder for Counting {
        fn decode(&mut self, pcm: &[f32]) -> Result<String, Failure> {
            self.clips.push(pcm.len());
            let count = (pcm.len() / (SAMPLE_RATE / 10)).max(1);
            let mut text: Vec<String> = (0..count).map(|index| format!("w{index}")).collect();
            if self.rewrite_first && self.clips.len().is_multiple_of(2) {
                text[0] = "changed".into();
            }
            Ok(text.join(" "))
        }
    }

    const FRAME: usize = 512;

    fn live(rewrite_first: bool) -> Live<Counting> {
        Live::new(
            LiveConfig::default(),
            Counting {
                clips: Vec::new(),
                rewrite_first,
            },
        )
    }

    /// Feeds `seconds` of frames at one speech probability, collecting the texts that changed.
    fn run(live: &mut Live<Counting>, seconds: f32, speech: f32) -> Vec<LiveText> {
        let frames = (seconds * SAMPLE_RATE as f32 / FRAME as f32).round() as usize;
        let frame = [0.1_f32; FRAME];
        (0..frames)
            .filter_map(|_| live.feed(&frame, speech).unwrap())
            .collect()
    }

    #[test]
    fn silence_before_speech_does_nothing_and_keeps_only_a_short_preroll() {
        let mut live = live(false);
        assert!(run(&mut live, 3.0, 0.05).is_empty());
        assert!(live.before.len() <= LiveConfig::default().preroll);
        assert!(live.decoder.clips.is_empty());
        assert!(live.finish().is_err(), "nothing was said");
    }

    #[test]
    fn words_appear_while_speaking_and_turn_stable_once_two_passes_agree() {
        let mut live = live(false);
        let texts = run(&mut live, 3.0, 0.9);
        assert!(texts.len() >= 3, "a pass every 0.8 s: {texts:?}");
        let first = &texts[0];
        assert!(first.stable.is_empty(), "one pass is not yet agreement");
        assert!(!first.tentative.is_empty());
        let last = texts.last().unwrap();
        assert!(
            !last.stable.is_empty(),
            "later passes agree on the opening words"
        );
        assert!(last.settled.is_empty(), "no pause yet");
        // The stable prefix only ever grows.
        for pair in texts.windows(2) {
            assert!(pair[1].stable.starts_with(&pair[0].stable));
        }
    }

    #[test]
    fn a_pause_settles_the_phrase_and_the_window_keeps_its_audio_for_the_last_pass() {
        let mut live = live(false);
        run(&mut live, 1.5, 0.9);
        let texts = run(&mut live, 0.8, 0.1);
        let settled = texts.last().expect("the pause settles the phrase");
        assert!(!settled.settled.is_empty());
        assert!(settled.stable.is_empty() && settled.tentative.is_empty());
        assert!(!live.speaking());
        // The settling pass leaves out most of the closing pause.
        let first = *live.decoder.clips.last().unwrap();
        assert!(first < (1.5 * SAMPLE_RATE as f32) as usize + SAMPLE_RATE / 2);
        assert_eq!(
            live.window.len(),
            1,
            "the settled phrase keeps its audio for the last pass"
        );
        run(&mut live, 1.0, 0.9);
        let text = live.finish().unwrap();
        assert!(text.split_whitespace().count() > 20, "both phrases: {text}");
    }

    #[test]
    fn finishing_reads_the_window_again_as_one_clip_so_a_pause_cannot_split_a_sentence() {
        struct Joined {
            clips: std::rc::Rc<std::cell::RefCell<Vec<usize>>>,
        }
        impl Decoder for Joined {
            fn decode(&mut self, pcm: &[f32]) -> Result<String, Failure> {
                self.clips.borrow_mut().push(pcm.len());
                Ok(format!("clip{}", pcm.len()))
            }
        }
        let clips = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
        let mut live = Live::new(
            LiveConfig::default(),
            Joined {
                clips: clips.clone(),
            },
        );
        let frame = [0.1_f32; FRAME];
        let mut feed = |seconds: f32, speech: f32| {
            for _ in 0..(seconds * SAMPLE_RATE as f32 / FRAME as f32) as usize {
                live.feed(&frame, speech).unwrap();
            }
        };
        feed(1.0, 0.9);
        feed(0.9, 0.1);
        feed(1.0, 0.9);
        feed(0.9, 0.1);
        let settled: Vec<usize> = live.window.iter().map(|(audio, _)| audio.len()).collect();
        assert_eq!(settled.len(), 2, "two phrases settled");
        let text = live.finish().unwrap();
        let last = *clips.borrow().last().unwrap();
        assert_eq!(
            last,
            settled.iter().sum::<usize>(),
            "one pass over both phrases"
        );
        assert_eq!(text, format!("clip{last}"));
    }

    #[test]
    fn a_long_recording_keeps_passes_and_memory_bounded() {
        let mut live = live(false);
        let config = LiveConfig::default();
        run(&mut live, 95.0, 0.9);
        let longest = *live.decoder.clips.iter().max().unwrap();
        assert!(
            longest <= config.max_phrase + FRAME,
            "every pass while talking is bounded"
        );
        assert!(
            live.window_len <= config.window,
            "the window keeps half a minute"
        );
        assert!(live.phrase.len() < config.max_phrase);
        assert!(
            !live.settled.is_empty(),
            "older phrases left the window with their text"
        );
        let text = live.finish().unwrap();
        assert!(text.split_whitespace().count() > 500);
    }

    #[test]
    fn a_pass_that_rewrites_stable_words_cannot_take_them_back() {
        let mut live = live(true);
        let texts = run(&mut live, 4.0, 0.9);
        let stable: Vec<&str> = texts.iter().map(|text| text.stable.as_str()).collect();
        for pair in stable.windows(2) {
            assert!(
                pair[1].starts_with(pair[0]),
                "stable text shrank: {stable:?}"
            );
        }
    }

    #[test]
    fn finishing_mid_phrase_settles_it() {
        let mut live = live(false);
        run(&mut live, 1.2, 0.9);
        let text = live.finish().unwrap();
        assert!(!text.is_empty());
    }
}
