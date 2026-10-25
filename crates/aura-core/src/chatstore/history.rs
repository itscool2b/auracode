//! History pages (package C): whole turns below a cursor within a byte budget, or the newest rows of
//! a turn too large for one page (with `cut_turn_id`); rows that do not parse are skipped and
//! counted, except `turn_ended` rows.
