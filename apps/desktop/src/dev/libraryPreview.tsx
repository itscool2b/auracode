/** Development-only fixture. It reads no native configuration and invokes no agent. */
import "../styles.css";
import "../ui-tokens.css";
import "../chat.css";
import "../orbit-shell.css";
import { createRoot } from "react-dom/client";
import { LibraryScreen } from "../components/library/LibraryScreen";
import type { VendorApi } from "../lib/config-vendor/api";
import type { LibraryApi } from "../lib/library/api";
import type {
  LibraryCopyReceipt,
  LibraryInventory,
  LibraryItem,
  LibraryItemRef,
} from "../lib/library/bindings";

function fixture() {
  const calls: string[] = [];
  const receipts: LibraryCopyReceipt[] = [];
  let pending = false;
  let resolvePreparation: (() => void) | null = null;
  const parameters = new URLSearchParams(location.search);
  const text =
    "# Review changes\n\nRead the surrounding code before suggesting a change.\n\n- Describe a reproducible failure.\n- Keep each fix focused.\n- Run the relevant checks.\n\n<script>window.shouldNeverRun = true</script>\n";
  const items: LibraryItem[] = [
    [
      "review-changes",
      "Review changes",
      "skill",
      "claude",
      "user",
      "skills/review-changes/SKILL.md",
    ],
    ["AGENTS.md", "AGENTS.md", "instructions", "codex", "user", "AGENTS.md"],
    ["release-check", "Release check", "skill", "pi", "user", "skills/release-check/SKILL.md"],
    ["docs", "Documentation", "mcp_server", "claude", "user", ".claude.json"],
    ["private", "Private issue tracker", "mcp_server", "codex", "user", "config.toml"],
    ["code-review", "Code review", "plugin", "claude", "user", "settings.json"],
    ["npm:pi-tools", "pi-tools", "package", "pi", "user", "settings.json"],
  ].map(
    ([key, label, kind, provider, scope, relative]) =>
      ({
        item: { key, kind, source_id: `user:${provider}` },
        label,
        provider,
        scope,
        relative_path: relative,
        revision: "synthetic-revision",
        bytes: text.length,
        copy_blocked:
          key === "private"
            ? "This server has authentication or vendor options that require manual setup. Values are hidden."
            : null,
      }) as LibraryItem,
  );
  const inventory: LibraryInventory = {
    items,
    sources: ["claude", "codex", "pi", "shared"].map(
      (provider) =>
        ({
          id: `user:${provider}`,
          provider,
          scope: "user",
          available: true,
          message: null,
        }) as LibraryInventory["sources"][number],
    ),
    notices: [],
  };
  const find = (reference: LibraryItemRef) => {
    const item = items.find((item) => item.item.key === reference.key);
    if (!item) throw new Error("Synthetic item missing");
    return item;
  };
  const api: LibraryApi = {
    snapshot: async (folder) => {
      calls.push(`snapshot:${folder}`);
      return inventory;
    },
    history: async () => {
      calls.push("history");
      return [...receipts];
    },
    preview: async (_, reference) => {
      calls.push(`preview:${reference.key}`);
      return {
        item: find(reference),
        text:
          reference.key === "private"
            ? '{"values":"Hidden for manual review"}'
            : reference.kind === "mcp_server"
              ? '{"url":"https://example.test/mcp","type":"http"}'
              : text,
        files: reference.kind === "skill" ? ["SKILL.md", "scripts/check.txt"] : [],
        notices: [],
      };
    },
    prepare: async (_, from, __, to_source) => {
      calls.push("prepare");
      pending = true;
      if (parameters.has("delay"))
        await new Promise<void>((resolve) => {
          resolvePreparation = resolve;
        });
      return {
        id: "synthetic-copy",
        from,
        to_source,
        before_text:
          from.kind === "mcp_server" ? null : "# Earlier instructions\n\nKeep changes small.\n",
        after_text: from.kind === "mcp_server" ? '{"url":"https://example.test/mcp"}' : text,
        files:
          from.kind === "mcp_server"
            ? [{ path: "config.toml", before_revision: "old", after_revision: "new", bytes: 40 }]
            : [
                {
                  path: "skills/review-changes/SKILL.md",
                  before_revision: "old",
                  after_revision: "new",
                  bytes: text.length,
                },
                {
                  path: "skills/review-changes/scripts/check.txt",
                  before_revision: null,
                  after_revision: "script",
                  bytes: 15,
                },
              ],
        notices: [
          "Existing unrelated files stay in place. Replaced files are retained for rollback.",
        ],
      };
    },
    cancel: async () => {
      calls.push("cancel");
      pending = false;
    },
    apply: async (id) => {
      calls.push("apply");
      if (!pending) throw new Error("Preview already consumed");
      pending = false;
      if (parameters.has("stale"))
        throw new Error(
          "The item changed after it was displayed. Refresh the Library and try again.",
        );
      receipts.push({
        id,
        source_id: "user:codex",
        kind: "skill",
        files: ["skills/review-changes/SKILL.md"],
        state: "complete",
      });
      return {
        id,
        source_id: "user:codex",
        applied: ["skills/review-changes/SKILL.md"],
        recovery_required: false,
        message: null,
      };
    },
    rollback: async (_, source_id, id) => {
      calls.push("rollback");
      receipts[0] = {
        id,
        source_id,
        kind: "skill",
        files: ["skills/review-changes/SKILL.md"],
        state: "rolled_back",
      };
      return {
        id,
        source_id,
        applied: ["skills/review-changes/SKILL.md"],
        recovery_required: false,
        message: null,
      };
    },
  };
  const vendorApi: VendorApi = {
    review: async (request) => {
      calls.push("vendor-review");
      return {
        token: "vendor-review",
        request,
        program: "C:/fixture/claude.exe",
        arguments: ["plugin", "install", request.target, "--scope", "user"],
        working_directory: "C:/fixture",
        config_directory: "C:/fixture/.claude",
        revision: "fixture",
        timeout_seconds: 600,
        notices: [
          "Synthetic fixture. No vendor command runs.",
          "The vendor may download and execute third-party code.",
        ],
      };
    },
    cancel: async () => {
      calls.push("vendor-cancel");
    },
    terminal: () => ({
      reserve: async () => {
        calls.push("vendor-reserve");
        return "vendor-terminal";
      },
      start: async () => {
        calls.push("vendor-start");
        return "vendor-terminal";
      },
      read: async () => ({
        bytes: [...new TextEncoder().encode("Synthetic command completed.\r\n")],
        done: true,
        exit_code: 0,
        truncated: false,
      }),
      write: async () => {},
      resize: async () => {},
      close: async () => {
        calls.push("vendor-close");
      },
    }),
  };
  return {
    api,
    vendorApi,
    calls: () => [...calls],
    finishPreparation: () => resolvePreparation?.(),
    pending: () => pending,
  };
}

declare global {
  interface Window {
    libraryFixture: ReturnType<typeof fixture>;
  }
}
const container = document.getElementById("root");
if (import.meta.env.DEV && container) {
  const data = fixture();
  window.libraryFixture = data;
  createRoot(container).render(
    <LibraryScreen
      api={data.api}
      vendorApi={data.vendorApi}
      onBack={() => {
        container.textContent = "Back to chats";
      }}
      folders={[{ id: "project-fixture", label: "Orbital / app" }]}
    />,
  );
}
