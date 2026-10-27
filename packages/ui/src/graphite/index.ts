/**
 * Graphite: auracode's visual language (docs/design/visual-language.md). Black, a grey ladder, one
 * volt accent and a live ordered-dither field. Import the stylesheet once at the app root; it
 * brings Geist and Geist Mono with it:
 *   import "@auracode/ui/graphite.css"; // or graphite-tokens.css for the variables alone
 */

export { createFrameClock, type FrameClock, type FrameHost, frameClock } from "../frameClock";
export { AgentMark, type AgentMarkProps, agentCode } from "./AgentMark";
export { CopyButton, type CopyButtonProps } from "./CopyButton";
export {
  type DitherClearingArea,
  DitherField,
  type DitherFieldProps,
  type DitherTarget,
} from "./DitherField";
export {
  BAYER_8,
  bayerThreshold,
  DEFAULT_ACCENT,
  DEFAULT_SEED,
  type DissolveOrder,
  type DitherFrameOptions,
  ditherLevel,
  renderDitherFrame,
  VOLT,
} from "./dither";
export { Keycap, type KeycapProps } from "./Keycap";
export {
  type LoaderTempo,
  type LoaderTone,
  PixelLoader,
  type PixelLoaderProps,
} from "./PixelLoader";
export { PixelMark, type PixelMarkProps, Wordmark, type WordmarkProps } from "./PixelMark";
export {
  gridPath,
  gridRects,
  LOADER_ORDER,
  LOADER_STEP_MS,
  loaderFrame,
  PIXEL_MARK_GRID,
  type PixelMarkSvgOptions,
  type PixelRect,
  pixelMarkSvg,
} from "./pixels";
export { StatusDot, type StatusDotProps, type StatusTone } from "./StatusDot";
export {
  contrastRatio,
  DITHER_PALETTES,
  type DitherPaletteName,
  GRAPHITE_COLORS,
  GRAPHITE_DURATIONS,
  GRAPHITE_EASINGS,
  GRAPHITE_STAGGERS,
  type GraphiteColor,
  relativeLuminance,
} from "./tokens";
