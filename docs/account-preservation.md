# Keeping a deleted Account workspace as Local

An exact unexpired session that was valid when its account was deleted can receive
`account_deleted`. The client clears its bearer and durably records Deleted in its secure bundle,
while retaining confirmed decryption material. It never replaces the encrypted profile with an
empty account. Ordinary expiry and revoked devices remain distinct unauthorized/denied cases.

Keep as Local requires that same Account profile to be unlocked and active. Review reads its
saved rows through the keyed writer, without contacting authentication or reading vendor files.
A one-use ten-minute token binds the complete reviewed workspace projection. Applying a changed
or expired review refuses before a destination is created. Applying holds the profile lease,
transition mutex, terminal-idle gate and session-idle gate through the actual writer result,
including when the requesting page disappears.

The explicit action creates a separate **unencrypted** Local profile, never modifies the existing
Local profile and never deletes the encrypted Account or its key. Its review lists the privacy
change and omissions. It copies nondeleted projects, archived and active chats, turns, saved drafts,
current-device folder locations and referenced available attachments. Native sessions, vendor
credentials, configuration, queued prompts, pending handoffs, worktree ownership, checkpoints,
protocol logs and sync state are excluded. Working files stay in place. Managed chats return to
their project-folder context, and any new prompt requires the existing visible Continue here flow.
Destination-only recovery retains partial answers as interrupted and closes old approval cards.

Each copy is bounded to 1024 projects, 512 MiB of workspace rows, 4096 referenced attachment objects
and 512 MiB of decrypted attachment data; individual objects retain the 64 MiB limit. Encrypted
attachment authentication and hashes are checked before publication. Missing files are counted in
the result. Malformed content or exceeded limits fail without publishing a usable profile.

The destination is a fresh app-owned UUID directory. Attachments and publication metadata use exclusive, no-follow writes;
Windows owner-only access is verified. The database and files are synced before an atomic
no-replace `profile.json` publication. Incomplete copies have an explicit marker and stay outside
the profile list. Failed operations identify their retained partial folder; the app never deletes
those plaintext files automatically or retries the operation without a new review. A successful
copy is listed separately and opens only when the user selects Open Local copy. Configuration
transition and profile-switch safety checks still apply to that later action.

Development checks use only synthetic encrypted profiles, synthetic service sessions and browser
fixtures. Actual Account deletion, owner data and vendor authentication are not used for verification.
