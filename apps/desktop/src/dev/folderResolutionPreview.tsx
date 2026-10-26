/** Synthetic folder resolution only. No native filesystem, agent or remote calls. */
import "../styles.css";
import "../ui-tokens.css";
import "../components/setup/setup.css";
import { createRoot } from "react-dom/client";
import type { FolderLocationReview, FolderResolution } from "../bindings";
import { FolderResolver } from "../components/setup/FolderResolver";
import type { FolderResolutionApi } from "../lib/folderResolution";

const calls: string[] = [];
const mode = new URLSearchParams(location.search).get("case");
const value: FolderResolution = {
  folder: {
    id: "folder",
    project_id: "project",
    display_name: "Sample",
    path: null,
    folder_state: "missing",
    unavailable_reason: "Locate folder",
    kind: "git",
    git_remote_url: "https://github.com/fixture/project",
    git_default_branch: "main",
  },
  roots: ["C:\\Code"],
  matches: [],
  truncated: false,
  notices: [],
};
let attempts = 0;
const api: FolderResolutionApi = {
  resolution: async (_id, search) => {
    calls.push(search ? "search" : "inspect");
    return { ...value, matches: search ? ["C:\\Code\\project"] : [] };
  },
  setRoots: async (roots) => {
    calls.push("roots");
    value.roots = roots;
    return roots;
  },
  review: async (folderId, path): Promise<FolderLocationReview> => {
    calls.push("review");
    return {
      folder_id: folderId,
      path,
      revision: `review-${attempts}`,
      notices: ["This changes only this device's folder mapping."],
    };
  },
  apply: async (review) => {
    calls.push("apply");
    attempts++;
    if (mode === "stale" && attempts === 1)
      throw new Error("The folder changed. Review its location again.");
    return { ...value.folder, path: review.path, folder_state: "ok", unavailable_reason: null };
  },
};
Object.assign(window, { folderFixture: { calls: () => [...calls] } });
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <main className="setup-shell" style={{ overflow: "auto", padding: 40 }}>
      <FolderResolver
        folderId="folder"
        api={api}
        pickFolder={async () => "C:\\Code\\project"}
        onLocated={async () => {
          calls.push("located");
          if (mode === "refresh") throw new Error("refresh failed");
        }}
      />
    </main>,
  );
