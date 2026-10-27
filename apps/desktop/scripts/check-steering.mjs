/** Browser-only steering checks. No agents, native commands or paid prompts. */
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

export async function checkSteering(browser, url, out, engine) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const input = page.getByTestId("composer-input");
    const steer = page.getByTestId("composer-steer");
    const delivery = (state) => page.locator(`[data-steering-state="${state}"]`);
    const open = async (scenario = "") => {
      await page.goto(`${url}/?preview=steering&case=${scenario}`);
      await input.waitFor();
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="composer-input"]').disabled,
      );
    };

    for (const scenario of ["unsupported", "idle", "unknown-turn", "recovered"]) {
      await open(scenario);
      assert.equal(await steer.count(), 0, `${scenario} incorrectly offers steering`);
    }
    await delivery("unconfirmed").waitFor();
    await page.getByText("Keep this visible after recovery", { exact: true }).waitFor();

    // An agent without steering (Claude Code here) says it takes the message after the turn.
    await open("unsupported");
    await input.fill("Then update the changelog");
    await page.getByTestId("composer-after-turn").waitFor();
    assert.equal(await steer.count(), 0);
    assert.equal(
      await page.getByRole("button", { name: "Queue message", exact: true }).isEnabled(),
      true,
    );
    await settled(page);
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: resolve(out, `${engine}-steering-after-turn.png`) });

    await open();
    await input.fill("Use the existing index");
    await steer.click();
    await delivery("pending").waitFor();
    assert.equal(await steer.isDisabled(), true);
    assert.equal(await page.getByTestId("composer-send").isDisabled(), true);
    assert.equal(await page.getByTestId("composer-stop").isEnabled(), true);
    await input.press("Enter");
    assert.deepEqual(await page.evaluate(() => window.steeringCalls), {
      steer: 1,
      send: 0,
      expected: "fixture-turn",
    });
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await delivery("accepted").waitFor();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="composer-input"]').value === "",
    );
    assert.equal(await page.getByText("Use the existing index", { exact: true }).count(), 1);
    await settled(page);
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: resolve(out, `${engine}-steering-accepted.png`) });

    for (const [button, state] of [
      ["Reject", "rejected"],
      ["Lose reply", "unconfirmed"],
    ]) {
      await open();
      await input.fill("Keep this draft");
      await steer.click();
      await delivery("pending").waitFor();
      await page.getByRole("button", { name: button, exact: true }).click();
      await delivery(state).waitFor();
      await page.getByTestId("composer-error").waitFor();
      assert.equal(await input.inputValue(), "Keep this draft");
      assert.deepEqual(await page.evaluate(() => window.steeringCalls), {
        steer: 1,
        send: 0,
        expected: "fixture-turn",
      });
    }

    await open();
    await input.fill("First instruction");
    await steer.click();
    await delivery("pending").waitFor();
    await input.fill("A newer draft");
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await delivery("accepted").waitFor();
    assert.equal(await input.inputValue(), "A newer draft");

    await open();
    await input.fill("A late acknowledgement");
    await steer.click();
    await delivery("pending").waitFor();
    await page.getByTestId("composer-stop").click();
    await page.getByTestId("composer-force-stop").waitFor();
    await delivery("pending").waitFor();
    await page.getByRole("button", { name: "End turn", exact: true }).click();
    await delivery("unconfirmed").waitFor();
    assert.equal(await steer.count(), 0);
    assert.equal(await input.inputValue(), "A late acknowledgement");
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await delivery("accepted").waitFor();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="composer-input"]').value === "",
    );
    assert.deepEqual(await page.evaluate(() => window.steeringCalls), {
      steer: 1,
      send: 0,
      expected: "fixture-turn",
    });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { chromium, webkit } = await import("playwright");
  const out = fileURLToPath(new URL("../../../target/steering-browser/", import.meta.url));
  await mkdir(out, { recursive: true });
  for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
    const browser = await browserType.launch();
    try {
      await checkSteering(browser, process.env.CHECK_URL ?? "http://localhost:1426", out, engine);
      console.log(
        `${engine}: qualified steering, exact turn, delivery states, draft retention and Stop passed`,
      );
    } finally {
      await browser.close();
    }
  }
}
