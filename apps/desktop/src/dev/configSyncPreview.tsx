/** Synthetic configuration sync exercise. Never opens real provider roots or Account stores. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConfigSyncPanel } from "../components/settings/ConfigSyncPanel";
import type { ConfigSyncApi } from "../lib/config-sync/api";
import type { ConfigSyncItem } from "../lib/config-sync/bindings";
import "../components/settings/settings.css";

declare global {
  interface Window {
    configSyncCalls: string[];
  }
}
export function mountConfigSyncPreview(container: HTMLElement) {
  const scenario = new URLSearchParams(location.search).get("case");
  window.configSyncCalls = [];
  let applied = false;
  let restored = false;
  const item: ConfigSyncItem = {
    id: "fixture",
    label: "AGENTS.md",
    provider: "codex",
    scope: "portable",
    operation: "conflict",
    first_link: true,
    device_only: false,
    skipped: false,
    detail: null,
  };
  const api: ConfigSyncApi = {
    async inventory(after) {
      window.configSyncCalls.push(`inventory:${after ?? "first"}`);
      return {
        items: after
          ? [{ ...item, id: "second", label: "rules/review.md", operation: "publish" }]
          : [{ ...item, operation: applied ? "in_sync" : "conflict" }],
        next_cursor: after ? null : "fixture",
        notices: ["One Codex item is waiting for its agent."],
      };
    },
    async history() {
      return [
        {
          id: "receipt",
          item_id: "fixture",
          label: "AGENTS.md",
          provider: "codex",
          status: restored
            ? "rolled_back"
            : scenario === "partial"
              ? "recovery_required"
              : "applied",
        },
      ];
    },
    async preview(id, choice) {
      window.configSyncCalls.push(`preview:${choice}`);
      return {
        token: `${id}:${choice}`,
        item: { ...item, operation: choice === "automatic" ? "conflict" : "merge" },
        choice,
        base: "Write focused changes.\n",
        local: "Write focused changes.\nCheck the final diff.\n",
        remote: "Write focused changes.\nExplain the result.\n",
        result:
          choice === "automatic"
            ? null
            : choice === "keep_local"
              ? "Write focused changes.\nCheck the final diff.\n"
              : "Write focused changes.\nExplain the result.\n",
        conflicts: choice === "automatic" ? ["AGENTS.md"] : [],
        deletes_item: scenario === "delete",
        can_apply: choice !== "automatic",
        warnings: [
          "This review expires after ten minutes. Changes remain encrypted in your Account profile.",
        ],
      };
    },
    async cancel(token) {
      window.configSyncCalls.push(`cancel:${token}`);
    },
    async apply(token) {
      window.configSyncCalls.push(`apply:${token}`);
      if (scenario === "stale") throw new Error("This item changed after review. Review it again.");
      applied = true;
      return {
        item_id: "fixture",
        receipt_id: "receipt",
        completed: scenario !== "partial",
        message:
          scenario === "partial"
            ? "The local change needs recovery. Open History to restore it before retrying."
            : "Configuration saved to this Account profile.",
      };
    },
    async deviceOnly(_id, value) {
      window.configSyncCalls.push(`device:${value}`);
      item.device_only = value;
    },
    async rollback(id) {
      window.configSyncCalls.push(`rollback:${id}`);
      restored = true;
      return {
        item_id: "fixture",
        receipt_id: "restored",
        completed: true,
        message: "Local configuration restored. Review the item before synchronizing this change.",
      };
    },
  };
  createRoot(container).render(
    <StrictMode>
      <main className="settings-shell g-root">
        <div className="settings-main">
          <div className="settings-content">
            <header>
              <h1>Configuration sync</h1>
              <p>Bring your setup with you.</p>
            </header>
            <ConfigSyncPanel
              active={scenario !== "local"}
              onAccount={() => window.configSyncCalls.push("account")}
              api={api}
            />
          </div>
        </div>
      </main>
    </StrictMode>,
  );
}
