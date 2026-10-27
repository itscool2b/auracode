/** Synthetic workspace only. No vault, database, native account or network calls. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { KeepAsLocalPanel } from "../components/settings/KeepAsLocalPanel";
import type { AccountPreservationApi } from "../lib/accountPreservation";
import "../components/settings/settings.css";

const calls: string[] = [];
const params = new URLSearchParams(location.search);
let sequence = 0;
const api: AccountPreservationApi = {
  preview: async () => {
    calls.push("preview");
    return {
      token: `review-${++sequence}`,
      projects: 2,
      chats: 8,
      turns: 42,
      notices: [
        "Create a separate, unencrypted Local profile on this computer. Nothing is uploaded.",
        "The encrypted Account profile and its retained key remain intact. Your existing Local profile is unchanged.",
        "Copy nondeleted projects, archived and active chats, saved drafts and available chat attachments. Deleted projects/chats, native agent sessions, credentials, configuration, queued prompts, pending handoffs, checkpoint history, worktree ownership and protocol logs are excluded.",
        "Working files stay in place. Chats use project folders and a visible Continue here handoff before a new agent prompt. Unfinished replies are retained as interrupted.",
        "Missing attachments remain visibly unavailable. Failed copies retain their unencrypted partial files in a separate profile folder and are never activated automatically.",
        "One copy supports up to 4096 referenced attachments, 512 MiB of decrypted attachment data and 512 MiB of workspace rows. Larger copies stop and preserve the encrypted original.",
      ],
    };
  },
  apply: async (token) => {
    calls.push(`apply:${token}`);
    if (params.has("stale")) throw new Error("The workspace changed. Review Keep as Local again.");
    if (params.has("partial"))
      throw new Error(
        "The copy did not finish. Unencrypted partial files remain in profile partial-copy. The encrypted original is unchanged.",
      );
    return {
      profile_id: "kept-local",
      display_name: "Kept Local workspace",
      projects: 2,
      chats: 8,
      turns: 42,
      missing_attachments: 1,
    };
  },
};
Object.assign(window, { preservationFixture: { calls: () => [...calls] } });
export function mountAccountPreservationPreview(container: HTMLElement) {
  createRoot(container).render(
    <StrictMode>
      <main className="g-root settings-content">
        <h1>Account</h1>
        <KeepAsLocalPanel
          api={api}
          onOpen={async (id) => {
            calls.push(`open:${id}`);
            if (params.has("open-fails"))
              throw new Error("Profile switching is unavailable while a terminal is open.");
          }}
        />
      </main>
    </StrictMode>,
  );
}
