/**
 * Graphite: auracode's visual language (docs/design/visual-language.md). Black, a grey ladder, one
 * volt accent, and Shallows: lit water with seals and turtles swimming through it. Import the
 * stylesheet once at the app root; it brings Geist and Geist Mono with it:
 *   import "@auracode/ui/graphite.css"; // or graphite-tokens.css for the variables alone
 */

export { createFrameClock, type FrameClock, type FrameHost, frameClock } from "../frameClock";
export { AgentLogo, type AgentLogoProps } from "./AgentLogo";
export { AgentMark, type AgentMarkProps, agentCode, logoSide } from "./AgentMark";
export { AGENT_LOGOS, type AgentLogo as AgentLogoData, agentLogo } from "./agentLogos";
export { CopyButton, type CopyButtonProps } from "./CopyButton";
export { Creature, type CreatureKind, type CreatureProps, creatureHeight } from "./Creature";
export { type Cadence, type CadenceHost, createCadence, IDLE_WAIT_MS } from "./cadence";
export {
  CREATURE_SMALL_MAX,
  SEAL_PATH,
  SEAL_SMALL_PATH,
  SEAL_VIEWBOX,
  TURTLE_PATH,
  TURTLE_SMALL_PATH,
  TURTLE_VIEWBOX,
} from "./creaturePaths";
export { Keycap, type KeycapProps } from "./Keycap";
export { Logo, type LogoProps, Wordmark, type WordmarkProps } from "./Logo";
export {
  LOGO_PATH,
  LOGO_SMALL_MAX,
  LOGO_SMALL_PATH,
  LOGO_VIEWBOX,
  type LogoSvgOptions,
  logoSvg,
} from "./logoPaths";
export {
  type LoaderTempo,
  type LoaderTone,
  PixelLoader,
  type PixelLoaderProps,
} from "./PixelLoader";
export {
  gridPath,
  gridRects,
  LOADER_ORDER,
  LOADER_STEP_MS,
  loaderFrame,
  type PixelRect,
} from "./pixels";
export { Shallows, type ShallowsProps } from "./Shallows";
export { StatusDot, type StatusDotProps, type StatusTone } from "./StatusDot";
export { Swimmers, type SwimmersProps } from "./Swimmers";
export {
  ease,
  GAITS,
  giveWay,
  type SwimmerSpec,
  type SwimPose,
  swimPose,
  swumDistance,
} from "./swim";
export {
  contrastRatio,
  GRAPHITE_COLORS,
  GRAPHITE_DURATIONS,
  GRAPHITE_EASINGS,
  GRAPHITE_STAGGERS,
  type GraphiteColor,
  relativeLuminance,
} from "./tokens";
