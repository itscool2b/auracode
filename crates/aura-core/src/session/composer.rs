//! Explicit, bounded context imports. File discovery never reads file contents.
use super::*;
use crate::chatstore::composer::ComposerCommand;
use aura_protocol::{
    PromptPart,
    composer::{ComposerAttachment, ComposerInput, FileMention},
};
use sha2::{Digest as _, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{Cursor, Read},
    path::Component,
};

const MAX_IMPORT: usize = 12 * 1024 * 1024;
const MAX_TEXT: usize = 256 * 1024;
const MAX_ITEMS: usize = 8;

fn invalid(message: impl Into<String>) -> SessionError {
    SessionError::OptionInvalid(message.into())
}

impl SessionManager {
    /// Only call after an explicit file picker, drop or paste action by the user.
    pub async fn composer_import(
        &self,
        chat_id: &str,
        path: PathBuf,
    ) -> Result<ComposerAttachment, SessionError> {
        self.composer_folder(chat_id).await?;
        let (name, mime, bytes) = self
            .deps()
            .rt
            .spawn_blocking(move || import_file(&path))
            .await
            .map_err(|_| invalid("The attachment could not be prepared."))??;
        self.composer_store(chat_id, name, mime, bytes).await
    }

    /// Clipboard images have no source path; the same image limits and normalization still apply.
    pub async fn composer_paste(
        &self,
        chat_id: &str,
        bytes: Vec<u8>,
    ) -> Result<ComposerAttachment, SessionError> {
        self.composer_folder(chat_id).await?;
        let bytes = self
            .deps()
            .rt
            .spawn_blocking(move || normalize_image(&bytes))
            .await
            .map_err(|_| invalid("The image could not be prepared."))??;
        self.composer_store(
            chat_id,
            "Pasted image.png".into(),
            "image/png".into(),
            bytes,
        )
        .await
    }

    async fn composer_store(
        &self,
        chat_id: &str,
        name: String,
        mime: String,
        bytes: Vec<u8>,
    ) -> Result<ComposerAttachment, SessionError> {
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        self.deps()
            .store
            .composer(ComposerCommand::Import {
                chat_id: chat_id.into(),
                name,
                mime,
                sha256,
                bytes: bytes.into(),
            })
            .await
            .map_err(|e| invalid(e.to_string()))?
            .pop()
            .map(|item| item.meta)
            .ok_or_else(|| invalid("The attachment could not be saved."))
    }

    pub async fn composer_mentions(
        &self,
        chat_id: &str,
        query: String,
    ) -> Result<Vec<FileMention>, SessionError> {
        if query.len() > 256 {
            return Err(invalid("Search with a shorter file name."));
        }
        let folder = self.composer_folder(chat_id).await?;
        self.deps()
            .rt
            .spawn_blocking(move || search(&folder, &query))
            .await
            .map_err(|_| invalid("The project files could not be searched."))?
    }

    pub async fn composer_send(
        &self,
        chat_id: &str,
        input: ComposerInput,
    ) -> Result<PromptAck, SessionError> {
        if self.shared().is_shutting_down() {
            return Err(SessionError::ShuttingDown);
        }
        if input.attachments.len() > MAX_ITEMS || input.mentions.len() > 32 {
            return Err(invalid(
                "Send up to eight attachments and 32 file mentions at a time.",
            ));
        }
        let limit = self.deps().limits.max_prompt_bytes;
        if input.text.len() > limit {
            return Err(SessionError::PromptTooLarge {
                bytes: input.text.len(),
                limit,
            });
        }
        if input.attachments.iter().any(|id| id.len() > 128) {
            return Err(invalid("An attachment identifier is invalid."));
        }
        let folder = self.composer_folder(chat_id).await?;
        let dir = self.deps().store.attachment_dir().to_path_buf();
        let attachments = self
            .deps()
            .store
            .composer(ComposerCommand::Resolve {
                chat_id: chat_id.into(),
                ids: input.attachments,
            })
            .await
            .map_err(|e| invalid(e.to_string()))?;
        let (text, parts) = self
            .deps()
            .rt
            .spawn_blocking(move || {
                let mut display = input.text.clone();
                let mut parts = if input.text.is_empty() {
                    Vec::new()
                } else {
                    vec![PromptPart::Text { text: input.text }]
                };
                let mut payload_bytes = display.len();
                let mut image_bytes = 0usize;
                let mut seen = HashSet::new();
                for attachment in attachments {
                    if !seen.insert(attachment.meta.id) {
                        continue;
                    }
                    let bytes = aura_drivers::attachments::read(
                        &dir,
                        &attachment.sha256,
                        if attachment.meta.image {
                            aura_drivers::attachments::MAX_IMAGE_BYTES
                        } else {
                            MAX_TEXT
                        },
                    )
                    .map_err(invalid)?;
                    if attachment.meta.image {
                        image_bytes += bytes.len();
                        if image_bytes > 8 * 1024 * 1024 {
                            return Err(invalid(
                                "The images exceed the 8 MiB message limit. Send fewer images.",
                            ));
                        }
                        display.push_str(&format!("\n\n[Image: {}]", attachment.meta.name));
                        parts.push(PromptPart::Image {
                            blob: attachment.sha256,
                            mime: attachment.meta.mime,
                        });
                    } else {
                        let text = String::from_utf8(bytes).map_err(|_| {
                            invalid("This attachment is no longer valid UTF-8 text.")
                        })?;
                        // The transcript includes exactly the text context the agent receives.
                        let context =
                            format!("\n\nAttached file: {}\n{}", attachment.meta.name, text);
                        payload_bytes += context.len();
                        display.push_str(&context);
                        parts.push(PromptPart::Text { text: context });
                    }
                }
                for mention in input.mentions {
                    let absolute = checked_mention(&folder, &mention)?;
                    let path = absolute.to_string_lossy().into_owned();
                    payload_bytes += path.len() + 2;
                    display.push_str(&format!("\n@{mention}"));
                    parts.push(PromptPart::Mention { path });
                }
                if payload_bytes > limit || display.len() > limit {
                    return Err(SessionError::PromptTooLarge {
                        bytes: payload_bytes.max(display.len()),
                        limit,
                    });
                }
                Ok((display, parts))
            })
            .await
            .map_err(|_| invalid("The message context could not be prepared."))??;
        self.ask(chat_id, |reply| ChatMsg::Send {
            text: text.clone(),
            parts: parts.clone(),
            reply,
        })
        .await
    }

    async fn composer_folder(&self, chat_id: &str) -> Result<PathBuf, SessionError> {
        self.deps()
            .store
            .chats()
            .await
            .map_err(|e| SessionError::StorageUnavailable(e.to_string()))?
            .into_iter()
            .find(|chat| chat.id == chat_id)
            .map(|chat| chat.folder)
            .ok_or_else(|| SessionError::ChatNotFound(chat_id.into()))
    }
}

fn restricted(path: &Path) -> bool {
    path.components().any(|part| {
        let name = part.as_os_str().to_string_lossy().to_ascii_lowercase();
        matches!(
            name.as_str(),
            ".ssh"
                | ".gnupg"
                | ".aws"
                | ".azure"
                | ".codex"
                | ".claude"
                | ".pi"
                | ".omp"
                | ".hermes"
                | "keychains"
                | "credentials"
                | "credentials.json"
                | "auth.json"
                | "auth.toml"
                | ".npmrc"
                | ".netrc"
                | "id_rsa"
                | "id_ed25519"
        ) || name == ".env"
            || name.starts_with(".env.")
            || name.ends_with(".key")
            || name.ends_with(".pem")
            || name.ends_with(".p12")
            || name.ends_with(".keychain-db")
    })
}

fn import_file(path: &Path) -> Result<(String, String, Vec<u8>), SessionError> {
    if restricted(path) {
        return Err(invalid(
            "Credential and private-key files cannot be attached.",
        ));
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| invalid("This file is no longer available."))?;
    if restricted(&canonical) {
        return Err(invalid(
            "Credential and private-key files cannot be attached.",
        ));
    }
    let meta = fs::metadata(&canonical).map_err(|_| invalid("This file could not be opened."))?;
    if !meta.is_file() || meta.len() > MAX_IMPORT as u64 {
        return Err(invalid("Attach a regular file smaller than 12 MiB."));
    }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    fs::File::open(&canonical)
        .and_then(|file| file.take(MAX_IMPORT as u64 + 1).read_to_end(&mut bytes))
        .map_err(|_| invalid("This file could not be read."))?;
    if bytes.len() > MAX_IMPORT {
        return Err(invalid("The attachment exceeds 12 MiB."));
    }
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.chars().any(char::is_control))
        .ok_or_else(|| invalid("Choose a file with a readable name."))?
        .to_owned();
    if name.len() > 255 {
        return Err(invalid("The attachment name is too long."));
    }
    if image::guess_format(&bytes).is_ok() {
        return Ok((name, "image/png".into(), normalize_image(&bytes)?));
    }
    if bytes.len() > MAX_TEXT || std::str::from_utf8(&bytes).is_err() || bytes.contains(&0) {
        return Err(invalid(
            "Attach a PNG, JPEG, WebP, GIF, or UTF-8 text file under 256 KiB.",
        ));
    }
    Ok((name, "text/plain".into(), bytes))
}

fn normalize_image(bytes: &[u8]) -> Result<Vec<u8>, SessionError> {
    if bytes.len() > MAX_IMPORT {
        return Err(invalid("The image exceeds 12 MiB."));
    }
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| invalid("The image format is not supported."))?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(64 * 1024 * 1024);
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|_| invalid("This image is damaged, too large, or not supported."))?;
    let resized = decoded.resize(2048, 2048, image::imageops::FilterType::Triangle);
    let mut encoded = Cursor::new(Vec::new());
    resized
        .write_to(&mut encoded, image::ImageFormat::Png)
        .map_err(|_| invalid("The image could not be prepared."))?;
    let bytes = encoded.into_inner();
    if bytes.len() > aura_drivers::attachments::MAX_IMAGE_BYTES {
        return Err(invalid(
            "The prepared image exceeds 4 MiB. Use a smaller image.",
        ));
    }
    Ok(bytes)
}

fn checked_mention(folder: &Path, relative: &str) -> Result<PathBuf, SessionError> {
    let path = Path::new(relative);
    if relative.is_empty()
        || relative.len() > 4096
        || relative.chars().any(char::is_control)
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        || restricted(path)
    {
        return Err(invalid("Choose a file or folder inside this project."));
    }
    let root = folder
        .canonicalize()
        .map_err(|_| invalid("The project folder is unavailable."))?;
    let target = root
        .join(path)
        .canonicalize()
        .map_err(|_| invalid("The mentioned file or folder is no longer available."))?;
    if !target.starts_with(&root) || restricted(&target) {
        return Err(invalid("The mentioned file must stay inside this project."));
    }
    Ok(target)
}

fn search(folder: &Path, query: &str) -> Result<Vec<FileMention>, SessionError> {
    let root = folder
        .canonicalize()
        .map_err(|_| invalid("The project folder is unavailable."))?;
    let query = query.to_lowercase();
    let mut stack = vec![root.clone()];
    let mut matches = Vec::new();
    let started = Instant::now();
    let mut visited = 0;
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            visited += 1;
            if visited > 20_000 || started.elapsed() > Duration::from_millis(250) {
                break;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.')
                || matches!(name.as_str(), "node_modules" | "target" | "dist" | "vendor")
            {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() || (!kind.is_dir() && !kind.is_file()) {
                continue;
            }
            let path = entry.path();
            if restricted(&path) {
                continue;
            }
            let Ok(relative) = path.strip_prefix(&root) else {
                continue;
            };
            let relative = relative.to_string_lossy().replace('\\', "/");
            if relative.to_lowercase().contains(&query) {
                matches.push(FileMention {
                    path: relative,
                    directory: kind.is_dir(),
                });
            }
            if kind.is_dir() && path.components().count() < root.components().count() + 12 {
                stack.push(path);
            }
            if matches.len() >= 100 {
                break;
            }
        }
        if visited > 20_000
            || started.elapsed() > Duration::from_millis(250)
            || matches.len() >= 100
        {
            break;
        }
    }
    matches.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(matches)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_normalize_images_and_reject_binary_or_oversized_text() {
        let temp = tempfile::tempdir().expect("folder");
        let path = temp.path().join("sample.png");
        let source = image::DynamicImage::new_rgba8(2400, 10);
        source.save(&path).expect("synthetic image");
        let (_, mime, bytes) = import_file(&path).expect("import image");
        assert_eq!(mime, "image/png");
        let image = image::load_from_memory(&bytes).expect("normalized");
        assert_eq!(image.width(), 2048);
        assert!(image.height() <= 10);
        let text = temp.path().join("sample.txt");
        fs::write(&text, "visible context").expect("text");
        assert_eq!(
            import_file(&text).expect("import text").2,
            b"visible context"
        );
        fs::write(&text, [0, 1, 2, 3]).expect("binary");
        assert!(import_file(&text).is_err());
        fs::write(&text, vec![b'a'; MAX_TEXT + 1]).expect("long text");
        assert!(import_file(&text).is_err());
    }

    #[test]
    fn discovery_skips_private_files_and_mentions_cannot_leave_project() {
        let temp = tempfile::tempdir().expect("folder");
        fs::create_dir(temp.path().join("src")).expect("src");
        fs::create_dir(temp.path().join("node_modules")).expect("dependencies");
        fs::write(temp.path().join("src/main.rs"), "fn main() {}").expect("source");
        fs::write(temp.path().join(".env"), "synthetic fixture only").expect("fixture");
        fs::write(temp.path().join("auth.json"), "synthetic fixture only").expect("fixture");
        let found = search(temp.path(), "").expect("search");
        assert!(found.iter().any(|item| item.path == "src/main.rs"));
        assert!(!found.iter().any(|item| item.path.contains("auth")
            || item.path.contains(".env")
            || item.path.contains("node_modules")));
        assert!(checked_mention(temp.path(), "../outside").is_err());
        assert!(checked_mention(temp.path(), ".env").is_err());
        assert!(checked_mention(temp.path(), "src/main.rs").is_ok());
        // Reject the path before trying to read the synthetic private-file fixture.
        assert!(import_file(&temp.path().join("auth.json")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_mention_symlink_cannot_escape_the_project() {
        let temp = tempfile::tempdir().expect("project");
        let outside = tempfile::tempdir().expect("outside");
        fs::write(outside.path().join("file.txt"), "outside").expect("outside file");
        std::os::unix::fs::symlink(outside.path(), temp.path().join("escape")).expect("link");
        assert!(checked_mention(temp.path(), "escape/file.txt").is_err());
        assert!(
            !search(temp.path(), "")
                .expect("search")
                .iter()
                .any(|item| item.path.contains("escape"))
        );
    }
}
