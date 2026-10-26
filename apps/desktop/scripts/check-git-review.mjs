import assert from "node:assert/strict";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";

export async function checkGitReview(page, url, out, engine) {
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
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  await page.screenshot({ path: resolve(out, `${engine}-worktree-restore.png`) });
  await page.getByRole("button", { name: "Restore retained worktree" }).click();
  await page.getByRole("button", { name: "Review merge", exact: true }).waitFor();
  assert.deepEqual(
    await page.evaluate(() => window.gitFixture.calls().filter((call) => call.startsWith("apply"))),
    [
      "apply-isolation",
      "apply-relocation",
      "apply-relocation",
      "apply-action",
      "apply-action",
      "apply-recovery",
    ],
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open Git workspace" }).waitFor();
}
