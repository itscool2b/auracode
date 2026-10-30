/** Additional production routes and synthetic desktop states for the complete visual review. */
export async function captureSiteRoutes(page, theme, save, base) {
  await page.route("**/api/v1/config", (route) =>
    route.fulfill({ json: { protocol: 1, turnstile_site_key: "synthetic-visual-review" } }),
  );
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "window.turnstile={render(node,options){options.callback('synthetic-visual-proof');return 'visual';},remove(){}};",
    }),
  );
  for (const [path, title] of [
    ["download", "Website: downloads"],
    ["signin", "Website: sign in"],
    ["signup", "Website: sign up"],
    ["verify-device", "Website: device verification"],
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

  // A populated account is a local capture fixture. All requests terminate in these handlers.
  const now = Math.floor(Date.now() / 1000);
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      json: {
        session: {
          user_id: "visual-review",
          client_kind: "browser",
          device_id: null,
          created_at: now,
          expires_at: now + 3600,
        },
        csrf_token: "synthetic-visual-csrf",
      },
    }),
  );
  await page.route("**/api/v1/account", (route) =>
    route.fulfill({
      json: {
        account: {
          id: "visual-review",
          email: "preview@example.invalid",
          created_at: now,
          sync_used_bytes: 100000,
          sync_limit_bytes: 104857600,
          blob_reserved_bytes: 1000,
          blob_limit_bytes: 1073741824,
        },
      },
    }),
  );
  await page.route("**/api/v1/devices", (route) =>
    route.fulfill({
      json: {
        devices: [
          {
            id: "visual-device",
            name: "Studio laptop",
            platform: "macos",
            created_at: now,
            last_seen: now,
            approved_at: now,
            revoked_at: null,
          },
        ],
      },
    }),
  );
  await page.goto(`${base}/account`);
  await page.getByRole("heading", { name: "preview@example.invalid" }).waitFor();
  await save(page, theme, "web-account", "Website: populated account", true);
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
    ["config-sync", "Desktop: configuration sync"],
    ["profiles", "Desktop: profiles"],
    ["account", "Desktop: account"],
    ["data-transfer", "Desktop: data transfer"],
    ["keep-local", "Desktop: account recovery"],
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
    ["plugin-sync", "Desktop: plugin sync"],
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
  for (const tab of ["Account", "Configuration sync", "Shortcuts", "About"]) {
    const account = tab === "Account" ? "&account=ready" : "";
    await page.goto(`${base}/?preview=settings&theme=${theme}${account}`);
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
