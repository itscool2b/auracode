//! A scoped bridge for whisper.cpp callbacks. whisper-rs 0.16.0's safe abort helper stores a
//! `Box<dyn FnMut>` but casts it back to the concrete closure type. Its safe progress helper
//! also leaks the boxed callback. Keep callback storage borrowed for exactly one synchronous
//! `WhisperState::full` call instead. No pointer or callback escapes this function.
#![allow(unsafe_code)]

use super::{DictationEvent, Operation};
use std::ffi::c_void;
use std::panic::{AssertUnwindSafe, catch_unwind};
use whisper_rs::{FullParams, WhisperError, WhisperState, WhisperSysContext, WhisperSysState};

struct Callbacks<'a> {
    operation: &'a Operation,
}

extern "C" fn abort(data: *mut c_void) -> bool {
    // SAFETY: `run` supplies a live, aligned Callbacks pointer for the duration of `full`.
    // This shared borrow is safe even when ggml calls from a worker: Operation is Sync.
    let callbacks = unsafe { &*data.cast::<Callbacks<'_>>() };
    catch_unwind(AssertUnwindSafe(|| callbacks.operation.cancelled())).unwrap_or(true)
}

extern "C" fn progress(
    _: *mut WhisperSysContext,
    _: *mut WhisperSysState,
    percent: i32,
    data: *mut c_void,
) {
    // SAFETY: same scoped pointer as `abort`; native context/state pointers are never touched.
    let callbacks = unsafe { &*data.cast::<Callbacks<'_>>() };
    let _ = catch_unwind(AssertUnwindSafe(|| {
        callbacks.operation.emit(DictationEvent::Transcribing {
            percent: percent.clamp(0, 100) as u8,
        });
    }));
}

pub(super) fn run(
    state: &mut WhisperState,
    mut parameters: FullParams<'_, '_>,
    audio: &[f32],
    operation: &Operation,
) -> Result<(), WhisperError> {
    let mut callbacks = Callbacks { operation };
    let data = (&mut callbacks as *mut Callbacks<'_>).cast::<c_void>();
    // SAFETY: whisper_full_with_state is synchronous, joins its workers before returning,
    // and does not retain callback pointers. `callbacks` and `operation` outlive that call.
    // The callbacks use only immutable references and catch all Rust panics at the boundary.
    unsafe {
        parameters.set_abort_callback(Some(abort));
        parameters.set_abort_callback_user_data(data);
        parameters.set_progress_callback(Some(progress));
        parameters.set_progress_callback_user_data(data);
    }
    state.full(parameters, audio)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    #[test]
    fn callbacks_observe_cancellation_and_channel_loss_without_unwinding() {
        let service = Arc::new(super::super::Dictation::default());
        let operation = service
            .begin(
                "test",
                uuid::Uuid::new_v4().to_string(),
                Arc::new(|_| false),
                Box::new(|| true),
            )
            .unwrap();
        let mut callbacks = Callbacks {
            operation: &operation,
        };
        let data = (&mut callbacks as *mut Callbacks<'_>).cast();
        assert!(!abort(data));
        progress(std::ptr::null_mut(), std::ptr::null_mut(), 50, data);
        assert!(abort(data));
    }
}
