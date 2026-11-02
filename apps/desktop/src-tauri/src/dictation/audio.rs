use super::{DictationEvent, Operation, model};
use crate::sync::lock;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rubato::{FftFixedInOut, Resampler};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
use zeroize::{Zeroize, Zeroizing};

const SAMPLE_RATE: usize = 16_000;
const MAX_SECONDS: u32 = 120;
const MICROPHONE_ERROR: &str = "The microphone could not be opened. Allow microphone access in system privacy settings and check your default input device.";

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

pub fn run(root: &Path, operation: &Operation) -> Result<DictationEvent, String> {
    if !operation.emit(DictationEvent::Preparing) {
        return Err("Dictation cancelled.".into());
    }
    let path = model::path(root);
    model::verify(&path, operation)?;
    let context = load_context(&path)?;
    if operation.cancelled() {
        return Err("Dictation cancelled.".into());
    }
    let (samples, rate) = record(operation)?;
    if operation.cancelled() {
        return Err("Dictation cancelled.".into());
    }
    let audio = resample(&samples, rate)?;
    drop(samples);
    if !has_signal(&audio) {
        return Err("No speech was detected. Check your microphone and try again.".into());
    }
    if !operation.emit(DictationEvent::Transcribing { percent: 0 }) {
        return Err("Dictation cancelled.".into());
    }
    transcribe(&context, &audio, operation).map(|text| DictationEvent::Complete { text })
}

fn load_context(path: &Path) -> Result<WhisperContext, String> {
    // With no whisper-rs logging backend enabled these hooks discard native logs, including
    // debug-build token traces. Print flags alone do not prevent transcript text on stderr.
    whisper_rs::install_logging_hooks();
    let mut parameters = WhisperContextParameters::default();
    parameters.use_gpu(false);
    WhisperContext::new_with_params(path, parameters).map_err(|_| {
        "The dictation model could not be loaded. Download it again or free some memory.".into()
    })
}

fn record(operation: &Operation) -> Result<(Zeroizing<Vec<f32>>, usize), String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("No microphone was found. Connect one and try again.")?;
    let supported = device
        .default_input_config()
        .map_err(|_| MICROPHONE_ERROR.to_string())?;
    let config = supported.config();
    let rate = config.sample_rate as usize;
    if !(8_000..=192_000).contains(&rate) || !(1..=8).contains(&config.channels) {
        return Err("This microphone's format is unsupported. Select a standard input device in system sound settings.".into());
    }
    let limit = rate * MAX_SECONDS as usize;
    let capture = Arc::new(Mutex::new(Capture {
        samples: Vec::with_capacity(limit),
        limit,
        level: 0.0,
    }));
    let failed = Arc::new(AtomicBool::new(false));
    macro_rules! stream {
        ($sample:ty) => {
            input_stream::<$sample>(&device, config, capture.clone(), failed.clone())
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
        _ => return Err(
            "This microphone's sample format is unsupported. Select another default input device."
                .into(),
        ),
    }
    .map_err(|_| MICROPHONE_ERROR.to_string())?;
    stream.play().map_err(|_| MICROPHONE_ERROR.to_string())?;
    let began = std::time::Instant::now();
    loop {
        if operation.cancelled() {
            return Err("Dictation cancelled.".into());
        }
        if failed.load(Ordering::Acquire) {
            return Err(
                "The microphone disconnected or stopped responding. Reconnect it and try again."
                    .into(),
            );
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
            return Err("Dictation cancelled.".into());
        }
        if operation.stop.load(Ordering::Acquire)
            || count >= limit
            || began.elapsed() >= Duration::from_secs(u64::from(MAX_SECONDS))
        {
            break;
        }
        if count == 0 && began.elapsed() > Duration::from_secs(5) {
            return Err(MICROPHONE_ERROR.into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    // Closing the native stream releases the microphone before any transcription begins.
    drop(stream);
    let samples = Zeroizing::new(std::mem::take(&mut lock(&capture).samples));
    Ok((samples, rate))
}

fn input_stream<T: cpal::SizedSample>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    capture: Arc<Mutex<Capture>>,
    failed: Arc<AtomicBool>,
) -> Result<cpal::Stream, cpal::Error>
where
    f32: cpal::FromSample<T>,
{
    let channels = usize::from(config.channels);
    device.build_input_stream(
        config,
        move |samples: &[T], _| lock(&capture).push(samples, channels),
        move |_| failed.store(true, Ordering::Release),
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

fn transcribe(
    context: &WhisperContext,
    audio: &[f32],
    operation: &Operation,
) -> Result<String, String> {
    let mut state = context.create_state().map_err(|_| {
        "Not enough memory to transcribe. Close other applications and retry.".to_string()
    })?;
    let mut parameters = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    parameters
        .set_n_threads(std::thread::available_parallelism().map_or(2, |n| n.get().min(4)) as i32);
    parameters.set_language(Some("auto"));
    parameters.set_translate(false);
    parameters.set_no_context(true);
    parameters.set_no_timestamps(true);
    parameters.set_suppress_blank(true);
    parameters.set_suppress_nst(true);
    parameters.set_print_progress(false);
    parameters.set_print_realtime(false);
    parameters.set_print_timestamps(false);
    super::callbacks::run(&mut state, parameters, audio, operation)
        .map_err(|_| "Dictation could not transcribe this recording. Try again.".to_string())?;
    if operation.cancelled() {
        return Err("Dictation cancelled.".into());
    }
    let mut text = String::new();
    for segment in state.as_iter() {
        if segment.no_speech_probability() >= 0.6 {
            continue;
        }
        text.push_str(
            segment
                .to_str()
                .map_err(|_| "The transcription could not be read. Try again.".to_string())?,
        );
    }
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("No speech was detected. Try speaking closer to your microphone.".into());
    }
    Ok(text)
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

    /// Opt-in engine acceptance, separate from microphone hardware verification. The fixture
    /// folder must contain upstream whisper.cpp's 16 kHz PCM `jfk.wav`. The production downloader
    /// installs the pinned model there if missing; subsequent runs need no network connection.
    #[tokio::test]
    #[ignore = "requires AURACODE_DICTATION_FIXTURE_DIR with jfk.wav; downloads 142 MiB once"]
    async fn offline_model_fixture() {
        let root = std::path::PathBuf::from(
            std::env::var_os("AURACODE_DICTATION_FIXTURE_DIR")
                .expect("explicit scratch fixture directory"),
        );
        let wav = std::fs::read(root.join("jfk.wav")).expect("upstream jfk.wav fixture");
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        let mut cursor = 12;
        let mut pcm = None;
        while cursor + 8 <= wav.len() {
            let size = u32::from_le_bytes(wav[cursor + 4..cursor + 8].try_into().unwrap()) as usize;
            if &wav[cursor..cursor + 4] == b"data" {
                pcm = Some(&wav[cursor + 8..cursor + 8 + size]);
                break;
            }
            cursor += 8 + size + size % 2;
        }
        let audio: Vec<f32> = pcm
            .expect("PCM data")
            .as_chunks::<2>()
            .0
            .iter()
            .map(|sample| f32::from(i16::from_le_bytes([sample[0], sample[1]])) / 32768.0)
            .collect();
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
        let result = transcribe(&context, &audio, &operation).expect("offline transcription");
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
            assert!(transcribe(&context, &audio, &operation).is_err());
        });
    }
}
