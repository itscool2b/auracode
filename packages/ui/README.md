# @auracode/ui

The auracode design system, shared by the desktop app and auracode.si. It ships as TypeScript source (no build step), with React 19 as a peer dependency.

**Graphite** (`@auracode/ui/graphite`) is the current visual language: black, a grey ladder, one volt accent and a live ordered-dither field. The spec is `docs/design/visual-language.md`. The older **Aura** (`@auracode/ui`: Orb, AuraField, GlassPanel) and **Orbit** (`@auracode/ui/orbit`) modules stay for the Design Lab and for screens not yet moved; new work uses Graphite.

```tsx
import "@auracode/ui/fonts.css"; // Geist and Geist Mono, bundled for offline use
import "@auracode/ui/graphite.css"; // tokens, the opt-in .g-root base layer and the g-* primitives
import { AgentMark, DitherField, Keycap, Wordmark } from "@auracode/ui/graphite";

// With class="g-root" on <html>:
<main>
  <Wordmark size={16} />
  <DitherField style={{ height: 640 }} interactive clearing={{ rx: 0.36, ry: 0.42, y: 0.38 }} />
  <AgentMark agent="claude" state="thinking" size={16} />
  <button type="button" className="g-button g-button-primary">
    Allow once <Keycap>1</Keycap>
  </button>
</main>;
```

- `@auracode/ui/graphite-tokens.css` declares only the `--g-*` variables on `:root`; `@auracode/ui/graphite.css` adds the base layer (opt in with `.g-root`) and the primitives. Every primitive is one class with its states inside `:where()`, so one app class loaded later always wins.
- `DitherField` renders on a 2D canvas at one canvas pixel per cell, scaled up pixelated. It draws from the shared frame clock at 30fps at most, only while on screen and while the page is visible, and holds one still frame under reduced motion (the OS setting or `setMotionPreference`). Give it a size. Server rendering emits the fallback image and an empty canvas; `renderDitherFrame()` renders the same deterministic frame in Node for that fallback.
- `AgentMark` replaces `OrbitMark` with the same props. Idle, hidden, offscreen and reduced-motion marks own no animation frame.
- `LOGO_PATH`, `LOGO_SMALL_PATH` and `logoSvg()` are the source of the logo, the app icons and
  the favicons.
- Checks: `pnpm --filter @auracode/ui test`, `pnpm --filter @auracode/ui typecheck`, `pnpm exec biome check packages/ui`.
