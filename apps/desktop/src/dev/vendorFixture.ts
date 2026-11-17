import type { VendorApi } from "../lib/config-vendor/api";

/** A vendor terminal that never runs anything, for the review's installer steps. */
export const syntheticVendor: VendorApi = {
  review: async (request) => ({
    token: "vendor-review",
    request,
    program: "C:/fixture/claude.exe",
    arguments: ["plugin", "install", request.target, "--scope", "user"],
    working_directory: "C:/fixture",
    config_directory: "C:/fixture/.claude",
    revision: "fixture",
    timeout_seconds: 600,
    notices: ["Synthetic fixture. No vendor command runs."],
  }),
  cancel: async () => {},
  terminal: () => ({
    reserve: async () => "vendor-terminal",
    start: async () => "vendor-terminal",
    read: async () => ({
      bytes: [...new TextEncoder().encode("Synthetic command finished.\r\n")],
      done: true,
      exit_code: 1,
      truncated: false,
    }),
    write: async () => {},
    resize: async () => {},
    close: async () => {},
  }),
};
