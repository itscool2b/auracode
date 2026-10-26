//! Bounded, integrity-checked reads of explicit composer imports from the private profile.
use aura_protocol::PromptPart;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};
use std::{fs, io::Read, path::Path};

pub const MAX_IMAGE_BYTES: usize = 4 * 1024 * 1024;

pub trait AttachmentReader: std::fmt::Debug + Send + Sync {
    fn read(&self, hash: &str, limit: usize) -> Result<Vec<u8>, String>;
}

/// A reader is authoritative, including failures. Every backend still passes the same byte bound
/// and content-hash validation before anything reaches a vendor process.
pub fn read_from(
    dir: Option<&Path>,
    reader: Option<&dyn AttachmentReader>,
    hash: &str,
    limit: usize,
) -> Result<Vec<u8>, String> {
    if !valid_hash(hash) {
        return Err("The attachment identifier is invalid.".into());
    }
    let bytes = match reader {
        Some(reader) => reader.read(hash, limit)?,
        None => {
            return read(
                dir.ok_or("This session cannot access saved attachments.")?,
                hash,
                limit,
            );
        }
    };
    if bytes.len() > limit || format!("{:x}", Sha256::digest(&bytes)) != hash {
        return Err("The saved attachment changed. Attach the original file again.".into());
    }
    Ok(bytes)
}

fn valid_hash(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub fn read(dir: &Path, hash: &str, limit: usize) -> Result<Vec<u8>, String> {
    if !valid_hash(hash) {
        return Err("The attachment identifier is invalid.".into());
    }
    let path = dir.join(hash);
    let metadata = fs::symlink_metadata(&path)
        .map_err(|_| "The attachment is no longer available. Attach it again.")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > limit as u64 {
        return Err("The saved attachment is not a supported file.".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    fs::File::open(path)
        .and_then(|file| file.take(limit as u64 + 1).read_to_end(&mut bytes))
        .map_err(|_| "The attachment could not be read.")?;
    if bytes.len() > limit || format!("{:x}", Sha256::digest(&bytes)) != hash {
        return Err("The saved attachment changed. Attach the original file again.".into());
    }
    Ok(bytes)
}

pub fn image(dir: Option<&Path>, hash: &str, mime: &str) -> Result<String, String> {
    image_from(dir, None, hash, mime)
}
fn image_from(
    dir: Option<&Path>,
    reader: Option<&dyn AttachmentReader>,
    hash: &str,
    mime: &str,
) -> Result<String, String> {
    if mime != "image/png" {
        return Err("The attachment must be a normalized PNG image.".into());
    }
    let bytes = read_from(dir, reader, hash, MAX_IMAGE_BYTES)?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("The saved image has an invalid format.".into());
    }
    Ok(STANDARD.encode(bytes))
}

/// Native SDK content. Text-only prompts retain their original wire representation.
pub fn claude(parts: &[PromptPart], dir: Option<&Path>) -> Result<Value, String> {
    claude_with_reader(parts, dir, None)
}
pub fn claude_with_reader(
    parts: &[PromptPart],
    dir: Option<&Path>,
    reader: Option<&dyn AttachmentReader>,
) -> Result<Value, String> {
    let mut content = Vec::new();
    let mut text = String::new();
    let mut has_image = false;
    for part in parts {
        match part {
            PromptPart::Text { text: value } => {
                text.push_str(value);
                content.push(json!({"type":"text","text":value}));
            }
            PromptPart::Mention { path } => {
                let value = format!("\n@{path}");
                text.push_str(&value);
                content.push(json!({"type":"text","text":value}));
            }
            PromptPart::Image { blob, mime } => {
                has_image = true;
                content.push(json!({"type":"image","source":{"type":"base64","media_type":mime,"data":image_from(dir,reader,blob,mime)?}}));
            }
        }
    }
    Ok(if has_image {
        json!(content)
    } else {
        json!(text)
    })
}

pub fn codex(parts: &[PromptPart], dir: Option<&Path>) -> Result<Vec<Value>, String> {
    codex_with_reader(parts, dir, None)
}
pub fn codex_with_reader(
    parts: &[PromptPart],
    dir: Option<&Path>,
    reader: Option<&dyn AttachmentReader>,
) -> Result<Vec<Value>, String> {
    parts.iter().map(|part| Ok(match part {
        PromptPart::Text { text } => json!({"type":"text","text":text}),
        PromptPart::Mention { path } => json!({"type":"mention","name":path,"path":path}),
        PromptPart::Image { blob, mime } => json!({"type":"image","url":format!("data:{mime};base64,{}",image_from(dir,reader,blob,mime)?)}),
    })).collect()
}

pub fn acp(parts: &[PromptPart], dir: Option<&Path>, images: bool) -> Result<Vec<Value>, String> {
    acp_with_reader(parts, dir, None, images)
}
pub fn acp_with_reader(
    parts: &[PromptPart],
    dir: Option<&Path>,
    reader: Option<&dyn AttachmentReader>,
    images: bool,
) -> Result<Vec<Value>, String> {
    parts.iter().map(|part| Ok(match part {
        PromptPart::Text { text } => json!({"type":"text","text":text}),
        PromptPart::Mention { path } => json!({"type":"text","text":format!("\n@{path}")}),
        PromptPart::Image { blob, mime } => {
            if !images { return Err("This agent did not advertise image support. Remove the image or choose another agent.".into()); }
            json!({"type":"image","mimeType":mime,"data":image_from(dir,reader,blob,mime)?})
        }
    })).collect()
}

pub fn pi(parts: &[PromptPart], dir: Option<&Path>) -> Result<Value, String> {
    pi_with_reader(parts, dir, None)
}
pub fn pi_with_reader(
    parts: &[PromptPart],
    dir: Option<&Path>,
    reader: Option<&dyn AttachmentReader>,
) -> Result<Value, String> {
    let blocks = acp_with_reader(parts, dir, reader, true)?;
    let text: Vec<&str> = blocks
        .iter()
        .filter_map(|block| block["text"].as_str())
        .collect();
    let images: Vec<&Value> = blocks
        .iter()
        .filter(|block| block["type"] == "image")
        .collect();
    let mut request = json!({"type":"prompt","message":text.join("\n")});
    if !images.is_empty() {
        request["images"] = json!(images);
    }
    Ok(request)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug)]
    struct Memory(Result<Vec<u8>, String>);
    impl AttachmentReader for Memory {
        fn read(&self, _: &str, _: usize) -> Result<Vec<u8>, String> {
            self.0.clone()
        }
    }
    #[test]
    fn native_images_resolve_from_memory_and_reader_errors_never_fall_back_to_disk() {
        let png = b"\x89PNG\r\n\x1a\nsynthetic image".to_vec();
        let hash = format!("{:x}", Sha256::digest(&png));
        let parts = [PromptPart::Image {
            blob: hash.clone(),
            mime: "image/png".into(),
        }];
        let reader = Memory(Ok(png.clone()));
        let encoded = STANDARD.encode(&png);
        assert_eq!(
            claude_with_reader(&parts, None, Some(&reader)).unwrap()[0]["source"]["data"],
            encoded
        );
        assert_eq!(
            acp_with_reader(&parts, None, Some(&reader), true).unwrap()[0]["data"],
            encoded
        );
        assert_eq!(
            codex_with_reader(&parts, None, Some(&reader)).unwrap()[0]["url"],
            format!("data:image/png;base64,{encoded}")
        );
        assert_eq!(
            pi_with_reader(&parts, None, Some(&reader)).unwrap()["images"][0]["data"],
            encoded
        );
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join(&hash), &png).unwrap();
        let unavailable = Memory(Err("encrypted read refused".into()));
        assert_eq!(
            read_from(
                Some(temp.path()),
                Some(&unavailable),
                &hash,
                MAX_IMAGE_BYTES
            )
            .unwrap_err(),
            "encrypted read refused"
        );
        assert!(read_from(None, Some(&reader), &hash, 1).is_err());
        assert!(
            read_from(
                None,
                Some(&Memory(Ok(b"changed".to_vec()))),
                &hash,
                MAX_IMAGE_BYTES
            )
            .is_err()
        );
    }

    #[test]
    fn native_payloads_preserve_text_and_visible_mentions() {
        let parts = vec![
            PromptPart::Text {
                text: "Review".into(),
            },
            PromptPart::Mention {
                path: "/project/main.rs".into(),
            },
        ];
        assert_eq!(
            claude(&parts, None).expect("text"),
            "Review\n@/project/main.rs"
        );
        assert_eq!(
            codex(&parts, None).expect("text")[1],
            json!({"type":"mention","name":"/project/main.rs","path":"/project/main.rs"})
        );
        assert_eq!(
            acp(&parts, None, false).expect("text")[1]["text"],
            "\n@/project/main.rs"
        );
        assert!(
            !pi(&parts, None)
                .expect("text")
                .as_object()
                .expect("object")
                .contains_key("images")
        );
    }

    #[test]
    fn unsupported_missing_or_traversing_images_are_explicit_errors() {
        let parts = [PromptPart::Image {
            blob: "../secret".into(),
            mime: "image/png".into(),
        }];
        assert!(
            acp(&parts, None, false)
                .expect_err("unsupported")
                .contains("advertise")
        );
        assert!(claude(&parts, None).is_err());
        assert!(codex(&parts, None).is_err());
        assert!(pi(&parts, None).is_err());
        assert!(read(Path::new("."), "../secret", 100).is_err());
    }
}
