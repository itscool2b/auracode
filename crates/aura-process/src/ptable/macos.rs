//! macOS: parsing `ps -axo pid=,ppid=,pgid=,lstart=,command=` (package A). The parser is pure and
//! builds on every OS so its tests run everywhere; only the call to `ps` is macOS-only.
