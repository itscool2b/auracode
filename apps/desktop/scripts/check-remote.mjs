/**
 * Scripted checks for Settings' Remote access page (`?preview=settings&page=remote`). Nothing
 * connects anywhere: the fixture stands in for the service, and `window.remoteFixture` plays the
 * device that opens a pairing link.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";

const settled = (page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );

export async function checkRemote(browser, url, out, engine) {
  for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1180, height: 820 },
      colorScheme,
      permissions: engine === "chromium" ? ["clipboard-read", "clipboard-write"] : [],
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const calls = () => page.evaluate(() => window.remoteFixture.calls());

    // Off: nothing is paired, and the page says nothing can be reached.
    await page.goto(`${url}/?preview=settings&page=remote`);
    await page.getByRole("heading", { level: 1, name: "Remote access" }).waitFor();
    const toggle = page.getByRole("switch", { name: "Remote access" });
    assert.equal(await toggle.isChecked(), false);
    await page.getByText("Off. Nothing on this computer can be reached from outside.").waitFor();
    assert.equal(await page.getByRole("button", { name: /^Remove / }).count(), 0);
    await settled(page);
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);

    // Pairing turns remote access on by itself and shows the link once, as a code and as text.
    await page.getByRole("button", { name: "Pair", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Pair a device" });
    await dialog.waitFor();
    assert.deepEqual(await calls(), ["enabled:true", "pair"]);
    assert.equal(await toggle.isChecked(), true);
    const code = dialog.getByRole("img", { name: "Pairing code" });
    const box = await code.boundingBox();
    assert.ok(
      box && Math.abs(box.width - box.height) < 1 && box.width >= 200,
      "the code is square",
    );
    assert.ok((await code.locator("path").getAttribute("d")).length > 2000, "the code has modules");
    // Dark modules on white whatever the appearance, or a phone's camera cannot read it.
    assert.equal(await code.locator("rect").getAttribute("fill"), "white");
    assert.equal(await code.locator("path").getAttribute("fill"), "black");
    const link = dialog.getByRole("textbox", { name: "Pairing link" });
    assert.match(await link.inputValue(), /^https:\/\/auracode\.si\/remote#h{22}\.p{11}\.k{43}$/);
    assert.equal(await link.getAttribute("readonly"), "");
    assert.match(
      await dialog.getByTestId("remote-pairing-time").textContent(),
      /^Opens once, for another (10:00|9:5\d)\./,
    );
    if (engine === "chromium") {
      await dialog.getByRole("button", { name: "Copy" }).click();
      await dialog.getByText("Copied").waitFor();
      assert.equal(
        await page.evaluate(() => navigator.clipboard.readText()),
        await link.inputValue(),
      );
    }
    await settled(page);
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: resolve(out, `${engine}-${colorScheme}-remote-pairing.png`) });

    // A device opens the link: the dialog says which, and the list shows it connected.
    await page.evaluate(() => window.remoteFixture.pairDevice("Pixel (Chrome)"));
    await dialog.getByText("Paired with Pixel (Chrome).").waitFor();
    assert.equal(await dialog.getByRole("img").count(), 0, "the spent link stayed on screen");
    await dialog.getByRole("button", { name: "Done" }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal((await calls()).includes("cancel-pairing"), false, "a used link was cancelled");
    await page.getByText("Connected now", { exact: true }).waitFor();

    // Closing an unused link cancels it; an expired one offers a new link instead of a dead code.
    await page.getByRole("button", { name: "Pair", exact: true }).click();
    await dialog.waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal((await calls()).at(-1), "cancel-pairing");
    await page.evaluate(() => window.remoteFixture.pairingLasts(900));
    await page.getByRole("button", { name: "Pair", exact: true }).click();
    await dialog.getByText("This link expired before a device opened it.").waitFor();
    assert.equal(await dialog.getByRole("img").count(), 0);
    await page.evaluate(() => window.remoteFixture.pairingLasts(600_000));
    await dialog.getByRole("button", { name: "New link" }).click();
    await dialog.getByRole("img", { name: "Pairing code" }).waitFor();
    await dialog.getByRole("button", { name: "Close" }).click();

    // Removing a device asks the service by id.
    await page.getByRole("button", { name: "Remove Pixel (Chrome)" }).click();
    await page.getByText("Pixel (Chrome)").waitFor({ state: "detached" });
    assert.equal((await calls()).at(-1), "remove-device:device-1");

    // A bot link: named, created, and its address shown once with where to put it.
    await page.getByRole("button", { name: "Create link" }).click();
    const bot = page.getByRole("dialog", { name: "Link a bot" });
    await bot.waitFor();
    const name = bot.getByRole("textbox", { name: "Name" });
    assert.equal(await name.inputValue(), "Grok Bot");
    await name.fill("fail");
    await bot.getByRole("button", { name: "Create link" }).click();
    await bot.getByRole("alert").getByText("already has 16 bot links").waitFor();
    // The link's level is chosen here: the chat tools unless full control is asked for.
    const levels = bot.getByRole("group", { name: "What it can do" });
    assert.equal(await levels.getByRole("radio", { name: /^Chats/ }).isChecked(), true);
    await levels
      .getByText("It has no tool for Settings", { exact: false })
      .waitFor();
    // Neither level is a wall: an agent the bot directs can still run commands.
    await bot.getByText("the level limits the bot's own tools", { exact: false }).waitFor();
    await levels.getByRole("radio", { name: /^Full control/ }).check();
    await name.fill("Research bot");
    await name.press("Enter");
    const address = bot.getByRole("textbox", { name: "Bot address" });
    assert.match(
      await address.inputValue(),
      /^https:\/\/auracode\.si\/api\/remote\/v1\/mcp\/h{22}\/b{11}\.t{43}$/,
    );
    await bot.getByText("grok.com/connectors").waitFor();
    await bot.getByText("works like a password").waitFor();
    await settled(page);
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: resolve(out, `${engine}-${colorScheme}-remote-bot.png`) });
    await bot.getByRole("button", { name: "Done" }).click();
    await page.getByText("Research bot", { exact: true }).waitFor();
    assert.equal((await calls()).at(-1), "create-bot:Research bot:full");
    await page.getByText("Full control · Not used yet", { exact: true }).waitFor();
    assert.equal(await page.getByText(/t{43}/).count(), 0, "the address stayed on the page");
    await page.getByRole("button", { name: "Remove Research bot" }).click();
    assert.equal((await calls()).at(-1), "remove-bot:bot-1");

    // When the relay cannot be reached the row says so and why; turning it off says off.
    await page.evaluate(() => window.remoteFixture.offline("The relay could not be reached."));
    await page
      .getByText("Not reachable right now; trying again. The relay could not be reached.")
      .waitFor();
    await toggle.focus();
    await page.keyboard.press("Space");
    await page.getByText("Off. Nothing on this computer can be reached from outside.").waitFor();
    assert.equal((await calls()).at(-1), "enabled:false");

    // Already on, with a device and a bot: both lists, and the search finds the page's rows.
    await page.goto(`${url}/?preview=settings&page=remote&remote=on`);
    await page.getByText("iPhone (Safari)", { exact: true }).waitFor();
    await page.getByText("Last seen 7 min ago", { exact: true }).waitFor();
    await page.getByText("Grok Bot", { exact: true }).waitFor();
    await settled(page);
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: resolve(out, `${engine}-${colorScheme}-remote.png`) });
    await page.getByRole("searchbox", { name: "Search settings" }).fill("grok");
    await page
      .getByRole("navigation", { name: "Matching settings" })
      .getByRole("button", { name: /Link a bot/ })
      .click();
    await page.getByRole("heading", { level: 1, name: "Remote access" }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }
}
