import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { FolderContextView } from "./FolderContext";

it("distinguishes the exact live folder context from sandbox permissions", () => {
  const html = renderToStaticMarkup(
    <FolderContextView
      value={{
        primary: "C:/fixture/worktree",
        additional: ["C:/fixture/other project"],
        active: true,
        supports_additional: true,
        notices: ["The original checkout is excluded from this isolated session."],
      }}
    />,
  );
  expect(html).toContain("Shared with this session");
  expect(html).toContain("C:/fixture/other project");
  expect(html).toContain("original checkout is excluded");
  expect(html).toContain("Stop and restart");
  expect(html).toContain("permissions and autonomy mode");
});

it("does not present unsupported or unavailable project folders as shared", () => {
  const html = renderToStaticMarkup(
    <FolderContextView
      value={{
        primary: "C:/fixture/primary",
        additional: [],
        active: false,
        supports_additional: false,
        notices: ["This driver receives only the primary folder."],
      }}
    />,
  );
  expect(html).toContain("Prepared for the next session");
  expect(html).toContain("only the primary folder");
  expect(html).not.toContain("<span>Additional</span>");
  expect(html).not.toContain("Stop and restart");
});
