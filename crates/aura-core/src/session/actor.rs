//! The chat actor (package C): one per chat, owning its state, batcher, normalizer, subscribers,
//! queue, open turn and live driver; it never awaits inline, so IPC commands, driver events, store
//! permits, flushes and timers are all handled in one loop.
