# Aura visual system

Status: **Halo, implemented 1 November 2026, awaiting the owner's visual lock**. The owner asked for this to be the last full styling pass. It covers the light-only website and the desktop app in both appearances. Local browser verification and native Windows checks are recorded in the review record. Do not treat the current styling or its captures as an approved golden baseline until the owner locks the design. Halo supersedes the earlier Aura proposal of 30 October and the old Graphite, Orbit and Shallows directions. Historical Design Lab screens are studies, not product authority.

The current review record is [checkpoint-2026-11-01-halo.md](checkpoint-2026-11-01-halo.md). Earlier records, [checkpoint-2026-11-01.md](checkpoint-2026-11-01.md) and [checkpoint-2026-10-30.md](checkpoint-2026-10-30.md), are historical.

## Direction

Halo means glass windows lit by the halo of the agent at work. Every agent already has a brand glow in `packages/ui/src/brand.ts`. On the website that glow lights the hero, the capability scenes and the finale. In the desktop it appears only as live state: the composer's rim breathes in the working agent's glow while it streams. Accent, focus and selection stay neutral, per the owner's 1 November decision.

The website takes its cleanliness and organization from the audited SpaceXAI, Harvey, Vercel and Aside landing pages. It matches Typesafe's uniqueness without copying it, and it uses rich, purposeful animation. The desktop keeps the audited Devin organization and is glass throughout, over the native window material. Adapt patterns to auracode's own product and capabilities. Do not copy reference brands, artwork or content, and do not imply unsupported functionality. Preserve the actual auracode logo, including its sea lion and turtle artwork, and its app icons and favicons. Do not add independent decorative animals, swimming or water motifs.

## No eyebrows

Never add eyebrows. That means no small label above a heading or section. It covers uppercase or mono micro-labels, numbered kickers such as "THE WORK / 01", "brand / section" lines, category labels and badges. Headings stand on their own. `.github/scripts/check-styles.mjs` enforces this for the website, the desktop and the shared primitives. It rejects uppercase text transforms, eyebrow, kicker and overline class names, and generated capitalized `content` labels.

## Shared foundation

`packages/ui/src/graphite/tokens.css` is the shared token source. `graphite/tokens.ts` and its tests mirror palettes where code needs them. Existing `--g-*` names are compatibility names, not permission to restore the former Graphite direction. Keep color, typography, spacing, radii, glass, motion, states, code and terminal values semantic and centrally defined. Do not introduce a parallel token system.

Glass tokens:

- **Window.** `--g-window` is `#0b0b0c` dark and `#efeff1` light, matching the native window's base color. `--g-window-tint` washes the material behind the sidebar.
- **Fills.** Translucent fills sit on top in a fixed order: `--g-glass-layer` for panes, `--g-glass-bar` for sticky toolbars, `--g-glass-pop` for menus, popovers, dialogs and the composer, and `--g-glass-card` for grouped lists and cards. `--g-glass-raised` is for raised thumbs only: a checked segment, an open popover trigger, a selected tab. `--g-glass-control`, `-hover` and `-active` are for controls, and `--g-glass-selected` is for the open row.
- **Edges.** Edges are inset hairlines, `--g-glass-rim` and `--g-glass-rim-strong`, with a `--g-glass-highlight` top edge on panes.
- **Blur and shadow.** Blur comes only from `--g-blur-bar`, `--g-blur-pop` and `--g-blur-scrim`. Shadows come only from `--g-shadow-control`, `-primary`, `-layer` and `-pop`. `tokens.test.ts` rejects other blur and shadow values.
- **Contrast.** `tokens.test.ts` composites every fill over the worst plausible material: a light window over a black desktop and a dark window over a white one. It requires 4.5:1 for primary, secondary and tertiary text on each result.

Radii form a concentric family: 6, 10, 14, 18 and 22px, plus pill. Every control is a pill: buttons, chips, segmented controls, tabs, switches and picker triggers. Inputs and menu rows use 10px; panes, menus and grouped lists 14px; transcript and setup cards 18px; the composer 22px. Nested radii stay concentric.

Geist Variable is the interface and prose face on the desktop and the website. Geist Mono sets machine-generated text. Instrument Serif Italic sets accent phrases on the website only. Desktop chrome is 13/20px, prose 15/24px, metadata 12/16px, headings 16/22px and titles 20/28px. Keep success, warning and danger distinct and verify text contrast on its real surface.

Dark background and first four surfaces are `#101112`, `#141516`, `#1c1d1f`, `#202226` and `#292b2f`. The light counterparts are `#fafafa`, `#ffffff`, `#f4f4f5`, `#f0f0f2` and `#e8e8eb`. Code, terminal, diff, selection and status tokens keep explicit values for both modes. Do not assume a dark code or terminal surface in light mode.

Desktop appearance defaults to System, with profile-local persisted Light and Dark overrides in the versioned setup preferences. Follow OS changes while System is selected. Keep the document root, native window and menus, portals and terminal palette consistent with the resolved appearance. The website is permanently light, with no appearance control or persisted theme, including its script-free standalone notices page. Website forms and third-party verification use light appearance. The hosted verification page stays light inside a dark desktop dialog. Preserve non-JavaScript behavior and the website's hashed content security policy.

## Desktop composition

The window shows its native material:

- **Windows.** Acrylic on Windows 11 build 22523 and later, Mica on builds 22000 to 22522, and opaque on Windows 10. A glass window hands its caption colors back to the system, so the caption and the page read as one surface.
- **macOS.** Vibrancy, or Liquid Glass where the system offers it.
- **Linux and browser fixtures.** No material. The same layers are painted over the opaque `--g-window`.

`prefers-reduced-transparency` replaces every glass fill with its solid equivalent.

The layers:

- The sidebar sits on the window tint.
- The chat (with its docked terminal), the settings pages and the Changes panel float as translucent layers, inset 8px with a 14px radius.
- The header and sticky toolbars are blurred bars over scrolling content. The composer is a frosted capsule.
- Menus, popovers, dialogs and tooltips are frosted.
- Grouped settings rows and transcript cards sit on cards with a hairline rim.
- The open chat and the open settings page are lit capsules. No colored side bars mark selection. Where a lit fill would take colored or secondary text under 4.5:1 on frosted glass, the selection is a rim without a fill, as on the selected changed file. The Git review panels are rimmed outlines for the same reason.

Design for a 1440 x 900 native window, minimum 960 x 640, with 52px clearance for native title controls. The sidebar is 256px expanded and 56px as a rail. At 1200px and wider, the Changes panel can resize from 320 to 560px; below that it overlays at up to 420px. The terminal remains persistent and resizable. Account for long titles, narrow windows, platform title controls, keyboard and focus order, scrolling and no horizontal overflow.

Cover setup and agent discovery, workspace and empty chat, populated and streaming transcripts, picker and composer, permissions and questions, queued messages, error and recovery states, project and worktree management, Git and changes, terminal, Plugins & MCP, settings and account/sync, and all menus and dialogs. Customize sits below Search and New chat and contains Plugins & MCP, Instructions and Project memory. Existing settings routes remain accessible. Opening Customize preserves the active chat and draft. Preserve the underlying Tauri commands, data, keyboard behavior, native focus and running processes when restyling.

The composer keeps access and native workflow controls on its left and the searchable agent, model and thinking picker on its right. Its pill always names the model and the thinking level ("Opus 5.5 · High", shortened at narrow widths). The picker reads top down: the current model and agent, the thinking level as one segmented row that is always in view, then the model and agent lists, which scroll on their own, then More options. A refused change says why inside the picker. While the agent is not running, its last models and levels stay choosable and the picker says the choice applies when the agent starts. The UI calls the level "Thinking", whatever an agent calls it. Use compact labels and semantic status, not decorative autonomy ticks. Project headers offer a visible new-chat plus. The new-chat form is a compact, left-aligned surface with a maximum width of 640px, holding an agent dropdown, folder and existing worktree controls. Instructions offers descriptive Shared instructions and Agent-specific files choices. Keep explanations of MCP scope, authentication and how agents edit project memory visible at their relevant surfaces. Agents edit project memory directly unless its switch is off (owner, 1 November 2026); an agent's edit shows as a calm banner in the chat pane with Review and Undo, never a blocking dialog, and history shows each revision's changes with the production diff block.

Automatic checkpoints are an opt-in, profile-local General setting. Extend the existing settings row and switch components. Explain the sending delay and file-undo tradeoff beside the control; full-auto autonomy must not imply that checkpoint protection is enabled. Changes must distinguish turns without a snapshot from earlier saved checkpoints that remain available.

The transcript keeps reasoning in stored history but does not render reasoning rows. While a turn runs, one working line occupies its tail: the agent's halo, a rotating verb and elapsed time after the first second. Text streaming in hides that line; a request replaces it with "Waiting on you"; the completed turn's footer takes its place. Verb changes crossfade, and the elapsed time glides with their width. Reduced motion stops the rotation, halo and sheen. Consecutive tool calls share one disclosure, including calls separated only by hidden reasoning. Tool labels use readable verbs and arguments, retain their full title in a tooltip, and expose failed or stopped states. Expanding tool output preserves keyboard focus, the reader's scroll position and virtualized history.

## Website composition

The page is light paper (`#fafafa`) with ink text, broken by two night bands: capabilities and the finale. Content is at most 1200px wide, or 1360px for wide stages. Gutters are 32px on desktop and 20px on mobile; section spacing is 168px on desktop and 104px on mobile. The hero title is Geist at `clamp(50px, 7.6vw, 112px)` and weight 560. Section titles are `clamp(38px, 5vw, 72px)` and leads 18/28px.

The home page, in order:

1. **Header.** A floating glass capsule with a pill that glides between links. It turns to dark glass over night bands. On mobile it opens as a glass sheet.
2. **Hero.** "One window for *[agent]*." The agent name rolls in letter by letter, in Instrument Serif Italic. Below sit the lead, a magnetic Download pill and "See it work".
   - The hero window is a live glass mini-app. It replays a real handoff loop: the message types in, the agent thinks, runs a tool and replies, then the next message hands off to another agent.
   - The composer's agent chip, the hero halo and the headline change agents together.
   - An agent marquee, drawn from one logo sprite, runs underneath.
3. **Product.** A real desktop screenshot in a glass bezel. A scroll-linked tilt flattens it, and callouts point at real parts of the interface.
4. **Capabilities (night).** Six tabs, with the third active by default, and a glass indicator that glides between them with the timer inside. Each scene has its own choreography, and the band's glow takes the active capability's hue.
5. **Numbers.** Odometer reels: one window, the count of supported agents and zero accounts needed for local work.
6. **Wheel.** "With auracode," followed by a wheel of true local-first facts taken from the FAQ.
7. **FAQ.** Glass rows with a plus that turns into a minus.
8. **Finale (night).** A cursor-following halo, a magnetic Download and the footer, which ends in a giant wordmark that rises in.

Utility pages share one layout: a glass sheet over a soft halo, with a two-tone title. They cover download, sign in and sign up, device verification, account, privacy, terms, changelog and error. Preserve all their content and actions. Keep download and essential information usable without JavaScript. Product images must come from real desktop preview states, generated by `apps/web/scripts/product-images.mjs`, and must reflect the integrated desktop. Do not present fabricated screenshots as product evidence. The hero window and the capability scenes are authored illustrations of supported states, not screenshots, parallel agents or invented features.

## Motion and accessibility

The website's motion is rich but purposeful, and built from named primitives:

- **Primitives.** Rise, word reveal, letter roll, halo bloom, typing and streaming, handoff pass, glide, flatten, glint, magnetic pull and marquee.
- **Easing.** Expo `cubic-bezier(0.16, 1, 0.3, 1)` for entrances and glide `cubic-bezier(0.32, 0.72, 0, 1)` for moving indicators.
- **Pausing.** Ambient loops pause offscreen and in hidden tabs. The capability cycle also pauses while the section is in use.
- **Fallbacks.** Pointer effects run only with a fine pointer. Reduced motion shows static, complete compositions, and without JavaScript the page shows the final composition. There is no canvas.

Desktop motion stays event-driven, with `cubic-bezier(0.2, 0, 0, 1)`:

- Hover 120ms, press 80ms, popover 160ms in and 120ms out with at most 2px travel, panel 180ms.
- Glides use 240ms. Pressed buttons scale to 0.97.
- The composer's halo breathes over 2400ms, and only while an agent works.

Reduced motion and the in-app motion setting remove movement and duration. State changes must stay understandable without animation. Preserve visible keyboard focus, native dialog behavior, accessible names, error announcements, readable contrast, and robust zoom and reflow.

## Governance and verification

For future visual work, read this document and [reference-audit.md](reference-audit.md), then inspect the shared tokens and production components. Until the owner locks Halo, visual artifacts are proposals. Record the owner's approval and artifact locations before treating them as golden. For a new feature, extend the semantic tokens and interaction patterns, show desktop states in light and dark and website states in light, and preserve accessibility and behavior. Update this document when an owner decision changes the design; do not leave competing directions in plans or READMEs.

Run `pnpm check` and `pnpm build`, `pnpm --filter @auracode/web test:browser`, and the desktop `check:chat`, `check:setup`, `check:settings` and `check:customization` suites as appropriate to changed surfaces. Run `node apps/desktop/scripts/check-layout.mjs` in both engines, both appearances and both window sizes. Add `--glass worst` to repeat it over the worst glass backdrop.

Development previews take `&glass=acrylic` to emulate the window material over a colourful desktop. `&backdrop=worst` paints the worst plausible material instead. Verify both desktop themes, system switching, saved desktop preferences, portal and terminal updates, the website's light appearance under a dark system preference, keyboard use, reduced motion, responsive sizes and contrast. Browser fixtures and screenshots do not establish native macOS or Windows release acceptance; verify native materials, menus and title controls on supported platforms separately. Existing style checks enforce token usage; use objective checks for meaningful invariants rather than freezing arbitrary layouts.
