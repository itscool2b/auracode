//! The normalizer (package C): fits every non-delta event within the event budget (fixed caps, then
//! raw input, locations, content and option names, in that order), spills full originals to blobs,
//! and tracks open messages, thoughts, cards and questions so turn ends and driver exits close them.
