//! Deterministic merge rules. This module performs no file reads, writes, vendor calls or HTTP.
use crate::{clock::Hlc, crypto::MAX_RECORD_PLAINTEXT};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum MergeError {
    #[error("The synced metadata is invalid or exceeds its limit.")]
    Invalid,
    #[error("This metadata schema requires a newer app. The original record must be retained.")]
    Version,
    #[error("Different edits share an identical clock. Neither value was discarded.")]
    ClockCollision,
}
type Result<T> = std::result::Result<T, MergeError>;

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Stamped<T> {
    pub clock: Hlc,
    pub value: T,
}
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    content = "value",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum FieldValue {
    Present(Value),
    Deleted,
}
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Metadata {
    pub schema_version: u32,
    /// Object deletion is independent of field edits. A late field edit cannot implicitly restore
    /// a deleted object; restoration is a separate, explicitly newer live=true operation.
    pub live: Stamped<bool>,
    pub fields: BTreeMap<String, Stamped<FieldValue>>,
}
impl std::fmt::Debug for Metadata {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Metadata")
            .field("schema_version", &self.schema_version)
            .field("field_count", &self.fields.len())
            .finish_non_exhaustive()
    }
}
impl Metadata {
    pub fn deleted(&self) -> bool {
        !self.live.value
    }
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != 1 {
            return Err(MergeError::Version);
        }
        if self.fields.len() > 256
            || self
                .fields
                .keys()
                .any(|key| key.is_empty() || key.len() > 128 || key.chars().any(char::is_control))
        {
            return Err(MergeError::Invalid);
        }
        if serde_json::to_vec(self)
            .map_err(|_| MergeError::Invalid)?
            .len()
            > MAX_RECORD_PLAINTEXT
        {
            return Err(MergeError::Invalid);
        }
        Ok(())
    }
    /// Authenticated payload clocks cannot outrun their enclosing record or poison the next local
    /// clock with a timestamp outside the service's five-minute allowance.
    pub fn validate_clocks(&self, envelope: &Hlc, now_ms: u64) -> Result<()> {
        self.validate()?;
        envelope
            .validate_time(now_ms)
            .map_err(|_| MergeError::Invalid)?;
        if &self.live.clock > envelope || self.fields.values().any(|field| &field.clock > envelope)
        {
            return Err(MergeError::Invalid);
        }
        Ok(())
    }
}
pub enum DecodedMetadata {
    Known(Metadata),
    /// Keep the original authenticated encrypted record intact. Do not merge, emit an empty
    /// substitute, or write it back. A durable sync engine must retain it before advancing a cursor.
    Future {
        schema_version: u64,
    },
}
pub fn decode_metadata(plaintext: &[u8]) -> Result<DecodedMetadata> {
    if plaintext.len() > MAX_RECORD_PLAINTEXT {
        return Err(MergeError::Invalid);
    }
    let value: Value = serde_json::from_slice(plaintext).map_err(|_| MergeError::Invalid)?;
    let schema = value
        .get("schema_version")
        .and_then(Value::as_u64)
        .ok_or(MergeError::Invalid)?;
    if schema > 1 {
        return Ok(DecodedMetadata::Future {
            schema_version: schema,
        });
    }
    if schema != 1 {
        return Err(MergeError::Invalid);
    }
    let metadata: Metadata = serde_json::from_value(value).map_err(|_| MergeError::Invalid)?;
    metadata.validate()?;
    Ok(DecodedMetadata::Known(metadata))
}
pub fn metadata(left: &Metadata, right: &Metadata) -> Result<Metadata> {
    left.validate()?;
    right.validate()?;
    let mut result = left.clone();
    result.live = stamp(&left.live, &right.live)?;
    for (key, value) in &right.fields {
        let merged = match result.fields.get(key) {
            Some(existing) => stamp(existing, value)?,
            None => value.clone(),
        };
        result.fields.insert(key.clone(), merged);
    }
    result.validate()?;
    Ok(result)
}
fn stamp<T: Clone + PartialEq>(left: &Stamped<T>, right: &Stamped<T>) -> Result<Stamped<T>> {
    if left.clock == right.clock && left.value != right.value {
        return Err(MergeError::ClockCollision);
    }
    Ok(if left.clock >= right.clock {
        left.clone()
    } else {
        right.clone()
    })
}

#[derive(Clone, PartialEq, Eq)]
pub enum Item<T> {
    Present(T),
    Tombstone,
}
#[derive(Clone, PartialEq, Eq)]
pub enum Local<T> {
    Present(T),
    /// Only a successful allowlisted scan may report absence. A skipped application, missing agent,
    /// unavailable path or device-only item must report Unavailable so it never becomes uninstall.
    Absent,
    Unavailable,
}
#[derive(Clone, PartialEq, Eq)]
pub enum ConfigAction<T> {
    Unchanged,
    Apply(Item<T>),
    Push(Item<T>),
    Conflict { local: Item<T>, remote: Item<T> },
    Wait,
}
#[derive(Clone, PartialEq, Eq)]
pub struct ConfigMerge<T> {
    pub first_link: bool,
    pub action: ConfigAction<T>,
}

/// Base=None means first link, which is union-only and always needs a preview before application.
/// Remote=None means no record, never a deletion. Linked remote deletion must be an explicit tombstone.
pub fn config<T: Clone + PartialEq>(
    base: Option<&Item<T>>,
    local: &Local<T>,
    remote: Option<&Item<T>>,
) -> ConfigMerge<T> {
    let first_link = base.is_none();
    let local = match local {
        Local::Present(value) => Item::Present(value.clone()),
        Local::Absent => Item::Tombstone,
        Local::Unavailable => {
            return ConfigMerge {
                first_link,
                action: ConfigAction::Wait,
            };
        }
    };
    let action = if let Some(base) = base {
        match remote {
            None => ConfigAction::Wait,
            Some(remote) if &local == remote => ConfigAction::Unchanged,
            Some(remote) if &local == base => ConfigAction::Apply(remote.clone()),
            Some(remote) if remote == base => ConfigAction::Push(local),
            Some(remote) => ConfigAction::Conflict {
                local,
                remote: remote.clone(),
            },
        }
    } else {
        match (&local, remote) {
            (Item::Tombstone, None | Some(Item::Tombstone)) => ConfigAction::Unchanged,
            (Item::Present(_), None | Some(Item::Tombstone)) => ConfigAction::Push(local),
            (Item::Tombstone, Some(remote)) => ConfigAction::Apply(remote.clone()),
            (_, Some(remote)) if &local == remote => ConfigAction::Unchanged,
            (_, Some(remote)) => ConfigAction::Conflict {
                local,
                remote: remote.clone(),
            },
        }
    };
    ConfigMerge { first_link, action }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hlc(counter: u64, device: &str) -> Hlc {
        format!("1793000000000:{counter:010}:{device}")
            .parse()
            .unwrap()
    }
    fn record() -> Metadata {
        Metadata {
            schema_version: 1,
            live: Stamped {
                clock: hlc(0, "a"),
                value: true,
            },
            fields: BTreeMap::new(),
        }
    }
    fn field(value: &str, counter: u64, device: &str) -> Stamped<FieldValue> {
        Stamped {
            clock: hlc(counter, device),
            value: FieldValue::Present(Value::String(value.into())),
        }
    }
    #[test]
    fn independent_field_edits_union_in_either_order_and_deletion_needs_explicit_restore() {
        let mut left = record();
        left.fields
            .insert("title".into(), field("local title", 1, "windows"));
        let mut right = record();
        right.fields.insert("color".into(), field("blue", 1, "mac"));
        right.live = Stamped {
            clock: hlc(2, "mac"),
            value: false,
        };
        let merged = metadata(&left, &right).unwrap();
        assert_eq!(merged, metadata(&right, &left).unwrap());
        assert_eq!(metadata(&merged, &merged).unwrap(), merged);
        assert_eq!(merged.fields.len(), 2);
        assert!(merged.deleted());
        left.fields.insert(
            "title".into(),
            field("edited offline after deletion", 3, "windows"),
        );
        assert!(metadata(&left, &right).unwrap().deleted());
        left.live = Stamped {
            clock: hlc(4, "windows"),
            value: true,
        };
        assert!(!metadata(&left, &right).unwrap().deleted());
    }
    #[test]
    fn concurrent_field_ties_are_deterministic_but_duplicate_clocks_with_different_values_are_errors()
     {
        let mut left = record();
        let mut right = record();
        left.fields.insert("title".into(), field("a", 1, "a"));
        right.fields.insert("title".into(), field("b", 1, "b"));
        let merged = metadata(&left, &right).unwrap();
        assert_eq!(merged, metadata(&right, &left).unwrap());
        assert!(merged.fields["title"].value == FieldValue::Present(Value::String("b".into())));
        right
            .fields
            .insert("title".into(), field("different", 1, "a"));
        assert_eq!(
            metadata(&left, &right).unwrap_err(),
            MergeError::ClockCollision
        );
    }
    #[test]
    fn newer_schemas_are_preserved_and_known_schema_unknown_fields_are_not_silently_discarded() {
        let future = br#"{"schema_version":2,"unrecognized":{"private_title":"retain me"}}"#;
        assert!(matches!(
            decode_metadata(future).unwrap(),
            DecodedMetadata::Future { schema_version: 2 }
        ));
        let mut value = serde_json::to_value(record()).unwrap();
        value["unknown"] = true.into();
        assert!(decode_metadata(&serde_json::to_vec(&value).unwrap()).is_err());
        let raw = serde_json::to_vec(&record()).unwrap();
        assert!(matches!(
            decode_metadata(&raw).unwrap(),
            DecodedMetadata::Known(_)
        ));
    }
    #[test]
    fn payload_clocks_cannot_claim_future_precedence_beyond_the_authenticated_envelope() {
        let mut value = record();
        value
            .fields
            .insert("title".into(), field("future edit", 2, "a"));
        assert!(
            value
                .validate_clocks(&hlc(1, "a"), 1_793_000_000_000)
                .is_err()
        );
        assert!(
            value
                .validate_clocks(&hlc(3, "a"), 1_793_000_000_000)
                .is_ok()
        );
        assert!(value.validate_clocks(&hlc(3, "a"), 0).is_err());
    }
    #[test]
    fn config_three_way_table_distinguishes_deletes_from_missing_and_skipped() {
        let base = Item::Present("old");
        let remote = Item::Present("remote");
        assert!(
            config(Some(&base), &Local::Present("old"), Some(&remote)).action
                == ConfigAction::Apply(remote.clone())
        );
        assert!(
            config(Some(&base), &Local::Present("local"), Some(&base)).action
                == ConfigAction::Push(Item::Present("local"))
        );
        assert!(
            config(Some(&base), &Local::Absent, Some(&base)).action
                == ConfigAction::Push(Item::Tombstone)
        );
        assert!(
            config(Some(&base), &Local::Present("old"), Some(&Item::Tombstone)).action
                == ConfigAction::Apply(Item::Tombstone)
        );
        assert!(matches!(
            config(Some(&base), &Local::Present("local"), Some(&remote)).action,
            ConfigAction::Conflict { .. }
        ));
        assert!(matches!(
            config(Some(&base), &Local::Unavailable, Some(&remote)).action,
            ConfigAction::Wait
        ));
        assert!(matches!(
            config(Some(&base), &Local::Absent, None).action,
            ConfigAction::Wait
        ));
        assert!(matches!(
            config(Some(&base), &Local::Present("remote"), Some(&remote)).action,
            ConfigAction::Unchanged
        ));
    }
    #[test]
    fn first_link_is_union_only_and_does_not_turn_absence_into_an_uninstall() {
        let cases = [
            (
                Local::Present("local"),
                None,
                ConfigAction::Push(Item::Present("local")),
            ),
            (
                Local::Present("local"),
                Some(Item::Tombstone),
                ConfigAction::Push(Item::Present("local")),
            ),
            (
                Local::Absent,
                Some(Item::Present("remote")),
                ConfigAction::Apply(Item::Present("remote")),
            ),
            (Local::Absent, None, ConfigAction::Unchanged),
            (
                Local::Unavailable,
                Some(Item::Present("remote")),
                ConfigAction::Wait,
            ),
        ];
        for (local, remote, expected) in cases {
            let merged = config(None, &local, remote.as_ref());
            assert!(merged.first_link);
            assert!(merged.action == expected);
        }
        assert!(matches!(
            config(
                None,
                &Local::Present("local"),
                Some(&Item::Present("remote"))
            )
            .action,
            ConfigAction::Conflict { .. }
        ));
    }
}
