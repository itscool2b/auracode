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

export async function checkGitReview(page, url, out, engine) {
  await page.goto(`${url}/?preview=git&non-git&live`);
  const initialize = page.getByRole("button", { name: "Review Git initialization", exact: true });
  await initialize.waitFor();
  assert.equal(await initialize.isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => window.gitFixture.calls()), []);
  await page.getByRole("button", { name: "Stop session", exact: true }).click();
  await initialize.click();
  await page.getByRole("heading", { name: "Review Git initialization", exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.gitFixture.calls()), [
    "stop",
    "review-initialize",
  ]);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await initialize.click();
  await settled(page);
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  await page.screenshot({ path: resolve(out, `${engine}-git-initialize-review.png`) });
  await page.getByRole("button", { name: "Initialize reviewed folder", exact: true }).click();
  await page
    .getByText(
      "Git is initialized. Existing files remain unstaged. Create the first commit before isolation.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Review isolation", exact: true }).isDisabled(),
    true,
  );
  assert.deepEqual(await page.evaluate(() => window.gitFixture.calls()), [
    "stop",
    "review-initialize",
    "review-initialize",
    "apply-initialize:initialize-once",
    "refresh-chat",
  ]);
  await page.goto(`${url}/?preview=git&non-git&stale-init`);
  await initialize.click();
  await page.getByRole("button", { name: "Initialize reviewed folder", exact: true }).click();
  await page
    .getByText("The folder changed since review. Review Git initialization again.", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Initialize reviewed folder", exact: true }).count(),
    0,
  );
  await page.goto(`${url}/?preview=git&live`);
  const isolate = page.getByRole("button", { name: "Review isolation", exact: true });
  await isolate.waitFor();
  assert.equal(await isolate.isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => window.gitFixture.calls()), []);
  await page.getByRole("button", { name: "Stop session", exact: true }).click();
  await page.getByLabel("Bring uncommitted changes", { exact: false }).check();
  await isolate.click();
  await page.getByRole("heading", { name: "Review isolation" }).waitFor();
  await page.getByText("Copy reviewed changes as unstaged files", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.gitFixture.calls().includes("apply-isolation")),
    false,
  );
  await settled(page);
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  await page.screenshot({ path: resolve(out, `${engine}-isolation-review.png`) });
  await page.getByRole("button", { name: "Create isolated workspace" }).click();
  await page.getByRole("heading", { name: "Owned worktrees" }).waitFor();
  await page.getByRole("button", { name: "Review moving this chat", exact: true }).click();
  await page.getByRole("heading", { name: "Context for your next prompt" }).waitFor();
  assert.equal(
    await page.evaluate(() => window.gitFixture.calls().includes("apply-relocation")),
    false,
  );
  await settled(page);
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  await page.screenshot({ path: resolve(out, `${engine}-worktree-move.png`) });
  await page.getByRole("button", { name: "Move chat to reviewed folder" }).click();
  await page.getByRole("button", { name: "Review return to project folder", exact: true }).click();
  await page.getByRole("button", { name: "Move chat to reviewed folder" }).click();
  await page.getByRole("button", { name: "Review moving this chat", exact: true }).waitFor();
  await page.evaluate(() => sessionStorage.setItem("git-conflict", "yes"));
  await page.getByRole("button", { name: "Review merge", exact: true }).click();
  await page.getByRole("heading", { name: "Conflicts to resolve first" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Merge reviewed changes" }).isDisabled(),
    true,
  );
  assert.equal(
    await page.evaluate(() => window.gitFixture.calls().includes("apply-action")),
    false,
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => {
    sessionStorage.removeItem("git-conflict");
    sessionStorage.setItem("git-stale", "yes");
  });
  await page.getByRole("button", { name: "Review merge", exact: true }).click();
  await page.getByRole("button", { name: "Merge reviewed changes" }).click();
  await page.getByRole("alert").filter({ hasText: "repository changed" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Merge reviewed changes" }).count(), 0);
  await page.evaluate(() => sessionStorage.removeItem("git-stale"));
  await page.getByRole("button", { name: "Review retirement", exact: true }).click();
  await page.getByRole("button", { name: "Retire and keep files" }).click();
  await page.getByRole("button", { name: "Review restoration", exact: true }).click();
  await page.getByRole("heading", { name: "Review restoration" }).waitFor();
  await settled(page);
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  await page.screenshot({ path: resolve(out, `${engine}-worktree-restore.png`) });
  await page.getByRole("button", { name: "Restore retained worktree" }).click();
  await page.getByRole("button", { name: "Review merge", exact: true }).waitFor();
  await page.getByRole("button", { name: "Prepare pull request", exact: true }).click();
  await page.getByLabel("Pull request title", { exact: true }).fill("Finish release checks");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Review the completed changes.\n\nVerified with the product checks.");
  await page.getByRole("button", { name: "Review pull request", exact: true }).click();
  await page.getByRole("heading", { name: "Review pull request", exact: true }).waitFor();
  await page.getByText("fixture/orbit", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.gitFixture.calls().includes("apply-pr")), false);
  await settled(page);
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  await page.screenshot({ path: resolve(out, `${engine}-pull-request-review.png`) });
  await page.getByRole("button", { name: "Publish reviewed pull request" }).click();
  await page.getByRole("heading", { name: "Pull request created" }).waitFor();
  assert.equal(
    await page.getByRole("link", { name: "Open on GitHub" }).getAttribute("href"),
    "https://github.com/fixture/orbit/pull/1",
  );
  assert.deepEqual(
    await page.evaluate(() => window.gitFixture.calls().filter((call) => call.startsWith("apply"))),
    [
      "apply-isolation",
      "apply-relocation",
      "apply-relocation",
      "apply-action",
      "apply-action",
      "apply-recovery",
      "apply-pr",
    ],
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open Git workspace" }).waitFor();
  await checkWorktreeRecreate(page, url, out, engine);
}

/**
 * A worktree folder deleted by hand: "Recreate folder" opens a confirmation that leads with what
 * is lost and what is kept, Cancel changes nothing, a stale review is refused and reviewed again,
 * and the next confirmation brings the folder back on its branch.
 */
export async function checkWorktreeRecreate(page, url, out, engine) {
  await page.goto(`${url}/?preview=git-missing`);
  const recreate = page.getByRole("button", { name: "Recreate folder", exact: true });
  await recreate.waitFor();
  await page.getByText("missing", { exact: true }).waitFor();
  await recreate.click();
  const dialog = page.getByRole("dialog", { name: "Recreate the deleted folder?" });
  await dialog
    .getByText(
      "Uncommitted files that were in the deleted folder are gone. Everything committed on the branch is kept.",
      { exact: true },
    )
    .waitFor();
  await dialog.getByText("aura/release-readiness", { exact: true }).waitFor();
  await dialog.getByText("9c41e07d2b8a", { exact: true }).waitFor();
  await dialog.getByText("C:/auracode/worktrees/owned-one", { exact: true }).waitFor();
  await settled(page);
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  await page.screenshot({ path: resolve(out, `${engine}-worktree-recreate.png`) });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => window.gitFixture.calls()), ["review-recreate"]);
  await recreate.click();
  await page.evaluate(() => sessionStorage.setItem("git-stale", "yes"));
  await dialog.getByRole("button", { name: "Recreate folder", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "expired or was already used" }).waitFor();
  await page.waitForFunction(
    () => window.gitFixture.calls().filter((call) => call === "review-recreate").length === 3,
  );
  await dialog.getByRole("button", { name: "Recreate folder", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByRole("heading", { name: "Workspace updated", exact: true }).waitFor();
  await page
    .getByText(
      "The folder is back on aura/release-readiness at its last commit. Uncommitted files from the deleted folder could not be restored.",
      { exact: true },
    )
    .waitFor();
  await page.getByText("ready", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.gitFixture.calls()), [
    "review-recreate",
    "review-recreate",
    "apply-recreate:recreate-2",
    "review-recreate",
    "apply-recreate:recreate-3",
    "refresh-chat",
  ]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open Git workspace" }).waitFor();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { chromium, webkit } = await import("playwright");
  const out = fileURLToPath(new URL("../../../target/settings-browser/", import.meta.url));
  await mkdir(out, { recursive: true });
  for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
    const browser = await browserType.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await checkGitReview(page, process.env.CHECK_URL ?? "http://localhost:1426", out, engine);
      console.log(
        `${engine}: reviewed Git workspace, pull request and worktree recreation flows passed`,
      );
    } finally {
      await browser.close();
    }
  }
}
