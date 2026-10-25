//! The permission policy (package C): one function over the dialect's autonomy state decides
//! whether a request is answered on the user's behalf or shown as a card. Never `allow_always`, never
//! `switch_mode`, kind `other` or a request without a kind; questions are never auto-answered.
