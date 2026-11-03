import { AGENT_LOGOS, type AgentLogo, parseLogo } from "./agentLogos";
import deepseek from "./maker-logos/deepseek.svg?raw";
import gemini from "./maker-logos/gemini.svg?raw";
import meta from "./maker-logos/meta.svg?raw";
import mistral from "./maker-logos/mistral.svg?raw";
import moonshot from "./maker-logos/moonshot.svg?raw";
import qwen from "./maker-logos/qwen.svg?raw";

/*
 * The companies that make the models agents run, and their marks (third-party/brand-marks.md
 * records each source). Anthropic, OpenAI and xAI reuse the marks already stored for Claude Code,
 * Codex and Grok Build: the Claude spark, the OpenAI Blossom and the Grok mark are those
 * companies' own. Used at the owner's direction (2026-11-03) to say which company's model is
 * working, never to imply endorsement.
 */
export type ModelMakerId =
  | "anthropic"
  | "openai"
  | "google"
  | "xai"
  | "deepseek"
  | "mistral"
  | "meta"
  | "qwen"
  | "moonshot";

export interface ModelMaker {
  readonly id: ModelMakerId;
  readonly name: string;
  readonly logo: AgentLogo;
}

const own = (id: ModelMakerId, name: string, svg: string): ModelMaker => {
  const { viewBox, shapes } = parseLogo(svg);
  return { id, name, logo: { id: "generic" as never, name, viewBox, shapes, scale: 0.92 } };
};

const reused = (id: ModelMakerId, name: string, logo: AgentLogo | undefined): ModelMaker | null =>
  logo ? { id, name, logo: { ...logo, name } } : null;

export const MODEL_MAKERS: Readonly<Partial<Record<ModelMakerId, ModelMaker>>> = Object.fromEntries(
  [
    reused("anthropic", "Anthropic", AGENT_LOGOS["claude-code"]),
    reused("openai", "OpenAI", AGENT_LOGOS.codex),
    reused("xai", "xAI", AGENT_LOGOS.grok),
    own("google", "Google", gemini),
    own("deepseek", "DeepSeek", deepseek),
    own("mistral", "Mistral AI", mistral),
    own("meta", "Meta", meta),
    own("qwen", "Qwen", qwen),
    own("moonshot", "Moonshot AI", moonshot),
  ]
    .filter((maker): maker is ModelMaker => maker !== null)
    .map((maker) => [maker.id, maker]),
);

/** Model names and families, in the order they are tried: the first that matches wins. */
const FAMILIES: readonly [RegExp, ModelMakerId][] = [
  [/claude|opus|sonnet|haiku|fable|anthropic/i, "anthropic"],
  [/gemini|gemma|google/i, "google"],
  [/grok|xai/i, "xai"],
  [/deepseek/i, "deepseek"],
  [/mistral|codestral|devstral|magistral|ministral|pixtral/i, "mistral"],
  [/llama|\bmeta\b/i, "meta"],
  [/qwen|qwq/i, "qwen"],
  [/kimi|moonshot/i, "moonshot"],
  [/gpt|chatgpt|openai|codex|\bo[1-9](?:-|\b)|davinci/i, "openai"],
];

/** The agents whose models come from one company, when the model name says nothing. */
const AGENT_MAKERS: Readonly<Record<string, ModelMakerId>> = {
  claude: "anthropic",
  "claude-code": "anthropic",
  codex: "openai",
  "grok-build": "xai",
  grok: "xai",
  antigravity: "google",
};

/**
 * The company whose model is working: from the model's name ("Opus 5.5", "gpt-5.5-codex",
 * "Gemini 3 Pro"), else from an agent that runs one company's models; null when neither says.
 */
export function modelMaker(
  model: string | null | undefined,
  agent?: string | null,
): ModelMaker | null {
  const name = model?.trim() ?? "";
  const family = name ? FAMILIES.find(([pattern]) => pattern.test(name))?.[1] : undefined;
  const id = family ?? (agent ? AGENT_MAKERS[agent] : undefined);
  return id ? (MODEL_MAKERS[id] ?? null) : null;
}
