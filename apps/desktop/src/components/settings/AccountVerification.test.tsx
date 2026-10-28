import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { canEmbedVerification, EMBEDDING_ORIGINS } from "../../lib/accountVerification";
import { AccountVerification } from "./AccountVerification";

const noop = () => {};

describe("sign-in verification", () => {
  it("says at once that a development build cannot show the check, and loads nothing", () => {
    const html = renderToStaticMarkup(
      <AccountVerification onToken={noop} host="http://localhost:1420" />,
    );
    expect(html).toContain('data-phase="unavailable"');
    expect(html).toContain(
      "Sign-in verification runs only in the installed app. auracode.si does not let this build (http://localhost:1420) show its check, so no code can be requested here.",
    );
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("Loading verification");
  });

  it("loads the check in the installed app, from the configured site", () => {
    for (const host of EMBEDDING_ORIGINS) {
      const html = renderToStaticMarkup(
        <AccountVerification onToken={noop} host={host} origin="https://preview.auracode.si" />,
      );
      expect(html, host).toContain('src="https://preview.auracode.si/verify-device"');
      expect(html, host).toContain("Loading verification…");
    }
  });

  it("allows exactly the parents the site's frame-ancestors and page allow", () => {
    const headers = readFileSync(
      new URL("../../../../web/scripts/headers.mjs", import.meta.url),
      "utf8",
    );
    const page = readFileSync(
      new URL("../../../../web/app/pages/verify-device.tsx", import.meta.url),
      "utf8",
    );
    for (const origin of EMBEDDING_ORIGINS) {
      expect(headers).toContain(origin);
      expect(page).toContain(`"${origin}"`);
    }
    for (const host of [
      "http://localhost:1420",
      "http://127.0.0.1:1426",
      "https://auracode.si",
      "",
    ])
      expect(canEmbedVerification(host), host).toBe(false);
  });
});
