import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";

export async function checkDataTransfer(page, url, out, engine) {
  const goto = (params = "") => page.goto(`${url}/?preview=data-transfer${params}`);
  const calls = () => page.evaluate(() => window.dataTransferFixture.calls());
  await goto();
  await page.getByRole("button", { name: "Review Local projects" }).waitFor();
  assert.deepEqual(await calls(), []);
  await page.getByRole("button", { name: "Review Local projects" }).click();
  const apply = page.getByRole("button", { name: "Import selected projects" });
  await apply.waitFor();
  assert.equal(await apply.isDisabled(), true);
  assert.equal(await page.getByRole("checkbox", { name: /Already here/ }).isDisabled(), true);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(await calls(), ["review"]);
  await page.getByRole("button", { name: "Review Local projects" }).click();
  await page.getByRole("checkbox", { name: /Orbit/ }).check();
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  await page.screenshot({ path: resolve(out, `${engine}-local-import.png`) });
  await apply.click();
  await page
    .getByRole("status")
    .filter({ hasText: "Imported 1 project(s) and 3 chat(s)." })
    .waitFor();
  assert.deepEqual(await calls(), [
    "review",
    "review",
    'import:[{"project_id":"orbit","revision":"revision-2"}]',
    "refresh",
  ]);
  await goto("&stale");
  await page.getByRole("button", { name: "Review Local projects" }).click();
  await page.getByRole("checkbox", { name: /Orbit/ }).check();
  await apply.click();
  await page.getByRole("alert").filter({ hasText: "changed" }).waitFor();
  assert.equal(await apply.count(), 0);
  assert.equal((await calls()).filter((call) => call.startsWith("import:")).length, 1);
  await page.getByRole("button", { name: "Review again" }).click();
  await page.getByRole("checkbox", { name: /Orbit/ }).check();
  await apply.click();
  await page.getByRole("status").filter({ hasText: "Imported" }).waitFor();
  await goto("&empty");
  await page.getByRole("button", { name: "Review Local projects" }).click();
  await page.getByText("No Local projects are available to import.").waitFor();
  assert.equal(await apply.isDisabled(), true);
  await goto();
  await page.getByRole("button", { name: "Export chat", exact: true }).click();
  await page.getByText(/This copy is unencrypted/).waitFor();
  assert.deepEqual(await calls(), []);
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  await page.screenshot({ path: resolve(out, `${engine}-chat-export.png`) });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(await calls(), []);
  await page.getByRole("button", { name: "Export chat", exact: true }).click();
  await page.getByRole("button", { name: "Choose export location" }).click();
  await page.getByRole("status").filter({ hasText: "Saved to C:/exports/Orbit chat.md" }).waitFor();
  assert.deepEqual(await calls(), ["export:saved-chat"]);
  for (const mode of ["export-cancel", "export-error"]) {
    await goto(`&${mode}`);
    await page.getByRole("button", { name: "Export chat", exact: true }).click();
    await page.getByRole("button", { name: "Choose export location" }).click();
    await page
      .getByText(
        mode === "export-cancel"
          ? "Export canceled. No file was saved."
          : "A file already exists there. Choose a new name.",
      )
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Choose export location" }).isEnabled(),
      true,
    );
    assert.deepEqual(await calls(), ["export:saved-chat"]);
  }
  await page.setViewportSize({ width: 390, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(out, `${engine}-chat-export-mobile.png`) });
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto();
  await page.getByRole("button", { name: "Copy debug bundle", exact: true }).click();
  assert.deepEqual(await calls(), []);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(await calls(), []);
  await page.getByRole("button", { name: "Copy debug bundle", exact: true }).click();
  await page.getByRole("button", { name: "Prepare preview" }).click();
  const preview = page.getByRole("textbox", { name: "Bundle preview" });
  await preview.waitFor();
  assert.deepEqual(await calls(), ["debug:saved-chat"]);
  await preview.fill("Reviewed diagnostics only");
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  await page.getByRole("button", { name: "Copy reviewed bundle" }).click();
  await page.getByRole("status").filter({ hasText: "Copied to clipboard" }).waitFor();
  assert.deepEqual(await calls(), ["debug:saved-chat", "copy:Reviewed diagnostics only"]);
  await page.setViewportSize({ width: 390, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(out, `${engine}-debug-bundle-mobile.png`) });
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const mode of ["debug-error", "clipboard-error"]) {
    await goto(`&${mode}`);
    await page.getByRole("button", { name: "Copy debug bundle", exact: true }).click();
    await page.getByRole("button", { name: "Prepare preview" }).click();
    if (mode === "clipboard-error")
      await page.getByRole("button", { name: "Copy reviewed bundle" }).click();
    await page.getByRole("alert").waitFor();
    assert.equal((await calls()).filter((call) => call.startsWith("debug:")).length, 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { chromium, webkit } = await import("playwright");
  const out = fileURLToPath(new URL("../../../target/data-transfer-browser/", import.meta.url));
  await mkdir(out, { recursive: true });
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    const browser = await type.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      await checkDataTransfer(page, process.env.ORBIT_URL ?? "http://127.0.0.1:1438", out, engine);
      console.log(`${engine}: Local import and readable chat export passed`);
    } finally {
      await browser.close();
    }
  }
}
