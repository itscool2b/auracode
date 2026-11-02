/** Scripted dictation UI checks. No audio hardware, downloads, or native commands. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";

export async function checkDictation(browser, url, out, engine) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 700 },
      colorScheme: theme,
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const input = page.getByTestId("composer-input");
      const mic = page.getByRole("button", { name: "Dictate a message", exact: true });
      const panel = page.getByTestId("dictation-panel");
      const open = async (scenario = "") => {
        await page.goto(`${url}/?preview=dictation&theme=${theme}&case=${scenario}`);
        await input.waitFor();
        await page.waitForFunction(
          () => !document.querySelector('[data-testid="composer-input"]').disabled,
        );
      };
      const audit = async (name) => {
        assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
        const box = await panel.boundingBox();
        assert.ok(
          box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1024 && box.y + box.height <= 700,
        );
        await page.screenshot({ path: resolve(out, `${engine}-${theme}-${name}.png`) });
      };

      await open("download");
      await mic.click();
      await page.getByRole("button", { name: "Download model", exact: true }).waitFor();
      await audit("download-offer");
      await page.getByRole("button", { name: "Download model", exact: true }).click();
      await page.getByRole("progressbar", { name: "Model download" }).waitFor();
      await page.getByRole("button", { name: "Complete download", exact: true }).click();
      await page.getByRole("button", { name: "Start recording", exact: true }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Finish recording", exact: true }).count(),
        0,
      );
      await page.getByRole("button", { name: "Start recording", exact: true }).click();
      await page.getByRole("meter", { name: "Microphone level" }).waitFor();
      await audit("recording");
      await input.fill("Keep my edits");
      await input.press("Enter");
      assert.equal(await page.getByLabel("Messages sent").textContent(), "0");
      await page.getByRole("button", { name: "Finish recording", exact: true }).click();
      await page.getByRole("progressbar", { name: "Transcription", exact: true }).waitFor();
      await audit("transcribing");
      await page.getByRole("button", { name: "Complete transcription", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="composer-input"]').value ===
          "Keep my edits Add a regression test.",
      );
      assert.equal(await page.getByLabel("Messages sent").textContent(), "0");

      await mic.click();
      await page.getByRole("meter", { name: "Microphone level" }).waitFor();
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Complete transcription", exact: true }).click();
      assert.equal(await input.inputValue(), "Keep my edits Add a regression test.");

      await mic.click();
      await page.getByRole("button", { name: "Switch chat", exact: true }).click();
      await input.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Complete transcription", exact: true }).click();
      await page.getByRole("button", { name: "Switch chat", exact: true }).click();
      await input.waitFor();
      assert.equal(await input.inputValue(), "Keep my edits Add a regression test.");

      await open("denied");
      await input.fill("Keep this draft");
      await mic.click();
      await page.getByRole("alert").waitFor();
      await audit("permission-error");
      assert.equal(await input.inputValue(), "Keep this draft");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { chromium, webkit } = await import("playwright");
  const out = fileURLToPath(new URL("../../../target/dictation-browser/", import.meta.url));
  await mkdir(out, { recursive: true });
  for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
    const browser = await browserType.launch();
    try {
      await checkDictation(browser, process.env.CHECK_URL ?? "http://localhost:1448", out, engine);
      console.log(
        `${engine}: dictation download, recording, insertion, cancellation and errors passed in both appearances`,
      );
    } finally {
      await browser.close();
    }
  }
}
