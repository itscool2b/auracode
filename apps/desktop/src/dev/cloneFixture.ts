/**
 * A synthetic clone service for previews and browser checks. It imitates Rust's answers (the
 * problem beside its field, the exact command, Git's stages) and never runs Git or touches disk.
 */
import type { CloneApi } from "../lib/setup-actions/api";
import type { CloneCheck, CloneRecord, CloneRecovery } from "../lib/setup-actions/bindings";

/** How a started clone ends: it finishes, stays running at 62%, or fails like a missing repo. */
export type CloneOutcome = "ready" | "running" | "error";

const STAGES: readonly [string, number, number, string | null][] = [
  ["Counting objects", 100, 5, null],
  ["Receiving objects", 18, 17, "2.10 MiB"],
  ["Receiving objects", 62, 48, "7.36 MiB"],
  ["Resolving deltas", 100, 90, "11.80 MiB"],
  ["Updating files", 100, 100, "11.80 MiB"],
];

export function cloneFixture(outcome: CloneOutcome, calls: string[] = []): CloneApi {
  let recoveries: CloneRecovery[] = new URLSearchParams(location.search).has("recovery")
    ? [
        {
          id: "saved-clone",
          state: "ready",
          repository: "auracode/orbit",
          remote: "https://github.com/auracode/orbit",
          destination: "C:\\Users\\fixture\\old-clone",
          detail: "Git completed this clone. The folder has been preserved.",
          can_add: true,
          can_open: true,
        },
      ]
    : [];
  let record: CloneRecord | null = null;
  let step = 0;
  let wake: (() => void) | null = null;
  const sleep = (ms: number) =>
    new Promise<void>((done) => {
      const timer = setTimeout(done, ms);
      wake = () => {
        clearTimeout(timer);
        done();
      };
    });
  return {
    recoveryList: async () => [...recoveries],
    recoveryReady: async (id) => {
      calls.push("clone-recovery-validate");
      const record = recoveries.find((row) => row.id === id);
      if (!record) throw new Error("No recovery record in this preview.");
      return record;
    },
    recoveryOpen: async () => {
      calls.push("clone-recovery-open");
    },
    recoveryDismiss: async (id) => {
      calls.push("clone-recovery-dismiss");
      recoveries = recoveries.filter((row) => row.id !== id);
    },
    check: async ({ remote, parent, name }) => {
      calls.push("clone-check");
      const text = remote.trim();
      const check: CloneCheck = { repository: null, name: null, review: null, problem: null };
      if (!text) {
        check.problem = { field: "remote", message: "Paste the repository's address." };
        return check;
      }
      if (text.startsWith("http://")) {
        check.problem = {
          field: "remote",
          message: "Use the https:// address. Plain http:// sends the repository unencrypted.",
        };
        return check;
      }
      if (!/^(https:\/\/|ssh:\/\/|git@)/.test(text)) {
        check.problem = {
          field: "remote",
          message:
            "Only https:// and SSH addresses can be cloned, such as https://github.com/owner/repository.",
        };
        return check;
      }
      const parts = text
        .replace(/^[^:]+:\/\/[^/]+\//, "")
        .replace(/^git@[^:]+:/, "")
        .replace(/\/+$/, "")
        .split("/");
      const last = (parts.at(-1) ?? "").replace(/\.git$/, "");
      check.repository = parts.length > 1 ? `${parts.at(-2)}/${last}` : last;
      const folder = name || last;
      check.name = folder;
      if (!parent) {
        check.problem = { field: "parent", message: "Choose a folder to clone into." };
        return check;
      }
      if (folder === "existing" || new URLSearchParams(location.search).has("existing")) {
        check.problem = {
          field: "name",
          message: `${parent} already has a ${folder} folder. Choose another name.`,
        };
        return check;
      }
      const destination = `${parent}${parent.includes("\\") ? "\\" : "/"}${folder}`;
      const quoted = destination.includes(" ") ? `"${destination}"` : destination;
      check.review = {
        id: `clone-${calls.length}`,
        remote: text,
        repository: check.repository,
        parent,
        destination,
        program: "C:\\Program Files\\Git\\cmd\\git.exe",
        arguments: ["clone", "--progress", "--", text, destination],
        command: `git clone --progress -- ${text} ${quoted}`,
      };
      return check;
    },
    cancelReview: async () => {
      calls.push("clone-cancel-review");
    },
    start: async (id) => {
      calls.push("clone-start");
      step = 0;
      record = {
        id,
        revision: 1,
        remote: "https://github.com/auracode/orbit",
        repository: "auracode/orbit",
        destination: "C:\\Users\\fixture\\code\\orbit",
        state: "running",
        detail: "Cloning.",
        progress: null,
        output: [],
        removed: false,
      };
      return { ...record };
    },
    status: async (_id, after) => {
      if (!record) throw new Error("This clone is no longer open.");
      if (after !== null && after >= record.revision) {
        // Rust's long poll: the next revision, or the same record after a while.
        const settled = outcome === "running" && step >= limit(outcome);
        await sleep(record.state === "running" && !settled ? 240 : 10_000);
      }
      if (record.state === "running") {
        if (outcome === "error" && step >= 1) {
          record = {
            ...record,
            revision: record.revision + 1,
            state: "failed",
            detail:
              "Git could not find this repository. Check the address and that your account can see it. The unfinished folder was removed.",
            output: [
              "Cloning into 'C:\\Users\\fixture\\code\\orbit'...",
              "remote: Repository not found.",
              "fatal: repository 'https://github.com/auracode/orbit.git/' not found",
            ],
            removed: true,
          };
        } else if (step < limit(outcome)) {
          const [stage, stagePercent, percent, received] = STAGES[step] ?? [
            "Receiving objects",
            0,
            5,
            null,
          ];
          step++;
          record = {
            ...record,
            revision: record.revision + 1,
            progress: { stage, stage_percent: stagePercent, percent, received },
          };
        } else if (outcome === "ready") {
          record = {
            ...record,
            revision: record.revision + 1,
            state: "ready",
            detail: "Cloned auracode/orbit.",
          };
        }
      }
      return { ...record };
    },
    cancel: async () => {
      calls.push("clone-cancel");
      if (record?.state === "running") {
        record = {
          ...record,
          revision: record.revision + 1,
          state: "canceled",
          detail: "Clone canceled. The unfinished folder was removed.",
          progress: null,
          removed: true,
        };
      }
      const resume = wake as (() => void) | null;
      resume?.();
    },
  };
}

/** How many progress reports a clone makes before it settles. */
function limit(outcome: CloneOutcome): number {
  return outcome === "running" ? 3 : outcome === "ready" ? STAGES.length : 1;
}
