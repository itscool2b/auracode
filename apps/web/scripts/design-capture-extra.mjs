/** Additional production routes and synthetic desktop states for the complete visual review. */
export async function captureSiteRoutes(page, theme, save, base) {
  for (const [path, title] of [
    ["download", "Website: downloads"],
    ["changelog", "Website: changelog"],
    ["privacy", "Website: privacy"],
    ["terms", "Website: terms"],
  ]) {
    await page.goto(`${base}/${path}`);
    await page.locator("main").waitFor();
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => window.scrollTo(0, 0));
    await save(page, theme, `web-${path}`, title, true);
  }

  await page.goto(`${base}/third-party-notices`);
  await page.getByRole("heading", { name: "Third-party notices" }).waitFor();
  await save(page, theme, "web-notices", "Website: notices");
}

export async function captureDesktopRoutes(page, theme, save, base) {
  for (const [mode, title] of [
    ["new", "Desktop: empty new chat"],
    ["new-worktree", "Desktop: new chat"],
    ["setup", "Desktop: welcome and setup"],
    ["agents", "Desktop: agents"],
    ["instructions", "Desktop: shared instructions"],
    ["instructions-per-agent", "Desktop: per-agent instructions"],
    ["instructions-conflict", "Desktop: instruction conflict"],
    ["profiles", "Desktop: profiles"],
    ["project-tools", "Desktop: project tools"],
    ["worktree-setup", "Desktop: worktree setup"],
    ["git", "Desktop: Git review"],
    ["git-conflict", "Desktop: Git conflict"],
    ["delete-data", "Desktop: data removal review"],
    ["clone", "Desktop: clone repository"],
    ["clone-running", "Desktop: cloning progress"],
    ["clone-error", "Desktop: clone error"],
    ["new-project", "Desktop: project dialog"],
    ["chat-options", "Desktop: chat options"],
    ["questions", "Desktop: agent question"],
    ["steering", "Desktop: steering"],
    ["queue-held", "Desktop: held queue"],
    ["error", "Desktop: session error"],
    ["streaming", "Desktop: streaming transcript"],
    ["thinking", "Desktop: thinking transcript"],
    ["plugins-update", "Desktop: plugin update"],
    ["plugins-failed", "Desktop: plugin error"],
  ]) {
    await page.goto(`${base}/?preview=${mode}&theme=${theme}&agents=lineup`);
    await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
    await page.waitForLoadState("networkidle");
    if (mode === "setup") await page.getByRole("button", { name: "Get started" }).waitFor();
    if (mode === "git-conflict") {
      await page.getByRole("button", { name: "Review merge", exact: true }).click();
      await page.getByRole("button", { name: "Open in Cursor", exact: true }).waitFor();
    }
    await save(page, theme, `desktop-${mode}`, title);
  }
  for (const tab of ["Shortcuts", "About"]) {
    await page.goto(`${base}/?preview=settings&theme=${theme}`);
    await page.getByRole("button", { name: tab, exact: true }).click();
    await page.getByRole("heading", { level: 1, name: tab === "About" ? /^About/ : tab }).waitFor();
    await page.locator(".settings-main").evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.waitForLoadState("networkidle");
    await save(
      page,
      theme,
      `settings-${tab.toLowerCase().replaceAll(" ", "-")}`,
      `Desktop: ${tab}`,
    );
  }
}
