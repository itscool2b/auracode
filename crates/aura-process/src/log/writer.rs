//! The writer task (package A): one per spawn, draining the bounded record queue, redacting each
//! record, capping it at `LogLimits::max_record_bytes`, appending it, and rotating at
//! `LogLimits::max_file_bytes`. A full queue drops and counts; a `{"note":{"dropped":n}}` follows.
