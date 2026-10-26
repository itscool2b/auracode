/** Synthetic publication only. All GitHub and Git operations are fake in this entry. */
import "../styles.css";
import "../ui-tokens.css";
import "../components/setup/setup.css";
import { createRoot } from "react-dom/client";
import { RepositoryPublisher } from "../components/setup/RepositoryPublisher";
import type { RepositoryPublicationApi } from "../lib/repositoryPublication";

const mode = new URLSearchParams(location.search).get("case");
const calls: string[] = [];
let attempts = 0;
const api: RepositoryPublicationApi = {
  draft: async () => {
    calls.push("local-draft");
    return mode === "reopen"
      ? { input: { owner: "fixture", name: "project" }, unfinished: true }
      : null;
  },
  review: async (_folderId, input) => {
    calls.push("remote-review");
    return {
      token: `review-${attempts}`,
      folder_id: "folder",
      path: "C:\\Code\\project",
      repository: `${input.owner || "fixture"}/${input.name}`,
      url: "https://github.com/fixture/project",
      branch: "main",
      head_commit: "a".repeat(40),
      private: true,
      recovering: attempts > 0 || mode === "reopen",
      will_create: attempts === 0 && mode !== "reopen",
      will_push: true,
      notices: ["Private repository. Staged and unstaged files remain unchanged."],
    };
  },
  apply: async () => {
    calls.push("remote-apply");
    attempts++;
    const uncertain = mode === "uncertain" && attempts === 1;
    return {
      folder_id: "folder",
      url: "https://github.com/fixture/project",
      repository: "fixture/project",
      head_commit: "a".repeat(40),
      state: uncertain ? "needs_review" : "complete",
      detail: uncertain
        ? "GitHub did not confirm the push. Review before retrying."
        : "The private repository is published.",
    };
  },
};
Object.assign(window, { publicationFixture: { calls: () => [...calls] } });
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <main className="setup-shell" style={{ overflow: "auto", padding: 40 }}>
      <RepositoryPublisher
        folderId="folder"
        api={api}
        onPublished={async () => {
          calls.push("published");
          if (mode === "refresh") throw new Error("refresh failed");
        }}
      />
    </main>,
  );
