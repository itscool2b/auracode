//! Who may reach this desktop: its own identity at the relay, the browsers paired with it and the
//! bots linked to it. Kept in `remote.json` in the data folder, readable by the user only.
//!
//! A pairing link is the exception: it lives in memory, opens once and expires in minutes, so a
//! link left in a screenshot or a browser's history is worth nothing later.

use std::{
    io::Write,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::crypto::{self, KEY_BYTES};

pub const MAX_DEVICES: usize = 16;
pub const MAX_BOTS: usize = 16;
pub const MAX_NAME: usize = 48;
/// How long a pairing link opens.
pub const PAIRING_MS: i64 = 10 * 60 * 1000;
/// Wrong attempts a pairing link survives. Its key cannot be guessed; this only bounds the noise.
const PAIRING_ATTEMPTS: u32 = 8;

#[derive(Debug, thiserror::Error)]
pub enum RegistryError {
    #[error("Remote access settings could not be saved: {0}")]
    Save(String),
    #[error("Remote access settings could not be read: {0}")]
    Read(String),
    #[error("This computer already has {MAX_DEVICES} paired devices. Remove one first.")]
    TooManyDevices,
    #[error("This computer already has {MAX_BOTS} bot links. Remove one first.")]
    TooManyBots,
    #[error("The system's random source is unavailable.")]
    Random,
}

impl From<crypto::CryptoError> for RegistryError {
    fn from(_: crypto::CryptoError) -> Self {
        Self::Random
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Device {
    pub id: String,
    /// The device's 32-byte key, base64url.
    pub key: String,
    pub name: String,
    pub created_at: i64,
    pub last_seen_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Bot {
    pub id: String,
    /// SHA-256 of the bot's token. The token itself is shown once and never stored.
    pub token_hash: String,
    pub name: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Stored {
    version: u32,
    enabled: bool,
    /// This desktop's id at the relay (16 bytes) and the key that claims it (32 bytes).
    host_id: String,
    host_key: String,
    devices: Vec<Device>,
    bots: Vec<Bot>,
}

/// A pairing link's secret half, to be shown once.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pairing {
    pub id: String,
    pub key: [u8; KEY_BYTES],
    pub expires_at: i64,
    failures: u32,
}

/// A new bot link's secret, to be shown once.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewBot {
    pub id: String,
    pub token: String,
}

pub struct Registry {
    path: PathBuf,
    stored: Stored,
    pairing: Option<Pairing>,
}

impl Registry {
    /// Reads the saved settings, or starts with remote access off and a new identity. A file that
    /// cannot be read is an error, never silently replaced: it holds every pairing.
    pub fn load(path: &Path) -> Result<Self, RegistryError> {
        let stored = match std::fs::read(path) {
            Ok(bytes) => {
                let stored: Stored = serde_json::from_slice(&bytes)
                    .map_err(|error| RegistryError::Read(error.to_string()))?;
                if stored.version != 1
                    || crypto::decode::<16>(&stored.host_id).is_none()
                    || crypto::decode::<KEY_BYTES>(&stored.host_key).is_none()
                {
                    return Err(RegistryError::Read("unsupported contents".into()));
                }
                stored
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Stored {
                version: 1,
                enabled: false,
                host_id: crypto::encode(&crypto::random::<16>()?),
                host_key: crypto::encode(&crypto::random::<KEY_BYTES>()?),
                devices: Vec::new(),
                bots: Vec::new(),
            },
            Err(error) => return Err(RegistryError::Read(error.to_string())),
        };
        Ok(Self {
            path: path.to_owned(),
            stored,
            pairing: None,
        })
    }

    fn save(&self) -> Result<(), RegistryError> {
        let save = |error: std::io::Error| RegistryError::Save(error.to_string());
        let folder = self
            .path
            .parent()
            .ok_or_else(|| RegistryError::Save("no folder".into()))?;
        // A temporary file beside it is private to the user on Unix, and replaces the old file
        // whole: a crash leaves one or the other.
        let mut file = tempfile::NamedTempFile::new_in(folder).map_err(save)?;
        let bytes = serde_json::to_vec_pretty(&self.stored)
            .map_err(|error| RegistryError::Save(error.to_string()))?;
        file.write_all(&bytes).map_err(save)?;
        file.as_file().sync_all().map_err(save)?;
        file.persist(&self.path)
            .map_err(|error| RegistryError::Save(error.error.to_string()))?;
        Ok(())
    }

    pub fn enabled(&self) -> bool {
        self.stored.enabled
    }

    pub fn host_id(&self) -> &str {
        &self.stored.host_id
    }

    pub fn host_key(&self) -> &str {
        &self.stored.host_key
    }

    pub fn devices(&self) -> &[Device] {
        &self.stored.devices
    }

    pub fn bots(&self) -> &[Bot] {
        &self.stored.bots
    }

    /// Turning remote access off also ends any open pairing link.
    pub fn set_enabled(&mut self, enabled: bool) -> Result<(), RegistryError> {
        if !enabled {
            self.pairing = None;
        }
        if self.stored.enabled != enabled {
            self.stored.enabled = enabled;
            self.save()?;
        }
        Ok(())
    }

    /// A new pairing link. It replaces the one before it: only the newest link opens.
    pub fn start_pairing(&mut self, now: i64) -> Result<Pairing, RegistryError> {
        let pairing = Pairing {
            id: crypto::encode(&crypto::random::<8>()?),
            key: crypto::random()?,
            expires_at: now + PAIRING_MS,
            failures: 0,
        };
        self.pairing = Some(pairing.clone());
        Ok(pairing)
    }

    pub fn cancel_pairing(&mut self) {
        self.pairing = None;
    }

    /// The open pairing link, while it is still good.
    pub fn pairing(&mut self, now: i64) -> Option<&Pairing> {
        if self
            .pairing
            .as_ref()
            .is_some_and(|pairing| pairing.expires_at <= now)
        {
            self.pairing = None;
        }
        self.pairing.as_ref()
    }

    /// The key of the pairing link `id`, if that link is the open one.
    pub fn pairing_key(&mut self, id: &str, now: i64) -> Option<[u8; KEY_BYTES]> {
        self.pairing(now)
            .filter(|pairing| crypto::same(&pairing.id, id))
            .map(|pairing| pairing.key)
    }

    /// A session under the pairing link `id` sent something its key did not seal.
    pub fn pairing_failed(&mut self, id: &str) {
        if let Some(pairing) = self.pairing.as_mut().filter(|pairing| pairing.id == id) {
            pairing.failures += 1;
            if pairing.failures >= PAIRING_ATTEMPTS {
                self.pairing = None;
            }
        }
    }

    /// Spends the pairing link `id` on a new device. The link never opens again.
    pub fn pair(
        &mut self,
        id: &str,
        name: &str,
        now: i64,
    ) -> Result<Option<Device>, RegistryError> {
        if self.pairing_key(id, now).is_none() {
            return Ok(None);
        }
        if self.stored.devices.len() >= MAX_DEVICES {
            return Err(RegistryError::TooManyDevices);
        }
        let device = Device {
            id: crypto::encode(&crypto::random::<8>()?),
            key: crypto::encode(&crypto::random::<KEY_BYTES>()?),
            name: name_of(name, "Browser"),
            created_at: now,
            last_seen_at: now,
        };
        self.stored.devices.push(device.clone());
        if let Err(error) = self.save() {
            self.stored.devices.pop();
            return Err(error);
        }
        self.pairing = None;
        Ok(Some(device))
    }

    pub fn device_key(&self, id: &str) -> Option<[u8; KEY_BYTES]> {
        self.stored
            .devices
            .iter()
            .find(|device| crypto::same(&device.id, id))
            .and_then(|device| crypto::decode(&device.key))
    }

    /// Notes that a device connected. A failed save only loses the time.
    pub fn seen(&mut self, id: &str, now: i64) {
        if let Some(device) = self.stored.devices.iter_mut().find(|d| d.id == id) {
            // Reconnects are frequent; a minute's precision is enough to be worth a write.
            if now - device.last_seen_at >= 60_000 {
                device.last_seen_at = now;
                let _ = self.save();
            }
        }
    }

    pub fn remove_device(&mut self, id: &str) -> Result<bool, RegistryError> {
        let before = self.stored.devices.clone();
        self.stored.devices.retain(|device| device.id != id);
        if self.stored.devices.len() == before.len() {
            return Ok(false);
        }
        if let Err(error) = self.save() {
            self.stored.devices = before;
            return Err(error);
        }
        Ok(true)
    }

    pub fn add_bot(&mut self, name: &str, now: i64) -> Result<NewBot, RegistryError> {
        if self.stored.bots.len() >= MAX_BOTS {
            return Err(RegistryError::TooManyBots);
        }
        let new = NewBot {
            id: crypto::encode(&crypto::random::<8>()?),
            token: crypto::encode(&crypto::random::<KEY_BYTES>()?),
        };
        self.stored.bots.push(Bot {
            id: new.id.clone(),
            token_hash: crypto::hash(&new.token),
            name: name_of(name, "Bot"),
            created_at: now,
            last_used_at: None,
        });
        if let Err(error) = self.save() {
            self.stored.bots.pop();
            return Err(error);
        }
        Ok(new)
    }

    /// Whether `token` is the bot `id`'s. Notes the use.
    pub fn verify_bot(&mut self, id: &str, token: &str, now: i64) -> bool {
        let hash = crypto::hash(token);
        let Some(bot) = self
            .stored
            .bots
            .iter_mut()
            .find(|bot| crypto::same(&bot.id, id))
        else {
            return false;
        };
        if !crypto::same(&bot.token_hash, &hash) {
            return false;
        }
        if bot.last_used_at.is_none_or(|last| now - last >= 60_000) {
            bot.last_used_at = Some(now);
            let _ = self.save();
        }
        true
    }

    pub fn remove_bot(&mut self, id: &str) -> Result<bool, RegistryError> {
        let before = self.stored.bots.clone();
        self.stored.bots.retain(|bot| bot.id != id);
        if self.stored.bots.len() == before.len() {
            return Ok(false);
        }
        if let Err(error) = self.save() {
            self.stored.bots = before;
            return Err(error);
        }
        Ok(true)
    }
}

/// A name a person or a browser supplied, as one short line; `fallback` when nothing is left.
fn name_of(name: &str, fallback: &str) -> String {
    let name: String = name
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_NAME)
        .collect();
    if name.is_empty() {
        fallback.to_owned()
    } else {
        name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> (tempfile::TempDir, Registry) {
        let folder = tempfile::tempdir().expect("folder");
        let registry = Registry::load(&folder.path().join("remote.json")).expect("load");
        (folder, registry)
    }

    #[test]
    fn starts_off_with_an_identity_and_keeps_it_across_restarts() {
        let (folder, mut registry) = fresh();
        let path = folder.path().join("remote.json");
        assert!(!registry.enabled());
        assert!(!path.exists(), "nothing is written until something changes");
        assert_eq!(registry.host_id().len(), 22);
        assert_eq!(registry.host_key().len(), 43);
        registry.set_enabled(true).expect("enable");
        let (id, key) = (
            registry.host_id().to_owned(),
            registry.host_key().to_owned(),
        );
        let again = Registry::load(&path).expect("reload");
        assert!(again.enabled());
        assert_eq!(
            (again.host_id(), again.host_key()),
            (id.as_str(), key.as_str())
        );
    }

    #[test]
    fn unreadable_settings_are_an_error_not_a_fresh_start() {
        let folder = tempfile::tempdir().expect("folder");
        let path = folder.path().join("remote.json");
        for contents in [
            "{",
            "{}",
            r#"{"version":2,"enabled":true,"host_id":"a","host_key":"b","devices":[],"bots":[]}"#,
        ] {
            std::fs::write(&path, contents).expect("write");
            assert!(
                matches!(Registry::load(&path), Err(RegistryError::Read(_))),
                "{contents}"
            );
            assert_eq!(std::fs::read_to_string(&path).expect("kept"), contents);
        }
    }

    #[test]
    fn a_pairing_link_opens_once_within_its_time() {
        let (_folder, mut registry) = fresh();
        let first = registry.start_pairing(1_000).expect("pairing");
        assert_eq!(first.id.len(), 11);
        assert_eq!(first.expires_at, 1_000 + PAIRING_MS);
        assert_eq!(registry.pairing_key(&first.id, 2_000), Some(first.key));
        assert_eq!(registry.pairing_key("another-id!", 2_000), None);

        // A newer link replaces it.
        let second = registry.start_pairing(3_000).expect("pairing");
        assert_ne!(first.key, second.key);
        assert_eq!(registry.pairing_key(&first.id, 3_500), None);
        assert_eq!(
            registry.pair(&first.id, "Phone", 3_500).expect("pair"),
            None
        );

        let device = registry
            .pair(&second.id, "  iPhone\n(Safari)\u{7} ", 4_000)
            .expect("pair")
            .expect("device");
        assert_eq!(device.name, "iPhone (Safari)");
        assert_eq!(registry.device_key(&device.id), crypto::decode(&device.key));
        // Spent: the same link pairs nothing more.
        assert_eq!(registry.pairing_key(&second.id, 4_001), None);
        assert_eq!(
            registry.pair(&second.id, "Again", 4_001).expect("pair"),
            None
        );
        assert_eq!(registry.devices().len(), 1);

        // Expired, and cancelled.
        let third = registry.start_pairing(10_000).expect("pairing");
        assert_eq!(registry.pairing_key(&third.id, 10_000 + PAIRING_MS), None);
        let fourth = registry.start_pairing(20_000).expect("pairing");
        registry.cancel_pairing();
        assert_eq!(registry.pairing_key(&fourth.id, 20_001), None);
        // Turning remote access off closes an open link too.
        registry.set_enabled(true).expect("on");
        let fifth = registry.start_pairing(30_000).expect("pairing");
        registry.set_enabled(false).expect("off");
        assert_eq!(registry.pairing_key(&fifth.id, 30_001), None);
    }

    #[test]
    fn a_pairing_link_closes_after_repeated_wrong_keys() {
        let (_folder, mut registry) = fresh();
        let pairing = registry.start_pairing(0).expect("pairing");
        for _ in 0..PAIRING_ATTEMPTS - 1 {
            registry.pairing_failed(&pairing.id);
            registry.pairing_failed("someone-else");
        }
        assert!(registry.pairing_key(&pairing.id, 1).is_some());
        registry.pairing_failed(&pairing.id);
        assert!(registry.pairing_key(&pairing.id, 1).is_none());
    }

    #[test]
    fn devices_and_bots_persist_are_bounded_and_can_be_removed() {
        let (folder, mut registry) = fresh();
        let path = folder.path().join("remote.json");
        for count in 0..MAX_DEVICES {
            let pairing = registry.start_pairing(0).expect("pairing");
            registry
                .pair(&pairing.id, &format!("Device {count}"), 5)
                .expect("pair")
                .expect("device");
        }
        let pairing = registry.start_pairing(0).expect("pairing");
        assert!(matches!(
            registry.pair(&pairing.id, "One more", 5),
            Err(RegistryError::TooManyDevices)
        ));
        // The refused pairing did not spend the link.
        assert!(registry.pairing_key(&pairing.id, 6).is_some());
        let first = registry.devices()[0].id.clone();
        assert!(registry.remove_device(&first).expect("remove"));
        assert!(!registry.remove_device(&first).expect("remove again"));
        assert_eq!(registry.device_key(&first), None);

        let bot = registry.add_bot("", 7).expect("bot");
        assert_eq!((bot.id.len(), bot.token.len()), (11, 43));
        assert_eq!(registry.bots()[0].name, "Bot");
        assert_ne!(
            registry.bots()[0].token_hash,
            bot.token,
            "the token is never stored"
        );
        assert!(!registry.verify_bot(&bot.id, "wrong", 8));
        assert!(!registry.verify_bot("wrong", &bot.token, 8));
        assert_eq!(registry.bots()[0].last_used_at, None);
        assert!(registry.verify_bot(&bot.id, &bot.token, 9));
        assert_eq!(registry.bots()[0].last_used_at, Some(9));
        for _ in 1..MAX_BOTS {
            registry.add_bot("Grok", 7).expect("bot");
        }
        assert!(matches!(
            registry.add_bot("Grok", 7),
            Err(RegistryError::TooManyBots)
        ));

        let mut again = Registry::load(&path).expect("reload");
        assert_eq!(again.devices().len(), MAX_DEVICES - 1);
        assert_eq!(again.bots().len(), MAX_BOTS);
        assert!(again.verify_bot(&bot.id, &bot.token, 10));
        assert!(again.remove_bot(&bot.id).expect("remove"));
        assert!(!again.verify_bot(&bot.id, &bot.token, 11));
        assert!(
            !std::fs::read_to_string(&path)
                .expect("file")
                .contains(&bot.token)
        );
    }
}
