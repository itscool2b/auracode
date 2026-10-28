import { describe, expect, it } from "vitest";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
  it("reads errors, strings and a raw Tauri rejection's message", () => {
    expect(errorMessage(new Error("Folder missing."))).toBe("Folder missing.");
    expect(errorMessage("Not allowed.")).toBe("Not allowed.");
    expect(
      errorMessage({ code: "invalid_input", message: "The shell changed after review." }),
    ).toBe("The shell changed after review.");
  });

  it("falls back only when nothing says why", () => {
    expect(errorMessage(undefined)).toBe("Something went wrong.");
    expect(errorMessage({ code: "x", message: "" })).toBe("Something went wrong.");
    expect(errorMessage(null, "The terminal could not continue.")).toBe(
      "The terminal could not continue.",
    );
  });
});
