//! The fake agent (package B): walks a fixture's records, writing `in` lines to the driver (response
//! ids rewritten to the live ids), reading and comparing the driver's `out` lines, and acting on
//! `agent` records (EOF, exit, oversized lines, waits).
