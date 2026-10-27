/**
 * Per-agent brand: the orb's colour ramp and motion signature, plus the UI accent.
 *
 * The UI never branches on agent names (it reads capabilities), but colour is identity: the active
 * agent's palette tints the aura field, its orb, and accent-coloured controls. Agents without a
 * designed brand fall back to `generic`, a neutral aurora shown with a monogram.
 */

/** Agents with a designed brand. Anything else renders as `generic`. */
export type AgentBrandId =
  | "claude-code"
  | "codex"
  | "pi"
  | "antigravity"
  | "cursor"
  | "grok"
  | "opencode"
  | "oh-my-pi"
  | "hermes"
  | "generic";

/** How an agent's orb moves. Values are multipliers the orb states scale further. */
export interface AgentBrandMotion {
  /** Base animation speed; 1 is the reference pace. */
  readonly speed: number;
  /** How hard the noise flow warps the light lobes: 0 is glassy, 1 is churning. */
  readonly turbulence: number;
  /** Density of the ring ripples across the orb radius. */
  readonly ringFrequency: number;
  /** Direction the light drifts, in orb radii per second of phase; x points right, y points up. */
  readonly drift: readonly [number, number];
}

export interface AgentBrand {
  readonly id: AgentBrandId;
  /** Display name used for labels and the generic monogram. */
  readonly name: string;
  /** Orb colour ramp, darkest (rim, low light) to brightest (core highlights), as `#rrggbb`. */
  readonly palette: readonly [string, string, string, string];
  /** Solid UI accent: focus rings, active pills, selection. `#rrggbb`. */
  readonly accent: string;
  /** Halo colour for glows and the aura field. `#rrggbb`. */
  readonly glow: string;
  readonly motion: AgentBrandMotion;
}

/** Every designed brand, keyed by id. */
export const AGENT_BRANDS: Readonly<Record<AgentBrandId, AgentBrand>> = {
  // Terracotta spark: a warm coral core with ember edges; heat rises gently.
  "claude-code": {
    id: "claude-code",
    name: "Claude Code",
    palette: ["#2e0f08", "#9c3f27", "#d97757", "#ffd3b8"],
    accent: "#d97757",
    glow: "#f08c64",
    motion: { speed: 1, turbulence: 0.6, ringFrequency: 6, drift: [0, 0.06] },
  },
  // Monochrome liquid with a cool tint: slow, smooth, few rings.
  codex: {
    id: "codex",
    name: "Codex",
    palette: ["#0a0c10", "#333b47", "#9aa6b5", "#f2f6fa"],
    accent: "#b9c5d3",
    glow: "#a9bcd0",
    motion: { speed: 0.75, turbulence: 0.38, ringFrequency: 3.5, drift: [0, 0] },
  },
  // Precise: amber on graphite, barely turbulent, fine orbit rings.
  pi: {
    id: "pi",
    name: "Pi",
    palette: ["#121316", "#34332f", "#e39a2b", "#ffd68c"],
    accent: "#f0a63a",
    glow: "#ffb23f",
    motion: { speed: 0.7, turbulence: 0.16, ringFrequency: 11, drift: [0.025, 0] },
  },
  // Blue-violet star with a clear upward drift.
  antigravity: {
    id: "antigravity",
    name: "Antigravity",
    palette: ["#0c0a2b", "#3b37b5", "#7d6bff", "#d5ccff"],
    accent: "#8c7dff",
    glow: "#6f8bff",
    motion: { speed: 0.9, turbulence: 0.5, ringFrequency: 5, drift: [0, 0.24] },
  },
  // Dark prism: near-black with a cold spectral glint.
  cursor: {
    id: "cursor",
    name: "Cursor",
    palette: ["#08080c", "#262035", "#5f72b0", "#f0e8ff"],
    accent: "#a9b4dd",
    glow: "#8c9be0",
    motion: { speed: 0.85, turbulence: 0.42, ringFrequency: 8, drift: [-0.05, 0.03] },
  },
  // Stark black and white, energetic.
  grok: {
    id: "grok",
    name: "Grok Build",
    palette: ["#050505", "#2b2b2b", "#bfbfbf", "#ffffff"],
    accent: "#f2f2f2",
    glow: "#ffffff",
    motion: { speed: 1.1, turbulence: 0.72, ringFrequency: 12, drift: [0, 0] },
  },
  // Pixel greens: dense rings read as a fine grid at speed.
  opencode: {
    id: "opencode",
    name: "OpenCode",
    palette: ["#03130a", "#0d5a2b", "#2fd26b", "#bdffcc"],
    accent: "#3bdb75",
    glow: "#47f58a",
    motion: { speed: 0.9, turbulence: 0.45, ringFrequency: 14, drift: [0.06, 0] },
  },
  // Magenta pi.
  "oh-my-pi": {
    id: "oh-my-pi",
    name: "oh-my-pi",
    palette: ["#1d0617", "#78145f", "#e5389f", "#ffc4eb"],
    accent: "#f04db0",
    glow: "#ff5fc4",
    motion: { speed: 0.95, turbulence: 0.5, ringFrequency: 9, drift: [0.03, 0.02] },
  },
  // Gold and fast, with a winged sideways drift.
  hermes: {
    id: "hermes",
    name: "Hermes",
    palette: ["#1b1304", "#7a5512", "#e9b83b", "#fff1c2"],
    accent: "#f2c14e",
    glow: "#ffd36b",
    motion: { speed: 1.6, turbulence: 0.55, ringFrequency: 7, drift: [0.2, 0.04] },
  },
  // Neutral aurora for agents without a brand: teal into lavender, never loud.
  generic: {
    id: "generic",
    name: "Agent",
    palette: ["#091017", "#25485a", "#7cb6b0", "#e4e1ff"],
    accent: "#9db7c9",
    glow: "#8fc5c0",
    motion: { speed: 0.8, turbulence: 0.42, ringFrequency: 5, drift: [0.04, 0.06] },
  },
};

/** Ids of every designed brand, in display order. */
export const AGENT_BRAND_IDS: readonly AgentBrandId[] = [
  "claude-code",
  "codex",
  "pi",
  "antigravity",
  "cursor",
  "grok",
  "opencode",
  "oh-my-pi",
  "hermes",
  "generic",
];

/*
 * A Map, not an object lookup: ids come from agent catalogs and registries, and a plain object would
 * resolve "constructor" or "__proto__" to Object.prototype members.
 */
const BRANDS_BY_ID: ReadonlyMap<string, AgentBrand> = new Map(
  AGENT_BRAND_IDS.map((id) => [id, AGENT_BRANDS[id]] as const),
);

/** Other names the same agents go by: binary names, registry ids, vendor-prefixed ids. */
const ALIASES: ReadonlyMap<string, AgentBrandId> = new Map<string, AgentBrandId>([
  ["claude", "claude-code"],
  ["claude-acp", "claude-code"],
  ["claudecode", "claude-code"],
  ["codex-cli", "codex"],
  ["codex-acp", "codex"],
  ["openai-codex", "codex"],
  ["pi-coding-agent", "pi"],
  ["agy", "antigravity"],
  ["antigravity-acp", "antigravity"],
  ["google-antigravity", "antigravity"],
  ["cursor-agent", "cursor"],
  ["cursor-cli", "cursor"],
  ["grok-build", "grok"],
  ["grok-cli", "grok"],
  ["open-code", "opencode"],
  ["opencode-v1", "opencode"],
  ["opencode-v2", "opencode"],
  ["omp", "oh-my-pi"],
  ["ohmypi", "oh-my-pi"],
  ["hermes-acp", "hermes"],
  ["hermes-agent", "hermes"],
]);

function normalizeId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/[\s_.]+/g, "-");
}

/**
 * Looks up an agent's brand by id, tolerating case, separators, and known aliases ("Claude Code",
 * "claude_code", "agy"). Unknown ids get the generic brand, so new agents render immediately.
 */
export function getBrand(id: string): AgentBrand {
  if (typeof id !== "string") return AGENT_BRANDS.generic;
  const key = normalizeId(id);
  const direct = BRANDS_BY_ID.get(key);
  if (direct) return direct;
  const alias = ALIASES.get(key);
  return alias ? AGENT_BRANDS[alias] : AGENT_BRANDS.generic;
}

/**
 * Whether two brands look and move the same. Components compare by content, not identity, so a
 * brand object rebuilt on every render does not restart fades or glides.
 */
export function brandsEqual(a: AgentBrand, b: AgentBrand): boolean {
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.accent === b.accent &&
    a.glow === b.glow &&
    a.palette.every((color, i) => color === b.palette[i]) &&
    a.motion.speed === b.motion.speed &&
    a.motion.turbulence === b.motion.turbulence &&
    a.motion.ringFrequency === b.motion.ringFrequency &&
    a.motion.drift[0] === b.motion.drift[0] &&
    a.motion.drift[1] === b.motion.drift[1]
  );
}

/*
 * The tokens tokens.css derives from the accent, exactly as declared there (tokens.test.ts fails if
 * they drift). A custom property resolves var() on the element that declares it and descendants
 * inherit the resolved value, so the :root declarations alone keep the default accent under every
 * override; they have to be declared again wherever the accent is. They stay var() rather than the
 * brand's hex so they track the accent on that element, including while it transitions.
 */
const ACCENT_DERIVED_TOKENS = {
  "--aura-accent-soft": "color-mix(in oklab, var(--aura-accent) 18%, transparent)",
  "--aura-focus-ring": "color-mix(in oklab, var(--aura-accent) 72%, white)",
} as const;

type BrandCssVariable =
  | "--aura-accent"
  | "--aura-accent-2"
  | "--aura-glow"
  | keyof typeof ACCENT_DERIVED_TOKENS;

/**
 * The CSS custom properties that make accent-coloured UI follow an agent. Spread into a style
 * object on whatever element should take the agent's colour (the app root for the active agent).
 * `--aura-accent-2` is the palette's deep companion tone, for gradients that end in the accent.
 * Set the accent through this rather than by hand: it also re-declares the tokens derived from the
 * accent (focus ring, soft accent), which would otherwise keep the default colour.
 */
export function brandCssVariables(brand: AgentBrand): Readonly<Record<BrandCssVariable, string>> {
  return {
    "--aura-accent": brand.accent,
    "--aura-accent-2": brand.palette[1],
    "--aura-glow": brand.glow,
    ...ACCENT_DERIVED_TOKENS,
  };
}

const MONOGRAM_FALLBACK = "?";
/** Anything that is not a letter, digit, or combining mark separates words. */
const WORD_SEPARATOR = /[^\p{L}\p{N}\p{M}]+/u;
/** "OpenCode" is two words. */
const CAMEL_HUMP = /(\p{Ll})(\p{Lu})/gu;
/** First letter or digit in a word, with any marks that follow it. */
const INITIAL = /[\p{L}\p{N}]\p{M}*/u;

function initialOf(word: string): string | null {
  const match = INITIAL.exec(word);
  if (!match) return null;
  let initial = match[0].normalize("NFC");
  // Marks that do not compose into one character (a keycap's enclosing mark) are dropped.
  const base = String.fromCodePoint(initial.codePointAt(0) ?? 0);
  if (initial.length !== base.length) initial = base;
  const upper = initial.toUpperCase();
  // Some letters grow when uppercased (ß becomes SS); keep them whole rather than spend both slots.
  return Array.from(upper).length === 1 ? upper : initial;
}

/**
 * One or two capital letters standing in for an agent without a logo: the initials of the first
 * two words ("Gemini CLI" is "GC", "OpenCode" is "OC"), or the first letter of a single word.
 * Emoji and punctuation are ignored; a name with no letters or digits at all yields "?".
 */
export function monogram(name: string): string {
  if (typeof name !== "string") return MONOGRAM_FALLBACK;
  const words = name.normalize("NFC").replace(CAMEL_HUMP, "$1 $2").split(WORD_SEPARATOR);
  let result = "";
  let count = 0;
  for (const word of words) {
    if (word.length === 0) continue;
    const initial = initialOf(word);
    if (initial === null) continue;
    result += initial;
    count += 1;
    if (count === 2) break;
  }
  return count === 0 ? MONOGRAM_FALLBACK : result;
}
