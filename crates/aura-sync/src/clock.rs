//! Fixed-width hybrid logical clocks shared by encrypted metadata and the cloud API's ordering.
use crate::crypto;
use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};

const MAX_TIME: u64 = 9_999_999_999_999;
const MAX_COUNTER: u64 = 9_999_999_999;
const FUTURE_TOLERANCE: u64 = 300_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ClockError {
    #[error("The sync clock has an invalid or unsupported format.")]
    Invalid,
    #[error("The device clock is too far ahead. Sync waits until the clock is corrected.")]
    Future,
    #[error("The sync clock cannot advance within the supported range.")]
    Exhausted,
}
type Result<T> = std::result::Result<T, ClockError>;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Hlc {
    physical_ms: u64,
    counter: u64,
    device: String,
}
impl Hlc {
    pub fn physical_ms(&self) -> u64 {
        self.physical_ms
    }
    pub fn device(&self) -> &str {
        &self.device
    }
    pub fn validate_time(&self, now_ms: u64) -> Result<()> {
        if now_ms > MAX_TIME {
            return Err(ClockError::Invalid);
        }
        if self.physical_ms > now_ms.saturating_add(FUTURE_TOLERANCE) {
            Err(ClockError::Future)
        } else {
            Ok(())
        }
    }
}
impl FromStr for Hlc {
    type Err = ClockError;
    fn from_str(value: &str) -> Result<Self> {
        let mut parts = value.split(':');
        let physical = parts.next().ok_or(ClockError::Invalid)?;
        let counter = parts.next().ok_or(ClockError::Invalid)?;
        let device = parts.next().ok_or(ClockError::Invalid)?;
        if physical.len() != 13
            || counter.len() != 10
            || parts.next().is_some()
            || !physical
                .bytes()
                .chain(counter.bytes())
                .all(|b| b.is_ascii_digit())
            || crypto::identifier(device).is_err()
        {
            return Err(ClockError::Invalid);
        }
        Ok(Self {
            physical_ms: physical.parse().map_err(|_| ClockError::Invalid)?,
            counter: counter.parse().map_err(|_| ClockError::Invalid)?,
            device: device.into(),
        })
    }
}
impl fmt::Display for Hlc {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{:013}:{:010}:{}",
            self.physical_ms, self.counter, self.device
        )
    }
}
impl Serialize for Hlc {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}
impl<'de> Deserialize<'de> for Hlc {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        String::deserialize(deserializer)?
            .parse()
            .map_err(serde::de::Error::custom)
    }
}

/// Persist last() in the same transaction as each local edit/outbox insertion. Restore from that
/// value after restart. Wall-clock rollback never lowers the logical clock.
pub struct Clock {
    last: Hlc,
}
impl Clock {
    pub fn new(device: &str) -> Result<Self> {
        crypto::identifier(device).map_err(|_| ClockError::Invalid)?;
        Ok(Self {
            last: Hlc {
                physical_ms: 0,
                counter: 0,
                device: device.into(),
            },
        })
    }
    pub fn restore(device: &str, last: Hlc) -> Result<Self> {
        if device != last.device {
            return Err(ClockError::Invalid);
        }
        Ok(Self { last })
    }
    pub fn last(&self) -> &Hlc {
        &self.last
    }
    pub fn tick(&mut self, now_ms: u64) -> Result<Hlc> {
        self.advance(now_ms, None)
    }
    pub fn observe(&mut self, remote: &Hlc, now_ms: u64) -> Result<Hlc> {
        self.advance(now_ms, Some(remote))
    }
    fn advance(&mut self, now_ms: u64, remote: Option<&Hlc>) -> Result<Hlc> {
        self.last.validate_time(now_ms)?;
        if let Some(remote) = remote {
            remote.validate_time(now_ms)?;
        }
        let physical_ms = now_ms
            .max(self.last.physical_ms)
            .max(remote.map_or(0, |c| c.physical_ms));
        let previous = if physical_ms == self.last.physical_ms {
            Some(self.last.counter)
        } else {
            None
        };
        let received = remote
            .filter(|c| c.physical_ms == physical_ms)
            .map(|c| c.counter);
        let counter = match (previous, received) {
            (None, None) => 0,
            (a, b) => a.unwrap_or(0).max(b.unwrap_or(0)) + 1,
        };
        let (physical_ms, counter) = if counter > MAX_COUNTER {
            (physical_ms.checked_add(1).ok_or(ClockError::Exhausted)?, 0)
        } else {
            (physical_ms, counter)
        };
        if physical_ms > MAX_TIME {
            return Err(ClockError::Exhausted);
        }
        let next = Hlc {
            physical_ms,
            counter,
            device: self.last.device.clone(),
        };
        next.validate_time(now_ms)?;
        self.last = next.clone();
        Ok(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clocks_remain_monotonic_across_rollback_restart_and_remote_causality() {
        let mut clock = Clock::new("windows").unwrap();
        let first = clock.tick(1_793_000_000_000).unwrap();
        let second = clock.tick(1_792_999_999_999).unwrap();
        assert!(second > first);
        let mut restored = Clock::restore("windows", second.clone()).unwrap();
        assert!(restored.tick(1_793_000_000_000).unwrap() > second);
        let remote: Hlc = "1793000000001:0000000099:mac".parse().unwrap();
        let observed = restored.observe(&remote, 1_793_000_000_000).unwrap();
        assert!(observed > remote);
        assert!(restored.tick(1_793_000_000_000).unwrap() > observed);
        assert_eq!(observed.to_string(), "1793000000001:0000000100:windows");
        assert!(Clock::restore("other", observed).is_err());
    }
    #[test]
    fn invalid_future_and_overflow_clocks_do_not_poison_local_state() {
        for raw in [
            "1:1:d",
            "1793000000000:0000000000:../x",
            "1793000000000:0000000000:d:extra",
            "1793000000000:0000000000:",
            "1793000000000:00000000-1:d",
        ] {
            assert!(raw.parse::<Hlc>().is_err());
        }
        let mut clock = Clock::new("device").unwrap();
        let before = clock.last().clone();
        assert_eq!(
            clock.observe(&"1793000000000:0000000000:remote".parse().unwrap(), 0),
            Err(ClockError::Future)
        );
        assert_eq!(clock.last(), &before);
        let mut clock =
            Clock::restore("device", "1793000000000:9999999999:device".parse().unwrap()).unwrap();
        assert_eq!(
            clock.tick(1_793_000_000_000).unwrap().to_string(),
            "1793000000001:0000000000:device"
        );
        let mut clock =
            Clock::restore("device", "9999999999999:9999999999:device".parse().unwrap()).unwrap();
        assert_eq!(clock.tick(MAX_TIME), Err(ClockError::Exhausted));
    }
    #[test]
    fn wire_lexical_order_matches_numeric_and_device_ties() {
        let mut values: Vec<Hlc> = [
            "1793000000010:0000000000:b",
            "1793000000009:0000000010:a",
            "1793000000009:0000000009:a",
            "1793000000010:0000000000:a",
        ]
        .into_iter()
        .map(|s| s.parse().unwrap())
        .collect();
        let mut wire: Vec<String> = values.iter().map(ToString::to_string).collect();
        values.sort();
        wire.sort();
        assert_eq!(
            values.iter().map(ToString::to_string).collect::<Vec<_>>(),
            wire
        );
        for value in values {
            assert_eq!(
                serde_json::from_str::<Hlc>(&serde_json::to_string(&value).unwrap()).unwrap(),
                value
            );
        }
    }
}
