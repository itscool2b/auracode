/**
 * The layout probe: walks every ?preview= mode in Chromium and WebKit at two window sizes, plus the
 * chat shell's floating layers opened as a person opens them ("settled#picker": the picker, the
 * palette, the chat and account menus, the other agents, the Changes panel, a typed message), and
 * fails on the five things a clean screen never has:
 *
 * 1. Horizontal overflow: the page scrolls sideways, or a visible box reaches past the window.
 * 2. Off-grid containers: a padded block container whose offset from its padded parent, or whose
 *    width or height, is off Graphite's 4px grid by more than half a pixel.
 * 3. Overlapping controls: two visible interactive elements in the same layer (the page, one
 *    popover, one dialog) that overlap, unless one holds the other.
 * 4. Missing focus: an element reached with Tab that draws no visible ring (an outline or a ring
 *    shadow) and no highlight (a fill or border change), which lists use in place of a ring (3.7).
 * 5. Low contrast: visible text under 4.5:1 against the opaque surface behind it. Disabled
 *    controls are exempt, as WCAG exempts them.
 *
 * Development-only fixtures; no agent process or prompt. Usage:
 *   node scripts/check-layout.mjs [--server URL] [--engines chromium,webkit]
 *     [--modes settled,thinking] [--sizes 1440x900,1024x700] [--focus-steps 120]
 * The report is written to target/layout-browser/<engine>.json.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, webkit } from "playwright";

/** Every ?preview= mode main.tsx routes, the chat harness's own and the other screens'. */
export const MODES = [
  "settled",
  "streaming",
  "thinking",
  "permission",
  "error",
  "new",
  "history",
  "history-question",
  "partial-history",
  "partial-message",
  "large-turn",
  "long-prompt",
  "long-output",
  "focus-group",
  "diff",
  "recorded-thinking",
  "recorded-tools",
  "questions",
  "steering",
  "config-sync",
  "worktree-setup",
  "profiles",
  "account",
  "verification",
  "project-tools",
  "data-transfer",
  "keep-local",
  "git",
  "settings",
  "setup",
  "agents",
  // New chat in a project folder: a Git folder's worktree chip, no commit yet, a plain folder.
  "new-worktree",
  "new-unavailable",
  "new-plain",
  "git-missing",
  // The chat shell's floating layers, opened the way a person opens them.
  "settled#picker",
  "settled#palette",
  "settled#chat-menu",
  "settled#changes",
  "settled#other-agents",
  "settled#account-menu",
  "thinking#typed",
  // The worktree chip's popover, Local chosen, a refused branch name, the setup terminal after
  // Create, and the recreate dialog for a deleted worktree folder.
  "new-worktree#worktree",
  "new-worktree#local",
  "new-worktree#branch-error",
  "new-setup#setup",
  "git-missing#recreate",
  // The docked terminal panel: two tabs open, opened with Ctrl+`, its shell menu, and resized.
  "terminal-panel",
  "settled#terminal",
  "terminal-panel#shell-menu",
  "terminal-panel#resized",
  // A worktree chat's merge that conflicts: the files, the message for the agent, Open in.
  "git-conflict#conflict",
  // A chat whose worktree folder was deleted: its start error, and Recreate folder from it.
  "missing-worktree",
  "missing-worktree#recreate",
];

/** Waits until the panel's shell has drawn its prompt. */
const terminalReady = (page) =>
  page.waitForFunction(() =>
    document
      .querySelector(".terminal-panel-viewport .xterm-accessibility-tree")
      ?.textContent?.includes(">"),
  );

const openWorktree = async (page) => {
  await page.getByTestId("new-chat-worktree").locator("summary").click();
  await page.locator(".new-chat-worktree-panel").waitFor();
};

/** How each "<mode>#<view>" opens its layer before the probes run. */
const OPENERS = {
  picker: (page) => page.keyboard.press("Control+."),
  palette: (page) => page.keyboard.press("Control+k"),
  "chat-menu": (page) => page.locator('summary[aria-label="Chat details and controls"]').click(),
  changes: (page) => page.getByRole("button", { name: "Changes", exact: true }).click(),
  "other-agents": (page) => page.locator('summary[aria-label$="other agents"]').click(),
  "account-menu": (page) => page.locator('summary[aria-label="Account menu"]').click(),
  typed: async (page) => {
    await page.getByTestId("composer-input").click();
    await page.keyboard.type("Hi");
  },
  worktree: openWorktree,
  local: async (page) => {
    await openWorktree(page);
    await page.locator('[data-test-mode-choice="local"]').click();
    await page.keyboard.press("Escape");
  },
  "branch-error": async (page) => {
    await openWorktree(page);
    await page.getByLabel("New branch", { exact: true }).fill("release/1.4");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.locator(".new-chat-worktree-error").waitFor();
  },
  setup: async (page) => {
    await page.getByTestId("new-chat-create").click();
    await page.getByRole("button", { name: "Start setup", exact: true }).click();
    await page.locator('.terminal-sheet[data-state="running"]').waitFor();
  },
  recreate: async (page) => {
    await page.getByRole("button", { name: "Recreate folder", exact: true }).click();
    await page.getByRole("dialog", { name: "Recreate the deleted folder?" }).waitFor();
  },
  terminal: async (page) => {
    await page.keyboard.press("Control+Backquote");
    await terminalReady(page);
  },
  "shell-menu": async (page) => {
    await terminalReady(page);
    await page.locator('.terminal-panel-shells > summary[aria-label="New terminal with"]').click();
  },
  conflict: async (page) => {
    await page.getByRole("button", { name: "Review merge", exact: true }).click();
    await page.getByRole("button", { name: "Open in Cursor", exact: true }).waitFor();
  },
  resized: async (page) => {
    await terminalReady(page);
    await page.getByRole("separator", { name: "Resize terminal panel" }).focus();
    for (let step = 0; step < 5; step++) await page.keyboard.press("ArrowUp");
  },
};

const { values } = parseArgs({
  options: {
    server: { type: "string" },
    engines: { type: "string", default: "chromium,webkit" },
    modes: { type: "string" },
    sizes: { type: "string", default: "1440x900,1024x700" },
    "focus-steps": { type: "string", default: "120" },
  },
});
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(app, "../../target/layout-browser");
const port = "1489";
const url = values.server ?? `http://127.0.0.1:${port}`;
const modes = values.modes ? values.modes.split(",") : MODES;
const sizes = values.sizes.split(",").map((size) => size.split("x").map(Number));
const focusSteps = Number(values["focus-steps"]);
const require = createRequire(import.meta.url);

/** Runs in the page: the four static probes. Returns plain findings. */
function probe() {
  const GRID = 4;
  const TOLERANCE = 0.5;
  for (const animation of document.getAnimations())
    if (animation.effect?.getTiming().iterations !== Infinity) animation.finish();
  const findings = [];
  const view = { width: innerWidth, height: innerHeight };
  const path = (element) => {
    const parts = [];
    for (let node = element; node && node !== document.body && parts.length < 4; ) {
      let part = node.tagName.toLowerCase();
      const testId = node.getAttribute("data-testid");
      const label = node.getAttribute("aria-label");
      if (testId) part += `[data-testid="${testId}"]`;
      else if (node.classList.length) part += `.${[...node.classList].slice(0, 2).join(".")}`;
      if (label) part += `[aria-label="${label.slice(0, 40)}"]`;
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  };
  const opacity = (element) => {
    let value = 1;
    for (let node = element; node; node = node.parentElement)
      value *= Number(getComputedStyle(node).opacity);
    return value;
  };
  const hidden = (element) => {
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") return true;
    if (element.closest("[hidden], [inert], details:not([open]) > :not(summary)")) return true;
    if (element.getClientRects().length === 0) return true;
    const box = element.getBoundingClientRect();
    if (box.width <= 1 || box.height <= 1) return true;
    return opacity(element) < 0.05;
  };
  /** The part of the box no overflow-clipping ancestor cuts away, or null when nothing shows. */
  const visibleBox = (element) => {
    const box = element.getBoundingClientRect();
    let left = Math.max(box.left, 0);
    let top = Math.max(box.top, 0);
    let right = Math.min(box.right, view.width);
    let bottom = Math.min(box.bottom, view.height);
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/(hidden|auto|scroll|clip)/.test(style.overflow + style.overflowX + style.overflowY)) {
        const clip = node.getBoundingClientRect();
        left = Math.max(left, clip.left);
        top = Math.max(top, clip.top);
        right = Math.min(right, clip.right);
        bottom = Math.min(bottom, clip.bottom);
      }
      if (style.position === "fixed") break;
    }
    return right - left > 1 && bottom - top > 1 ? { left, top, right, bottom } : null;
  };

  // 1. Horizontal overflow.
  if (document.documentElement.scrollWidth > view.width + 1)
    findings.push({
      kind: "overflow",
      target: "page",
      detail: `page is ${document.documentElement.scrollWidth}px wide in a ${view.width}px window`,
    });
  for (const element of document.body.querySelectorAll("*")) {
    if (hidden(element)) continue;
    const box = element.getBoundingClientRect();
    if (box.right > view.width + 1 && visibleBox(element) && box.left < view.width) {
      const fixed = getComputedStyle(element).position === "fixed";
      // Content scrolled inside a clipping box is not overflow; only boxes the page itself shows.
      let clipped = false;
      for (let node = element.parentElement; node && !fixed; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/(hidden|auto|scroll|clip)/.test(style.overflowX)) {
          clipped = true;
          break;
        }
      }
      if (!clipped)
        findings.push({
          kind: "overflow",
          target: path(element),
          detail: `right edge at ${Math.round(box.right)}px in a ${view.width}px window`,
        });
    }
  }

  // 2. Padded block containers on the 4px grid.
  const blocks = new Set(["block", "flex", "grid", "flow-root", "list-item", "table"]);
  const padded = (element) => {
    const style = getComputedStyle(element);
    if (!blocks.has(style.display)) return false;
    return ["Top", "Right", "Bottom", "Left"].some(
      (side) => Number.parseFloat(style[`padding${side}`]) > 0,
    );
  };
  const scrollerOf = (element, stop) => {
    for (let node = element.parentElement; node && node !== stop; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY + style.overflowX)) return node;
    }
    return null;
  };
  const off = (value) => {
    const remainder = Math.abs(value) % GRID;
    return Math.min(remainder, GRID - remainder) > TOLERANCE;
  };
  /**
   * A box as wide as its own words (a pill, a chip, a right-aligned message) takes its width, and
   * so its place on a centred or end-aligned line, from its text; only its height must be on the
   * grid. Measured by letting the box size itself to its content.
   */
  const contentWidth = new Map();
  const sizedByContent = (element) => {
    if (contentWidth.has(element)) return contentWidth.get(element);
    const before = element.getBoundingClientRect().width;
    const saved = element.style.getPropertyValue("width");
    const priority = element.style.getPropertyPriority("width");
    element.style.setProperty("width", "max-content", "important");
    const natural = element.getBoundingClientRect().width;
    if (saved) element.style.setProperty("width", saved, priority);
    else element.style.removeProperty("width");
    const result = Math.abs(natural - before) <= TOLERANCE;
    contentWidth.set(element, result);
    return result;
  };
  for (const element of document.body.querySelectorAll("*")) {
    if (hidden(element) || !padded(element) || !visibleBox(element)) continue;
    const box = element.getBoundingClientRect();
    // Glyph, keycap and chip boxes (under 24px) have Graphite's own pixel geometry.
    if (box.width < 24 || box.height < 24) continue;
    let parent = element.parentElement;
    while (parent && !(padded(parent) && !hidden(parent))) parent = parent.parentElement;
    const scroller = scrollerOf(element, parent);
    const origin = scroller ?? parent;
    const base = origin ? origin.getBoundingClientRect() : { left: 0, top: 0 };
    const dx = box.left - base.left + (scroller ? scroller.scrollLeft : 0);
    const dy = box.top - base.top + (scroller ? scroller.scrollTop : 0);
    const ownWidth = sizedByContent(element);
    // A box placed after content-sized siblings on its line starts wherever their words end.
    let afterWords = false;
    for (let sibling = element.previousElementSibling; sibling; ) {
      const sibBox = sibling.getBoundingClientRect();
      if (
        !hidden(sibling) &&
        Math.abs(sibBox.top - box.top) < box.height &&
        sibBox.left < box.left &&
        sizedByContent(sibling)
      ) {
        afterWords = true;
        break;
      }
      sibling = sibling.previousElementSibling;
    }
    // A modal dialog centred in the window (4.6) takes its offset from the window's size, which the
    // person sets, so only that axis is exempt; its own size and everything inside keep the grid.
    // A dialog held at a set offset (the palette's) is still measured on that axis.
    const modal = !origin && element.matches("dialog:modal");
    const style = getComputedStyle(element);
    const centredX = modal && style.marginLeft === style.marginRight;
    const centredY = modal && style.marginTop === style.marginBottom;
    const problems = [];
    if (!centredX && !ownWidth && !afterWords && off(dx)) problems.push(`x ${dx.toFixed(1)}`);
    if (!centredY && off(dy)) problems.push(`y ${dy.toFixed(1)}`);
    if (!ownWidth && off(box.width)) problems.push(`width ${box.width.toFixed(1)}`);
    if (off(box.height)) problems.push(`height ${box.height.toFixed(1)}`);
    if (problems.length)
      findings.push({
        kind: "grid",
        target: path(element),
        detail: `${problems.join(", ")} (from ${origin ? path(origin) : "the window"})`,
      });
  }

  // 3. Overlapping controls, within one layer.
  const interactive = [
    ...document.body.querySelectorAll(
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="option"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="link"]',
    ),
  ]
    .filter((element) => !hidden(element))
    .map((element) => ({ element, box: visibleBox(element) }))
    .filter((entry) => entry.box !== null);
  // A layer is the page, a popover, a dialog, or a box placed over the flow (a sticky prompt, a
  // row's hover menu, a floating "Latest"): controls are compared only within their own layer.
  const layerOf = (element) => {
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      if (node.matches('dialog[open], .chat-popover-panel, [role="menu"], [role="listbox"]'))
        return node;
      if (/^(absolute|fixed|sticky)$/.test(getComputedStyle(node).position)) return node;
    }
    return document.body;
  };
  for (let i = 0; i < interactive.length; i++) {
    const a = interactive[i];
    for (let j = i + 1; j < interactive.length; j++) {
      const b = interactive[j];
      if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
      if (layerOf(a.element) !== layerOf(b.element)) continue;
      const width = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
      const height = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
      if (width > 1 && height > 1)
        findings.push({
          kind: "overlap",
          target: path(a.element),
          detail: `overlaps ${path(b.element)} by ${width.toFixed(0)}x${height.toFixed(0)}px`,
        });
    }
  }

  // 5. Text contrast against the opaque surface behind it.
  const parse = (value) => {
    const match = value.match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const background = (element) => {
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== "none" && !style.backgroundImage.startsWith("url("))
        return null;
      const color = parse(style.backgroundColor);
      if (color && color.a > 0) {
        layers.push(color);
        if (color.a >= 1) break;
      }
    }
    let result = { r: 0, g: 0, b: 0, a: 1 };
    for (const layer of layers.reverse()) result = over(layer, result);
    return result;
  };
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const element = text.parentElement;
    if (!element || seen.has(element) || !text.textContent?.trim()) continue;
    seen.add(element);
    if (hidden(element)) continue;
    if (
      element.closest(
        ":disabled, [aria-disabled='true'], fieldset:disabled, option, [aria-hidden='true']",
      )
    )
      continue;
    const style = getComputedStyle(element);
    if (style.webkitTextFillColor && parse(style.webkitTextFillColor)?.a === 0) continue;
    const color = parse(style.color);
    const behind = background(element);
    if (!color || !behind) continue;
    const alpha = color.a * opacity(element);
    const shown = over({ ...color, a: alpha }, behind);
    const [light, dark] = [luminance(shown), luminance(behind)].sort((x, y) => y - x);
    const ratio = (light + 0.05) / (dark + 0.05);
    if (ratio < 4.5)
      findings.push({
        kind: "contrast",
        target: path(element),
        detail: `${ratio.toFixed(2)}:1 for "${text.textContent.trim().slice(0, 32)}"`,
      });
  }
  return findings;
}

/** Runs in the page: the styles that can show focus on the active element, and its resting ones. */
function focusedStyle() {
  const target = document.activeElement;
  if (!target || target === document.body) return null;
  // Settle the focus transition (a ring fading in over 150ms) before reading its end state.
  for (const animation of document.getAnimations())
    if (animation.effect?.getTiming().iterations !== Infinity) animation.finish();
  const style = getComputedStyle(target);
  const box = target.getBoundingClientRect();
  const name = typeof target.className === "string" ? target.className.trim() : "";
  const label =
    target.getAttribute("aria-label") ?? target.textContent?.trim().replace(/\s+/g, " ") ?? null;
  const key = target.dataset.layoutKey ?? `${Math.random()}`;
  target.dataset.layoutKey = key;
  // A field inside a larger control (the composer's message box) may light its frame instead.
  const frames = [target.parentElement, target.parentElement?.parentElement].filter(Boolean);
  const framed = frames.some((frame) => {
    const base = window.__focusBase.get(frame);
    if (!base) return false;
    const now = getComputedStyle(frame);
    return (
      now.boxShadow !== base.shadow ||
      now.borderColor !== base.border ||
      now.backgroundColor !== base.background
    );
  });
  return {
    key,
    base: window.__focusBase.get(target) ?? null,
    framed,
    focus: {
      path: `${target.tagName.toLowerCase()}${name ? `.${name.split(/\s+/).slice(0, 2).join(".")}` : ""}${label ? `[aria-label="${label.slice(0, 40)}"]` : ""}`,
      outline: style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 1,
      shadow: style.boxShadow,
      background: style.backgroundColor,
      border: style.borderColor,
      visible: box.width > 1 && box.height > 1 && style.visibility !== "hidden",
    },
  };
}

async function walkFocus(page) {
  const findings = [];
  await page.mouse.move(1, 1);
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    // The blur starts transitions back to rest; read the resting styles, not their first frame.
    for (const animation of document.getAnimations())
      if (animation.effect?.getTiming().iterations !== Infinity) animation.finish();
    window.__focusBase = new Map();
    const focusable = document.querySelectorAll(
      'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
    );
    for (const element of focusable)
      for (const node of [element, element.parentElement, element.parentElement?.parentElement]) {
        if (!node || window.__focusBase.has(node)) continue;
        const style = getComputedStyle(node);
        window.__focusBase.set(node, {
          shadow: style.boxShadow,
          background: style.backgroundColor,
          border: style.borderColor,
        });
      }
  });
  const visited = new Set();
  for (let step = 0; step < focusSteps; step++) {
    await page.keyboard.press("Tab");
    const result = await page.evaluate(focusedStyle);
    if (!result) continue;
    if (visited.has(result.key)) break;
    visited.add(result.key);
    const { focus, base, framed } = result;
    if (!focus.visible) continue;
    const ring = focus.outline || (base !== null && focus.shadow !== base.shadow);
    const highlight =
      base !== null && (focus.background !== base.background || focus.border !== base.border);
    if (!ring && !highlight && !framed)
      findings.push({
        kind: "focus",
        target: focus.path,
        detail: "no outline, ring shadow, fill or border change while focused from the keyboard",
      });
  }
  return { findings, stops: visited.size };
}

async function ready() {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) throw new Error(serverOutput);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* Startup has not bound its port yet. */
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Preview did not start: ${serverOutput}`);
}

let server;
let serverOutput = "";
const totals = {};
try {
  await mkdir(out, { recursive: true });
  if (!values.server) {
    const vite = resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");
    server = spawn(
      process.execPath,
      [vite, "--host", "127.0.0.1", "--port", port, "--strictPort"],
      {
        cwd: app,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    for (const stream of [server.stdout, server.stderr])
      stream.on("data", (data) => {
        serverOutput = (serverOutput + data).slice(-8192);
      });
  }
  await ready();
  for (const engine of values.engines.split(",")) {
    const launcher = { chromium, webkit }[engine];
    if (!launcher) throw new Error(`Unsupported engine: ${engine}`);
    const browser = await launcher.launch({ headless: true });
    const report = [];
    try {
      for (const [width, height] of sizes) {
        const context = await browser.newContext({
          viewport: { width, height },
          reducedMotion: "reduce",
          colorScheme: "dark",
        });
        const page = await context.newPage();
        for (const mode of modes) {
          const [preview, view] = mode.split("#");
          await page.goto(`${url}/?preview=${preview}`);
          await page.waitForLoadState("networkidle").catch(() => {});
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(900);
          if (view) {
            await OPENERS[view](page);
            await page.waitForTimeout(400);
          }
          const found = await page.evaluate(probe);
          const focus = await walkFocus(page);
          const findings = [...found, ...focus.findings];
          report.push({ mode, size: `${width}x${height}`, focusStops: focus.stops, findings });
          const counts = findings.reduce((all, { kind }) => {
            all[kind] = (all[kind] ?? 0) + 1;
            return all;
          }, {});
          totals[`${engine} ${width}x${height} ${mode}`] = counts;
          console.log(
            `${engine} ${width}x${height} ${mode}: ${findings.length === 0 ? "clean" : JSON.stringify(counts)} (${focus.stops} focus stops)`,
          );
        }
        await context.close();
      }
    } finally {
      await browser.close();
    }
    await writeFile(resolve(out, `${engine}.json`), `${JSON.stringify(report, null, 2)}\n`);
  }
  const failing = Object.entries(totals).filter(([, counts]) => Object.keys(counts).length);
  if (failing.length) {
    console.error(
      `${failing.length} of ${Object.keys(totals).length} views have layout findings; see target/layout-browser/`,
    );
    process.exitCode = 1;
  } else console.log(`All ${Object.keys(totals).length} views are clean.`);
} finally {
  server?.kill();
}
