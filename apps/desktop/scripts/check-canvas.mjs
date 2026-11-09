/**
 * Canvas (`?preview=canvas`, docs/superpowers/plans/2026-11-09-canvas.md): drawing, labels, arrows
 * that follow their shapes, undo, Talk's numbered narration, and Add to message, in both
 * appearances, with axe. Runs no agent; the microphone is scripted.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";

async function axe(page, label) {
  const result = await new AxeBuilder({ page }).include("section[aria-label=Canvas]").analyze();
  assert.deepEqual(
    result.violations.map(
      (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(" ")}`,
    ),
    [],
    `${label}: axe`,
  );
}

export async function checkCanvas(browser, url, out, engine) {
  for (const theme of ["light", "dark"]) {
    const label = `${engine} ${theme}`;
    const context = await browser.newContext({
      viewport: { width: 1280, height: 820 },
      colorScheme: theme,
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${url}/?preview=canvas&theme=${theme}`);
      const opener = page.getByRole("button", { name: "Canvas", exact: true });
      await opener.waitFor();
      await opener.click();
      const pane = page.locator("section[aria-label=Canvas]");
      await pane.waitFor();
      assert.equal(
        await opener.getAttribute("aria-pressed"),
        "true",
        `${label}: Canvas shows open`,
      );
      await axe(page, `${label} empty`);
      const surface = page.locator(".canvas-surface");
      const box = await surface.boundingBox();
      assert.ok(box, `${label}: the surface has a size`);
      const at = (x, y) => ({ x: box.x + x, y: box.y + y });
      const drag = async (from, to) => {
        await page.mouse.move(at(...from).x, at(...from).y);
        await page.mouse.down();
        await page.mouse.move(at(...to).x, at(...to).y, { steps: 8 });
        await page.mouse.up();
      };
      const tool = (name) => pane.getByRole("button", { name, exact: true }).click();
      const count = (selector) => surface.locator(selector).count();

      // Two labelled boxes and an arrow from one to the other.
      await tool("Rectangle");
      await drag([120, 140], [300, 220]);
      await drag([520, 140], [700, 220]);
      assert.equal(await count("rect[data-id]"), 2, `${label}: two boxes`);
      await tool("Text");
      for (const [x, text] of [
        [140, "API gateway"],
        [540, "Queue"],
      ]) {
        await page.mouse.click(at(x, 165).x, at(x, 165).y);
        const editor = pane.getByRole("textbox", { name: "Text on the canvas" });
        await editor.waitFor();
        await editor.fill(text);
        await editor.press("Enter");
      }
      assert.equal(await count("text[data-id]"), 2, `${label}: two labels`);
      await tool("Arrow");
      await drag([280, 180], [560, 180]);
      assert.equal(await count("g[data-id] line"), 1, `${label}: an arrow`);

      // Keys choose tools while the drawing has focus; undo and redo take back a stroke.
      await page.keyboard.press("p");
      assert.equal(
        await pane.getByRole("button", { name: "Pen", exact: true }).getAttribute("aria-pressed"),
        "true",
        `${label}: P chooses the pen`,
      );
      await drag([120, 360], [420, 420]);
      assert.equal(await count("path[data-id]"), 1, `${label}: a stroke`);
      await page.keyboard.press("Control+z");
      assert.equal(await count("path[data-id]"), 0, `${label}: undo takes it back`);
      await page.keyboard.press("Control+Shift+z");
      assert.equal(await count("path[data-id]"), 1, `${label}: redo returns it`);

      // Moving a box takes the arrow's end along.
      const arrowEnd = () =>
        surface.locator("g[data-id] line").evaluate((line) => Number(line.getAttribute("x2")));
      const queueAt = () =>
        surface
          .locator("text[data-id]")
          .filter({ hasText: "Queue" })
          .evaluate((text) => Number(text.getAttribute("x")));
      const before = await arrowEnd();
      const labelBefore = await queueAt();
      await page.keyboard.press("v");
      await drag([620, 205], [660, 205]);
      const after = await arrowEnd();
      assert.ok(
        Math.abs(after - before - 40) < 2,
        `${label}: the arrow follows its box (${before} to ${after})`,
      );
      assert.ok(
        Math.abs((await queueAt()) - labelBefore - 40) < 2,
        `${label}: the label moves with its box`,
      );

      // Talk: a shape drawn while a phrase is said gets that phrase's number.
      await pane.getByRole("button", { name: "Talk" }).click();
      await pane.getByText("Listening").waitFor();
      await tool("Ellipse");
      await drag([140, 470], [300, 560]);
      await page.evaluate(() => {
        window.canvasSaid = ["this is the cache"];
      });
      await pane.getByText("this is the cache").waitFor();
      await pane.getByRole("button", { name: "Finish" }).click();
      await pane.locator(".canvas-phrases li").filter({ hasText: "this is the cache" }).waitFor();
      assert.equal(
        await surface.locator(".canvas-marker text").first().textContent(),
        "1",
        `${label}: the marker`,
      );
      await axe(page, `${label} drawn`);
      await page.screenshot({ path: resolve(out, `canvas-${engine}-${theme}.png`) });

      // Add to message: the drawing as Canvas.png, its outline and the narration in the draft.
      const composer = page.locator(".chat-composer textarea");
      await composer.fill("Build this.");
      await pane.getByRole("button", { name: "Add to message" }).click();
      await pane.getByText("Added to your message.", { exact: false }).waitFor();
      const pastes = await page.evaluate(() => window.canvasPastes);
      assert.equal(pastes.length, 1, `${label}: one image`);
      assert.equal(pastes[0].name, "Canvas.png", `${label}: named Canvas.png`);
      assert.equal(pastes[0].png, true, `${label}: a PNG`);
      const text = await composer.inputValue();
      for (const part of [
        "Build this.",
        "The attached canvas shows:",
        '- box "API gateway"',
        '- arrow from "API gateway" to "Queue"',
        "1. this is the cache",
      ])
        assert.ok(text.includes(part), `${label}: the draft has ${part}: ${text}`);
      await page.locator(".composer-context").getByText("Canvas.png").waitFor();
      // Adding again replaces the image and the text instead of doubling them.
      await pane.getByRole("button", { name: "Add to message" }).click();
      await page.waitForFunction(() => window.canvasPastes.length === 2);
      await page.waitForFunction(() => window.canvasDraft().attachments.length === 1);
      const again = await composer.inputValue();
      assert.equal(again.split("The attached canvas shows:").length, 2, `${label}: one outline`);

      // Closing keeps the drawing; the transcript comes back.
      await pane.getByRole("button", { name: "Close the canvas" }).click();
      await pane.waitFor({ state: "detached" });
      await opener.click();
      await pane.waitFor();
      assert.equal(await count("rect[data-id]"), 2, `${label}: the drawing stayed`);
      assert.deepEqual(errors, [], `${label}: no page errors`);
    } finally {
      await context.close();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { chromium, webkit } = await import("playwright");
  const out = fileURLToPath(new URL("../../../target/canvas-browser/", import.meta.url));
  await mkdir(out, { recursive: true });
  for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
    const browser = await browserType.launch();
    try {
      await checkCanvas(browser, process.env.CHECK_URL ?? "http://localhost:1476", out, engine);
      console.log(
        `${engine}: canvas drawing, labels, arrows, undo, Talk and Add to message passed in both appearances`,
      );
    } finally {
      await browser.close();
    }
  }
}
