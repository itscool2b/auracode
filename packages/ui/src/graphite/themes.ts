/**
 * Desktop themes: one per supported agent, beside Aura's own neutral one (owner, 3 November 2026).
 * A theme is a palette layer over the Graphite tokens, independent of the appearance: each has a
 * dark and a light set, so System, Light and Dark keep working. It changes colour only, never type,
 * spacing or motion, and it adds no glow: the glass layers stay translucent fills cut from the
 * theme's own surfaces.
 *
 * This file is the source of truth. `themes.css` is generated from it (`node
 * packages/ui/scripts/write-themes.mts`), and themes.test.ts fails if the two drift or if any
 * theme misses the contrast the base palette keeps.
 */

/** Every theme, Aura first. Aura is the base palette itself and sets no overrides. */
export const THEME_IDS = [
  "aura",
  "claude",
  "codex",
  "grok",
  "pi",
  "antigravity",
  "cursor",
  "opencode",
  "oh_my_pi",
  "hermes",
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** One appearance of a theme: the few colours everything else derives from. */
export interface ThemeSeed {
  /** The page, then surfaces 1 to 4 (dark: each lighter than the last). */
  readonly bg: string;
  readonly surfaces: readonly [string, string, string, string];
  /** Faint, ordinary and strong lines; the strong one also outlines controls. */
  readonly lines: readonly [string, string, string];
  /** Text from primary to disabled. */
  readonly fg: readonly [string, string, string, string];
  /** Filled controls: rest, hover, pressed, and the label on all three. */
  readonly primary: readonly [string, string, string];
  readonly onPrimary: string;
  /** The theme's mark: focus rings and the volt accent. */
  readonly accent: string;
  /** Selected text and rows. */
  readonly selection: string;
  /** The opaque window under the glass. */
  readonly window: string;
  /** RGB channels the pane, bar and popover glass are cut from. */
  readonly glass: {
    readonly layer: readonly [number, number, number];
    readonly bar: readonly [number, number, number];
    readonly pop: readonly [number, number, number];
  };
  /** Syntax colours that carry the theme in code. */
  readonly code: { readonly keyword: string; readonly string: string; readonly number: string };
}

export interface ThemeDefinition {
  readonly id: Exclude<ThemeId, "aura">;
  /** The name Settings shows. */
  readonly name: string;
  /** The agent whose mark Settings shows beside it (`AgentMark`'s id). */
  readonly agent: string;
  readonly dark: ThemeSeed;
  readonly light: ThemeSeed;
}

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: "claude",
    name: "Claude Code",
    agent: "claude",
    // Warm graphite and ivory paper, terracotta for what you act on.
    dark: {
      bg: "#191817",
      surfaces: ["#1e1d1b", "#252421", "#2b2a26", "#2f2d2a"],
      lines: ["#2a2825", "#35332f", "#7a766c"],
      fg: ["#f5f1e8", "#c9c3b6", "#aba598", "#77736a"],
      primary: ["#d97757", "#e08b6e", "#cc6a4a"],
      onPrimary: "#1a1918",
      accent: "#e3896b",
      selection: "#3d2c24",
      window: "#121110",
      glass: { layer: [33, 32, 29], bar: [28, 27, 25], pop: [42, 40, 37] },
      code: { keyword: "#ee9a80", string: "#d6bd85", number: "#c3aef0" },
    },
    light: {
      bg: "#f8f6f1",
      surfaces: ["#ffffff", "#f2efe8", "#ede9e0", "#e5e0d5"],
      lines: ["#ebe7de", "#e2ddd2", "#8a8579"],
      fg: ["#1f1d1a", "#57524a", "#625d53", "#8a8579"],
      primary: ["#b4532f", "#a3482a", "#8f3e23"],
      onPrimary: "#ffffff",
      accent: "#a1461f",
      selection: "#f3dccf",
      window: "#eeebe4",
      glass: { layer: [255, 255, 255], bar: [255, 254, 251], pop: [255, 255, 255] },
      code: { keyword: "#a33a1e", string: "#7a5b12", number: "#6b3fa0" },
    },
  },
  {
    id: "codex",
    name: "Codex",
    agent: "codex",
    // Cool slate with an ice-blue mark.
    dark: {
      bg: "#0f1115",
      surfaces: ["#13161b", "#1a1e24", "#20252c", "#282e36"],
      lines: ["#222830", "#2c333c", "#6c7684"],
      fg: ["#f2f6fa", "#b4bdc8", "#9ea8b5", "#67717e"],
      primary: ["#e9eef4", "#d6dee8", "#c3cdd9"],
      onPrimary: "#0f1115",
      accent: "#8fb3ff",
      selection: "#1f2b3d",
      window: "#0b0d10",
      glass: { layer: [22, 26, 31], bar: [18, 21, 26], pop: [30, 35, 42] },
      code: { keyword: "#ff9f9f", string: "#93c5fd", number: "#c4b5fd" },
    },
    light: {
      bg: "#f7f9fb",
      surfaces: ["#ffffff", "#f1f4f7", "#ebeff3", "#e2e7ed"],
      lines: ["#e8edf2", "#dfe5eb", "#848d99"],
      fg: ["#0f1720", "#4b5563", "#56606d", "#848d99"],
      primary: ["#111827", "#1f2937", "#030712"],
      onPrimary: "#f9fafb",
      accent: "#2557d6",
      selection: "#dbe6fb",
      window: "#edf0f4",
      glass: { layer: [255, 255, 255], bar: [255, 255, 255], pop: [255, 255, 255] },
      code: { keyword: "#b42318", string: "#0550ae", number: "#6b21a8" },
    },
  },
  {
    id: "grok",
    name: "Grok Build",
    agent: "grok",
    // The Grok Bot app's own colours in dark, read from the live app on its page (owner, 10
    // November 2026; docs/design/reference-audit.md): a graphite window, a lighter chat over it,
    // off-white text and paper for what you act on. Light stays black on white.
    dark: {
      bg: "#1f1f1e",
      surfaces: ["#202020", "#242424", "#282828", "#2c2c2c"],
      lines: ["#2e2e2e", "#383838", "#7a7a7a"],
      fg: ["#f2f2f2", "#bdbdbd", "#b0b0b0", "#757575"],
      primary: ["#ecece8", "#f5f5f2", "#d9d9d4"],
      onPrimary: "#141414",
      accent: "#ecece8",
      selection: "#3a3a3a",
      window: "#151514",
      glass: { layer: [38, 38, 38], bar: [30, 30, 30], pop: [46, 46, 46] },
      code: { keyword: "#ff9b9b", string: "#9cc8ff", number: "#d0b3ff" },
    },
    light: {
      bg: "#ffffff",
      surfaces: ["#ffffff", "#f5f5f5", "#efefef", "#e6e6e6"],
      lines: ["#ededed", "#e3e3e3", "#7a7a7a"],
      fg: ["#000000", "#4d4d4d", "#5a5a5a", "#808080"],
      primary: ["#000000", "#1f1f1f", "#333333"],
      onPrimary: "#ffffff",
      accent: "#000000",
      selection: "#e6e6e6",
      window: "#f2f2f2",
      glass: { layer: [255, 255, 255], bar: [255, 255, 255], pop: [255, 255, 255] },
      code: { keyword: "#b42318", string: "#0550ae", number: "#6b21a8" },
    },
  },
  {
    id: "pi",
    name: "Pi",
    agent: "pi",
    // Charcoal and amber.
    dark: {
      bg: "#121316",
      surfaces: ["#17181c", "#1e1f24", "#24262b", "#2a2c31"],
      lines: ["#26272c", "#303237", "#73757d"],
      fg: ["#f6f2ea", "#c4beb3", "#aaa59b", "#6f7178"],
      primary: ["#f0a63a", "#f5b65c", "#dc9426"],
      onPrimary: "#121316",
      accent: "#f5b44f",
      selection: "#3b2f1b",
      window: "#0d0e10",
      glass: { layer: [26, 27, 31], bar: [22, 23, 27], pop: [36, 37, 42] },
      code: { keyword: "#ffb86b", string: "#9ccfd8", number: "#c4a7ff" },
    },
    light: {
      bg: "#fbf9f5",
      surfaces: ["#ffffff", "#f5f2ec", "#f0ece4", "#e8e3d9"],
      lines: ["#ece8df", "#e3ded3", "#888276"],
      fg: ["#1c1b18", "#57524a", "#625c52", "#8d877b"],
      primary: ["#8a4f00", "#7a4500", "#663a00"],
      onPrimary: "#ffffff",
      accent: "#8a4f00",
      selection: "#f6e3c2",
      window: "#efece5",
      glass: { layer: [255, 255, 255], bar: [255, 255, 255], pop: [255, 255, 255] },
      code: { keyword: "#9a3a00", string: "#0b5c73", number: "#6b21a8" },
    },
  },
  {
    id: "antigravity",
    name: "Antigravity",
    agent: "antigravity",
    // Indigo night with a violet mark.
    dark: {
      bg: "#0e0d18",
      surfaces: ["#13121f", "#1a1828", "#201e30", "#29263b"],
      lines: ["#232136", "#2e2b44", "#736e94"],
      fg: ["#f3f1ff", "#c3bee0", "#aaa4cc", "#6f6a8f"],
      primary: ["#b3a8ff", "#c3baff", "#9f92fb"],
      onPrimary: "#120f2a",
      accent: "#ab9dff",
      selection: "#2a2552",
      window: "#0a0912",
      glass: { layer: [24, 22, 38], bar: [19, 18, 31], pop: [34, 31, 52] },
      code: { keyword: "#ff9fc6", string: "#8fd1ff", number: "#c9b6ff" },
    },
    light: {
      bg: "#f8f7ff",
      surfaces: ["#ffffff", "#f2f0fd", "#edebfb", "#e4e1f6"],
      lines: ["#ebe8fa", "#e1ddf4", "#857fa3"],
      fg: ["#16132e", "#514c70", "#5c5780", "#8a85a6"],
      primary: ["#4a3ad6", "#3f30c2", "#3326a8"],
      onPrimary: "#ffffff",
      accent: "#4a3ad6",
      selection: "#e0dcff",
      window: "#efedfa",
      glass: { layer: [255, 255, 255], bar: [255, 255, 255], pop: [255, 255, 255] },
      code: { keyword: "#a8155d", string: "#0550ae", number: "#5b21b6" },
    },
  },
  {
    id: "cursor",
    name: "Cursor",
    agent: "cursor",
    // Ink with a periwinkle mark.
    dark: {
      bg: "#0c0c11",
      surfaces: ["#111117", "#17171f", "#1d1d26", "#25252f"],
      lines: ["#20202a", "#2a2a36", "#707086"],
      fg: ["#f1f0f7", "#bfbdd0", "#a6a4bb", "#6c6c80"],
      primary: ["#c6cdf0", "#d5daf4", "#b3bbe6"],
      onPrimary: "#0c0c11",
      accent: "#a9b4e6",
      selection: "#23273c",
      window: "#08080c",
      glass: { layer: [21, 21, 28], bar: [17, 17, 23], pop: [30, 30, 39] },
      code: { keyword: "#ff9ccf", string: "#a5d6ff", number: "#d2b8ff" },
    },
    light: {
      bg: "#f8f8fb",
      surfaces: ["#ffffff", "#f2f2f7", "#ededf3", "#e4e4ec"],
      lines: ["#eaeaf1", "#e1e1ea", "#838396"],
      fg: ["#121218", "#50505f", "#5b5b6b", "#888899"],
      primary: ["#2d3561", "#252c52", "#1c2243"],
      onPrimary: "#ffffff",
      accent: "#3b4a8f",
      selection: "#dfe3f6",
      window: "#eeeef4",
      glass: { layer: [255, 255, 255], bar: [255, 255, 255], pop: [255, 255, 255] },
      code: { keyword: "#a8155d", string: "#0550ae", number: "#5b21b6" },
    },
  },
  {
    id: "opencode",
    name: "OpenCode",
    agent: "opencode",
    // A terminal at night: deep green-black, phosphor green.
    dark: {
      bg: "#07100b",
      surfaces: ["#0b1510", "#101c15", "#15231a", "#1c2c22"],
      lines: ["#16251c", "#1f3127", "#62826d"],
      fg: ["#ecfff2", "#b2cdbb", "#98b5a2", "#5f7d6a"],
      primary: ["#3bdb75", "#5ee28f", "#2cc463"],
      onPrimary: "#04120a",
      accent: "#4fe085",
      selection: "#12361f",
      window: "#050b08",
      glass: { layer: [14, 26, 19], bar: [11, 21, 15], pop: [22, 36, 28] },
      code: { keyword: "#ffb86b", string: "#8ddcff", number: "#d2b4ff" },
    },
    light: {
      bg: "#f6fbf8",
      surfaces: ["#ffffff", "#eff7f2", "#e9f3ed", "#dfece4"],
      lines: ["#e6f0ea", "#dce8e1", "#7a8f83"],
      fg: ["#0c1a12", "#475a4f", "#506659", "#7f9488"],
      primary: ["#0d6b35", "#0b5c2e", "#094c26"],
      onPrimary: "#ffffff",
      accent: "#0d6b35",
      selection: "#d3efdc",
      window: "#ecf4ef",
      glass: { layer: [255, 255, 255], bar: [255, 255, 255], pop: [255, 255, 255] },
      code: { keyword: "#9a3a00", string: "#0550ae", number: "#6b21a8" },
    },
  },
  {
    id: "oh_my_pi",
    name: "oh-my-pi",
    agent: "oh-my-pi",
    // Plum dark and a magenta mark.
    dark: {
      bg: "#130810",
      surfaces: ["#190b15", "#21101c", "#281522", "#321b2b"],
      lines: ["#2a1424", "#351b2e", "#86667e"],
      fg: ["#fff0f8", "#d8b7ca", "#c09fb3", "#82627a"],
      primary: ["#ff6cc4", "#ff86cf", "#f052b3"],
      onPrimary: "#1a0613",
      accent: "#ff7ccb",
      selection: "#42153a",
      window: "#0d050b",
      glass: { layer: [30, 14, 25], bar: [25, 11, 21], pop: [42, 20, 35] },
      code: { keyword: "#ffb27a", string: "#8fd8ff", number: "#d9b8ff" },
    },
    light: {
      bg: "#fff7fb",
      surfaces: ["#ffffff", "#fcf0f6", "#f9eaf2", "#f2dfea"],
      lines: ["#f7e8f0", "#efdde7", "#957a89"],
      fg: ["#24101c", "#5e4554", "#694f5e", "#9a7f8e"],
      primary: ["#a3146f", "#8f115f", "#7a0e51"],
      onPrimary: "#ffffff",
      accent: "#a3146f",
      selection: "#fbd9ec",
      window: "#f8eef3",
      glass: { layer: [255, 255, 255], bar: [255, 255, 255], pop: [255, 255, 255] },
      code: { keyword: "#9a3a00", string: "#0550ae", number: "#5b21b6" },
    },
  },
  {
    id: "hermes",
    name: "Hermes",
    agent: "hermes",
    // Warm black and gold.
    dark: {
      bg: "#13100a",
      surfaces: ["#18140d", "#1f1a11", "#262016", "#2f281d"],
      lines: ["#282118", "#332b20", "#7e735d"],
      fg: ["#fbf5e6", "#d2c6a9", "#b8ac90", "#7a6f5a"],
      primary: ["#f2c14e", "#f5cd6f", "#e3b03a"],
      onPrimary: "#1b1405",
      accent: "#f2c14e",
      selection: "#3b2e10",
      window: "#0e0b07",
      glass: { layer: [29, 24, 16], bar: [24, 20, 13], pop: [40, 33, 23] },
      code: { keyword: "#ff9f80", string: "#9dd7c4", number: "#c9b3ff" },
    },
    light: {
      bg: "#fdfaf2",
      surfaces: ["#ffffff", "#f8f3e7", "#f4eedf", "#ece4d0"],
      lines: ["#f2ecdd", "#e9e1ce", "#8a8065"],
      fg: ["#1f1a0e", "#5b5240", "#655b46", "#8f8569"],
      primary: ["#7a5512", "#6a490f", "#573c0c"],
      onPrimary: "#ffffff",
      accent: "#7a5512",
      selection: "#f6e7bf",
      window: "#f3eee2",
      glass: { layer: [255, 255, 255], bar: [255, 255, 255], pop: [255, 255, 255] },
      code: { keyword: "#9a3a00", string: "#0b5c73", number: "#6b21a8" },
    },
  },
];

/** The two sRGB colours' midpoint, as `#rrggbb`: code text sits between fg-1 and fg-2. */
function mid(a: string, b: string): string {
  const parts = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  const [x, y] = [parts(a), parts(b)];
  return `#${x
    .map((value, index) =>
      Math.round((value + (y[index] ?? value)) / 2)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function rgba([r, g, b]: readonly [number, number, number], alpha: number): string {
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

function channels(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Every `--g-*` value one appearance of a theme sets, without the `--g-` prefix, in the order
 * themes.css writes them. Status colours, the terminal palette, the neutral glass overlays,
 * shadows and every non-colour token stay Graphite's.
 */
export function themeTokens(
  seed: ThemeSeed,
  appearance: "dark" | "light",
): Readonly<Record<string, string>> {
  const dark = appearance === "dark";
  const [s1, s2, s3, s4] = seed.surfaces;
  const [faint, line, strong] = seed.lines;
  const [fg1, fg2, fg3, fg4] = seed.fg;
  const [primary, hover, active] = seed.primary;
  const codeBg = dark ? s1 : s2;
  const codeFg = mid(fg1, fg2);
  return {
    // Graphite sets the logo plate once, in dark; light keeps it.
    ...(dark ? { "brand-plate": s3 } : {}),
    bg: seed.bg,
    "surface-1": s1,
    "surface-2": s2,
    "surface-3": s3,
    "surface-4": s4,
    "line-faint": faint,
    line,
    "line-strong": strong,
    "fg-1": fg1,
    "fg-2": fg2,
    "fg-3": fg3,
    "fg-4": fg4,
    "on-light": seed.onPrimary,
    primary,
    "primary-hover": hover,
    "primary-active": active,
    volt: seed.accent,
    "volt-tint": rgba(channels(seed.accent), dark ? 0.12 : 0.08),
    focus: seed.accent,
    selection: seed.selection,
    hover: s3,
    selected: s4,
    outline: strong,
    overlay: dark ? s2 : s1,
    "diff-hunk": dark ? seed.bg : s2,
    "code-bg": codeBg,
    "code-fg": codeFg,
    "code-bright": fg1,
    "code-dim": fg3,
    "code-keyword": seed.code.keyword,
    "code-string": seed.code.string,
    "code-number": seed.code.number,
    "code-function": fg1,
    "terminal-bg": codeBg,
    "terminal-fg": codeFg,
    "terminal-cursor": fg1,
    "terminal-cursor-text": codeBg,
    "terminal-selection": seed.selection,
    window: seed.window,
    "window-tint": rgba(channels(seed.bg), dark ? 0.45 : 0.5),
    "glass-layer": rgba(seed.glass.layer, dark ? 0.72 : 0.76),
    "glass-bar": rgba(seed.glass.bar, dark ? 0.66 : 0.68),
    "glass-pop": rgba(seed.glass.pop, dark ? 0.88 : 0.9),
  };
}

/** themes.css, as `node packages/ui/scripts/write-themes.mts` writes it. */
export function themesCss(): string {
  const blocks = THEMES.flatMap((theme) =>
    (["dark", "light"] as const).map((appearance) => {
      const tokens = themeTokens(theme[appearance], appearance);
      const lines = Object.entries(tokens).map(([name, value]) => `  --g-${name}: ${value};`);
      return `/* ${theme.name}, ${appearance} */\n:root[data-palette="${theme.id}"][data-theme="${appearance}"] {\n${lines.join("\n")}\n}\n`;
    }),
  );
  return [
    "/*",
    " * Generated from themes.ts by `node packages/ui/scripts/write-themes.mts`. Do not edit: change",
    " * themes.ts and write it again (themes.test.ts fails when the two drift).",
    " *",
    " * A theme is a palette over the Graphite tokens for one appearance. The selectors outrank",
    " * tokens.css's light block, so the order of the two files does not matter.",
    " */",
    "",
    ...blocks,
    "/* Reduce transparency: a theme's layers turn solid too, as Graphite's do (ui-tokens.css). */",
    "@media (prefers-reduced-transparency: reduce) {",
    "  :root[data-palette][data-theme] {",
    "    --g-glass-layer: var(--g-surface-1);",
    "    --g-glass-bar: var(--g-surface-1);",
    "    --g-glass-pop: var(--g-overlay);",
    "  }",
    "}",
    "",
  ].join("\n");
}
