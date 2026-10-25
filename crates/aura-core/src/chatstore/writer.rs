//! The writer thread (package C): the FIFO and its group commits, the read channel served from saved
//! data while saving is paused, disk-full and busy pauses, poison isolation into the dead-letter
//! file, and shutdown.
