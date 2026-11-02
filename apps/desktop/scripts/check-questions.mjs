/** Pending question browser checks use only the owned in-memory transport. */
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

export async function checkQuestions(browser, url, out, engine) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const dock = page.getByRole("region", { name: "Waiting for your response" });
    const question = dock.locator('[data-test-request-id="question-1"]');
    const input = page.getByTestId("composer-input");
    const open = async (scenario) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${url}/?preview=questions&case=${scenario}`);
      await input.waitFor();
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="composer-input"]').disabled,
      );
    };
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme });
      await open("startup");
      await input.fill("Retain this draft during recovery");
      await page.getByTestId("transcript").evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.getByRole("button", { name: "Ask question", exact: true }).click();
      await question.waitFor();
      assert.equal(await input.isVisible(), false);
      assert.equal(await page.locator('[data-test-request-id="question-1"]').count(), 1);
      await dock.getByText("Session request", { exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.questionCalls), []);
      const choice = question.getByRole("button", { name: "Use advertised default", exact: true });
      await choice.focus();
      await page.keyboard.press("Enter");
      assert.equal(await choice.isDisabled(), true);
      assert.equal(
        await question.getByRole("button", { name: "Dismiss", exact: true }).isDisabled(),
        true,
      );
      assert.deepEqual(await page.evaluate(() => window.questionCalls), [
        { id: "question-1", answer: { type: "select", index: 0 } },
      ]);
      await page.getByRole("button", { name: "Background update", exact: true }).click();
      assert.equal(await choice.isDisabled(), true);
      await page.getByRole("button", { name: "Fail answer", exact: true }).click();
      await question.getByRole("alert").waitFor();
      assert.equal(await choice.isEnabled(), true);
      await choice.focus();
      await page.keyboard.press("Space");
      await page.getByRole("button", { name: "Resolve answer", exact: true }).click();
      await dock.waitFor({ state: "detached" });
      await input.waitFor();
      assert.equal(await input.inputValue(), "Retain this draft during recovery");
      await page.getByRole("button", { name: "Reattach chat", exact: true }).click();
      await input.waitFor();
      assert.equal(await dock.count(), 0);
      assert.equal((await page.evaluate(() => window.questionCalls)).length, 2);
      await page.getByTestId("transcript").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await page.getByText("Informational update only", { exact: true }).waitFor();
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);

      await open("turn");
      await page.getByRole("button", { name: "Ask question", exact: true }).click();
      await dock.getByText("Turn request", { exact: false }).waitFor();
      const radio = question.getByRole("radio", { name: "Unit tests", exact: true });
      await radio.focus();
      await page.keyboard.press("Space");
      assert.equal(await radio.isChecked(), true);
      await page.getByRole("button", { name: "Background update", exact: true }).click();
      assert.equal(await radio.isChecked(), true);
      await question.getByRole("button", { name: "Submit answers", exact: true }).focus();
      await page.keyboard.press("Enter");
      assert.equal(await radio.isDisabled(), true);
      assert.deepEqual(await page.evaluate(() => window.questionCalls), [
        {
          id: "question-1",
          answer: {
            type: "questions",
            answers: [{ question_id: "scope", selected: [0], text: null }],
          },
        },
      ]);
      await page.getByRole("button", { name: "Resolve answer", exact: true }).click();
      await dock.waitFor({ state: "detached" });

      await open("mixed");
      await page.getByRole("button", { name: "Ask question", exact: true }).click();
      await question.waitFor();
      assert.equal(await page.locator('[data-test-request-id="permission-1"]').count(), 0);
      await dock.getByText("1 more request waiting", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Reattach chat", exact: true }).click();
      await question.waitFor();
      assert.deepEqual(await page.evaluate(() => window.questionCalls), []);
      await radio.check();
      await question.getByRole("button", { name: "Submit answers", exact: true }).click();
      assert.equal(await radio.isDisabled(), true);
      await page.getByRole("button", { name: "Withdraw question", exact: true }).click();
      await question.waitFor({ state: "detached" });
      assert.equal(await input.isVisible(), false, "remaining permission still owns composer");
      await dock.locator('[data-test-request-id="permission-1"]').waitFor();
      const allow = dock.getByRole("button", { name: "Allow once", exact: true });
      await allow.focus();
      await page.keyboard.press("Enter");
      assert.equal(await allow.isDisabled(), true);
      await page.getByRole("button", { name: "Fail answer", exact: true }).click();
      await dock.getByRole("alert").waitFor();
      await allow.click();
      await page
        .getByRole("button", { name: "Resolve answer", exact: true })
        .evaluate((button) => button.click());
      await dock.waitFor({ state: "detached" });
      assert.equal(await input.evaluate((element) => element === document.activeElement), true);
      assert.deepEqual(await page.evaluate(() => window.permissionCalls), [
        { id: "permission-1", optionId: "allow" },
        { id: "permission-1", optionId: "allow" },
      ]);

      await open("permission-first");
      await page.getByRole("button", { name: "Ask question", exact: true }).click();
      await allow.waitFor();
      assert.equal(await question.count(), 0, "a question does not jump ahead of a permission");
      await dock.getByRole("button", { name: "Reject", exact: true }).click();
      await page
        .getByRole("button", { name: "Resolve answer", exact: true })
        .evaluate((button) => button.click());
      await question.waitFor();
      assert.equal(await dock.evaluate((element) => element === document.activeElement), true);
      await question.getByRole("button", { name: "Dismiss", exact: true }).click();
      await page
        .getByRole("button", { name: "Resolve answer", exact: true })
        .evaluate((button) => button.click());
      await dock.waitFor({ state: "detached" });
      assert.deepEqual(await page.evaluate(() => window.questionCalls), [
        { id: "question-1", answer: null },
      ]);

      await open("group");
      await input.fill("Keep my composer draft");
      await page.getByRole("button", { name: "Ask question", exact: true }).click();
      const next = question.getByRole("button", { name: "Next", exact: true });
      const back = question.getByRole("button", { name: "Back", exact: true });
      const freeText = question.getByTestId("question-free-text");
      assert.equal(await question.getByTestId("question-group").count(), 1);
      assert.equal(await next.isDisabled(), true);
      await radio.check();
      await next.focus();
      await page.keyboard.press("Enter");
      assert.equal(await question.getByTestId("question-group").count(), 1);
      assert.equal(
        await page.evaluate(() => document.activeElement.textContent),
        "Which details should I report?",
      );
      await question.getByRole("checkbox", { name: "Failures", exact: true }).check();
      await question.getByRole("checkbox", { name: "Timing", exact: true }).check();
      await freeText.fill("Include skipped checks");
      await page.getByRole("button", { name: "Ask another question", exact: true }).click();
      await dock.getByText("1 more request waiting", { exact: true }).waitFor();
      assert.equal(await page.locator('[data-test-request-id="question-2"]').count(), 0);
      await back.click();
      assert.equal(await radio.isChecked(), true);
      await freeText.fill("Only the changed packages");
      assert.equal(await radio.isChecked(), false);
      await freeText.press("Enter");
      assert.equal(
        await question.getByRole("checkbox", { name: "Timing", exact: true }).isChecked(),
        true,
      );
      assert.equal(await freeText.inputValue(), "Include skipped checks");
      await next.click();
      const submit = question.getByRole("button", { name: "Submit answers", exact: true });
      assert.equal(await submit.isDisabled(), true);
      await freeText.fill("No network calls");
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({ path: resolve(out, `${engine}-${theme}-question-step.png`) });
      assert.deepEqual(
        await page.evaluate(() => window.questionCalls),
        [],
        "steps do not send partial answers",
      );
      await freeText.press("Enter");
      assert.equal(await back.isDisabled(), true);
      assert.equal(await submit.isDisabled(), true);
      const expected = {
        id: "question-1",
        answer: {
          type: "questions",
          answers: [
            { question_id: "scope", selected: [], text: "Only the changed packages" },
            { question_id: "details", selected: [0, 1], text: "Include skipped checks" },
            { question_id: "notes", selected: [], text: "No network calls" },
          ],
        },
      };
      assert.deepEqual(await page.evaluate(() => window.questionCalls), [expected]);
      await page.getByRole("button", { name: "Fail answer", exact: true }).click();
      await question.getByRole("alert").waitFor();
      assert.equal(await freeText.inputValue(), "No network calls");
      await back.click();
      assert.equal(await freeText.inputValue(), "Include skipped checks");
      await next.click();
      assert.equal(await freeText.inputValue(), "No network calls");
      await submit.click();
      await page
        .getByRole("button", { name: "Resolve answer", exact: true })
        .evaluate((button) => button.click());
      const last = dock.locator('[data-test-request-id="question-2"]');
      await last.waitFor();
      await last.getByRole("textbox", { name: "Your answer", exact: true }).fill("All set");
      await last.getByRole("button", { name: "Submit", exact: true }).click();
      await page
        .getByRole("button", { name: "Resolve answer", exact: true })
        .evaluate((button) => button.click());
      await dock.waitFor({ state: "detached" });
      assert.equal(await input.inputValue(), "Keep my composer draft");
      assert.equal(await input.evaluate((element) => element === document.activeElement), true);
      assert.deepEqual(await page.evaluate(() => window.questionCalls), [
        expected,
        expected,
        { id: "question-2", answer: { type: "input", text: "All set" } },
      ]);

      await open("turn");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Ask question", exact: true }).click();
      await question.waitFor();
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({ path: resolve(out, `${engine}-${theme}-question-dock.png`) });
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { chromium, webkit } = await import("playwright");
  const out = fileURLToPath(new URL("../../../target/questions-browser/", import.meta.url));
  await mkdir(out, { recursive: true });
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch();
    try {
      await checkQuestions(browser, process.env.CHECK_URL ?? "http://127.0.0.1:1468", out, engine);
      console.log(
        engine +
          ": question docking, keyboard answers, pending/error/withdraw/reattach and draft retention passed",
      );
    } finally {
      await browser.close();
    }
  }
}
