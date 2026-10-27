import { emit, listen } from "@tauri-apps/api/event";
import { composerApi } from "./composer";
import { flushComposerDrafts } from "./composerDraft";
import { inTauri } from "./ipc";

/** The native quit flow keeps the store open until this explicit flush is acknowledged. */
export function installDraftQuit(): void {
  if (!inTauri()) return;
  void listen<string>("auracode-flush-drafts", (event) => {
    void flushComposerDrafts(composerApi)
      .then((saved) => emit("auracode-drafts-flushed", { token: event.payload, saved }))
      .catch(() => {
        void emit("auracode-drafts-flushed", { token: event.payload, saved: false }).catch(
          () => {},
        );
      });
  }).catch(() => {
    /* The native quit flow reports an unavailable flush before closing. */
  });
}
