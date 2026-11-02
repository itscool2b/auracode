//! App-owned, explicitly started dictation. Audio lives only in memory. The sole network
//! operation downloads a pinned model; transcription never makes a network request.
mod audio;
pub mod commands;
mod model;

use crate::sync::lock;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

pub(crate) type Sink = Arc<dyn Fn(DictationEvent) -> bool + Send + Sync>;

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum DictationEvent {
    Downloading {
        received: u32,
        total: u32,
    },
    ModelReady,
    Preparing,
    Recording {
        seconds: u32,
        level: f32,
        limit_seconds: u32,
    },
    Transcribing {
        percent: u8,
    },
    Complete {
        text: String,
    },
    Cancelled,
    Failed {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct DictationModel {
    pub installed: bool,
    pub name: String,
    pub bytes: u32,
}

#[derive(Default)]
pub struct Dictation {
    active: Mutex<Option<Active>>,
}
struct Active {
    id: String,
    owner: String,
    cancel: CancellationToken,
    stop: Arc<AtomicBool>,
}

pub(crate) struct Operation {
    service: Arc<Dictation>,
    id: String,
    pub cancel: CancellationToken,
    pub stop: Arc<AtomicBool>,
    pub sink: Sink,
    current: Box<dyn Fn() -> bool + Send + Sync>,
}
impl Operation {
    pub fn cancelled(&self) -> bool {
        if !(self.current)() {
            self.cancel.cancel();
        }
        self.cancel.is_cancelled()
    }
    pub fn emit(&self, event: DictationEvent) -> bool {
        if self.cancelled() || !(self.sink)(event) {
            self.cancel.cancel();
            return false;
        }
        true
    }
    pub fn finish(&self, result: Result<DictationEvent, String>) {
        let event = if self.cancelled() {
            DictationEvent::Cancelled
        } else {
            result.unwrap_or_else(|message| DictationEvent::Failed { message })
        };
        // Cancellation still ends the UI's busy state. Stale page channels simply reject it.
        (self.sink)(event);
    }
}
impl Drop for Operation {
    fn drop(&mut self) {
        let mut active = lock(&self.service.active);
        if active.as_ref().is_some_and(|op| op.id == self.id) {
            *active = None;
        }
    }
}
impl Dictation {
    pub(crate) fn begin(
        self: &Arc<Self>,
        owner: &str,
        id: String,
        sink: Sink,
        current: Box<dyn Fn() -> bool + Send + Sync>,
    ) -> Result<Operation, String> {
        uuid::Uuid::parse_str(&id).map_err(|_| "Invalid dictation request.".to_string())?;
        let mut active = lock(&self.active);
        if active.is_some() {
            return Err("Dictation is still finishing. Try again in a moment.".into());
        }
        let cancel = CancellationToken::new();
        let stop = Arc::new(AtomicBool::new(false));
        *active = Some(Active {
            id: id.clone(),
            owner: owner.into(),
            cancel: cancel.clone(),
            stop: stop.clone(),
        });
        Ok(Operation {
            service: self.clone(),
            id,
            cancel,
            stop,
            sink,
            current,
        })
    }
    pub fn cancel(&self, owner: &str, id: &str) {
        if let Some(op) = lock(&self.active)
            .as_ref()
            .filter(|op| op.owner == owner && op.id == id)
        {
            op.cancel.cancel();
        }
    }
    pub fn stop(&self, owner: &str, id: &str) {
        if let Some(op) = lock(&self.active)
            .as_ref()
            .filter(|op| op.owner == owner && op.id == id)
        {
            op.stop.store(true, Ordering::Release);
        }
    }
    pub fn drop_owner(&self, owner: &str) {
        if let Some(op) = lock(&self.active).as_ref().filter(|op| op.owner == owner) {
            op.cancel.cancel();
        }
    }
    pub fn cancel_all(&self) {
        if let Some(op) = lock(&self.active).as_ref() {
            op.cancel.cancel();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn begin(service: &Arc<Dictation>, owner: &str) -> Operation {
        service
            .begin(
                owner,
                uuid::Uuid::new_v4().to_string(),
                Arc::new(|_| true),
                Box::new(|| true),
            )
            .unwrap()
    }
    #[test]
    fn ownership_cancellation_and_exclusivity() {
        let service = Arc::new(Dictation::default());
        let operation = begin(&service, "main");
        assert!(
            service
                .begin(
                    "main",
                    uuid::Uuid::new_v4().to_string(),
                    Arc::new(|_| true),
                    Box::new(|| true)
                )
                .is_err()
        );
        service.cancel("other", &operation.id);
        assert!(!operation.cancelled());
        service.stop("main", &operation.id);
        assert!(operation.stop.load(Ordering::Acquire));
        service.drop_owner("main");
        assert!(operation.cancelled());
        drop(operation);
        assert!(!begin(&service, "main").cancelled());
    }
    #[test]
    fn stale_page_or_disconnected_channel_cancels() {
        let service = Arc::new(Dictation::default());
        let operation = service
            .begin(
                "main",
                uuid::Uuid::new_v4().to_string(),
                Arc::new(|_| true),
                Box::new(|| false),
            )
            .unwrap();
        assert!(operation.cancelled());
        drop(operation);
        let operation = service
            .begin(
                "main",
                uuid::Uuid::new_v4().to_string(),
                Arc::new(|_| false),
                Box::new(|| true),
            )
            .unwrap();
        assert!(!operation.emit(DictationEvent::Preparing));
        assert!(operation.cancelled());
    }
}
