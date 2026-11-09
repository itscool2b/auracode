/**
 * Regenerates the home page's product images from the desktop app itself: its chat preview
 * (?preview=settled, development fixtures only, no agent or prompt) at 1440 by 760 and 2x, encoded
 * through Chromium's canvas into WebP at 480, 960, 1440 and 2240 wide and a 1440 PNG fallback in
 * public/images; and the Canvas feature card, a drawn and narrated canvas (?preview=canvas, its
 * microphone scripted), at 480, 960 and 1440 wide.
 * Run it whenever the app changes visibly.
 *
 * Usage: node apps/web/scripts/product-images.mjs [--server http://127.0.0.1:1426] [--no-glass]
 * Without --server it starts the desktop's Vite on 127.0.0.1:1426 (strictPort) and stops it after.
 * The window is shown as it is on Windows 11 and macOS, glass over a desktop (?glass=acrylic, the
 * development stand-in for the native material); --no-glass shows the opaque fallback instead.
 */
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values } = parseArgs({
  options: { server: { type: "string" }, "no-glass": { type: "boolean", default: false } },
});
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = resolve(web, "../desktop");
const images = resolve(web, "public/images");
const url = values.server ?? "http://127.0.0.1:1426";

/** A feature card's files: WebP at three widths and a PNG fallback. */
const featureOutputs = (name) => [
  [`feature-${name}-480.webp`, 480, "image/webp", 0.9],
  [`feature-${name}-960.webp`, 960, "image/webp", 0.9],
  [`feature-${name}-1440.webp`, 1440, "image/webp", 0.88],
  [`feature-${name}.png`, 960, "image/png", undefined],
];

/** Every encoded file: its name, width, type and quality. */
const outputsFor = (theme) => [
  [`desktop-${theme}-480.webp`, 480, "image/webp", 0.9],
  [`desktop-${theme}-960.webp`, 960, "image/webp", 0.9],
  [`desktop-${theme}-1440.webp`, 1440, "image/webp", 0.9],
  [`desktop-${theme}-2240.webp`, 2240, "image/webp", 0.88],
  [`desktop-${theme}.png`, 1440, "image/png", undefined],
];

let server = null;
let output = "";
if (!values.server) {
  const require = createRequire(resolve(desktop, "package.json"));
  const vite = resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");
  server = spawn(
    process.execPath,
    [vite, "--host", "127.0.0.1", "--port", "1426", "--strictPort"],
    { cwd: desktop, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (data) => {
      output = (output + data).slice(-8192);
    });
}

const browser = await chromium.launch({ headless: true });
try {
  for (let attempt = 0; ; attempt++) {
    // Our own server must be the one answering: another worktree's Vite may hold the port.
    if (server && server.exitCode !== null) throw new Error(output);
    if (attempt > 150) throw new Error(`The desktop preview did not start at ${url}.\n${output}`);
    const ok = await fetch(`${url}/?preview=settled`).then(
      (response) => response.ok && (!server || /ready in/i.test(output)),
      () => false,
    );
    if (ok) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  const theme = "light";
  const context = await browser.newContext({
    viewport: { width: 1440, height: 760 },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
    colorScheme: theme,
  });
  const page = await context.newPage();
  const glass = values["no-glass"] ? "" : "&glass=acrylic";
  // The site's product images keep Aura's neutral palette, which suits its paper and ink; the
  // desktop's own default theme is Claude Code's (owner, 4 November 2026).
  await page.goto(`${url}/?preview=settled&theme=${theme}&palette=aura&agents=lineup${glass}`);
  await page.getByTestId("composer-input").waitFor();
  await page.evaluate(() => document.fonts.ready);
  // Nothing under the hand: no hover fill, no tooltip.
  await page.mouse.move(1439, 759);
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await page.getByRole("table", { name: "File line changes" }).waitFor();
  const capture = await page.screenshot();
  await encode(context, capture, outputsFor(theme));
  await features(theme);
  await context.close();
} finally {
  await browser.close();
  server?.kill();
}

/** Writes `capture` (a PNG) at each of `outputs`, scaled and encoded in the browser. */
async function encode(context, capture, outputs) {
  const encoder = await context.newPage();
  const encoded = await encoder.evaluate(
    async ({ source, outputs }) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      return outputs.map(([name, width, type, quality]) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = Math.round((width * image.height) / image.width);
        const context = canvas.getContext("2d");
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return [name, canvas.toDataURL(type, quality)];
      });
    },
    { source: `data:image/png;base64,${capture.toString("base64")}`, outputs },
  );
  for (const [name, dataUrl] of encoded) {
    const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
    await writeFile(resolve(images, name), bytes);
    console.log(`${name}: ${bytes.length} bytes`);
  }
  await encoder.close();
}

/** The Canvas feature card: a flow drawn and narrated on the canvas. */
async function features(theme) {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 760 },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
    colorScheme: theme,
  });
  const page = await context.newPage();
  await page.goto(`${url}/?preview=canvas&theme=${theme}&palette=aura`);
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  const pane = page.locator("section[aria-label=Canvas]");
  await pane.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const box = await page.locator(".canvas-surface").boundingBox();
  const at = (x, y) => [box.x + x, box.y + y];
  const drag = async (from, to) => {
    await page.mouse.move(...at(...from));
    await page.mouse.down();
    await page.mouse.move(...at(...to), { steps: 10 });
    await page.mouse.up();
  };
  const tool = (name) => pane.getByRole("button", { name, exact: true }).click();
  const label = async (x, y, text) => {
    await tool("Text");
    await page.mouse.click(...at(x, y));
    const editor = pane.getByRole("textbox", { name: "Text on the canvas" });
    await editor.fill(text);
    await editor.press("Enter");
  };
  await pane.getByRole("button", { name: "Talk" }).click();
  await pane.getByText("Listening").waitFor();
  await tool("Rectangle");
  await drag([90, 150], [290, 240]);
  await label(112, 182, "Sign-in page");
  await page.evaluate(() => {
    window.canvasSaid = ["this is where people sign in"];
  });
  await pane.getByText("this is where people sign in").waitFor();
  await tool("Rectangle");
  await drag([470, 150], [690, 240]);
  await label(492, 182, "Session service");
  await tool("Arrow");
  await drag([292, 195], [468, 195]);
  await page.evaluate(() => {
    window.canvasSaid = ["this is where people sign in", "and it hands them a session"];
  });
  await pane.getByText("and it hands them a session").waitFor();
  await pane.getByRole("button", { name: "Blue" }).click();
  await tool("Pen");
  // A hand-drawn wave under the service, as a pen would leave it.
  await page.mouse.move(...at(486, 268));
  await page.mouse.down();
  for (let step = 1; step <= 40; step += 1)
    await page.mouse.move(...at(486 + step * 5, 268 + Math.sin(step / 3) * 7));
  await page.mouse.up();
  await pane.getByRole("button", { name: "Finish" }).click();
  await pane.locator(".canvas-phrases li").nth(1).waitFor();
  await page.mouse.move(1, 1);
  await page.waitForTimeout(600);
  await encode(context, await page.locator(".chat-main").screenshot(), featureOutputs("canvas"));
  await context.close();
}
