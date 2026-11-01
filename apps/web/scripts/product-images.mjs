/**
 * Regenerates the home page's product images from the desktop app itself: its chat preview
 * (?preview=settled, development fixtures only, no agent or prompt) at 1440 by 760 and 2x, encoded
 * through Chromium's canvas into WebP at 480, 960, 1440 and 2240 wide and a 1440 PNG fallback in
 * public/images. Run it whenever the app changes visibly.
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
  await page.goto(`${url}/?preview=settled&theme=${theme}&agents=lineup${glass}`);
  await page.getByTestId("composer-input").waitFor();
  await page.evaluate(() => document.fonts.ready);
  // Nothing under the hand: no hover fill, no tooltip.
  await page.mouse.move(1439, 759);
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await page.getByRole("table", { name: "File line changes" }).waitFor();
  const capture = await page.screenshot();
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
    { source: `data:image/png;base64,${capture.toString("base64")}`, outputs: outputsFor(theme) },
  );
  for (const [name, dataUrl] of encoded) {
    const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
    await writeFile(resolve(images, name), bytes);
    console.log(`${name}: ${bytes.length} bytes`);
  }
  await context.close();
} finally {
  await browser.close();
  server?.kill();
}
