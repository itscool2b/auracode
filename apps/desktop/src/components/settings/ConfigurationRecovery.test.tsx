import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ConfigurationRecovery } from "./ConfigurationRecovery";

const recovery = {
  transaction: "fixture",
  owner_profile: "account",
  from_profile: "local",
  to_profile: "account",
  phase: "restore_previous" as const,
  detail: "An interrupted switch needs recovery.",
};

it("renders recovery without invoking it and names the exact action", () => {
  const run = vi.fn();
  const html = renderToStaticMarkup(
    <ConfigurationRecovery recovery={recovery} recoverConfiguration={run} />,
  );
  expect(run).not.toHaveBeenCalled();
  expect(html).toContain("Restore previous settings");
  expect(html).toContain("Unmanaged settings stay in place");
  expect(html).toContain("configuration-recovery orbit-theme");
});

it("keeps unavailable recovery read-only and locked recovery disabled", () => {
  const unavailable = renderToStaticMarkup(
    <ConfigurationRecovery recovery={{ ...recovery, phase: "unavailable" }} />,
  );
  expect(unavailable).not.toContain("<button");
  expect(unavailable).toContain("No configuration will be guessed or replaced");
  const locked = renderToStaticMarkup(<ConfigurationRecovery recovery={recovery} locked />);
  expect(locked).toContain("disabled");
  expect(locked).toContain("Unlock the selected account");
});
