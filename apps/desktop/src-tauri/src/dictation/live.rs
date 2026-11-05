//! Live dictation text from a model that transcribes whole clips (owner, 4 November 2026: words
//! appear while you talk, with no time limit).
//!
//! Voice activity splits speech into phrases at pauses. The phrase in progress is transcribed
//! again whenever enough new audio has arrived, and the words two passes agree on become stable
//! while the rest stays tentative (the "local agreement" policy of streaming Whisper). A pause, or
//! a phrase that runs too long, settles the phrase with one last pass over all of it and drops its
//! audio, so memory and the cost of each pass stay bounded however long a recording runs.
use super::Failure;
use serde::Serialize;
use std::collections::VecDeque;

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
}

impl Default for LiveConfig {
    fn default() -> Self {
        Self {
            speech_on: 0.5,
            speech_off: 0.35,
            pause: SAMPLE_RATE * 6 / 10,
            preroll: SAMPLE_RATE / 4,
            interval: SAMPLE_RATE / 2,
            max_phrase: SAMPLE_RATE * 20,
        }
    }
}

pub struct Live<D> {
    config: LiveConfig,
    decoder: D,
    settled: String,
    /// The phrase in progress; empty between phrases.
    phrase: Vec<f32>,
    /// Recent audio before speech, at most `config.preroll` samples.
    before: VecDeque<f32>,
    silence: usize,
    fresh: usize,
    /// The words of the last pass over the phrase in progress.
    previous: Vec<String>,
    /// How many of the phrase's words are stable; they never become tentative again.
    stable: Vec<String>,
    /// Whether any phrase held speech: a recording without one has nothing to add.
    heard: bool,
}

fn words(text: &str) -> Vec<String> {
    text.split_whitespace().map(str::to_owned).collect()
}

/// Appends `phrase` to `settled` with one space between them.
fn join(settled: &mut String, phrase: &str) {
    let phrase = phrase.trim();
    if phrase.is_empty() {
        return;
    }
    if !settled.is_empty() {
        settled.push(' ');
    }
    settled.push_str(phrase);
}

impl<D: Decoder> Live<D> {
    pub fn new(config: LiveConfig, decoder: D) -> Self {
        Self {
            config,
            decoder,
            settled: String::new(),
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

    /// The phrase in progress, settled by one pass over all of it.
    fn settle(&mut self) -> Result<(), Failure> {
        // Leave out most of the closing pause: it holds no words and only costs time.
        let keep = self
            .phrase
            .len()
            .saturating_sub(self.silence.saturating_sub(SAMPLE_RATE / 5));
        let text = self.decoder.decode(&self.phrase[..keep.max(1)])?;
        join(&mut self.settled, &text);
        self.phrase.clear();
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
            settled: self.settled.clone(),
            stable,
            tentative,
        }
    }

    /// Ends the recording: the phrase in progress settles, and the whole text is returned.
    pub fn finish(mut self) -> Result<String, Failure> {
        if self.speaking() {
            self.settle()?;
        }
        if !self.heard || self.settled.trim().is_empty() {
            return Err(Failure::no_speech(
                "No speech was detected. Check that the right microphone is selected and not muted.",
            ));
        }
        Ok(self.settled)
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
            if self.rewrite_first && self.clips.len() % 2 == 0 {
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
        let texts = run(&mut live, 2.0, 0.9);
        assert!(texts.len() >= 3, "a pass every half second: {texts:?}");
        let first = &texts[0];
        assert!(first.stable.is_empty(), "one pass is not yet agreement");
        assert!(!first.tentative.is_empty());
        let last = texts.last().unwrap();
        assert!(!last.stable.is_empty(), "later passes agree on the opening words");
        assert!(last.settled.is_empty(), "no pause yet");
        // The stable prefix only ever grows.
        for pair in texts.windows(2) {
            assert!(pair[1].stable.starts_with(&pair[0].stable));
        }
    }

    #[test]
    fn a_pause_settles_the_phrase_with_one_pass_over_all_of_it_and_drops_its_audio() {
        let mut live = live(false);
        run(&mut live, 1.5, 0.9);
        let texts = run(&mut live, 0.7, 0.1);
        let settled = texts.last().expect("the pause settles the phrase");
        assert!(!settled.settled.is_empty());
        assert!(settled.stable.is_empty() && settled.tentative.is_empty());
        assert!(!live.speaking(), "the phrase's audio is dropped");
        // The settling pass leaves out most of the closing pause.
        let last_clip = *live.decoder.clips.last().unwrap();
        assert!(last_clip < (1.5 * SAMPLE_RATE as f32) as usize + SAMPLE_RATE / 2);
        run(&mut live, 1.0, 0.9);
        let text = live.finish().unwrap();
        assert!(text.split_whitespace().count() > 10, "both phrases: {text}");
    }

    #[test]
    fn a_long_phrase_settles_without_a_pause_so_each_pass_stays_bounded() {
        let mut live = live(false);
        run(&mut live, 45.0, 0.9);
        let longest = *live.decoder.clips.iter().max().unwrap();
        assert!(longest <= LiveConfig::default().max_phrase + FRAME);
        assert!(live.phrase.len() < LiveConfig::default().max_phrase);
        assert!(live.text().settled.split_whitespace().count() > 100);
    }

    #[test]
    fn a_pass_that_rewrites_stable_words_cannot_take_them_back() {
        let mut live = live(true);
        let texts = run(&mut live, 3.0, 0.9);
        let stable: Vec<&str> = texts.iter().map(|text| text.stable.as_str()).collect();
        for pair in stable.windows(2) {
            assert!(pair[1].starts_with(pair[0]), "stable text shrank: {stable:?}");
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
