//! Retention (package A): runs at boot in the background and when a session ends. Deletes files
//! older than `RetentionPolicy::max_age`, then the oldest files until the profile's protocol logs
//! fit `RetentionPolicy::max_total_bytes`.
