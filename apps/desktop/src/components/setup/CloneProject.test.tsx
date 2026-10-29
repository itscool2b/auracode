import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CloneApi } from "../../lib/setup-actions/api";
import type { CloneRecord } from "../../lib/setup-actions/bindings";
import { CloneController, type CloneView } from "../../lib/setup-actions/clone";
import { CloneBody, cloneHeading } from "./CloneProject";

const noop = (): void => {};
const api: CloneApi = {
  recoveryList: async () => [],
  recoveryReady: async () => {
    throw new Error("unused");
  },
  recoveryOpen: async () => {},
  recoveryDismiss: async () => {},
  check: async () => ({ repository: null, name: null, review: null, problem: null }),
  cancelReview: async () => {},
  start: async () => {
    throw new Error("unused");
  },
  status: async () => {
    throw new Error("unused");
  },
  cancel: async () => {},
};

const RECORD: CloneRecord = {
  id: "c1",
  revision: 4,
  remote: "https://github.com/auracode/orbit",
  repository: "auracode/orbit",
  destination: "C:\\code\\orbit",
  state: "running",
  detail: "Cloning.",
  progress: { stage: "Receiving objects", stage_percent: 62, percent: 48, received: "7.36 MiB" },
  output: [],
  removed: false,
};

/** A controller whose view is set directly, as the running app reaches it. */
function controllerWith(change: Partial<CloneView>): {
  controller: CloneController;
  view: CloneView;
} {
  const controller = new CloneController(api, { parent: "C:\\code" });
  const view = { ...controller.getSnapshot(), ...change };
  Object.assign(controller, { view });
  return { controller, view };
}

const render = (change: Partial<CloneView>, layout: "inline" | "dialog" = "inline") => {
  const { controller, view } = controllerWith(change);
  return renderToStaticMarkup(
    <CloneBody
      controller={controller}
      view={view}
      pickParent={async () => null}
      layout={layout}
      onBack={noop}
      onCloned={noop}
    />,
  );
};

describe("CloneBody", () => {
  it("shows retained recovery paths and record-only dismissal in onboarding and dialogs", () => {
    for (const layout of ["inline", "dialog"] as const) {
      const markup = render(
        {
          recoveries: [
            {
              id: "old",
              state: "ready",
              repository: "owner/repo",
              remote: "https://github.com/owner/repo",
              destination: "C:\\old\\repo",
              detail: "Git completed this clone.",
              can_add: true,
              can_open: true,
            },
          ],
        },
        layout,
      );
      expect(markup).toContain("Interrupted clones");
      expect(markup).toContain("C:\\old\\repo");
      for (const action of [
        "Open folder",
        "Add existing project",
        "Retry in another folder",
        "Dismiss notice",
      ])
        expect(markup).toContain(action);
      expect(markup).toContain("Dismissing a notice removes its record only.");
    }
  });
  it("shows the exact command and its Git before Clone, primary first in setup", () => {
    const markup = render({
      remote: "https://github.com/auracode/orbit",
      name: "orbit",
      check: {
        repository: "auracode/orbit",
        name: "orbit",
        problem: null,
        review: {
          id: "r1",
          remote: "https://github.com/auracode/orbit",
          repository: "auracode/orbit",
          parent: "C:\\code",
          destination: "C:\\code\\orbit",
          program: "C:\\Program Files\\Git\\cmd\\git.exe",
          arguments: [],
          command: "git clone --progress -- https://github.com/auracode/orbit C:\\code\\orbit",
        },
      },
    });
    expect(markup).toContain(
      "git clone --progress -- https://github.com/auracode/orbit C:\\code\\orbit",
    );
    expect(markup).toContain("C:\\Program Files\\Git\\cmd\\git.exe");
    expect(markup).toContain("Cancel removes the unfinished folder.");
    expect(markup.indexOf(">Clone<")).toBeLessThan(markup.indexOf(">Back<"));
    expect(markup).not.toMatch(/disabled=""[^>]*>Clone</);
  });

  it("puts a refused address under its field and keeps Clone disabled", () => {
    const markup = render({
      remote: "http://example.com/r",
      check: {
        repository: null,
        name: null,
        review: null,
        problem: { field: "remote", message: "Use the https:// address." },
      },
    });
    expect(markup).toMatch(/aria-invalid="true"[^>]*aria-describedby/);
    expect(markup).toContain("Use the https:// address.");
    expect(markup).toMatch(/type="submit"[^>]*disabled=""/);
  });

  it("offers Git's download when Git is missing", () => {
    const markup = render({
      check: {
        repository: "o/r",
        name: "r",
        review: null,
        problem: { field: "git", message: "Install Git to clone repositories." },
      },
    });
    expect(markup).toContain('href="https://git-scm.com/downloads"');
  });

  it("follows Git with the stage, a progress bar and Cancel clone", () => {
    const markup = render({ phase: "running", record: RECORD });
    expect(markup).toContain("Receiving objects");
    expect(markup).not.toContain("62%");
    expect(markup).toContain('aria-valuenow="48"');
    expect(markup).toContain("7.36 MiB received");
    expect(markup).toMatch(/Cancel clone.*Esc/);
    expect(markup).not.toContain(">Clone<");
  });

  it("explains a failure with Git's own last lines and offers Try again", () => {
    const markup = render(
      {
        phase: "failed",
        record: {
          ...RECORD,
          state: "failed",
          detail: "Git could not find this repository. The unfinished folder was removed.",
          output: ["remote: Repository not found.", "fatal: repository not found"],
        },
      },
      "dialog",
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("remote: Repository not found.\nfatal: repository not found");
    expect(markup.indexOf(">Edit<")).toBeLessThan(markup.indexOf(">Try again<"));
  });
});

describe("cloneHeading", () => {
  it("follows the clone in two tones", () => {
    const { view } = controllerWith({});
    expect(cloneHeading(view)).toEqual(["Clone a repository.", "Git copies it into a new folder."]);
    expect(cloneHeading({ ...view, phase: "running", record: RECORD })).toEqual([
      "Cloning auracode/orbit.",
      "Cancel leaves nothing behind.",
    ]);
    expect(cloneHeading({ ...view, phase: "failed", record: RECORD })[0]).toBe(
      "The clone stopped.",
    );
  });
});
