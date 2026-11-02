import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Banners, type MemoryEditBanner, MemoryEditBannerView } from "./Banners";

const banner = (state: MemoryEditBanner["state"]): MemoryEditBanner => ({
  key: "one:r2",
  text: "Claude Code in Fix the login flow updated project memory for auracode.",
  state,
  onReview: vi.fn(),
  onUndo: vi.fn(),
  onDismiss: vi.fn(),
});
const view = (edit: MemoryEditBanner) =>
  renderToStaticMarkup(
    <ul>
      <MemoryEditBannerView edit={edit} />
    </ul>,
  );

describe("an agent's memory edit banner", () => {
  it("says who edited memory and offers Review, Undo and Dismiss without acting", () => {
    const edit = banner({ status: "shown" });
    const html = view(edit);
    expect(html).toContain(
      "Claude Code in Fix the login flow updated project memory for auracode.",
    );
    expect(html).toContain('role="status"');
    for (const label of [">Review<", ">Undo<", ">Dismiss<"]) expect(html).toContain(label);
    expect(html).not.toContain('data-level="warning"');
    expect(edit.onUndo).not.toHaveBeenCalled();
    expect(edit.onReview).not.toHaveBeenCalled();
  });
  it("holds every action while undoing, and keeps only Dismiss once undone", () => {
    const undoing = view(banner({ status: "undoing" }));
    expect(undoing).toContain("Undoing…");
    expect(undoing.match(/disabled=""/g)).toHaveLength(3);
    const undone = view(banner({ status: "undone" }));
    expect(undone).not.toContain(">Undo<");
    expect(undone).not.toContain(">Review<");
    expect(undone).toContain(">Dismiss<");
  });
  it("announces a failed undo and keeps Review to look at it", () => {
    const html = view(
      banner({ status: "failed", message: "Nothing was undone. Project memory changed." }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Nothing was undone. Project memory changed.");
    expect(html).toContain(">Review<");
    expect(html).not.toContain(">Undo<");
  });
  it("hides Review where nothing can open Project memory", () => {
    expect(view({ ...banner({ status: "shown" }), onReview: undefined })).not.toContain(">Review<");
  });
  it("joins the window's banners, which otherwise show nothing", () => {
    const quiet = {
      storage: null,
      env: null,
      onRetryEnv: () => {},
      recoveryNotice: null,
      onRecoveryDismissed: () => {},
      notices: [],
    };
    expect(renderToStaticMarkup(<Banners {...quiet} />)).toBe("");
    expect(
      renderToStaticMarkup(<Banners {...quiet} memoryEdits={[banner({ status: "shown" })]} />),
    ).toContain('data-testid="memory-edit-banner"');
  });
});
