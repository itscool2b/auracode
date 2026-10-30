/**
 * Regenerates the home page's product images from the desktop app itself: its chat preview
 * (?preview=settled, development fixtures only, no agent or prompt) at 1440 by 760 and 2x, encoded
 * through Chromium's canvas into WebP at 480, 960, 1440 and 2240 wide and a 1440 PNG fallback in
 * public/images. Run it whenever the app changes visibly.
 *
 * Usage: node apps/web/scripts/product-images.mjs [--server http://127.0.0.1:1426]
 * Without --server it starts the desktop's Vite on 127.0.0.1:1426 (strictPort) and stops it after.
 */
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values } = parseArgs({ options: { server: { type: "string" } } });
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
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 760 },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
      colorScheme: theme,
    });
    const page = await context.newPage();
    await page.goto(`${url}/?preview=settled&theme=${theme}&agents=lineup`);
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
    await page.goto(`${url}/?preview=settled&theme=${theme}&agents=lineup`);
    await page.getByTestId("composer-input").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.keyboard.press("Control+.");
    const agents = page.locator(".chat-model-popover[open] .chat-model-columns > section").first();
    await agents.waitFor();
    const detail = await agents.screenshot();
    const detailUrl = await encoder.evaluate(
      async ({ source, theme }) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 800;
        canvas.height = 600;
        const context = canvas.getContext("2d");
        context.fillStyle = theme === "light" ? "#ffffff" : "#1c1d1f";
        context.fillRect(0, 0, 800, 600);
        const scale = Math.min(752 / image.width, 552 / image.height);
        const width = image.width * scale,
          height = image.height * scale;
        context.drawImage(image, (800 - width) / 2, (600 - height) / 2, width, height);
        return canvas.toDataURL("image/webp", 0.94);
      },
      { source: `data:image/png;base64,${detail.toString("base64")}`, theme },
    );
    await writeFile(
      resolve(images, `hero-detail-${theme}.webp`),
      Buffer.from(detailUrl.split(",")[1], "base64"),
    );
    await context.close();
  }
} finally {
  await browser.close();
  server?.kill();
}
