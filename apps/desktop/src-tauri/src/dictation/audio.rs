use super::{DictationEvent, Failure, Operation, model};
use crate::sync::lock;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rubato::{FftFixedInOut, Resampler};
use std::path::Path;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
use zeroize::{Zeroize, Zeroizing};

const SAMPLE_RATE: usize = 16_000;
const MAX_SECONDS: u32 = 120;
/// whisper.cpp stops gaining from threads past about the physical core count. Measured on an
/// 8-core, 16-thread Ryzen: 4 threads took 1.7 s for 11 s of speech, 8 took 1.1 s, 16 took 1.1 s.
const MAX_THREADS: usize = 8;
/// A stream that delivered audio and then nothing for this long has stopped.
const STALL: Duration = Duration::from_secs(3);
/// A stream that delivers no audio at all within this long cannot be used.
const FIRST_AUDIO: Duration = Duration::from_secs(5);
const MICROPHONE_ERROR: &str = "The microphone could not be opened. Check that one is connected and set as the default input device in your system sound settings.";
const PRIVACY_ERROR: &str = "Microphone access is turned off for desktop apps. Allow it in your system privacy settings, then try again.";
const BUSY_ERROR: &str = "Another app is using the microphone exclusively. Close it, or turn off exclusive mode for the device, then try again.";
const STOPPED_ERROR: &str =
    "The microphone disconnected or stopped responding. Reconnect it and try again.";

/// The processor features this build's speech engine was compiled for. ggml-cpu alone uses them,
/// and only once dictation runs: nothing compiled for them runs at startup (see
/// docs/local-dictation.md), so checking here keeps older processors safe.
pub fn cpu_supported() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        std::arch::is_x86_feature_detected!("avx")
            && std::arch::is_x86_feature_detected!("avx2")
            && std::arch::is_x86_feature_detected!("fma")
            && std::arch::is_x86_feature_detected!("f16c")
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        true
    }
}

/// What a stream error means for the recording. cpal reports glitches and reroutes through the
/// same callback as failures: on Windows an early capture packet routinely carries WASAPI's data
/// discontinuity flag, which cpal 0.18 reports as an `Xrun`. Treating that as fatal ended every
/// recording a tenth of a second after it began.
fn stream_fault(kind: cpal::ErrorKind) -> u8 {
    use cpal::ErrorKind as K;
    match kind {
        // The stream keeps running: an overrun drops a few samples, a reroute follows the new
        // default device, and a refused real-time priority only adds latency.
        K::Xrun | K::DeviceChanged | K::RealtimeDenied => FAULT_NONE,
        K::PermissionDenied => FAULT_PERMISSION,
        // cpal ends the capture thread after any other error.
        _ => FAULT_STOPPED,
    }
}
const FAULT_NONE: u8 = 0;
const FAULT_STOPPED: u8 = 1;
const FAULT_PERMISSION: u8 = 2;

/// A failure to open or start the stream, by what the person can do about it.
fn open_failure(kind: cpal::ErrorKind) -> Failure {
    use cpal::ErrorKind as K;
    Failure::microphone(match kind {
        K::PermissionDenied => PRIVACY_ERROR,
        K::DeviceBusy => BUSY_ERROR,
        K::DeviceNotAvailable => "No microphone was found. Connect one and try again.",
        K::UnsupportedConfig => {
            "This microphone's format is unsupported. Select another input device in your system sound settings."
        }
        _ => MICROPHONE_ERROR,
    })
}

struct Capture {
    samples: Vec<f32>,
    limit: usize,
    level: f32,
}
impl Drop for Capture {
    fn drop(&mut self) {
        self.samples.zeroize();
    }
}
impl Capture {
    fn push<T: cpal::Sample>(&mut self, data: &[T], channels: usize)
    where
        f32: cpal::FromSample<T>,
    {
        let mut power = 0.0;
        let mut count = 0;
        for frame in data.chunks_exact(channels) {
            if self.samples.len() >= self.limit {
                break;
            }
            let sample = frame
                .iter()
                .map(|sample| sample.to_sample::<f32>())
                .sum::<f32>()
                / channels as f32;
            let sample = if sample.is_finite() {
                sample.clamp(-1.0, 1.0)
            } else {
                0.0
            };
            self.samples.push(sample);
            power += sample * sample;
            count += 1;
        }
        self.level = if count > 0 {
            (power / count as f32).sqrt()
        } else {
            0.0
        };
    }
}

pub fn run(
    root: &Path,
    operation: &Operation,
    language: Option<&str>,
) -> Result<DictationEvent, Failure> {
    if !cpu_supported() {
        return Err(Failure::unsupported());
    }
    if !operation.emit(DictationEvent::Preparing) {
        return Err(Failure::cancelled());
    }
    let path = model::path(root);
    model::verify(&path, operation)?;
    let context = load_context(&path)?;
    if operation.cancelled() {
        return Err(Failure::cancelled());
    }
    let (samples, rate) = record(operation)?;
    if operation.cancelled() {
        return Err(Failure::cancelled());
    }
    let audio = resample(&samples, rate).map_err(Failure::other)?;
    drop(samples);
    if !has_signal(&audio) {
        return Err(Failure::no_speech(
            "No speech was detected. Check that the right microphone is selected and not muted.",
        ));
    }
    if !operation.emit(DictationEvent::Transcribing { percent: 0 }) {
        return Err(Failure::cancelled());
    }
    transcribe(&context, &audio, operation, whisper_language(language))
        .map(|text| DictationEvent::Complete { text })
}

fn load_context(path: &Path) -> Result<WhisperContext, Failure> {
    // With no whisper-rs logging backend enabled these hooks discard native logs, including
    // debug-build token traces. Print flags alone do not prevent transcript text on stderr.
    whisper_rs::install_logging_hooks();
    let mut parameters = WhisperContextParameters::default();
    parameters.use_gpu(false);
    WhisperContext::new_with_params(path, parameters).map_err(|_| {
        Failure::model(
            "The dictation model could not be loaded. Download it again or free some memory.",
        )
    })
}

fn record(operation: &Operation) -> Result<(Zeroizing<Vec<f32>>, usize), Failure> {
    let host = cpal::default_host();
    let device = host.default_input_device().ok_or_else(|| {
        Failure::microphone("No microphone was found. Connect one and try again.")
    })?;
    let supported = device
        .default_input_config()
        .map_err(|error| open_failure(error.kind()))?;
    let config = supported.config();
    let rate = config.sample_rate as usize;
    if !(8_000..=192_000).contains(&rate) || !(1..=8).contains(&config.channels) {
        return Err(open_failure(cpal::ErrorKind::UnsupportedConfig));
    }
    let limit = rate * MAX_SECONDS as usize;
    let capture = Arc::new(Mutex::new(Capture {
        samples: Vec::with_capacity(limit),
        limit,
        level: 0.0,
    }));
    let fault = Arc::new(AtomicU8::new(FAULT_NONE));
    macro_rules! stream {
        ($sample:ty) => {
            input_stream::<$sample>(&device, config, capture.clone(), fault.clone())
        };
    }
    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => stream!(f32),
        cpal::SampleFormat::F64 => stream!(f64),
        cpal::SampleFormat::I8 => stream!(i8),
        cpal::SampleFormat::I16 => stream!(i16),
        cpal::SampleFormat::I32 => stream!(i32),
        cpal::SampleFormat::I64 => stream!(i64),
        cpal::SampleFormat::U8 => stream!(u8),
        cpal::SampleFormat::U16 => stream!(u16),
        cpal::SampleFormat::U32 => stream!(u32),
        cpal::SampleFormat::U64 => stream!(u64),
        _ => return Err(open_failure(cpal::ErrorKind::UnsupportedConfig)),
    }
    .map_err(|error| open_failure(error.kind()))?;
    stream.play().map_err(|error| open_failure(error.kind()))?;
    let began = Instant::now();
    let mut watch = Watchdog::new(began);
    loop {
        if operation.cancelled() {
            return Err(Failure::cancelled());
        }
        match fault.load(Ordering::Acquire) {
            FAULT_NONE => {}
            FAULT_PERMISSION => return Err(Failure::microphone(PRIVACY_ERROR)),
            _ => return Err(Failure::microphone(STOPPED_ERROR)),
        }
        let (count, level) = {
            let capture = lock(&capture);
            (capture.samples.len(), capture.level)
        };
        if !operation.emit(DictationEvent::Recording {
            seconds: (count / rate) as u32,
            level: (level * 8.0).clamp(0.0, 1.0),
            limit_seconds: MAX_SECONDS,
        }) {
            return Err(Failure::cancelled());
        }
        if operation.stop.load(Ordering::Acquire)
            || count >= limit
            || began.elapsed() >= Duration::from_secs(u64::from(MAX_SECONDS))
        {
            break;
        }
        if let Some(message) = watch.check(count, Instant::now()) {
            return Err(Failure::microphone(message));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    // Closing the native stream releases the microphone before any transcription begins.
    drop(stream);
    let samples = Zeroizing::new(std::mem::take(&mut lock(&capture).samples));
    Ok((samples, rate))
}

/// Notices a stream that never starts delivering audio, or stops partway: some drivers end a
/// stream without reporting an error.
struct Watchdog {
    began: Instant,
    last_count: usize,
    last_change: Instant,
}
impl Watchdog {
    fn new(began: Instant) -> Self {
        Self {
            began,
            last_count: 0,
            last_change: began,
        }
    }
    fn check(&mut self, count: usize, now: Instant) -> Option<&'static str> {
        if count != self.last_count {
            self.last_count = count;
            self.last_change = now;
            return None;
        }
        if count == 0 {
            (now.duration_since(self.began) > FIRST_AUDIO).then_some(MICROPHONE_ERROR)
        } else {
            (now.duration_since(self.last_change) > STALL).then_some(STOPPED_ERROR)
        }
    }
}

fn input_stream<T: cpal::SizedSample>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    capture: Arc<Mutex<Capture>>,
    fault: Arc<AtomicU8>,
) -> Result<cpal::Stream, cpal::Error>
where
    f32: cpal::FromSample<T>,
{
    let channels = usize::from(config.channels);
    device.build_input_stream(
        config,
        move |samples: &[T], _| lock(&capture).push(samples, channels),
        move |error: cpal::Error| {
            let code = stream_fault(error.kind());
            if code != FAULT_NONE {
                // Keep the first failure: the capture thread ends after it.
                let _ =
                    fault.compare_exchange(FAULT_NONE, code, Ordering::AcqRel, Ordering::Acquire);
            }
        },
        Some(Duration::from_secs(5)),
    )
}

/// Anti-aliased conversion to Whisper's mono 16 kHz input. Flush the FFT's delay, then trim
/// padding so the first and last words survive conversion from 44.1/48 kHz microphones.
fn resample(input: &[f32], rate: usize) -> Result<Zeroizing<Vec<f32>>, String> {
    if rate == SAMPLE_RATE {
        return Ok(Zeroizing::new(input.to_vec()));
    }
    let mut resampler = FftFixedInOut::<f32>::new(rate, SAMPLE_RATE, 1024, 1)
        .map_err(|_| "The microphone audio could not be converted.".to_string())?;
    let chunk = resampler.input_frames_next();
    let delay = resampler.output_delay();
    let length = input.len() * SAMPLE_RATE / rate;
    let mut result = Zeroizing::new(Vec::with_capacity(length + delay + 2048));
    for samples in input.chunks(chunk) {
        let converted = resampler
            .process_partial(Some(&[samples]), None)
            .map_err(|_| "The microphone audio could not be converted.".to_string())?;
        for mut channel in converted {
            result.extend_from_slice(&channel);
            channel.zeroize();
        }
    }
    while result.len() < length + delay {
        let converted = resampler
            .process_partial::<&[f32]>(None, None)
            .map_err(|_| "The microphone audio could not be converted.".to_string())?;
        for mut channel in converted {
            result.extend_from_slice(&channel);
            channel.zeroize();
        }
    }
    result.drain(..delay);
    result.truncate(length);
    Ok(result)
}

fn has_signal(audio: &[f32]) -> bool {
    audio.len() >= SAMPLE_RATE / 3 && audio.iter().any(|sample| sample.abs() > 0.002)
}

/// Whisper's code for the person's language (`en-US` becomes `en`), or `auto` when Whisper does
/// not know it. Whisper's own detection misreads short clips, so the system language comes first.
fn whisper_language(requested: Option<&str>) -> &'static str {
    let Some(tag) = requested else {
        return "auto";
    };
    let primary = tag
        .split(['-', '_'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    // Only plain ISO 639 codes reach whisper-rs, whose lookup panics on a NUL byte.
    if !(2..=3).contains(&primary.len()) || !primary.bytes().all(|byte| byte.is_ascii_lowercase()) {
        return "auto";
    }
    // Language tags whose Whisper name differs.
    let code = match primary.as_str() {
        "nb" => "no",
        "fil" => "tl",
        "jv" => "jw",
        "iw" => "he",
        "in" => "id",
        other => other,
    };
    whisper_rs::get_lang_id(code)
        .and_then(whisper_rs::get_lang_str)
        .unwrap_or("auto")
}

/// Decoder settings for one recording.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Decode {
    threads: i32,
    /// Encoder frames to process (50 per second); `None` encodes Whisper's full 30 s window.
    /// Shrinking it saved a third of the time but misheard words, so production keeps `None`.
    audio_ctx: Option<i32>,
    language: &'static str,
}

fn decode_threads() -> i32 {
    std::thread::available_parallelism().map_or(2, |n| n.get().min(MAX_THREADS)) as i32
}

fn transcribe(
    context: &WhisperContext,
    audio: &[f32],
    operation: &Operation,
    language: &'static str,
) -> Result<String, Failure> {
    transcribe_with(
        context,
        audio,
        operation,
        Decode {
            threads: decode_threads(),
            audio_ctx: None,
            language,
        },
    )
}

fn transcribe_with(
    context: &WhisperContext,
    audio: &[f32],
    operation: &Operation,
    decode: Decode,
) -> Result<String, Failure> {
    let mut state = context.create_state().map_err(|_| {
        Failure::other("Not enough memory to transcribe. Close other applications and retry.")
    })?;
    let mut parameters = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    parameters.set_n_threads(decode.threads);
    if let Some(frames) = decode.audio_ctx {
        parameters.set_audio_ctx(frames);
    }
    parameters.set_language(Some(decode.language));
    parameters.set_translate(false);
    parameters.set_no_context(true);
    parameters.set_no_timestamps(true);
    parameters.set_suppress_blank(true);
    parameters.set_suppress_nst(true);
    parameters.set_print_progress(false);
    parameters.set_print_realtime(false);
    parameters.set_print_timestamps(false);
    super::callbacks::run(&mut state, parameters, audio, operation)
        .map_err(|_| Failure::other("Dictation could not transcribe this recording. Try again."))?;
    if operation.cancelled() {
        return Err(Failure::cancelled());
    }
    // whisper.cpp already leaves out a segment it judges silent (no-speech probability above 0.6
    // and low confidence, OpenAI's rule). Dropping segments again on the probability alone threw
    // away clear speech.
    let mut text = String::new();
    for segment in state.as_iter() {
        // A token can end partway through a multi-byte character; keep the rest of the text.
        let part = segment
            .to_str_lossy()
            .map_err(|_| Failure::other("The transcription could not be read. Try again."))?;
        text.push_str(&part);
    }
    let text = without_annotations(&text);
    if text.is_empty() {
        return Err(Failure::no_speech(
            "No speech was detected. Try speaking closer to your microphone.",
        ));
    }
    Ok(text)
}

/// Removes Whisper's non-speech markers (`[BLANK_AUDIO]`, `[MUSIC]`), which are never dictation.
fn without_annotations(text: &str) -> String {
    let mut kept = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('[') {
        let Some(length) = rest[start..].find(']') else {
            break;
        };
        let inner = &rest[start + 1..start + length];
        kept.push_str(&rest[..start]);
        if inner.is_empty()
            || !inner
                .bytes()
                .all(|byte| byte.is_ascii_uppercase() || byte == b'_' || byte == b' ')
        {
            kept.push_str(&rest[start..=start + length]);
        }
        rest = &rest[start + length + 1..];
    }
    kept.push_str(rest);
    kept.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn downmix_normalizes_samples_and_bounds_memory() {
        let mut capture = Capture {
            samples: Vec::new(),
            limit: 2,
            level: 0.0,
        };
        capture.push(&[i16::MAX, i16::MIN, i16::MAX, i16::MAX, 0, 0], 2);
        assert_eq!(capture.samples.len(), 2);
        assert!(capture.samples[0].abs() < 0.001);
        assert!(capture.samples[1] > 0.99);
        let mut floats = Capture {
            samples: Vec::new(),
            limit: 10,
            level: 0.0,
        };
        floats.push(&[f32::NAN, f32::INFINITY, 2.0], 1);
        assert_eq!(floats.samples, vec![0.0, 0.0, 1.0]);
    }
    #[test]
    fn glitches_and_reroutes_keep_recording_and_failures_end_it() {
        use cpal::ErrorKind as K;
        // The Windows regression: an early Xrun ended every recording at once.
        for kind in [K::Xrun, K::DeviceChanged, K::RealtimeDenied] {
            assert_eq!(stream_fault(kind), FAULT_NONE, "{kind:?}");
        }
        assert_eq!(stream_fault(K::PermissionDenied), FAULT_PERMISSION);
        for kind in [
            K::DeviceNotAvailable,
            K::StreamInvalidated,
            K::BackendError,
            K::Other,
        ] {
            assert_eq!(stream_fault(kind), FAULT_STOPPED, "{kind:?}");
        }
        assert_eq!(open_failure(K::PermissionDenied).message, PRIVACY_ERROR);
        assert_eq!(open_failure(K::DeviceBusy).message, BUSY_ERROR);
        assert_eq!(
            open_failure(K::BackendError).reason,
            super::super::DictationFailure::Microphone
        );
    }

    #[test]
    fn the_watchdog_notices_a_stream_that_never_starts_or_stalls() {
        let began = Instant::now();
        let at = |ms: u64| began + Duration::from_millis(ms);
        let mut quiet = Watchdog::new(began);
        assert_eq!(quiet.check(0, at(4_900)), None);
        assert_eq!(quiet.check(0, at(5_100)), Some(MICROPHONE_ERROR));
        let mut stalled = Watchdog::new(began);
        assert_eq!(stalled.check(4_800, at(100)), None);
        assert_eq!(stalled.check(9_600, at(200)), None);
        assert_eq!(stalled.check(9_600, at(3_100)), None);
        assert_eq!(stalled.check(9_600, at(3_300)), Some(STOPPED_ERROR));
        let mut steady = Watchdog::new(began);
        for tick in 1..100 {
            assert_eq!(steady.check(tick * 4_800, at(tick as u64 * 100)), None);
        }
    }

    #[test]
    fn the_system_language_is_mapped_to_whisper_or_detected() {
        assert_eq!(whisper_language(Some("en-US")), "en");
        assert_eq!(whisper_language(Some("pt_BR")), "pt");
        assert_eq!(whisper_language(Some("zh-Hant-TW")), "zh");
        assert_eq!(whisper_language(Some("nb-NO")), "no");
        assert_eq!(whisper_language(Some("DE")), "de");
        assert_eq!(whisper_language(None), "auto");
        for unknown in ["xx", "english", "", "e\0n", "-", "en\u{0}-US"] {
            assert_eq!(whisper_language(Some(unknown)), "auto", "{unknown:?}");
        }
    }

    #[test]
    fn non_speech_markers_are_removed_and_text_is_kept() {
        assert_eq!(without_annotations(" [BLANK_AUDIO]"), "");
        assert_eq!(without_annotations("Hello [MUSIC] world."), "Hello world.");
        assert_eq!(without_annotations("[Laughter] fine"), "[Laughter] fine");
        assert_eq!(
            without_annotations("an array [i] here"),
            "an array [i] here"
        );
        assert_eq!(without_annotations("open [ bracket"), "open [ bracket");
        assert_eq!(without_annotations("  spaced   out  "), "spaced out");
    }

    #[test]
    fn silence_and_too_short_audio_are_not_transcribed() {
        assert!(!has_signal(&vec![0.0; SAMPLE_RATE]));
        assert!(!has_signal(&[0.2; 50]));
        assert!(has_signal(&vec![0.2; SAMPLE_RATE]));
    }
    #[test]
    fn resampling_preserves_duration_and_speech_band_signal() {
        for rate in [16_000, 44_100, 48_000, 96_000] {
            let input: Vec<f32> = (0..rate)
                .map(|n| (n as f32 * 440.0 * std::f32::consts::TAU / rate as f32).sin() * 0.2)
                .collect();
            let output = resample(&input, rate).unwrap();
            assert_eq!(output.len(), SAMPLE_RATE);
            assert!(has_signal(&output));
            let rms = (output.iter().map(|sample| sample * sample).sum::<f32>()
                / SAMPLE_RATE as f32)
                .sqrt();
            assert!((0.13..0.15).contains(&rms), "{rate}: {rms}");
        }
    }

    /// 16 kHz mono signed 16-bit PCM from a fixture WAV. Not a general WAV decoder.
    fn fixture_pcm(path: &Path) -> Vec<f32> {
        let wav = std::fs::read(path).expect("fixture WAV");
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        let mut cursor = 12;
        let mut pcm = None;
        while cursor + 8 <= wav.len() {
            let size = u32::from_le_bytes(wav[cursor + 4..cursor + 8].try_into().unwrap()) as usize;
            if &wav[cursor..cursor + 4] == b"data" {
                pcm = Some(&wav[cursor + 8..(cursor + 8 + size).min(wav.len())]);
                break;
            }
            cursor += 8 + size + size % 2;
        }
        pcm.expect("PCM data")
            .as_chunks::<2>()
            .0
            .iter()
            .map(|sample| f32::from(i16::from_le_bytes([sample[0], sample[1]])) / 32768.0)
            .collect()
    }

    fn fixture_root() -> std::path::PathBuf {
        std::path::PathBuf::from(
            std::env::var_os("AURACODE_DICTATION_FIXTURE_DIR")
                .expect("explicit scratch fixture directory"),
        )
    }

    /// Opt-in timing: transcribes every 16 kHz mono `*.wav` in the fixture folder with the
    /// production parameters and prints how long each took. Needs the model in the fixture
    /// folder already (run `offline_model_fixture` once).
    #[test]
    #[ignore = "requires AURACODE_DICTATION_FIXTURE_DIR with WAVs and the model"]
    fn offline_model_timing() {
        let root = fixture_root();
        let service = Arc::new(super::super::Dictation::default());
        let operation = service
            .begin(
                "timing",
                uuid::Uuid::new_v4().to_string(),
                Arc::new(|_| true),
                Box::new(|| true),
            )
            .unwrap();
        let began = std::time::Instant::now();
        model::verify(&model::path(&root), &operation).expect("model digest");
        let context = load_context(&model::path(&root)).expect("CPU model");
        println!("verify+load: {:?}", began.elapsed());
        let mut wavs: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "wav"))
            .collect();
        wavs.sort();
        for wav in wavs {
            let audio = fixture_pcm(&wav);
            let seconds = audio.len() as f32 / SAMPLE_RATE as f32;
            for threads in [4, decode_threads()] {
                let began = std::time::Instant::now();
                let text = transcribe_with(
                    &context,
                    &audio,
                    &operation,
                    Decode {
                        threads,
                        audio_ctx: None,
                        language: "en",
                    },
                );
                let audio_ctx: Option<i32> = None;
                println!(
                    "{} ({seconds:.1}s) threads={threads} audio_ctx={audio_ctx:?}: {:?} {text:?}",
                    wav.file_name().unwrap().to_string_lossy(),
                    began.elapsed()
                );
            }
        }
    }

    /// Opt-in engine acceptance, separate from microphone hardware verification. The fixture
    /// folder must contain upstream whisper.cpp's 16 kHz PCM `jfk.wav`. The production downloader
    /// installs the pinned model there if missing; subsequent runs need no network connection.
    #[tokio::test]
    #[ignore = "requires AURACODE_DICTATION_FIXTURE_DIR with jfk.wav; downloads 142 MiB once"]
    async fn offline_model_fixture() {
        let root = fixture_root();
        let audio = fixture_pcm(&root.join("jfk.wav"));
        let service = Arc::new(super::super::Dictation::default());
        let operation = service
            .begin(
                "fixture",
                uuid::Uuid::new_v4().to_string(),
                Arc::new(|_| true),
                Box::new(|| true),
            )
            .unwrap();
        if !model::status(&root).installed {
            model::download(root.clone(), &operation)
                .await
                .expect("verified model download");
        }
        model::verify(&model::path(&root), &operation).expect("model digest");
        let context = load_context(&model::path(&root)).expect("CPU model");
        let result = transcribe(
            &context,
            &audio,
            &operation,
            whisper_language(Some("en-US")),
        )
        .expect("offline transcription");
        assert!(
            result
                .to_lowercase()
                .contains("ask not what your country can do for you"),
            "{result}"
        );
        // Cancel after inference starts, exercising the native callback bridge, not just the
        // controller. No text may escape a cancelled operation.
        let cancel = operation.cancel.clone();
        std::thread::scope(|scope| {
            scope.spawn(move || {
                std::thread::sleep(Duration::from_millis(250));
                cancel.cancel();
            });
            assert!(transcribe(&context, &audio, &operation, "en").is_err());
        });
    }
}
