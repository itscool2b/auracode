# Questions and permission requests

Pending requests use the composer area in their original arrival order. Only the oldest request
has controls; the remaining count sits below it. Answering, dismissing or withdrawing that request
reveals the next. An answer that fails stays available for retry. Informational notifications remain
in the transcript and never block the composer. Pending requests do not appear twice in the dock
and transcript, and resolved requests remain in conversation history.

A group of questions presents one question at a time. Next requires an answer to the current
question, Back retains all drafts, and Submit answers sends the complete group once. A single
choice and free text replace one another; multiple choices and optional free text can coexist.
Navigation and answers disable while the response is pending. No choice is selected automatically.

The composer stays mounted while requests wait, retaining its text and attachments. Keyboard
navigation follows the new question when a step changes. When a request closes, focus moves to the
next request or back to the composer if focus belonged to the request. Focus elsewhere in the app
stays where the reader placed it.

## Verification

`apps/desktop/scripts/check-questions.mjs` uses an owned browser transport with no agent calls. It
covers arrival ordering for mixed requests, grouped questions, single and multiple selections,
free text, Back and Next, retry after failure, withdrawal during an in-flight response, history
reattachment, keyboard focus, composer draft retention, narrow reflow and accessibility. Run it
with `CHECK_URL` pointing to the desktop Vite fixture server. It uses Chromium and WebKit in both
appearances and writes captures to `target/questions-browser/`.

The layout probe also opens `questions&case=mixed#request` and
`questions&case=group#question-step`. On 2 November 2026, all 24 request views passed across both
engines and appearances at 1440x900 and 960x640 over the worst glass backdrop. These are browser
fixtures, not native window or live-agent acceptance evidence. Halo still awaits the owner's
visual lock.
