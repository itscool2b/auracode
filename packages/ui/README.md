# @auracode/ui

The Aura design system shared by the auracode desktop app and auracode.si: tokens, bundled fonts, glass surfaces, motion presets, the live agent `Orb`, and the `AuraField` light. It ships as TypeScript source (no build step), with React 19 as a peer dependency.

```tsx
import "@auracode/ui/fonts.css"; // Geist, Geist Mono, Instrument Serif, bundled for offline use
import "@auracode/ui/tokens.css"; // --aura-* custom properties, dark-first, reduced-motion aware
import { AuraField, brandCssVariables, GlassPanel, getBrand, Orb } from "@auracode/ui";

<main style={{ position: "relative", ...brandCssVariables(getBrand("codex")) }}>
  <AuraField brand="codex" intensity="active" />
  <GlassPanel elevation={2} squircle>
    <Orb brand="codex" state="thinking" size={40} label="Codex is thinking" />
  </GlassPanel>
</main>;
```

- Set an agent's colours with `brandCssVariables()`, not by writing `--aura-accent` by hand. It also re-declares the tokens derived from the accent (`--aura-focus-ring`, `--aura-accent-soft`): a custom property resolves `var()` where it is declared, so without that they keep the default accent below the override.
- Every live orb shares one WebGL2 context (OGL) but keeps its own canvas, so orbs stack like any element. Without WebGL2 they show a CSS poster in brand colours, and under reduced motion they hold still. To keep the shader compile off the first orb's render, call `getOrbSupport()` during boot.
- `GlassPanel` has no `backdrop-filter` unless you set `blur`. Large surfaces sit on the native window glass; reserve blur for small overlays, and never animate it.
- To animate an orb's size, use a CSS transform, not the `size` prop. The shared canvas reallocates whenever the largest orb changes size, and each live orb's canvas holds a frame as large as that orb, so mix huge and tiny live orbs sparingly.
- Checks: `pnpm --filter @auracode/ui test`, `pnpm --filter @auracode/ui typecheck`, `pnpm exec biome check packages/ui`.
