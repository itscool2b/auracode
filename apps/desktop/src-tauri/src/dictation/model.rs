use super::{DictationEvent, DictationModel, Operation};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

// Upstream GGML conversion of multilingual Whisper base. Pin both revision and LFS SHA-256.
// https://huggingface.co/ggerganov/whisper.cpp/blob/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin
pub const MODEL_BYTES: u32 = 147_951_465;
const MODEL_SHA256: &str = "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe";
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin";

pub fn path(root: &Path) -> PathBuf {
    root.join("models").join("dictation").join("ggml-base.bin")
}
pub fn status(root: &Path) -> DictationModel {
    DictationModel {
        installed: std::fs::metadata(path(root))
            .is_ok_and(|m| m.is_file() && m.len() == u64::from(MODEL_BYTES)),
        name: "Whisper base (multilingual)".into(),
        bytes: MODEL_BYTES,
    }
}
pub fn verify(path: &Path, operation: &Operation) -> Result<(), String> {
    let mut file = std::fs::File::open(path)
        .map_err(|_| "Download the dictation model before recording.".to_string())?;
    let mut digest = Sha256::new();
    let mut bytes = 0u64;
    let mut buffer = [0u8; 65536];
    loop {
        if operation.cancelled() {
            return Err("Dictation cancelled.".into());
        }
        let count = file
            .read(&mut buffer)
            .map_err(|_| "The dictation model could not be read. Download it again.".to_string())?;
        if count == 0 {
            break;
        }
        bytes += count as u64;
        if bytes > u64::from(MODEL_BYTES) {
            return Err("The dictation model is damaged. Download it again.".into());
        }
        digest.update(&buffer[..count]);
    }
    validate(
        bytes,
        &format!("{:x}", digest.finalize()),
        u64::from(MODEL_BYTES),
        MODEL_SHA256,
    )
}
fn validate(
    bytes: u64,
    hash: &str,
    expected_bytes: u64,
    expected_hash: &str,
) -> Result<(), String> {
    if bytes != expected_bytes || hash != expected_hash {
        return Err(
            "The dictation model did not pass its integrity check. Download it again.".into(),
        );
    }
    Ok(())
}

pub async fn download(root: PathBuf, operation: &Operation) -> Result<DictationEvent, String> {
    let path = path(&root);
    let directory = path.parent().ok_or("The model folder is unavailable.")?;
    std::fs::create_dir_all(directory).map_err(|_| {
        "The model folder could not be created. Check disk access and space.".to_string()
    })?;
    // The random temporary file is removed on failure/cancel. A valid model is replaced only
    // after the entire new file passes its size and digest check, on the same filesystem.
    let mut temporary = tempfile::NamedTempFile::new_in(directory)
        .map_err(|_| "The model download could not be saved. Check disk space.".to_string())?;
    let client = reqwest::Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(1800))
        .build()
        .map_err(|_| "The model downloader could not start.".to_string())?;
    let mut response = tokio::select! {
        _ = operation.cancel.cancelled() => return Err("Download cancelled.".into()),
        response = client.get(MODEL_URL).send() => response.map_err(|_| "The model could not be downloaded. Check your connection and retry.".to_string())?
            .error_for_status().map_err(|_| "The model server refused the download. Try again later.".to_string())?,
    };
    let mut received = 0u64;
    let mut digest = Sha256::new();
    let mut last = std::time::Instant::now() - Duration::from_secs(1);
    loop {
        if operation.cancelled() {
            return Err("Download cancelled.".into());
        }
        let chunk = tokio::select! {
            _ = operation.cancel.cancelled() => return Err("Download cancelled.".into()),
            chunk = response.chunk() => chunk.map_err(|_| "The model download was interrupted. Retry when connected.".to_string())?,
        };
        let Some(chunk) = chunk else {
            break;
        };
        received += chunk.len() as u64;
        if received > u64::from(MODEL_BYTES) {
            return Err("The model server returned an unexpected file.".into());
        }
        temporary
            .write_all(&chunk)
            .map_err(|_| "The model could not be saved. Check disk space and retry.".to_string())?;
        digest.update(&chunk);
        if last.elapsed() >= Duration::from_millis(100) {
            if !operation.emit(DictationEvent::Downloading {
                received: received as u32,
                total: MODEL_BYTES,
            }) {
                return Err("Download cancelled.".into());
            }
            last = std::time::Instant::now();
        }
    }
    validate(
        received,
        &format!("{:x}", digest.finalize()),
        u64::from(MODEL_BYTES),
        MODEL_SHA256,
    )?;
    if operation.cancelled() {
        return Err("Download cancelled.".into());
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| "The model could not be saved to disk.".to_string())?;
    temporary.persist(path).map_err(|_| {
        "The model could not be installed. Check folder access and retry.".to_string()
    })?;
    Ok(DictationEvent::ModelReady)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn both_size_and_digest_must_match() {
        assert!(validate(3, "abc", 3, "abc").is_ok());
        assert!(validate(2, "abc", 3, "abc").is_err());
        assert!(validate(3, "bad", 3, "abc").is_err());
        assert!(validate(4, "abc", 3, "abc").is_err());
    }
    #[test]
    fn a_partial_download_is_not_installed() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(path(root.path()).parent().unwrap()).unwrap();
        std::fs::write(path(root.path()), b"partial").unwrap();
        assert!(!status(root.path()).installed);
        assert!(!path(root.path()).starts_with(root.path().join("profiles")));
    }
}
