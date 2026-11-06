/**
 * Typing while a turn streams must not move the transcript (`?preview=streaming`). The composer
 * measures itself collapsed on every keystroke; if what surrounds it collapsed too, a transcript
 * at its bottom would be clamped up for that moment and pulled back down by the next streamed
 * frame, a flicker. So: with the view at its bottom, no frame may move the transcript up while its
 * viewport keeps its size.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function checkComposerFollow(browser, url, engine) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(`${url}/?preview=streaming`);
    const field = page.getByRole("textbox", { name: "Message" });
    await field.waitFor();
    await page.locator(".chat-transcript").waitFor();
    await page.evaluate(() => {
      const log = document.querySelector(".chat-transcript");
      window.__frames = [];
      const tick = () => {
        window.__frames.push([log.scrollTop, log.clientHeight]);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await field.click();
    // Long enough to wrap onto more lines, so the box grows past its smallest height.
    const text =
      "This message wraps across several lines in the composer, so the box grows taller while the agent streams its answer above it, and keeps growing.";
    for (const character of text) await page.keyboard.type(character, { delay: 20 });
    await page.waitForTimeout(200);
    const frames = await page.evaluate(() => window.__frames);
    const jumps = frames.filter(
      ([top, height], index) =>
        index > 0 && height === frames[index - 1][1] && top < frames[index - 1][0] - 0.5,
    );
    assert.ok(frames.length > 30, `${engine}: frames were sampled`);
    assert.ok(
      (await field.evaluate((node) => node.offsetHeight)) > 48,
      `${engine}: the box grew past one line`,
    );
    assert.deepEqual(jumps, [], `${engine}: typing moved the transcript up`);
  } finally {
    await page.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { chromium, webkit } = await import("playwright");
  for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
    const browser = await browserType.launch();
    try {
      await checkComposerFollow(browser, process.env.CHECK_URL ?? "http://localhost:1448", engine);
      console.log(`${engine}: typing while a turn streams keeps the transcript still`);
    } finally {
      await browser.close();
    }
  }
}
