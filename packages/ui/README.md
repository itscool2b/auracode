# @auracode/ui

The auracode design system, shared by the desktop app and auracode.si. It ships as TypeScript source (no build step), with React 19 as a peer dependency.

**Graphite** (`@auracode/ui/graphite`) is the current visual language: black, a grey ladder, one volt accent and Shallows, lit water with seals and turtles swimming through it. The spec is `docs/design/visual-language.md`. The older **Aura** (`@auracode/ui`: Orb, AuraField, GlassPanel) and **Orbit** (`@auracode/ui/orbit`) modules stay for the Design Lab and for screens not yet moved; new work uses Graphite.

```tsx
import "@auracode/ui/fonts.css"; // Geist and Geist Mono, bundled for offline use
import "@auracode/ui/graphite.css"; // tokens, the opt-in .g-root base layer and the g-* primitives
import { AgentMark, Keycap, Wordmark } from "@auracode/ui/graphite";

// With class="g-root" on <html>:
<main>
  <Wordmark size={16} />
  <AgentMark agent="claude" state="thinking" size={16} />
  <button type="button" className="g-button g-button-primary">
    Allow once <Keycap>1</Keycap>
  </button>
</main>;
```

- `@auracode/ui/graphite-tokens.css` declares only the `--g-*` variables on `:root`; `@auracode/ui/graphite.css` adds the base layer (opt in with `.g-root`) and the primitives. Every primitive is one class with its states inside `:where()`, so one app class loaded later always wins.
- `AgentMark` replaces `OrbitMark` with the same props. Idle, hidden, offscreen and reduced-motion marks own no animation frame.
- `LOGO_PATH`, `LOGO_SMALL_PATH` and `logoSvg()` are the source of the logo, the app icons and
  the favicons.

### Shallows (visual language 4.16)

Shallows replaced the dither field as the brand surface on 2026-10-28 (the dither engine was
deleted once nothing used it): lit water seen from below, with seals and turtles passing as dark
silhouettes. Three primitives, all server-renderable:

```tsx
import { Creature, Shallows, type SwimmerSpec, Swimmers } from "@auracode/ui/graphite";

// Module-level, so the motion never restarts on a parent re-render.
const SWIMMERS: readonly SwimmerSpec[] = [
  { kind: "turtle", x: 0.16, y: 0.32, size: "clamp(104px, 17vw, 250px)", tilt: -10, phase: 3 },
  { kind: "seal", x: 0.8, y: 0.2, size: "clamp(150px, 23vw, 330px)", heading: "left", phase: 9 },
  { kind: "turtle", x: 0.7, y: 0.5, size: 92, depth: 0.7, speed: 6, className: "far" },
];

<Shallows as="section" shimmer depth="760px" className="hero">
  <Swimmers swimmers={SWIMMERS} />
  <h1>Content sits above the swimmers.</h1>
</Shallows>;

<Creature kind="seal" size={48} label="A seal" />; // a static silhouette in currentColor
```

- `Shallows` (`as`, `shimmer`, `depth`, plus any HTML attributes): the rounded panel
  (`--g-shallows-radius` 28px, `--g-shallows-radius-compact` 20px for phones), one vertical
  falloff from `--g-water-surface` #1e1e1e to `--g-water-deep` #050505 over `depth` (default the
  panel's height), a soft top light, a faint rim. `shimmer` adds one slow caustic layer moved by
  transform only. Its direct children sit above the light and the swimmers (`z-index: 1`, inside
  `:where()` so any class overrides it).
- `Swimmers` (`swimmers`, `still`, `giveWay`, `className`): absolutely fills its parent and takes
  no pointer events. Each `SwimmerSpec` anchors a creature by fractions of the layer (`x`, `y`) with
  a CSS width (`size`), `depth` 0 near to 1 far (lighter and softened once at raster time),
  `heading`, `speed` px/s, `phase` s and `tilt` degrees. Creatures cruise at an eased speed, sway,
  pitch a few degrees with their path and wrap fully off one side. Transform only, from the shared
  frame clock; paused off screen and in hidden tabs; held where they are under reduced motion or
  `still`. The server frame is the first live frame. With `giveWay` (default) they ease up to 22px
  out of the pointer's way through a smooth field read from the parent: no flicker, no snap.
- `Creature` (`kind`, `size`, `small`, `facing`, `label`): the silhouette alone. At 64px
  (`CREATURE_SMALL_MAX`) and below it draws the small variant, whose gaps stay open. The raw paths
  are `SEAL_PATH`, `SEAL_SMALL_PATH`, `TURTLE_PATH` and `TURTLE_SMALL_PATH` with `SEAL_VIEWBOX`
  320 by 130 and `TURTLE_VIEWBOX` 240 by 220: one even-odd path each, absolute M, C and Z only.
  They are generated from `creatureGeometry.ts`; after editing a drawing run
  `node packages/ui/scripts/creature-paths.ts`.
- `swimPose`, `swumDistance`, `giveWay`, `ease` and `GAITS` are the motion as pure functions.
- Checks: `pnpm --filter @auracode/ui test`, `pnpm --filter @auracode/ui typecheck`, `pnpm exec biome check packages/ui`.
