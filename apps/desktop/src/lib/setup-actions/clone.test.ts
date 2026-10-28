import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloneApi } from "./api";
import type { CloneCheck, CloneInput, CloneRecord, CloneReview } from "./bindings";
import { CloneController, folderName, progressLine, TYPING_MS } from "./clone";

function review(id: string, input: CloneInput): CloneReview {
  const name = input.name ?? "repo";
  return {
    id,
    remote: input.remote,
    repository: "owner/repo",
    parent: input.parent ?? "",
    destination: `${input.parent}\\${name}`,
    program: "C:\\Program Files\\Git\\cmd\\git.exe",
    arguments: ["clone", "--progress", "--", input.remote, `${input.parent}\\${name}`],
    command: `git clone --progress -- ${input.remote} ${input.parent}\\${name}`,
  };
}

function answer(id: string, input: CloneInput): CloneCheck {
  if (!input.remote.startsWith("https://"))
    return {
      repository: null,
      name: null,
      review: null,
      problem: { field: "remote", message: "Only https:// and SSH addresses can be cloned." },
    };
  if (!input.parent)
    return {
      repository: "owner/repo",
      name: input.name ?? "repo",
      review: null,
      problem: { field: "parent", message: "Choose a folder to clone into." },
    };
  return {
    repository: "owner/repo",
    name: input.name ?? "repo",
    review: review(id, input),
    problem: null,
  };
}

function record(id: string, change: Partial<CloneRecord> = {}): CloneRecord {
  return {
    id,
    revision: 1,
    remote: "https://github.com/owner/repo",
    repository: "owner/repo",
    destination: "C:\\code\\repo",
    state: "running",
    detail: "Cloning.",
    progress: null,
    output: [],
    removed: false,
    ...change,
  };
}

/** A clone service whose status answers are queued by the test. */
function fakeApi() {
  const calls: string[] = [];
  const inputs: CloneInput[] = [];
  const statuses: CloneRecord[] = [];
  let next = 0;
  const api: CloneApi = {
    check: vi.fn(async (input: CloneInput) => {
      inputs.push(input);
      return answer(`review-${++next}`, input);
    }),
    cancelReview: vi.fn(async (id: string) => {
      calls.push(`release ${id}`);
    }),
    start: vi.fn(async (id: string) => {
      calls.push(`start ${id}`);
      return record(id);
    }),
    status: vi.fn(async () => {
      const value = statuses.shift();
      if (!value) throw new Error("no status queued");
      return value;
    }),
    cancel: vi.fn(async (id: string) => {
      calls.push(`cancel ${id}`);
    }),
  };
  return { api, calls, inputs, statuses };
}

const flush = async () => {
  for (let index = 0; index < 10; index++) await Promise.resolve();
};

describe("CloneController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("asks Rust once typing pauses and shows the repository's own folder name", async () => {
    const { api, inputs } = fakeApi();
    const clone = new CloneController(api, { parent: "C:\\code" });
    clone.open();
    clone.setRemote("https://github.com/o");
    clone.setRemote("https://github.com/owner/re");
    clone.setRemote("https://github.com/owner/repo");
    expect(clone.getSnapshot().checking).toBe(true);
    await vi.advanceTimersByTimeAsync(TYPING_MS);
    expect(inputs).toEqual([
      { remote: "https://github.com/owner/repo", parent: "C:\\code", name: null },
    ]);
    const view = clone.getSnapshot();
    expect(view.name).toBe("repo");
    expect(view.check?.review?.command).toBe(
      "git clone --progress -- https://github.com/owner/repo C:\\code\\repo",
    );
    expect(clone.canStart).toBe(true);
    // A typed name is sent and kept; clearing it goes back to the repository's own.
    clone.setName("work");
    await vi.advanceTimersByTimeAsync(TYPING_MS);
    expect(inputs.at(-1)?.name).toBe("work");
    clone.setName("");
    await vi.advanceTimersByTimeAsync(TYPING_MS);
    expect(inputs.at(-1)?.name).toBeNull();
    expect(clone.getSnapshot().name).toBe("repo");
  });

  it("puts each problem beside its field and never starts a form with one", async () => {
    const { api } = fakeApi();
    const clone = new CloneController(api, { parent: null });
    clone.open();
    clone.setRemote("file:///srv/repo.git");
    await vi.advanceTimersByTimeAsync(TYPING_MS);
    expect(clone.problem("remote")).toMatch(/https/);
    expect(clone.problem("parent")).toBeNull();
    expect(clone.canStart).toBe(false);
    clone.setRemote("https://github.com/owner/repo");
    await vi.advanceTimersByTimeAsync(TYPING_MS);
    expect(clone.problem("remote")).toBeNull();
    expect(clone.problem("parent")).toBe("Choose a folder to clone into.");
    await clone.start();
    expect(api.start).not.toHaveBeenCalled();
    clone.setParent("C:\\code");
    await vi.advanceTimersByTimeAsync(0);
    expect(clone.canStart).toBe(true);
    // An emptied address clears the answer without asking.
    clone.setRemote("");
    expect(clone.getSnapshot()).toMatchObject({ check: null, checking: false });
  });

  it("drops an answer for an older form and releases its review", async () => {
    const { api, calls } = fakeApi();
    let release: (value: CloneCheck) => void = () => {};
    vi.mocked(api.check).mockImplementationOnce(
      (input) =>
        new Promise((done) => {
          release = () => done(answer("stale", input));
        }),
    );
    const clone = new CloneController(api, { parent: "C:\\code" });
    clone.open();
    clone.setRemote("https://github.com/owner/old");
    await vi.advanceTimersByTimeAsync(TYPING_MS);
    clone.setRemote("https://github.com/owner/repo");
    await vi.advanceTimersByTimeAsync(TYPING_MS);
    const current = clone.getSnapshot().check?.review?.id;
    release(answer("stale", { remote: "", parent: null, name: null }));
    await flush();
    expect(clone.getSnapshot().check?.review?.id).toBe(current);
    expect(calls).toContain("release stale");
  });

  it("follows Git to the end and remembers the folder for the next clone", async () => {
    const { api, statuses } = fakeApi();
    const clone = new CloneController(api, {
      remote: "https://github.com/owner/repo",
      parent: "C:\\code",
    });
    clone.open();
    await vi.advanceTimersByTimeAsync(0);
    statuses.push(
      record("review-1", {
        revision: 2,
        progress: { stage: "Receiving objects", stage_percent: 40, percent: 33, received: "1 MiB" },
      }),
      record("review-1", { revision: 3, state: "ready", detail: "Cloned owner/repo." }),
    );
    await clone.start();
    await flush();
    expect(api.status).toHaveBeenNthCalledWith(1, "review-1", 1);
    expect(api.status).toHaveBeenNthCalledWith(2, "review-1", 2);
    expect(clone.getSnapshot().phase).toBe("done");
    expect(clone.getSnapshot().record?.state).toBe("ready");
  });

  it("returns to the form after a cancel, with the reason, and checks again", async () => {
    const { api, statuses } = fakeApi();
    const clone = new CloneController(api, {
      remote: "https://github.com/owner/repo",
      parent: "C:\\code",
    });
    clone.open();
    await vi.advanceTimersByTimeAsync(0);
    // Rust's long poll answers once Git has stopped.
    let stopped: (value: CloneRecord) => void = () => {};
    vi.mocked(api.status).mockImplementationOnce(
      () =>
        new Promise((done) => {
          stopped = done;
        }),
    );
    await clone.start();
    expect(clone.getSnapshot().phase).toBe("running");
    clone.cancel();
    expect(api.cancel).toHaveBeenCalledWith("review-1");
    stopped(
      record("review-1", {
        revision: 2,
        state: "canceled",
        detail: "Clone canceled. The unfinished folder was removed.",
        removed: true,
      }),
    );
    await flush();
    expect(statuses).toEqual([]);
    expect(clone.getSnapshot()).toMatchObject({
      phase: "form",
      record: null,
      notice: "Clone canceled. The unfinished folder was removed.",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(clone.getSnapshot().check?.review?.id).toBe("review-2");
  });

  it("keeps a failure with Git's lines, and Try again starts a fresh review", async () => {
    const { api, statuses, calls } = fakeApi();
    const clone = new CloneController(api, {
      remote: "https://github.com/owner/repo",
      parent: "C:\\code",
    });
    clone.open();
    await vi.advanceTimersByTimeAsync(0);
    statuses.push(
      record("review-1", {
        revision: 2,
        state: "failed",
        detail: "Git could not find this repository.",
        output: ["fatal: repository not found"],
      }),
    );
    await clone.start();
    await flush();
    expect(clone.getSnapshot().phase).toBe("failed");
    expect(clone.getSnapshot().record?.output).toEqual(["fatal: repository not found"]);
    statuses.push(record("review-2", { revision: 2, state: "ready" }));
    clone.retry();
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(calls.filter((call) => call.startsWith("start"))).toEqual([
      "start review-1",
      "start review-2",
    ]);
    expect(clone.getSnapshot().phase).toBe("done");
  });

  it("closing the form releases its review and stops a running clone", async () => {
    const { api, calls } = fakeApi();
    vi.mocked(api.status).mockImplementation(() => new Promise(() => {}));
    const clone = new CloneController(api, {
      remote: "https://github.com/owner/repo",
      parent: "C:\\code",
    });
    clone.open();
    await vi.advanceTimersByTimeAsync(0);
    clone.close();
    expect(calls).toEqual(["release review-1"]);
    const running = new CloneController(api, {
      remote: "https://github.com/owner/repo",
      parent: "C:\\code",
      start: true,
    });
    running.open();
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(running.getSnapshot().phase).toBe("running");
    running.close();
    expect(calls).toContain("cancel review-2");
  });
});

describe("clone text", () => {
  it("says Git's stage and how much arrived", () => {
    expect(progressLine(record("x"))).toEqual({ stage: "Starting Git", detail: null });
    expect(
      progressLine(
        record("x", {
          progress: {
            stage: "Resolving deltas",
            stage_percent: 50,
            percent: 82,
            received: "2.40 MiB",
          },
        }),
      ),
    ).toEqual({ stage: "Resolving deltas", detail: "2.40 MiB" });
  });
  it("names a folder by its last part on either platform", () => {
    expect(folderName("C:\\Users\\me\\code")).toBe("code");
    expect(folderName("/Users/me/code/")).toBe("code");
  });
});
