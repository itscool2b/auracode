import { beforeEach, expect, it, vi } from "vitest";
import type { VendorReview } from "./bindings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { vendorApi } from "./api";

const review: VendorReview = {
  token: "one-use-review",
  request: {
    provider: "codex",
    kind: "plugin",
    action: "install",
    target: "tools@team",
    item_revision: null,
  },
  program: "C:/vendor/codex.exe",
  arguments: ["plugin", "add", "tools@team"],
  working_directory: "C:/fixture",
  config_directory: "C:/fixture/.codex",
  revision: "bound",
  timeout_seconds: 600,
  notices: [],
};
beforeEach(() => vi.mocked(invoke).mockReset());
it("review and terminal construction never launch; explicit start sends only token and terminal size", async () => {
  vi.mocked(invoke).mockResolvedValueOnce(review).mockResolvedValueOnce("terminal");
  const result = await vendorApi.review(review.request);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("config_vendor_review", {
    request: review.request,
  });
  const terminal = vendorApi.terminal(result);
  expect(invoke).toHaveBeenCalledTimes(1);
  await terminal.start("reserved", "untrusted-renderer-agent", { rows: 25, cols: 90 });
  expect(invoke).toHaveBeenLastCalledWith("config_vendor_start", {
    token: "one-use-review",
    terminalId: "reserved",
    rows: 25,
    cols: 90,
  });
});
it("cancel removes the server review without starting a terminal", async () => {
  vi.mocked(invoke).mockResolvedValue(undefined);
  await vendorApi.cancel(review.token);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("config_vendor_cancel", { token: review.token });
});
