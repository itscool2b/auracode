/** Visible fresh-session review using local UI fixtures only. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, webkit } from "playwright";

const url = process.env.ORBIT_URL ?? "http://localhost:1426";
const out = fileURLToPath(new URL("../../../target/session-fallback-browser/", import.meta.url));
await mkdir(out, { recursive: true });
for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
  const browser = await launcher.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}/?preview=steering&case=missing-native`);
    await page.getByText("The saved native transcript is unavailable.", { exact: true }).waitFor();
    // The error card's action opens review, without starting or retrying the old session.
    await page.getByRole("button", { name: "Start fresh", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Review continuation" });
    await dialog
      .getByText("Your next message will include this handoff. Confirming does not send a prompt.")
      .waitFor();
    assert.deepEqual(await page.evaluate(() => window.sessionRecoveryCalls), {
      starts: 0,
      previews: ["fresh_session"],
      applied: 0,
    });
    assert.equal(await page.evaluate(() => window.steeringCalls.send), 0);
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: resolve(out, `${engine}-fresh-session-review.png`) });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    // The header action uses the same reviewed path. Canceling left source history untouched.
    await page.locator('summary[aria-label="Chat details and controls"]').click();
    await page.getByTestId("chat-start-fresh").click();
    await dialog.getByRole("button", { name: "Use handoff in a fresh session" }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(await page.evaluate(() => window.sessionRecoveryCalls), {
      starts: 0,
      previews: ["fresh_session", "fresh_session"],
      applied: 1,
    });
    assert.equal(await page.evaluate(() => window.steeringCalls.send), 0);
    await page.getByText("Review this change", { exact: true }).waitFor();
    await page.getByText("Next message includes a handoff to", { exact: false }).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      `${engine}: missing native transcript opens review, cancel preserves source and confirmation waits for a prompt`,
    );
  } finally {
    await browser.close();
  }
}
