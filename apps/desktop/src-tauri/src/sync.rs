//! Lock helpers.

use std::sync::{Mutex, MutexGuard, PoisonError};

/// Locks `mutex`, recovering from poisoning. A poisoned lock only means another thread panicked
/// while holding it; every value guarded in this crate is updated in single steps (one insert, one
/// remove, one swap), so the data is consistent and the app keeps working instead of cascading the
/// panic into every later command.
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn a_poisoned_lock_still_yields_its_data() {
        let shared = Arc::new(Mutex::new(vec![1, 2, 3]));
        let poisoner = Arc::clone(&shared);
        let result = std::thread::spawn(move || {
            let _guard = poisoner.lock().expect("lock");
            panic!("poison the lock");
        })
        .join();
        assert!(result.is_err());
        assert!(shared.is_poisoned());
        assert_eq!(*lock(&shared), vec![1, 2, 3]);
    }
}
