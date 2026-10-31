# Aura visual system

Status: **full styling pass implemented, awaiting owner visual approval**. This direction covers the light-only production website and the desktop app in both appearances. Local visual and browser verification is recorded in the review record; final remote integration checks and native release acceptance remain separate gates. Do not treat current styling or captures as an approved golden baseline until the owner locks the design. These decisions supersede the old dark-only Graphite, Orbit and Shallows directions. Historical Design Lab screens are studies, not product authority.

The implemented proposal, reproducible review gallery and verification limits are recorded in [checkpoint-2026-10-30.md](checkpoint-2026-10-30.md).

## Purpose and boundaries

The website combines Vercel's restrained hierarchy, Harvey's clear organization, and Typesafe/Jev's distinctive staged product proof. The desktop takes its organizational and visual cues primarily from Devin, with restrained touches from the Aura website. Adapt patterns to auracode's own product and capabilities. Do not copy reference brands, artwork or content, or imply unsupported functionality. Recompose layouts and navigation grouping while preserving existing actions, content, capabilities and workflows. Preserve the actual auracode logo, including its sea lion and turtle artwork, and its app icons and favicons. Remove independent decorative animals, swimming and water motifs across production surfaces and generated social art.

## Shared foundation

`packages/ui/src/graphite/tokens.css` is the shared token source; `graphite/tokens.ts` and its tests mirror palettes where code needs them. Existing `--g-*` names are compatibility names for the Aura foundation, not permission to restore the former Graphite direction. Keep color, typography, spacing, radii, motion, states, code and terminal values semantic and centrally defined. Product-specific layout and density belong near each application. Do not introduce a parallel uncoordinated token system. The sparse shared accent currently uses `--g-volt`: dark `#ccff33`, light `#496800`. Reserve it for small meaningful accents, keeping success, warning and danger distinct. Verify solid text contrast on its actual surface.

Dark background and first four surfaces are `#101112`, `#141516`, `#1c1d1f`, `#202226`, `#292b2f`; light counterparts are `#fafafa`, `#ffffff`, `#f4f4f5`, `#f0f0f2`, `#e8e8eb`. Lines, text, focus, syntax, ANSI, selection and status tokens have explicit values for both modes in the token source. Preserve theme pairs and mirror tests when changing them. Do not assume a dark code or terminal surface in light mode.

Desktop uses Inter for interface and prose, website uses Geist, and machine-generated text uses Geist Mono. Desktop chrome is 13/20px, prose 15/24px, metadata 12/16px, title 20/28px. Website hero is 48/52px, 36/40px on mobile; section heading 32/38px; body 16/24px. Use a compact 6, 8 and 12px radius family. These values guide production consistency; preserve legibility and actual content needs.

Desktop appearance defaults to System, with profile-local persisted Light and Dark overrides in the versioned setup preferences. Follow OS changes while System is selected and keep the document root, native window and menus, portals and terminal palette consistent with the resolved desktop appearance. The website is permanently light, with no appearance control or persisted theme, including its script-free standalone notices page. Website forms and third-party verification use light appearance. The hosted verification page also remains light inside a dark desktop dialog; the surrounding native UI retains its selected appearance. Preserve non-JavaScript behavior and the website's hashed content security policy.

## Desktop composition

Design for a 1440 x 900 native window, minimum 960 x 640, with 52px clearance for native title controls. A manually collapsible sidebar is 256px expanded and 56px as a rail. At 1200px and wider, the existing Changes panel can resize from 320 to 560px; below that it overlays at up to 420px. The existing terminal remains persistent and resizable. These are layout targets, not new capabilities. Account for long titles, narrow windows, platform title controls, keyboard and focus order, scrolling and no horizontal overflow.

Cover setup and agent discovery, workspace and empty chat, populated and streaming transcripts, picker and composer, permissions and questions, queued messages, error and recovery states, project and worktree management, Git and changes, terminal, plugin library, settings and account/sync, and all menus and dialogs. Settings currently includes General, Instructions, Account, Configuration sync, Shortcuts and About, and entry points to Agents and Plugin library. Rearrangement must retain every capability and accessible route. Preserve underlying Tauri commands, data, keyboard behavior, native focus and ongoing processes when restyling.

Automatic checkpoints are an opt-in, profile-local General setting. Extend the existing settings
row and switch components. Explain the sending delay and file-undo tradeoff beside the control;
full-auto autonomy must not imply that checkpoint protection is enabled. Changes must distinguish
turns without a snapshot from earlier saved checkpoints that remain available.

## Website composition

The homepage uses two offset chat and handoff planes on a muted coral dither field with technical registration, followed by a framed real desktop screenshot. The capabilities section uses an open six-tab rail, with clear proof tied to each actual capability. The handoff planes are an authored illustration of successive supported chat states, not a screenshot, parallel agents or invented functionality. The full framed product image is a screenshot of the real desktop preview. Use an inverse closing CTA, FAQ and footer. Utility pages use a ruled, organized treatment. Keep headings modest, facts accurate and repetition low. Use a maximum content width of 1200px, 32px desktop and 20px mobile gutters, and 96px desktop and 64px mobile section spacing.

Preserve all content and actions on home, download, sign in, sign up, device verification, account, privacy, terms, changelog and error pages. Keep download and essential information usable without JavaScript. Product images must come from actual desktop preview states, using `apps/web/scripts/product-images.mjs`, and reflect the integrated desktop. Do not present fabricated screenshots as product evidence.

## Motion and accessibility

Motion is primarily event-driven; avoid decorative ambient motion. Existing marketing agent rotation and capability cycles pause while the page is hidden and under reduced motion; the capability cycle also pauses when its section is offscreen or being used. Use `cubic-bezier(0.2, 0, 0, 1)`: hover 120ms, press 80ms, popover 160ms with at most 2px travel, panel 180ms, website entrance 240ms with at most 8px travel once per capability, and fixed-width agent-name rotation 250ms. Reduced motion removes movement and duration. State changes must remain understandable without animation. Preserve visible keyboard focus, native dialog behavior, accessible names, error announcements, readable contrast, and robust zoom and reflow.

## Governance and verification

For future visual work, read this document and [reference-audit.md](reference-audit.md), inspect shared tokens and production components, then compare against the approved checkpoint artifacts once they exist. Do not use a historical lab screen as a golden reference. Until the owner approves the full styling pass, visual artifacts are proposals; record the owner's approval and artifact locations before treating them as golden. For a new feature, extend semantic tokens and interaction patterns, show desktop states in light and dark and website states in light, and preserve accessibility and behavior. Update this document when an owner decision changes the design; do not leave competing active directions in plans or READMEs.

Run `pnpm check` and `pnpm build`, `pnpm --filter @auracode/web test:browser`, and desktop `check:chat`, `check:setup`, `check:settings` and `node apps/desktop/scripts/check-layout.mjs` as appropriate to changed surfaces. Verify both desktop themes, system switching, saved desktop preferences, portal and terminal updates, website light appearance regardless of system theme, keyboard, reduced motion, responsive sizes and contrast. Browser fixtures and screenshots do not establish native macOS/Windows release acceptance; verify native materials, menus and title controls on supported platforms separately. Existing style checks enforce token usage; use objective checks for meaningful invariants rather than freezing arbitrary layouts.
