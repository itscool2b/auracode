/** Agent update notices over the real chat screen (`?preview=agent-updates`). Installs nothing. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";

export async function checkAgentUpdates(browser, url, out, engine) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      colorScheme: theme,
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const notice = (agent) =>
        page.locator(`[data-testid="agent-update-banner"][data-agent="${agent}"]`);
      const open = async (query = "") => {
        await page.goto(`${url}/?preview=agent-updates&theme=${theme}${query}`);
        await notice("claude").waitFor();
        // The stack folds to its front toast; pointing at it opens every toast.
        await notice("claude").hover();
      };

      await page.goto(`${url}/?preview=agent-updates&theme=${theme}`);
      await notice("claude").waitFor();
      await page.mouse.move(400, 600);
      assert.equal(await notice("codex").isVisible(), false, "the stack folds to its front toast");
      await page.screenshot({ path: resolve(out, `${engine}-${theme}-folded.png`) });
      await open();
      assert.equal(
        await page.getByTestId("agent-update-banner").count(),
        3,
        "up-to-date agents stay quiet",
      );
      await notice("claude")
        .getByText("Claude Code 2.1.400 is available", { exact: true })
        .waitFor();
      // Another tool owns Codex's installation: its reason, and the way to Settings > Agents.
      // The reason arrives with the installation's check, after the notice itself.
      await notice("codex")
        .getByText(/Homebrew manages this installation/)
        .waitFor();
      assert.equal(
        await notice("codex").getByRole("button", { name: "Update", exact: true }).count(),
        0,
      );
      assert.match(await notice("codex").textContent(), /Homebrew manages this installation/);
      await notice("codex").getByRole("button", { name: "Agents settings" }).click();
      assert.equal(await page.evaluate(() => "openedAgents" in document.body.dataset), true);
      // Cursor's chat is working: its update waits rather than replacing files under a turn.
      assert.match(await notice("cursor").textContent(), /Update once its working chat finishes\./);
      assert.equal(
        await notice("cursor").getByRole("button", { name: "Update", exact: true }).count(),
        0,
      );
      assert.deepEqual(
        (await new AxeBuilder({ page }).include(".chat-banners").analyze()).violations,
        [],
      );
      // The stack sits at the pane's top right under its header, clear of the composer.
      const stack = await page.locator(".chat-banners").boundingBox();
      const pane = await page.locator(".chat-main").boundingBox();
      assert.ok(stack && pane, "the stack and the pane are on screen");
      assert.ok(
        stack.y - pane.y < 80,
        `the stack starts under the header, at ${stack.y - pane.y}px`,
      );
      assert.ok(
        pane.x + pane.width - (stack.x + stack.width) <= 24,
        "the stack keeps to the right",
      );
      await page.screenshot({ path: resolve(out, `${engine}-${theme}-notices.png`) });

      // X hides a notice for this run of auracode only.
      await notice("cursor")
        .getByRole("button", { name: "Dismiss the Cursor update notice" })
        .click();
      assert.equal(await notice("cursor").count(), 0);
      // Update: it reads as updating, then goes once detection finds the new version.
      await notice("claude").getByRole("button", { name: "Update", exact: true }).click();
      await notice("claude").getByRole("button", { name: "Updating…" }).waitFor();
      await notice("claude").waitFor({ state: "detached" });
      // A restart shows the dismissed notice again, as the agent is still not updated.
      await open();
      await notice("cursor").waitFor();

      // A failed update says why and offers its command in auracode's terminal, where its
      // output shows; once that passes and the sheet closes, the notice goes.
      await open("&case=fail");
      await notice("claude").getByRole("button", { name: "Update", exact: true }).click();
      await notice("claude").getByRole("alert").filter({ hasText: "The update failed" }).waitFor();
      await notice("claude").getByRole("button", { name: "Run in terminal" }).click();
      const sheet = page.getByRole("dialog", { name: "Update Claude Code" });
      await sheet.waitFor();
      await sheet
        .getByText("The update finished. auracode checks the new version when you close this.")
        .waitFor();
      assert.equal(await notice("claude").count(), 1, "the notice waits while the output is read");
      await sheet.getByRole("button", { name: "Close update terminal" }).click();
      await notice("claude").waitFor({ state: "detached" });
      // Try again can succeed too.
      await open("&case=fail");
      await notice("claude").getByRole("button", { name: "Update", exact: true }).click();
      await notice("claude").getByRole("alert").filter({ hasText: "The update failed" }).waitFor();
      await notice("claude").getByRole("button", { name: "Try again" }).click();
      await notice("claude").waitFor({ state: "detached" });

      // An update that finished while detection still finds the old version says so.
      await open("&case=unchanged");
      await notice("claude").getByRole("button", { name: "Update", exact: true }).click();
      await notice("claude")
        .getByText(/still finds 2\.1\.310 at .*claude\.cmd/)
        .waitFor();
      assert.equal(
        await notice("claude")
          .getByRole("button", { name: /^(Update|Updating…|Try again)$/ })
          .count(),
        0,
      );
      await notice("claude").getByRole("button", { name: "Agents settings" }).waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { chromium, webkit } = await import("playwright");
  const out = fileURLToPath(new URL("../../../target/agent-updates-browser/", import.meta.url));
  await mkdir(out, { recursive: true });
  for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
    const browser = await browserType.launch();
    try {
      await checkAgentUpdates(
        browser,
        process.env.CHECK_URL ?? "http://localhost:1448",
        out,
        engine,
      );
      console.log(
        `${engine}: agent update notices, their edge cases and dismissal passed in both appearances`,
      );
    } finally {
      await browser.close();
    }
  }
}
