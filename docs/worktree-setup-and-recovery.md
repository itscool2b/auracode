# Worktree setup and retained folders

A new worktree chat opens its conversation as soon as the chat is saved. Messages typed during
setup use the same saved queue as other messages. They can be edited, reordered and removed while
the setup review or terminal is open in the docked panel.

Setup admission is stored for this chat and device in the profile database. Its states are
`awaiting`, `running`, `failed`, `interrupted` and `succeeded`. Each reviewed retry receives a new
generation. The chat and its first pending setup state are saved in the same transaction, before
the conversation is returned to the interface. Existing chats have no pending setup state.

The Rust actor refuses both explicit agent starts and queued prompt dispatch until setup succeeds.
The terminal owner records success only after exit code zero and confirmed process cleanup.
Closing the terminal, timing out, launch failure or another exit code leaves setup failed and
holds its messages. Hiding the docked panel keeps the owned terminal running. A renderer callback
cannot mark setup successful or start the agent.

Review tokens are bound to the generation they observed. Expired current reviews, unavailable
folders and folder-admission refusals record failure and hold messages. Setup uses its own native
terminal reservation: the prepared launch and completion owner remain in the terminal slot until
a matching chat/token claim starts it. A full terminal pool or closing a pending slot also fails
that generation. Invalid or stale reviews and claims cannot fail a newer or unrelated attempt.
The review cache admits at most 64 chats, each retaining its current command receipt and one
replacement review. Reviewing again reclaims the chat's obsolete review before checking capacity,
so expired receipts cannot prevent an admitted chat from retrying.

After success, unheld messages leave in their saved order once. Messages held by a failure, a
restart or the person stay held until explicitly sent. Retrying reviews the saved command only;
it does not copy setup files again. An old command token or completion cannot complete a newer
generation. On restart, unfinished attempts become interrupted and messages remain held. Setup
never reruns automatically.

Queued lifecycle events carry the Rust-owned hold for that prompt, including new messages typed
while setup has failed or was interrupted and updates when existing queued messages become held.
The interface uses that row's hold directly, so a second
held message keeps its Send action even when another held message already exists. Setup status
changes do not require resetting loaded conversation history to discover those new holds.

Migration 15 adds the device-local attempt table using the existing pre-migration database backup
path. Attempt state, terminal input and terminal output are not synchronized. Setup recipes remain
device-local and no file contents are stored in recipes.

If a worktree chat cannot be saved and safe rollback refuses to remove changed files, the profile
retains its worktree journal. New chat and the source project's settings show its branch, original
source, retained folder and failure detail even though no chat exists. Review recovery uses the
same single-use reconcile, restore or recreation previews as the existing chat route. The backend
looks up the owner by stored worktree ID in the active profile; it does not trust a supplied chat
ID or path. Reconciliation retains the chatless record and all files. Open folder resolves and
checks the profile-owned path before passing it to the operating system.

Listing retained records does not require the source repository to be available. Applying recovery
still verifies its reviewed Git state and refuses changed or missing repositories. Managed
worktrees show branch/source labels in folder choices, are omitted as New chat source folders and
remain available as legitimate Move chat destinations.

Focused verification lives in the core setup-attempt, session worktree-setup, worktree-chat and
terminal tests. `check-setup-recovery.mjs`, also called by the settings acceptance checker,
exercises the normal composer, setup terminal, failure/retry, restart and chatless recovery with
in-memory fixtures. It starts no agent, modifies no repository and opens no real folder.
