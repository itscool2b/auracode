import { describe, expect, it } from "vitest";
import { verificationMessage } from "./accountVerification";

describe("account verification proof boundary", () => {
  it("rejects another attempt, malformed messages and unbounded tokens", () => {
    const valid = {
      type: "auracode:verification-token",
      nonce: "this-attempt",
      token: "synthetic-proof",
    };
    expect(verificationMessage(valid, "this-attempt")).toEqual({ token: "synthetic-proof" });
    expect(verificationMessage(valid, "other-attempt")).toBeNull();
    for (const invalid of [
      null,
      [],
      "proof",
      { ...valid, type: "session-token" },
      { ...valid, token: {} },
      { ...valid, token: "x".repeat(2049) },
    ])
      expect(verificationMessage(invalid, "this-attempt")).toBeNull();
    expect(verificationMessage({ ...valid, token: "" }, "this-attempt")).toEqual({ token: "" });
  });
});
