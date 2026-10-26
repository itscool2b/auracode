import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { VendorCommand } from "./VendorDialog";

it("shows the exact executable, separate arguments, personal realm and vendor warning", () => {
  const html = renderToStaticMarkup(
    <VendorCommand
      review={{
        token: "review",
        request: {
          provider: "claude",
          kind: "plugin",
          action: "remove",
          target: "tools@team",
          item_revision: null,
        },
        program: "C:/fixture/claude.exe",
        arguments: ["plugin", "uninstall", "tools@team", "--scope", "user", "--keep-data"],
        working_directory: "C:/fixture",
        config_directory: "C:/fixture/.claude",
        revision: "revision",
        timeout_seconds: 600,
        notices: ["Plugin removal keeps its persistent data."],
      }}
    />,
  );
  expect(html).toContain("C:/fixture/claude.exe");
  expect(html).toContain("--keep-data");
  expect(html).toContain("Personal configuration");
  expect(html).toContain("Plugin removal keeps its persistent data.");
});
