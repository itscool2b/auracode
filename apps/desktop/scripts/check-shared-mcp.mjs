/** Browser-fixture evidence only. No native agent, server, credential file or account is used. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { chromium, webkit } from "playwright";

const server = process.argv[process.argv.indexOf("--server") + 1] || "http://127.0.0.1:1474";
const output = resolve("../../target/shared-mcp-browser");
await mkdir(output, { recursive: true });
const results = [];
async function checkDelayedScope(page) {
  const delayed = `${server}/?preview=plugins-mcp&delayedProjects=1`;
  const projectId = "7cc769fb-ae40-44c1-8baa-fc2210f3bebe";
  await page.goto(delayed);
  const scope = page.getByLabel("MCP scope", { exact: true });
  await page.getByRole("button", { name: "Add server", exact: true }).waitFor();
  assert.equal(await scope.inputValue(), "");
  await page.evaluate(() => window.pluginsFixture.supplyProjects());
  await page.getByText("project_docs", { exact: true }).waitFor();
  assert.equal(await scope.inputValue(), projectId, "late project discovery supplies the default");
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  assert.equal(
    await page.getByRole("dialog").getByLabel("Scope", { exact: true }).inputValue(),
    projectId,
  );
  await page.keyboard.press("Escape");

  await page.goto(delayed);
  await scope.waitFor();
  await scope.selectOption("");
  await page.evaluate(() => window.pluginsFixture.supplyProjects());
  await scope
    .getByRole("option", { name: "Aura project", exact: true })
    .waitFor({ state: "attached" });
  assert.equal(await scope.inputValue(), "", "a deliberate all-projects choice survives discovery");

  await page.goto(delayed);
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("unsaved_tools");
  await page.evaluate(() => window.pluginsFixture.supplyProjects());
  assert.equal(
    await dialog.getByLabel("Scope", { exact: true }).inputValue(),
    "",
    "an open editor keeps its initial scope",
  );
  assert.equal(await dialog.getByLabel("Name", { exact: true }).inputValue(), "unsaved_tools");
  await page.keyboard.press("Escape");
  assert.equal(await scope.inputValue(), "", "starting an editor pins the displayed scope");

  await page.goto(delayed);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Import format", { exact: true }).selectOption("native");
  await dialog
    .getByLabel("Definition JSON", { exact: true })
    .fill('{"mcpServers":{"docs":{"command":"node"}}}');
  await page.evaluate(() => window.pluginsFixture.supplyProjects());
  await dialog.getByRole("button", { name: "Import definitions", exact: true }).click();
  await page.waitForFunction(() => window.pluginsFixture.calls.includes("mcp:import-native:all"));
  await page.keyboard.press("Escape");
  assert.equal(await scope.inputValue(), "", "an open import keeps its chosen scope");
}
for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
  const browser = await launcher.launch({ headless: true });
  try {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce",
        colorScheme: theme,
      });
      await context.route("**/*", (route) =>
        new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
      );
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await checkDelayedScope(page);
      await page.goto(`${server}/?preview=plugins-mcp`);
      await page.getByText("project_docs", { exact: true }).waitFor();
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
        `${engine}/${theme} MCP inventory accessibility`,
      );
      await page.getByRole("button", { name: "Authentication", exact: true }).click();
      let dialog = page.getByRole("dialog");
      await dialog
        .getByLabel("Authorization", { exact: true })
        .fill("synthetic-private-local-value");
      await dialog.getByRole("button", { name: "Save local authentication" }).click();
      await page.getByText("Configured, session connection unverified", { exact: false }).waitFor();
      await page.getByRole("button", { name: "Session status", exact: true }).click();
      await page.getByText("project_docs: connected, oauth, 2 tools", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Test connection", exact: true }).click();
      await page.getByText("Synthetic MCP initialization succeeded.", { exact: false }).waitFor();
      await page.getByRole("button", { name: "Add server", exact: true }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name", { exact: true }).fill("local_tools");
      await dialog.getByLabel("Executable", { exact: true }).fill("node");
      await dialog
        .getByLabel("Arguments, one per line", { exact: true })
        .fill("fixture.js\n--stdio");
      assert.equal(
        await dialog.getByLabel("Scope", { exact: true }).inputValue(),
        "7cc769fb-ae40-44c1-8baa-fc2210f3bebe",
      );
      await dialog.getByRole("button", { name: "Save definition" }).click();
      await page.getByText("local_tools", { exact: true }).waitFor();
      // A new server is for every agent, including ones installed later.
      const localRow = page.locator(".shared-mcp-row", { hasText: "local_tools" });
      assert.equal(await localRow.getByTestId("shared-mcp-agents").textContent(), "Every agent");
      // Limited to chosen agents: none chosen cannot be saved; two chosen show by name.
      await localRow.getByRole("button", { name: "Edit", exact: true }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByRole("radio", { name: /Only the agents I choose/ }).check();
      await dialog.getByText("Choose at least one agent.", { exact: true }).waitFor();
      assert.equal(
        await dialog.getByRole("button", { name: "Save definition" }).isDisabled(),
        true,
      );
      const choices = dialog.getByRole("list", { name: "Agents that load this server" });
      await choices.getByRole("checkbox", { name: /Codex/ }).check();
      await choices.getByRole("checkbox", { name: /Claude Code/ }).check();
      assert.deepEqual(
        (await new AxeBuilder({ page }).include("dialog[open]").analyze()).violations,
        [],
        `${engine}/${theme} agent scope accessibility`,
      );
      await dialog.getByRole("button", { name: "Save definition" }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(
        await localRow.getByTestId("shared-mcp-agents").textContent(),
        "Claude Code, Codex",
      );
      // Back to every agent: the choice is a radio away, and the server is for all again.
      await localRow.getByRole("button", { name: "Edit", exact: true }).click();
      dialog = page.getByRole("dialog");
      assert.equal(
        await dialog.getByRole("radio", { name: /Only the agents I choose/ }).isChecked(),
        true,
      );
      await dialog.getByRole("radio", { name: /Every agent/ }).check();
      await dialog.getByRole("button", { name: "Save definition" }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(await localRow.getByTestId("shared-mcp-agents").textContent(), "Every agent");
      await page.getByRole("button", { name: "Export", exact: true }).click();
      dialog = page.getByRole("dialog");
      const document = await dialog.getByLabel("Definition JSON", { exact: true }).inputValue();
      assert.equal(document.includes("synthetic-private-local-value"), false);
      assert.equal(JSON.parse(document).definitions.length, 2);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Import", exact: true }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByLabel("Import format", { exact: true }).selectOption("native");
      await dialog
        .getByLabel("Definition JSON", { exact: true })
        .fill('{"mcpServers":{"docs":{"command":"node"}}}');
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
        `${engine}/${theme} import review accessibility`,
      );
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 960, height: 640 });
      await page.screenshot({
        path: resolve(output, `${engine}-${theme}-960.png`),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        "MCP panel reflows without page overflow",
      );
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement?.tagName !== "BODY"),
        true,
        "keyboard focus remains visible",
      );
      assert.deepEqual(errors, []);
      results.push({ engine, theme, state: "passed", native: false });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
await writeFile(resolve(output, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(
  `Shared MCP: ${results.length} browser-fixture theme/engine cases passed, no native execution.`,
);
