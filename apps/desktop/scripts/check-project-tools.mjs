import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";

// Sheets fade in and controls settle their colours; audit only once every finite animation ends.
const settled = (page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );

export async function checkProjectTools(page, url, out, engine) {
  await page.goto(`${url}/?preview=project-tools`);
  await page.getByRole("button", { name: "Review PowerShell terminal", exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.projectToolsFixture.calls()), []);
  await settled(page);
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  await page.screenshot({ path: resolve(out, `${engine}-project-tools.png`) });
  await page.getByRole("button", { name: "Review PowerShell terminal", exact: true }).click();
  const start = page.getByRole("button", { name: "Start project terminal", exact: true });
  await start.waitFor();
  await page.getByText("C:/projects/orbit", { exact: true }).waitFor();
  await page.screenshot({ path: resolve(out, `${engine}-project-terminal-review.png`) });
  assert.deepEqual(await page.evaluate(() => window.projectToolsFixture.calls()), []);
  await page.getByRole("button", { name: "Close project terminal", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.projectToolsFixture.calls()), []);
  await page.getByRole("button", { name: "Open project tools", exact: true }).click();
  await page.getByRole("button", { name: "Review PowerShell terminal", exact: true }).click();
  await start.click();
  await page.waitForFunction(() => window.projectToolsFixture.calls().includes("start"));
  await page.getByText("The project shell is running.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close project terminal", exact: true }).click();
  await page.waitForFunction(() => window.projectToolsFixture.calls().includes("close"));
  assert.deepEqual(
    await page.evaluate(() =>
      window.projectToolsFixture.calls().filter((item) => item !== "input"),
    ),
    ["reserve", "start", "close"],
  );
  await page.goto(`${url}/?preview=project-tools&handler-error`);
  await page.getByRole("button", { name: "Open in Cursor", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "could not open this editor" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Open in Cursor", exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.projectToolsFixture.calls()), [
    "editor:cursor",
  ]);
  await page.getByRole("button", { name: "Review project tools again", exact: true }).click();
  await page.getByRole("button", { name: "Open in Cursor", exact: true }).waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);
  await page.goto(`${url}/?preview=project-tools`);
  await page.getByRole("button", { name: "Open in Cursor", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "operating system accepted" }).waitFor();
  // Zed and the JetBrains IDEs are offered beside the URL-handler editors, each by name.
  await page.goto(`${url}/?preview=project-tools`);
  for (const name of ["Zed", "IntelliJ IDEA", "WebStorm", "RustRover"])
    await page.getByRole("button", { name: `Open in ${name}`, exact: true }).waitFor();
  await page.screenshot({ path: resolve(out, `${engine}-project-tools-editors.png`) });
  await page.getByRole("button", { name: "Open in Zed", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "request for Zed" }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.projectToolsFixture.calls()), ["editor:zed"]);
  await page.goto(`${url}/?preview=project-tools&stale`);
  await page.getByRole("button", { name: "Review PowerShell terminal", exact: true }).click();
  await start.click();
  await page
    .getByText("The chat or folder changed after review. Review project tools again.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await start.isDisabled(), true);
  await page.goto(`${url}/?preview=project-tools&missing`);
  await page.getByText("No supported native shell was found.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Open in / }).count(), 0);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${url}/?preview=project-tools`);
  await page.getByRole("button", { name: "Open in Cursor", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(out, `${engine}-project-tools-mobile.png`) });
  await page.setViewportSize({ width: 1440, height: 900 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { chromium, webkit } = await import("playwright");
  const out = fileURLToPath(new URL("../../../target/settings-browser/", import.meta.url));
  await mkdir(out, { recursive: true });
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    const browser = await type.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      await checkProjectTools(page, process.env.CHECK_URL ?? "http://127.0.0.1:1438", out, engine);
      console.log(`${engine}: reviewed project terminals and editor dispatch passed`);
    } finally {
      await browser.close();
    }
  }
}
