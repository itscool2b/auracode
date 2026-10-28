# Graphite: the auracode visual language

Status: **Graphite replaces Orbit on 2026-10-26 (owner decision).** The product is **dark only**
(desktop, onboarding and website): no light theme, no system switching, no appearance setting. One
accent, **volt** `#CCFF33`, means look here. **Shallows replaces the dither field as the brand
surface on 2026-10-28 (owner decision):** lit water seen from below, with seals and turtles passing
as dark silhouettes (4.16). The foundation ships in `@auracode/ui/graphite` (tokens, stylesheet,
`Shallows`, `Swimmers`, `Creature`, `AgentMark`, `Logo`, `Wordmark`, `StatusDot`,
`PixelLoader`, `Keycap`, `CopyButton`, and `DitherField` until the app no longer uses it). The
website is built in Shallows; the desktop app moves next. Every number here is meant to be built as written. Motion values are
measured on the reference sites (`target/design-research/motion.md`, captured 2026-10-26); the
few that are not are marked *provisional*.

**Orbit history.** Orbit (2026-10-24 to 2026-10-26) was a mission-control direction: line-drawn
orbit marks, a graticule globe, a starfield night panel, orange as the signal, an alpha ink ladder
for text and dark-mode weights of 380, 430 and 480. The owner rejected the result ("looks
horrible"): the space imagery read as theme rather than product, fractional weights and alpha text
rendered soft and uneven in WebView2 on Windows, and the app felt janky. Graphite drops the globe,
orbits, stars, orange, alpha text and every fractional weight. It keeps Orbit's UX grammar (plain
sentences with real numbers, tool-row grammar, receipts, cards that take the composer's place,
keyboard everywhere), restated in section 6. `@auracode/ui/orbit` stays only for the Design Lab
and for screens not yet moved.

**Dither history.** From 2026-10-26 to 2026-10-28 the signature was a live ordered-dither field
with pixel-art seals and turtles swimming through it. The owner rejected it as a messy background,
and the creatures glitched as they eased away from the pointer. Shallows keeps the animals and the
calm and drops the texture: one grey fade, flat silhouettes, transform-only motion. The website no
longer uses or ships the dither engine (4.15 documents the component while the app still uses it).

---

## 1. Direction and thesis

**Name:** Graphite. **Id:** `graphite`.

**Thesis:** a black instrument with one living surface. Type and hairlines do the work, a grey
ladder carries every hierarchy, the only living thing is the water, lit from the top with seals
and turtles passing through it, and the only colour is the thing that needs you.

1. **Type does the work.** Geist at integer weights (400, 500, 600), solid colours, two-tone
   headlines at one size. Geist Mono only for what a machine made.
2. **Shallows is the ornament.** The one decorative surface is the lit water (4.16): a single
   grey fade with the logo's seal and turtle drawn as flat silhouettes. Machine state keeps its
   small pixel marks (the 2x3 loader, the pixel check). No glow, no glass, no texture, no noise;
   the one blur softens a far swimmer, painted once.

**Status dots are circles (owner decision, 2026-10-28).** Wherever this document says a volt, red,
green, white or grey square marks a state (needs you, failed, running, found, not installed, a
project, an attention mark on a control), read a dot: the same size, a flat circle centred on whole
pixels, no ring or glow (an empty "not installed" mark is a 1px ring). Pixels, loader cells, the
pixel check, diffstat squares, list bullets, plan nodes and the Stop square stay square.
3. **One accent, one meaning.** Volt marks needs-you, live and new, and the glint. It is never a
   fill larger than a chip and never a button.
4. **Structure from hairlines and value steps** (Vercel, X Money, Aside), not from cards and
   shadows. One soft shadow exists, for things that float.
5. **Motion only on events.** The swimmers and the water's shimmer are the single ambient
   motion, and they stop for reduced motion, for hidden pages and offscreen.
6. **Crisp everywhere.** Solid text colours, integer weights, no positive tracking on small text,
   whole-pixel geometry, 14px minimum for UI text.

---

## 2. What we copy from where

The references are the owner's Mobbin and official-site set in `target/design-research/` (Mobbin
images in `mobbin/`, live frames in `live/`, raw logs in `data/`, the motion report in
`motion.md`). We copy layout, treatment, measurement and motion; never logos, illustrations,
photography or fonts. "Measured" means read from the live capture of 2026-10-26.

### 2.1 SpaceXAI (x.ai): hero, pills, tiles, terminal

| Trait | Lands on the website | Lands in the app |
|---|---|---|
| Centred two-line hero; one word rotates every 3000ms, letters leave up 14px and arrive from 14px below 25ms apart (250ms, `cubic-bezier(0.16, 1, 0.3, 1)`); a 3px underline 4px below draws in over 800ms; a glint sweeps it in 3000ms linear, 400ms after each swap (measured; recoloured to one volt band) | Hero headline with the agent name rotating (5.3); the underline and its glint were dropped on 2026-10-28 | Empty state agent switch (6.13) |
| Load choreography: pill 320ms at 320, words from 100 plus 55 per word, lead 380ms at 580, CTAs 380ms at 700, tiles 1250ms at 760, all `cubic-bezier(0.22, 1, 0.36, 1)` (measured) | Hero entrance (5.3) | None |
| Announcement pill: chip, sentence, arrow coin | **Not taken** until a release is published (5.3) | None |
| White primary pill beside a dark secondary pill; colour 150ms `cubic-bezier(0.4, 0, 0.2, 1)`, no scale on press (measured) | One primary pill per section: hero, closing (5.3, 5.9) | Primary and outline buttons (4.1) |
| Film card: a centred one-line heading, a large rounded card, "Play" and a caption line in large type | **Removed** on 2026-10-28: the capabilities panel shows the product (5.4) | None |
| Terminal card: mono, line numbers, "Thought for 4.1s"; 2x3 dot loader on a 660ms cycle (measured) | Product fragments in the film card and tiles (5.6, 5.7) | Code wells, the thinking line, `PixelLoader` (4.5, 6.4) |
| Sparse footer: the brand at left, link columns at right | Footer (5.7); its giant logo was removed on 2026-10-28 | None |

### 2.2 X Money (money.x.com): two tones, tiles, FAQ, shimmer

| Trait | Lands on the website | Lands in the app |
|---|---|---|
| Two-tone stacked heading, same size and weight, second line grey | Every section heading (5) | Empty state, settings titles, onboarding (6) |
| Per-word flip-up: from `translateY(45%) rotateX(-40deg)` in a 1200px perspective, 650ms `cubic-bezier(0.23, 1, 0.32, 1)`, 100ms then 55ms per word (measured, identical at x.ai) | `.g-rise` on the hero and section headings (4.12) | Onboarding headings (6.17) |
| Recessed square tiles holding miniature real UI, the text set against each tile's bottom edge, one wide tile with a two-way toggle; hovering one dims the others to 0.5 over 500ms `cubic-bezier(0.32, 0.72, 0, 1)` (measured) | **Removed** on 2026-10-28 for the capabilities panel (5.4) | Settings usage tiles (6.16) |
| Hairlines across the full column between sections | **Not taken**: sections are separated by space (5.1) | Settings groups (6.16) |
| FAQ accordion: 300ms ease-out-quint, the open row's tinted well slides between rows in about 270ms, the icon turns 90 degrees in 200ms (measured) | FAQ, now on Vercel's hairlines (5.5) | Advanced settings, expanded tool rows (6.4) |
| Grey-on-grey text shimmer: 100deg band, 250% wide, 1400ms linear (measured) | None | Thinking, running, live verbs (4.12) |
| Success check drawn in 250ms (measured) | None | `AgentMark` done check (4.13) |

### 2.3 Harvey (harvey.ai): word wheel, stats, timer tabs, slow hover

| Trait | Lands on the website | Lands in the app |
|---|---|---|
| Timer-driven vertical word wheel: one row step every 1100ms (600ms move on `cubic-bezier(0.7, 0, 0.7, 0.7)`, 500ms hold), 7 visible rows, opacity by distance 1, 0.6, 0.3, 0.1 (measured from the archived source) | **Not taken** since the landing study (5.10): the hero rotates the agent name | None |
| "Top performers" triptych: three tall textured tiles, a sentence-case title and grey paragraph under each | **Not taken** since the landing study (5.10): its captions became the capability rows (5.4) | None |
| Stats with a rule above each number (Harvey's is 2px with 32px above the numeral) | **Not taken** | Usage settings (6.16) |
| Capability list whose active item's 2px rule fills as a timer: 7500ms linear by `translateX(-100%)` to 0, paused on hover, switch 300ms `cubic-bezier(0.7, 0, 0.3, 1)` (measured) | Capabilities panel: the active row's 2px timer runs 6.5s, held while hovered or focused (5.4) | Plan strip progress (6.5) |
| Nav hover dims the siblings over 300ms `cubic-bezier(0.3, 0.3, 0.3, 1)` (measured) | Nav (5.2) | None |
| Slow-settling button hover: 300ms `cubic-bezier(0, 0.7, 0.3, 1)`, 90% by 120ms, settled near 240ms (measured) | All buttons (4.1) | All buttons (4.1) |
| Harvey's serif | **Not taken.** Graphite is one grotesk | Not taken |

### 2.4 Aside (aside.com): column frame, lead-ins, rows

| Trait | Lands on the website | Lands in the app |
|---|---|---|
| Content column framed by full-height 1px side rules (1248px column, measured) | **Not taken**: no column rules (5.1) | None |
| Bold lead sentence, grey continuation, one paragraph | Feature copy, intro paragraphs (4.12) | Settings descriptions, onboarding (6) |
| Rows entering: 8px rise, 340ms `cubic-bezier(0.22, 1, 0.36, 1)`, 70ms apart (measured) | `.g-enter` on rows (4.12) | Ledger and roster rows (6.13, 6.17) |
| Rows on hairlines with a segmented control | Spec rows on the download cards, account lists (5.9) | Settings, right panel tabs (6.14, 6.16) |
| Closing panel: a centred two-line statement and one download pill in one rounded panel | Closing panel, as lit water (5.6) | None |
| Composer control row of quiet text controls | None | Composer (6.9) |

### 2.5 Vercel: grid frames, cells, real fragments

| Trait | Lands on the website | Lands in the app |
|---|---|---|
| Hairline grid frames with "+" crosshairs on the corners: 21px crosses with 10px arms in `#878787`, guides at white 9% (measured) | **Not taken**: no guides or crosshairs (5.1) | None |
| One frame of joined panels divided by its own rule | **Not taken** since the landing study (5.10) | Settings agent roster (6.16) |
| Mocks built from real UI fragments: timelines, agent tables, status dots | The capabilities views (5.4) | The same components, live (6) |
| Geist everywhere; command pill with copy | Geist everywhere (5.1) | Code blocks (4.8) |
| Dark buttons `#0A0A0A` to `#1F1F1F` in 150ms; footer links in 100ms (measured) | `--g-dur-fast`, `--g-dur-micro` (3.8) | Rows and icon buttons |

### 2.6 AI in Design Report 2026: uniqueness bar, not copied

The report sets the bar for distinctiveness: giant edge-to-edge type, dithered and pixel imagery,
big numerals split by rules, numerals counting up in about 950ms (measured). We copy none of its
artwork or layout. Our answer to the bar is Shallows (4.16): the sea seen from below, with the
logo's own seal and turtle swimming through it, calm enough to sit behind a headline.

### 2.7 What we leave behind

- Eyebrows: small uppercase or mono labels above headings, numbered "01/02" tags, caption filler.
  Vercel's tracked caps labels and X Money's numbered tiles are not copied (section 8).
- Orange and every other signal hue; agent brand colours; project colours in chrome.
- Space imagery: globes, orbits, satellites, starfields, orbs, halos.
- Glass, blur, gradients, glow, sparkles, tilted cards, parallax.
- Harvey's serif, Aside's sky wallpapers, SpaceXAI's rainbow glint (ours is volt on grey).

---

## 3. Tokens

Implemented in `packages/ui/src/graphite/tokens.css` (variables on `:root`) and mirrored in
`tokens.ts`; `tokens.test.ts` keeps them equal and checks every contrast claim below.

### 3.1 Colour

All text colours are solid hex: WebView2 and WebKit rasterise text against an opaque colour, and
alpha text was one cause of the old app's soft type. Alpha appears only in tints behind content.

**Surfaces** (back to front; a well sits one step below its container)

| Token | Hex | Use |
|---|---|---|
| `--g-bg` | `#000000` | Page, window, sidebar, website sections |
| `--g-surface-1` | `#0A0A0A` | Panes (chat, right panel, settings), hairline cells, wells on the page, tiles |
| `--g-surface-2` | `#111111` | Raised: composer, menus, cards, dialogs, open accordion rows |
| `--g-surface-3` | `#191919` | Fills: soft buttons, tracks, hover, the user message, agent tiles |
| `--g-surface-4` | `#222222` | Pressed and selected, highlighted menu items |

**Lines**: `--g-line-faint #141414` (rules inside wells), `--g-line #1F1F1F` (hairlines, pane
rings, grid lines), `--g-line-strong #2E2E2E` (inputs, outline buttons, chips, tile edges).

**Text** (contrast on bg / surface-1 / surface-2 / surface-3)

| Token | Hex | Contrast | Use |
|---|---|---|---|
| `--g-fg-1` | `#EDEDED` | 17.9 / 16.9 / 16.1 / 15.0 | Primary text, headings, the answer |
| `--g-fg-2` | `#A3A3A3` | 8.3 / 7.9 / 7.5 / 7.0 | Secondary: descriptions, tool verbs, leads |
| `--g-fg-3` | `#858585` | 5.7 / 5.4 / 5.1 / 4.8 | Tertiary: meta, timestamps, two-tone continuations, placeholders |
| `--g-fg-4` | `#4D4D4D` | 2.5 / 2.3 / 2.2 / 2.1 | Decorative and disabled only; never information |
| `--g-on-light` | `#000000` | 17.9 on the primary pill | Labels on the white and red pills |

`--g-fg-3` started at `#808080`, which measured **4.45:1** on surface-3 and failed; `#858585` keeps
4.76:1 there, a margin for grayscale antialiasing that thins grey stems. fg-3 is not for text on
surface-4 (4.3:1): selected rows use fg-2 or fg-1.

**Primary pill**: `--g-primary #EDEDED`, hover `--g-primary-hover #FFFFFF`, pressed
`--g-primary-active #D6D6D6`. The one white object on a screen.

**Signal and semantics** (the only hues outside code wells)

| Token | Value | Meaning |
|---|---|---|
| `--g-volt` | `#CCFF33` (17.9:1 on bg) | Look here: needs you, live, new, the glint, lit dither pixels. Text or a small mark |
| `--g-volt-tint` | `rgb(204 255 51 / 0.12)` | Behind "New" and needs-you chips only |
| `--g-green` | `#3DD68C` (11.2:1) | Passed, allowed, added. Never "done": done is a white check |
| `--g-green-tint` | `rgb(61 214 140 / 0.12)` | Behind pass chips |
| `--g-red` / `--g-red-hover` | `#FF5C5C` (6.9:1) / `#FF7A7A` | Failed, denied, removed, the one destructive pill (black label: white would be 3.0:1) |
| `--g-red-tint` | `rgb(255 92 92 / 0.12)` | Behind failure chips, failed wells |
| `--g-selection` | `#333333` | `::selection`, with text forced to fg-1 |
| `--g-scrim` | `rgb(0 0 0 / 0.72)` | Behind dialogs |
| `--g-focus` | `#EDEDED` | Focus ring (3.7) |

Volt stays `#CCFF33`: compared beside `#C6FF33`, `#D0FF2E` and `#C2FF29` on black, greener
variants drift toward the pass green and yellower ones toward a warning; `#CCFF33` sits 76 degrees
of hue from `--g-green`, and their luminance differs too, so they never read as one signal. No
separate text variant is needed: volt text passes 13.6:1 even on surface-4.

**Diffs** (inside wells): added line `rgb(61 214 140 / 0.10)`, added word `/ 0.24`; removed line
`rgb(255 92 92 / 0.10)`, removed word `/ 0.24`; hunk band `--g-diff-hunk #111111` with fg-3 text.
Line numbers take the full tone (green or red) on changed rows, fg-3 elsewhere. Diff code is not
syntax-coloured; the tint, the number and the `+` or minus marker carry the change, so colour is
never the only cue.

**Code and terminal** (wells only; every value passes 4.5:1 on surface-1)

| Role | Hex | Role | Hex |
|---|---|---|---|
| Code text | `#D4D4D4` | Keywords, ANSI bright red | `#FF8F8F` |
| Bright | `#EDEDED` | Strings | `#8FB8FF` |
| Dim: comments, punctuation, prompts | `#858585` | Numbers, attributes | `#C7A6FF` |
| Function names | `#EDEDED` | | |
| ANSI black, red, green, yellow | `#4D4D4D`, `#FF6B6B`, `#3DD68C`, `#E6CC6E` | ANSI blue, magenta, cyan, white | `#7AA7FF`, `#D69CFF`, `#5CD6D6`, `#D4D4D4` |
| ANSI bright green, yellow | `#6EE7A8`, `#F2DC8C` | ANSI bright blue, magenta, cyan, white | `#A3C2FF`, `#E4BDFF`, `#8AE6E6`, `#EDEDED` |

Comments are dim, never italic. ANSI inverse renders as the hue at 16% behind the hue's text.

**Project marks**: `--g-project-slate #8A98A6`, `--g-project-sand #A59E92`,
`--g-project-sage #8C9C88`, `--g-project-clay #A88E80`. Four quiet tones a person can give a
project; they colour that project's own swatch and nothing else, never chrome or text.

**Dither palettes** (greys above black, darkest first): `quiet` `#191919 #2E2E2E #4D4D4D`
(behind reading content), `standard` `#2E2E2E #4D4D4D #858585` (hero), `bright`
`#4D4D4D #A3A3A3 #EDEDED` (type made of pixels). Lit pixels are volt in every palette.

### 3.2 Type

**Faces.** Geist (variable) for every word, Geist Mono for machine data: paths, commands, code,
durations, versions, keycaps, ids and hashes. Both are bundled by `@auracode/ui/fonts.css`; nothing
else loads. No serif, no italic.

**Rendering rules** (the `.g-root` base layer applies them): integer weights 400, 500 and 600 only;
no fractional weights and no dark-mode weight reduction (a root cause of the old blurry text);
`font-synthesis: none`; `text-rendering: optimizeLegibility`; `-webkit-font-smoothing:
antialiased` and `-moz-osx-font-smoothing: grayscale`; `font-variant-numeric: tabular-nums` on
every counter, timer, cost and diffstat. Small text never takes positive tracking; display sizes
take negative tracking. Superscript decimals are built (a span at 42% of the numeral's size,
cap-aligned), because Geist has no `sups`.

**Website scale**

Measured against the reference landing pages (5.10) and stepped rather than fluid, so every size
and line height sits on the 4px grid at phone (under 640px), tablet and desktop (1024px and up)
widths. The site sets these in `apps/web/app/site.css`; the shared `--g-web-*` tokens stay as they
are for other consumers.

| Role | Size / line (phone, tablet, desktop) | Weight | Tracking |
|---|---|---|---|
| Hero and display | 40, 56, 72 / 1 | 500 | -0.04em |
| Section and page heading | 32/36, 36/40, 40/44 | 500 | -0.035em |
| Film caption and Play | 24/32, 32/40, 32/40 | 500 | -0.03em |
| Subheading | 24 / 32 | 500 | -0.02em |
| Lead | 16/24, 18/28, 18/28, fg-2 | 400 | 0 |
| Body, FAQ rows | 16 / 24 | 400, 500 | 0 |
| Small: captions, nav, footer | 14 / 20 | 400, 500 | 0 |
| Meta | 12 / 16 | 400 | 0 |

**App scale**

| Role | Size / line | Weight | Tracking | Class | Use |
|---|---|---|---|---|---|
| UI | 14 / 20 | 400, 500 | 0 | `.g-text-ui` | Rows, menus, buttons, inputs, tool rows |
| Prose | 15 / 24 | 400 | 0 | `.g-text-prose` | Agent answers, user messages, composer input |
| Meta | 12 / 16 | 400 | 0 | `.g-text-meta` | Timestamps, captions, hints, chips |
| Heading | 16 / 22 | 600 | 0 | `.g-text-heading` | Markdown h1 to h3, card titles |
| Title | 22 / 28 | 500 | -0.015em | `.g-text-title` | Settings pages, dialog titles |
| Display | 32 / 38 | 500 | -0.025em | `.g-text-display` | Two-tone empty states, onboarding |
| Code | 13 / 20 mono | 400 | 0 | `.g-text-code` | Code blocks, diffs, inline code at 0.9em |
| Term | 12.5 / 18 mono | 400 | 0 | `.g-text-term` | Terminal output |
| Key | 11 / 16 mono | 500 | 0 | `.g-keycap` | Keycaps |

**Two tones.** A heading's first clause is fg-1 and the rest fg-3 at the same size and weight,
stacked (`.g-two-tone > span`, X Money) or run in (`.g-lead-in`: bold lead in fg-1 500, the rest
fg-3, Aside). In sentences that describe an action, connective words are fg-3 and the variables
(agent, command, path, number) are fg-1 (X Money's confirm grammar).

### 3.3 Spacing

4px base: `--g-space-2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160`. The desktop
app writes every margin, padding and gap with these tokens (only 0 and 1px hairlines are literal);
geometry that follows a layout value (the 24px transcript gutter, the 52px titlebar band, a mark's
width) is written from that value. `.github/scripts/check-styles.mjs` keeps the app's stylesheets on
the colour, space, radius, type, weight and motion tokens.
Row heights: 24 compact, 28 tool rows and menu-dense rows, 32 menu rows, buttons and sidebar rows,
36 inputs and composer segments, 44 headers and two-line rows. Website section rhythm: 160px
between sections at 1024px and wider, 128px from 640 to 1023, 96px below (80, 64 and 48px above
and below each section).

### 3.4 Radii

`--g-radius-4` keycaps, inline code, "New"; `-6` chips, icon buttons, tooltips; `-8` inputs,
rows, wells, menu items; `-12` panes, menus, tiles, accordion wells; `-16` composer, dialogs,
docked cards; `-pill` buttons, segmented controls, switches, status dots. Pixels, loader cells
and crosshairs are square (0). Nested radius: inner equals outer minus padding (a 12px menu with
4px padding has 8px items). Nothing exceeds 16 except pills.

### 3.5 Borders and dividers

One hairline, 1px `--g-line`, everywhere structure needs a line: pane rings, hairline grids,
section rules, list separators (inset to the text start). Strong lines (`--g-line-strong`) mark
things you can act on: inputs, outline buttons, chips, tiles' inner edge. Tear lines are dashed
8/8 (`linear-gradient(90deg, currentColor 50%, transparent 0) 0 0 / 16px 1px repeat-x` in
`--g-line-strong`). Spines (tool groups, plan steps) are 1px `--g-line`. A selected card takes a
1.5px fg-1 rim. A focused list row takes a 2px fg-1 rail on its left edge. No border is ever
coloured except the failed well's 2px red left edge and the invalid input's red border.

### 3.6 Elevation

Flat by default. One shadow, `--g-shadow: 0 16px 48px -12px rgb(0 0 0 / 0.8), 0 4px 12px -4px
rgb(0 0 0 / 0.6)`, for menus, popovers, the picker, tooltips, dialogs and toasts only. On black a
shadow is mostly invisible, so floating things also take a 1px `--g-line-strong` ring and one
surface step up. Panes, rows, wells, tiles and the composer never cast a shadow.

### 3.7 Focus

`:focus-visible` draws a 2px solid `--g-focus` (fg-1) ring at a 2px offset, following the radius.
Decided against volt: focus is on every keyboard step, and volt must stay scarce enough to mean
"needs you"; white also reaches 17.9:1 on black. The ring is never removed. Inputs also lift their
border to fg-3 on focus. Inside menus and lists the highlight fill (surface-4) plus a 2px rail is
the focus indicator, as in native menus, so arrow keys do not draw rings around rows.

### 3.8 Motion

Measured on the reference sites (`target/design-research/motion.md`); only the exit curve and its
120ms are *provisional*. Each easing has one job.

| Easing | Curve | Job | Source |
|---|---|---|---|
| `--g-ease` | `cubic-bezier(0.4, 0, 0.2, 1)` | Hover colour and fill, toggles, menus | x.ai, X Money, Vercel, Aside |
| `--g-ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Letters, underline and line draws, dither reveal | x.ai |
| `--g-ease-quint` | `cubic-bezier(0.23, 1, 0.32, 1)` | Headline flip-up, panels, accordion, dialogs | X Money |
| `--g-ease-smooth` | `cubic-bezier(0.32, 0.72, 0, 1)` | Sibling dims, large media reveals | X Money |
| `--g-ease-settle` | `cubic-bezier(0, 0.7, 0.3, 1)` | Button hover (fast start, slow tail) | Harvey |
| `--g-ease-soft` | `cubic-bezier(0.3, 0.3, 0.3, 1)` | Nav sibling dim | Harvey |
| `--g-ease-step` | `cubic-bezier(0.7, 0, 0.7, 0.7)` | Word wheel step | Harvey |
| `--g-ease-in-out` | `cubic-bezier(0.7, 0, 0.3, 1)` | Tab switch, crossfades | Harvey |
| `--g-ease-reveal` | `cubic-bezier(0.22, 1, 0.36, 1)` | Rows and hero items entering | Aside, x.ai |
| `--g-ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Exits (*provisional*) | |

| Duration | Value | Job | Source |
|---|---|---|---|
| `--g-dur-micro` | 100ms | Row and link hover | Vercel |
| `--g-dur-fast` | 150ms | Button and control colour, input borders, tooltips | x.ai, X Money, Vercel |
| `--g-dur-base` | 200ms | Menus and popovers in, icon turns | Vercel, X Money |
| `--g-dur-letter` | 250ms | Rotating-word letters, the drawn check | x.ai, X Money |
| `--g-dur-panel` | 300ms | Accordion, tab switch, dialogs, docked cards, folds | X Money, Harvey |
| `--g-dur-settle` | 300ms | Button hover settle | Harvey |
| `--g-dur-row` | 340ms | Rows entering | Aside |
| `--g-dur-dim` | 500ms | Sibling dim, media crossfade | X Money, Harvey |
| `--g-dur-step` | 600ms | One word-wheel step | Harvey |
| `--g-dur-headline` | 650ms | Per-word flip-up | X Money, x.ai |
| `--g-dur-reveal` | 800ms | Underline and line draws, dither reveal fade | x.ai |
| `--g-dur-count` | 950ms | Count-up | AI in Design |
| `--g-dur-tick` | 1100ms | Word-wheel period | Harvey |
| `--g-dur-shimmer` | 1400ms | One shimmer sweep, linear, only while live | X Money |
| `--g-dur-glint` / `--g-dur-cycle` | 3000ms | Glint sweep (linear, 400ms after a swap) / rotating-word period | x.ai |
| `--g-dur-timer` | 7500ms | Capability tab timer, linear | Harvey |
| `--g-dur-exit` | 120ms | Anything leaving (*provisional*) | |

Staggers: `--g-stagger` 55ms per headline word (after a 100ms lead), `--g-stagger-letter` 25ms per
rotating letter, `--g-stagger-row` 70ms per entering row. Press never scales (none of the five
reference sites does).

No springs, no overshoot, no bounce. Nothing idles, breathes, pulses or parallaxes; the swimmers
and the shimmer of Shallows (4.16) are the one ambient motion, and they glide rather than loop.
Only `opacity`, `transform`, colour and `background-position` (shimmer, glint) animate; never
`height`, `top`, `left`, margins, blur or `transition: all`. Since 2026-10-28 the hero's rotating
word no longer morphs its slot's `width`: the slot takes the new width at once and the line glides
to its new centre by a FLIP transform.

**Reduced motion** is the OS setting or the app's own (`setMotionPreference` in `motion.ts` writes
`html[data-motion="reduced"|"off"]`; "full" never overrides the OS). Both are honoured in CSS and
in components. Movement durations (`letter`, `panel`, `row`, `step`, `headline`, `reveal`,
`count`, `glint`) and every stagger become 0ms; colour and opacity changes stay (`micro`, `fast`,
`base`, `settle`, `dim`), as on every reference site. Headlines arrive by a 150ms fade with no
transform; the rotating word stops on its first word with a static grey rule and no glint; the word
wheel and tab timers stop advancing (the active tab shows a full rule); counters show their final
values; the shimmer becomes static fg-2; rows render in place; the pixel check appears whole;
loaders hold their static pattern; swimmers hold where they are and the shimmer stops; every
DitherField renders one still frame and owns no animation frame, and a field that reveals content
shows the content at once. Content is never hidden waiting
for motion.

### 3.9 Layout tokens

`--g-web-max 1200px`, `--g-web-gutter clamp(16px, 4vw, 40px)` (the website steps it to 16, 24
and 40px), `--g-app-column 720px`,
`--g-app-sidebar 264px`, `--g-app-header 44px`, `--g-app-panel 380px`.

---

## 4. Components

Primitives live in `graphite.css` as one class each, states inside `:where()`, so one app class
loaded later always wins. React components live in `@auracode/ui/graphite`.

### 4.1 Buttons (`.g-button`)

Pill, 14/20 500, gap 6, 1px transparent border. Heights: `.g-button-24` (padding 0 8, gap 4,
12/16; compact inline actions), `.g-button-28` (padding 0 12, gap 4), default 32 (0 14),
`.g-button-36` (0 16), `.g-button-44` (0 20, 15/20, gap 8; website CTAs). `.g-button-icon` makes
it square at radius 6. Colour changes settle over 300ms `--g-ease-settle`; pressing drops the
transition to 0. Hover rules apply only on `(hover: hover)`. The desktop app has no other button
class: every button, icon button and dialog close is `.g-button` with these modifiers.

| Variant | Rest | Hover | Pressed |
|---|---|---|---|
| Soft (default) | surface-3, fg-1 | surface-4 | surface-4 |
| `.g-button-primary` | `#EDEDED`, black label | `#FFFFFF` | `#D6D6D6` |
| `.g-button-outline` | transparent, 1px line-strong | border fg-4, fill surface-2 | surface-4 |
| `.g-button-ghost` | transparent, fg-2 | surface-3, fg-1 | surface-4 |
| `.g-button-danger` | red, black label; confirm dialogs only, one per dialog | `#FF7A7A` | |
| Disabled | surface-2, fg-4, `not-allowed`; a ghost stays unfilled; on a raised surface (dialogs, popovers, the dock, the composer, settings groups) surface-3 | | |

One primary per view. A split button joins a pill and a 28px chevron segment with a 1px divider
at `#D6D6D6`. Keycaps inside a primary take `#D6D6D6` with a `#222222` glyph.

### 4.2 Inputs (`.g-input`)

`.g-input`, `.g-select` (the same field with a 12px fg-3 chevron at right 12 and padding-right 32)
and `.g-textarea` are one field style: 36px, radius 8, surface-1, 1px line-strong, 14/20 400,
padding 0 12, placeholder fg-3, min width 0 so a field never forces its row wider. Hover border
fg-4; focus border fg-3 plus the focus ring; invalid (`aria-invalid="true"`) border red with the
reason under the field in 12/16 red; disabled border line, text fg-4. Textareas: height auto, min
72, padding 8 12, vertical resize. Website forms use 44px inputs (padding 0 16, 16/24). Labels
sit above in 14/20 500 fg-1, with help text under in 12/16 fg-3.

### 4.3 Segmented control and switch

`.g-segmented`: surface-3 track, 32px, padding 2, gap 2, pill. `.g-segment`: 28px, padding 0 12,
14/20 500 fg-2, hover fg-1. Active (`aria-pressed`, `aria-selected`, `aria-checked` or
`data-active`): a white pill with a black label (strong, SpaceXAI). `.g-segmented-quiet` makes
the active segment surface-1 with a 1px line-strong inset ring and fg-1 (Harvey). Colour 150ms.
In the desktop app the strong control sits on the 4px grid: a 36px track (an input's height) with
its 28px segments 4px in and 4px apart, in settings rows and dialogs alike; the picker's quiet
effort track is 32px with 24px levels (6.10).
`.g-switch` (a native checkbox with `role="switch"`): 32x18 track, 12px knob 3px in; off surface-4
with a line-strong ring and an fg-3 knob; on white with a black knob moved 14px over 150ms.

### 4.4 Chips, "New" and keycaps

`.g-chip`: 22px, radius 6, padding 0 8, surface-3, 12/16 500 fg-2, an optional 6px status square.
`.g-new`: 20px, radius 4, padding 0 6, volt on volt-tint, "New" in sentence case 12/16 500.
`Keycap` (`kbd.g-keycap`): 20px tall, min width 20, padding 0 5, radius 4, surface-3 with a 1px
line-strong inset ring, Geist Mono 11/16 500 fg-2. One keycap per key in a chord (`⌘` `K`), 4px
apart. Buttons, menus, cards and hint lines show keycaps wherever a key works.

### 4.5 Status: `StatusDot` and `PixelLoader`

`StatusDot` is a flat circle, never a glow: 6px default (4 to 32), tone neutral fg-2, volt, green
or red; decorative unless `label` is set, since the text beside it speaks. `live` swaps the dot
for the loader at twice the size (at least 12px) with the head in the tone.

`PixelLoader` is six square pixels in a 2x3 grid with a light walking the perimeter clockwise
(order 0, 1, 3, 5, 4, 2) and a two-cell trail: head fg-1 (or the tone), trail fg-3 then fg-4, rest
line-strong. Cells are `max(2, round(box / 8))` px with `max(1, round(box / 16))` gaps, on whole
pixels, `shape-rendering: crispEdges`. Steps flip with no tween: 130ms thinking, 110ms tool (six
steps make x.ai's measured 660ms dot-loader cycle), 90ms streaming, computed from absolute time so
every loader at a tempo lights the same cell at once. It draws from the shared frame clock
(`frameClock()`, one `requestAnimationFrame` for the whole app), writes the DOM only when the step
changes, and owns no frame while offscreen (IntersectionObserver), while the page is hidden, or
under reduced motion, where it holds step 0 (head top-left, trail below it).

### 4.6 Menus, popovers, tooltips, dialogs, toasts

- **Menu** (`.g-menu`): surface-2, 1px line-strong, radius 12, padding 4, `--g-shadow`, min width
  200. Items (`.g-menu-item`) 32px, radius 8, padding 0 8, 14/20 fg-1, a 16px icon in fg-3 when
  icons help; highlight surface-4 (hover, focus, `data-highlighted`); shortcut right-aligned
  (`.g-menu-shortcut`, mono 12/16 fg-3, or keycaps); separators 1px line with 4px margins; the one
  destructive item is red and grouped last; disabled items stay visible in fg-4 with a tooltip
  saying why. Groups use separators, never caps labels. Open over 200ms `--g-ease` (opacity, scale
  0.98 to 1, 4px from the anchor side); close over 120ms `--g-ease-in`. While open a menu owns the
  keyboard: arrows move, Enter picks, Esc closes and returns focus to its trigger.
- **Popover**: the menu's shell with padding 12 to 16 and radius 16 for richer content (agent
  card, plan card).
- **Tooltip** (`.g-tooltip`): surface-3, 1px line-strong, radius 6, padding 4 8, 12/16 fg-1, max
  280, the shadow, keycaps for its shortcut; 500ms delay, 150ms fade.
- **Dialog** (`.g-dialog` on a native `<dialog>`): three widths, sm 440 (the base), `.g-dialog-md`
  560 and `.g-dialog-lg` 760, each at most the viewport minus 32 (one 16px margin on every side, also
  for its height; long content scrolls the dialog); padding 24, surface-2, a 1px line-strong ring
  drawn inset (so the content starts 24px in, on the grid), radius 16, the shadow, scrim `rgb(0 0 0 / 0.72)`. `.g-dialog-header` holds the `.g-dialog-title` and a
  28px ghost icon close button; `.g-dialog-actions` is the action row. Sm for confirmations and
  one-field forms, md for forms and lists, lg for reviews, comparisons, terminals and the palette.
  Title 22/28 500 as
  a two-tone sentence ("Revert **turn 3** in **auracode**"), key-value rows on hairlines, one calm
  line in fg-2 about the consequence, buttons right-aligned: soft "Cancel" and one primary (or the
  red pill for destruction). Enters over 300ms `--g-ease-quint` (opacity, 8px rise); Esc and the
  scrim cancel.
- **Toast**: top centre of the pane, 12px under the header, 36px, radius pill, surface-3, 1px
  line-strong, the shadow, 14/20 fg-1 with an optional 500 action and keycaps ("Archived Fix the
  pacing test · Undo ⌘Z"). Solid, no blur. Enters 200ms (opacity, scale 0.96 to 1), stays 4s
  (held under the pointer), leaves 120ms. Undo replaces confirms for reversible actions.

### 4.7 Tables and rows

`.g-row`: min 44px, 1px line bottom, gap 12, `contain: layout style`. Table header 12/16 500 fg-3
in sentence case; rows 36px (44 two-line), 14/20, numbers right-aligned and tabular; no vertical
rules; hover surface-1 on the page or surface-2 in a pane; the selected row surface-4 with the 2px
rail. Long lists window (virtualise) and contain each row.

### 4.8 Code wells and inline code

`.g-well`: surface-1 on the page (bg inside a surface-1 pane, so it reads recessed), 1px line,
radius 8, padding 12 16, mono 13/20 in code text, no ligatures, tab size 2, horizontal scroll, no
wrap unless the setting turns it on. Header (32px, 1px line-faint under it): the file path in mono
12/16 fg-3 when known, and the `CopyButton` at right; no language label in caps. Token classes:
`.g-tok-keyword`, `-string`, `-number`, `-function`, `-comment`. Inline code: mono 0.9em fg-1 on
surface-3, radius 4, padding 2 4, at `--g-text-code-inline` (0.9em). File references (`pacing.ts:42`) are inline-code chips with a
10px arrow; clicking opens the file.

`CopyButton`: 24px, radius 6, padding 0 8, 12/16 500 fg-3, a 12px icon; hover surface-3 and fg-1;
"Copy" becomes "Copied" with a check for 1.2s only after the clipboard accepts the write, and a
refusal says "Could not copy. Select the text and copy it instead." in red.

### 4.9 Diffs

Inside a well: a 32px header with a 14px file icon, the path in mono 13 (folders fg-3, file name
fg-1, never cut), "+19" in green and the removal count in red in mono 12, five 6px diffstat squares
(green share, red share, rest surface-4, 1px gaps), "Open in Changes" and "Copy path" icon buttons.
Rows are 20px code: a 40px number column (fg-3, green or red on changed rows), a 16px marker
column, then the code over the line tint (`.g-diff-add`, `.g-diff-del`) with changed words on the
word tint. Fourteen rows show, then "Show 34 more lines"; gaps read "12 unchanged lines" in mono
12 fg-3 and expand on click. Hunk headers are 24px bands in `--g-diff-hunk`.

### 4.10 Terminal

A command's row is its block's header: the verb ("Ran", or "Running" with the shimmer) and the
command in mono 13 fg-1, a test summary in fg-3 ("19 passed"), status at right: running = loader
and elapsed "4s"; done = "4.2s"; opened and passed = a white check and "exit 0 · 4.2s"; failed = a
red square and "exit 1 · 2.1s" in red; stopped = a fg-3 square and "Stopped · 1.0s". Output uses
`.g-well-term` (12.5/18) in the ANSI palette, last 6 lines live while running, 12 visible with "Show
all 214 lines", warning and error lines on a full-width volt or red tint, a failed well with a 2px
red left edge. Secrets that look like keys render as "••••" with an eye toggle.

### 4.11 Structure

- **Hairline grid** (`.g-hairline-grid`): CSS grid with a 1px `--g-line` gap and border (Vercel's
  white 9% over its `#0A0A0A` page comes to the same `#1F1F1F`); cells paint the page colour, so
  lines appear between them. Lines may draw in once with `.g-draw-x` and `.g-draw-y`, rows 60ms
  apart, crosses fading in as their lines arrive (*provisional*: Vercel's grid is static).
- **Crosshair** (`.g-crosshair`): 21px "+" of 1px fg-3 lines with 10px arms (Vercel's `#878787`,
  measured); `-tl`, `-tr`, `-bl`, `-br` centre it on the grid's outer border (offset -11px);
  elsewhere place it at the intersection minus 10px.
- **Tile** (`.g-tile`): surface-1, radius 12, 1px line inset ring, overflow hidden; holds real UI
  rendered small (never a drawing of UI). In a `.g-dim-group`, hovering a tile dims the others.
- **Accordion** (`details.g-disclosure`): radius 12; the open item becomes a surface-2 well over
  300ms `--g-ease-quint`; summary padding 16 20, 500 fg-1, a 20px "+" that becomes a minus sign;
  body padding 0 20 18 in fg-2. Where a page animates the panel, it opens by `grid-template-rows`
  0fr to 1fr over 300ms quint with the content fading in, and the well slides from the old row to
  the new one as a shared element in about 270ms (X Money); reduced motion opens instantly.

### 4.12 Live text

- **Shimmer** (`.g-shimmer`): text painted by a 100deg band of solid greys (fg-3 from 0 to 38%,
  fg-1 at 50%, fg-3 from 62%; 250% wide) clipped to the text, `background-position` 100% to 0
  every 1400ms, linear, only while the label is live (X Money). The resting grey is fg-3 rather than
  X Money's 30% ink because our live labels carry words people read. Static fg-2 under reduced
  motion. One live indicator animates per row.
- **Glint** (`.g-glint`): the rotating word's underline (x.ai): a rule `max(2px, 0.05em)` tall
  (3px at 60px type), `max(3px, 0.066em)` below the word, fully rounded, in fg-4 (x.ai's 25% white).
  A solid volt band (8% of a 400%-wide image, about a third of the word) sweeps it once,
  `background-position` 150% to -150%, 3000ms linear, starting 400ms after mount; the rule then
  rests grey. Re-key the element on every swap to replay.
- **Rise** (`.g-rise`): per word, opacity 0 and `perspective(1200px) translateY(45%)
  rotateX(-40deg)` to rest, `backface-visibility: hidden`, 650ms `--g-ease-quint`, delay 100ms plus
  `--g-rise-index` times 55ms (X Money and x.ai). At most ten words per heading so it settles within
  1.2s. Reduced motion: a 150ms fade with no transform. Used once per heading, on first view.
- **Enter** (`.g-enter`): rows and cards appearing: opacity and an 8px rise, 340ms
  `--g-ease-reveal`, `--g-row-index` times 70ms apart (Aside), once, at 10% visibility. Reduced
  motion: rendered in place.
- **Draw** (`.g-draw-x`, `.g-draw-y`): a line scaling in from its start with opacity, 800ms
  `--g-ease-out`, after `--g-draw-delay` (x.ai's underline draw: 800ms after 800ms on load).
- **Dim** (`.g-dim-group`, `.g-dim-text`): hovering one child dims its siblings, tiles to 0.5
  opacity over 500ms `--g-ease-smooth` (X Money), nav text to fg-3 over 300ms `--g-ease-soft`
  (Harvey).

### 4.13 `AgentMark`

Replaces `OrbitMark` with the same props (`agent`, `state?`, `size?`, `label?`, `ghost?`,
`className?`), so call sites swap by name. A square tile: surface-3, 1px line-strong inset ring,
radius `max(3, round(0.22 * size))`, size clamped 12 to 256 (24 when invalid). **State takes the
glyph's place**; the agent's name always sits beside the mark.

| State | Inside the tile |
|---|---|
| idle | The agent's two-letter code in Geist, fg-2, at every size (one letter would make Claude Code and Codex both C): `0.5 * size` under 24px, never under 7px, and `0.38 * size` from 24px; a one-character code ("?") at `0.56 * size`; weight 500, or 600 below a 12px glyph |
| thinking, streaming, tool | The 2x3 pixel loader (4.5) at its state's tempo |
| waiting | A solid volt dot, `0.375 * size` across (parity-adjusted to centre on whole pixels) |
| done | A white pixel check (cells `max(2, round(size / 8))`), drawn once a pixel at a time, 50ms apart (about 250ms, X Money's check), by CSS |
| error | A solid red dot, same geometry as waiting |
| ghost (any state) | Transparent tile, 1px dashed line-strong outline, the code in fg-3 (it is text, so it keeps AA contrast) |

Codes: CC Claude Code, CX Codex, PI Pi, MP oh-my-pi, AG Antigravity, HM Hermes, CU Cursor, GB
Grok Build, OC OpenCode; any other agent takes the first two letters of its id; an empty or
generic id shows "?" (`agentCode()`). Root: `span.g-agent-mark[role="img"]` with `aria-label`
"Claude Code, waiting for approval" (from `ORB_STATE_LABELS`, or `label`), `data-agent` (the brand
id, "generic" for unknown), `data-state`, `data-ghost`. No canvas. Idle, hidden, offscreen and
reduced-motion marks own no animation frame; the check uses no frame at all. Volt and red differ
in luminance as well as hue (17.9:1 against 6.9:1 on black), and the label and the words beside
the mark always say the state.

Sizes in use: 14 (composer pill, event chips), 16 (header, bylines, live gutter, pickers, menus),
24 (onboarding roster, New chat, library), 32 (Agents, settings), 48 (settings), 56 (empty
state).

### 4.14 `Logo`, `Wordmark` and the app icon

The logo is a sea lion and a sea turtle in silhouette, the owner's artwork
(`docs/design/brand/logo-source.png`, replaced the pixel "a" on 2026-10-27). It was traced into one
even-odd path in a 546 x 557 box (`LOGO_PATH`, `LOGO_VIEWBOX` in `logoPaths.ts`); the holes are the
eyes and the gaps between the animals. It is always one solid colour: fg-1 (or fg-2 where it is
secondary) on black, never volt, never outlined, never on a gradient.

`LOGO_SMALL_PATH` is the same shape traced with wider gaps and larger eyes. `Logo` draws it at 24px
and below, and the raster favicons use it up to 32px, because the full logo's gaps close at those
sizes.

`Logo` draws the path in `currentColor` inside a square box of `size` px, decorative unless
`label` is set.

`Wordmark`: "auracode" as real text in Geist 600, tracking -0.035em, after the logo at
`round(1.25 * fontSize)` px (20 at 16px type, 40 at 32), centred on the text, gap 0.375em, fg-1.
In a nav link it names the link.

App icons come from `apps/desktop/scripts/app-icons.mjs` (`pnpm --filter @auracode/desktop
icons`):
- **macOS:** the logo at 560px on a black body inset 100px in the 1024px canvas (radius 185, a
  4px #2e2e2e ring), following the macOS grid.
- **Windows (`icon.ico`):** the small variant at 800px on a full-bleed tile.
- **Tray:** a 32px tile on Windows, and a 36px black template image on macOS.

`logoSvg({ size, padding, color, background, radius })` writes the same tile as a standalone SVG.
The website builds:
- `favicon.svg`;
- `favicon.png` (32px);
- `apple-touch-icon.png` (180px);
- `og.png`, a 1200 x 630 social card: the lit water of Shallows with a turtle and a seal, and the
  logo in fg-1 at the centre.

### 4.15 `DitherField`

No longer the brand surface (2026-10-28): Shallows (4.16) replaced it. The website does not use or
ship it; the app keeps it on its first-launch intro and onboarding until its Shallows branch lands,
and the component stays in `@auracode/ui` until nothing uses it.

The signature: a live ordered dither of an evolving field, on a 2D canvas (no WebGL).

**Rendering.** The canvas holds one pixel per cell and is scaled up with `image-rendering:
pixelated`. A cell is `cell` CSS px (default 4), snapped to whole device pixels
(`round(cell * devicePixelRatio)`), and the canvas is sized to whole cells, so the upscale never
makes uneven cells; past 240,000 cells the cell grows. Each frame:

1. **Field.** Seeded 3D value noise (quintic, 256-cell lattice), fbm of 4 octaves rotated about 37
   degrees and scaled 2.03 per octave so no lattice shows, domain-warped by two 2-octave fbm lookups
   (strength 2.4). Base wavelength 420 CSS px; sampled every 4 cells and interpolated, because the
   field is deliberately smooth and the dither supplies the texture. Time moves the third axis at
   0.03 units a second plus a slow drift, so forms fold and travel without churning.
2. **Shape.** `density` (default 0.5) sets the floor `0.74 - 0.36 * density`; above it a smooth
   ramp of 0.24 reaches full; the result is posterised into 4 plateaus with soft 20% edges, so the
   field reads as drawn areas of tone with patterned transitions rather than fog. About two thirds
   of a default field is black.
3. **Dither.** Bayer 8x8 thresholds quantise each cell to black plus the palette's greys
   (`standard` by default; the palettes are in 3.1).
4. **Volt.** Where the unlensed field passes 0.72, a fixed per-cell hash below `accent` (default
   0.02) lights the cell volt: a few dozen pixels on a hero, appearing as peaks pass over them like
   lit sensor pixels. Never from the lens, never on image targets, a fifth as often inside text and
   grid targets.

**Props.** `className`, `style`; `children` (real content under the field); `cell` 4; `speed` 1
(0 holds); `density` 0.5; `edges` 0; `ceiling` 1; `accent` 0.02; `interactive` false; `target`;
`progress` (0, or 1 when only a target is set); `reveal` false; `order` "scatter"; `palette`
"standard" (or 2 to 4 greys); `transparent` false (black cells clear, to layer over a surface);
`clearing`; `fallbackSrc`; `still` false; `seed` `0x6a09e667`; `fps` 30; `sprites` (none); `label`
(otherwise `aria-hidden`).

- **Lens** (`interactive`, fine pointers with hover only): within 120 CSS px of the pointer the
  field develops: the floor drops by up to 0.16 and contrast rises by up to 60%, both falling off
  with the square of distance; the lens eases toward the pointer and fades out when it leaves.
- **Target**: `{ kind: "text", text, fontFamily, fontWeight 600, fontSize | "fit", tracking
  -0.06em, align, anchor, inset, texture 0.25 }`, `{ kind: "image", src, fit "cover", texture 0 }`
  (same-origin images; luminance lifted by a 0.6 gamma so dark UI keeps texture; a tainted image
  leaves the field as noise and still reveals), `{ kind: "grid", rows, scale }` (a pixel grid,
  crisp at any size), or `{ kind: "path", d, viewBox, height 0.6, align, anchor, inset, texture
  0.2 }` (one even-odd SVG path such as `LOGO_PATH`, `height` a fraction of the field's height,
  capped by its width). Text waits for its font to load and redraws.
  `texture` lets the live field shade the resolved target.
- **Dissolve** (`progress` 0 to 1): each cell leaves the field when progress passes its threshold:
  half a per-cell random value, half a slow noise, so pixels go in ragged islands rather than as
  salt and pepper; `order` "down", "up" or "radial" adds a direction. Cells crossing the front
  flash one step brighter for 2.5% of progress.
- **Reveal**: with `reveal`, at progress 1 the canvas fades out over 800ms `--g-ease-out` and stops
  drawing, showing `children`; it returns if progress drops. Under reduced motion it reveals at
  once.
- **Clearing**: an ellipse in fractions of the field (`{ x 0.5, y 0.5, rx, ry }`), or a list of them
  that multiply, where the field thins to black a pixel at a time, so a headline set over it stays
  readable.
- **Edges** (0 to 1): the floor rises by up to 0.12 in the middle and falls by up to 0.2 at the left
  and right edges, so the field gathers at the sides of a centred layout.
- **Ceiling** (0 to 1): the brightest the field itself may get. Below 1 its plateaus dither between
  the top two greys instead of filling solid; sprites keep the full range and read against it.
- **Sprites** (opt-in, none by default): small luminance grids with 2 to 4 frames (`.` empty, `0`
  to `9` ninths of full brightness), drawn into the field's luminance before the threshold, so they
  dither in the same cells and greys as the noise. Each drifts in CSS px a second with an optional
  sine bob, a lazy roll and a 1-cell black moat, travels fully off one side before entering from the
  other, mirrors when swimming left, eases away from the lens, fades to black inside a clearing and
  never lights volt. They ride the field's clock: frozen in place under reduced motion or `still`,
  paused whenever the field pauses.

**Performance.** Draws from the shared frame clock, at most `fps` (30) times a second, only while
the field intersects the viewport (64px margin), the page is visible, motion is allowed, `still`
is off and it is not revealed; otherwise it renders single frames on demand (resize, target or
progress change). Measured: about 2.5ms a frame in Chromium and 4.9ms in WebKit for a 1440x720
hero at 4px cells, lens and clearing included.

**Server, no JS, no canvas.** Server rendering emits the wrapper, the optional fallback `<img>` and
an empty canvas, touching no browser API. The fallback shows until the first frame lands and stays
if the canvas is unavailable. For a field without a target, `renderDitherFrame({ cols, rows,
cellPx, seed, density, accent, edges, ceiling, clearing, overlay })` (clearing in cells, time 0,
the overlay from `paintSprites`) renders the identical first frame in Node, sprites included, so a
build step can write the fallback PNG at one pixel per cell and the hand-off is seamless. With
`children` and no scripting, the field steps aside (`@media (scripting: none)`). Give the field a
size; it fills its box.

### 4.16 Shallows, `Swimmers` and `Creature`

The brand surface since 2026-10-28 (owner decision, direction B of three concepts): the sea seen
from below. One rounded panel lit from the top like the water's surface, and seals and turtles
passing above as dark silhouettes. It replaced the dither field (4.15), which the owner found
messy, and the pixel sprites that glitched under the pointer.

**`Shallows`** (`as`, `shimmer`, `depth`, and any HTML attributes). One panel, radius
`--g-shallows-radius` 28px (`--g-shallows-radius-compact` 20px on phones), `overflow: hidden`,
and a single vertical falloff over `--g-shallows-depth` (default the panel's height):
`--g-water-surface` #1E1E1E, `--g-water-shallow` #161616 at 24%, `--g-water-mid` #0D0D0D at 50%,
`--g-water-low` #080808 at 76%, `--g-water-deep` #050505. A soft light at the top centre
(`--g-water-light`, white at 4.5%) and a 1px rim (`--g-water-rim`, white at 5%). No texture, no
noise, no lines. `shimmer` adds one layer of caustic light near the surface (`--g-water-caustic`,
white at 2.8%) that drifts 3% and scales 1.06 over 26s, alternate, transform only; it stops under
reduced motion. Direct children sit above the light and the swimmers (`z-index: 1`, overridable).
A quieter panel overrides the water tokens locally, as the website's capabilities panel does.

**`Creature`** (`kind` "seal" or "turtle", `size`, `small`, `facing`, `label`). Flat silhouettes in
the logo's language: a body with its flippers, head and tail set off by an even gap, and one eye
hole on the seal. A harbour seal from the side (`SEAL_VIEWBOX` 320 by 130: round head, short
muzzle, a slight neck, a plump body, one fore flipper, the hind flippers fanned into a V with
dented ends) and a sea turtle from below (`TURTLE_VIEWBOX` 240 by 220: a teardrop shell, a round
head, long sickle front flippers swept back, short paddle rear flippers, a stub of a tail). Each is
one even-odd path of absolute M, C and Z commands, generated from splines through hand-placed
points (`creatureGeometry.ts`, `scripts/creature-paths.ts`), so the gap is exact at any size. At
64px and below the small variants (gaps of 9 and 10 units instead of 4 and 5, a larger eye) keep
the shapes open. `currentColor`, decorative unless labelled.

**`Swimmers`** (`swimmers`, `still`, `giveWay`, `className`). Fills its parent under the content and
takes no pointer events. Each `SwimmerSpec` anchors a creature by fractions of the layer (`x`, `y`)
with a CSS width (`size`), `depth` 0 to 1, `heading`, `speed`, `phase` and `tilt`.
- **Path.** Cruising at an eased speed: a turtle surges 42% on each 5.6s stroke and glides between
  strokes (9px a second), a seal swims more evenly (18% over 3.4s, 15px a second). Two slow sines
  sway it 7 to 9px and drift it 5 to 6px; it pitches 30% of its path's slope (under 7 degrees). It
  swims fully off one side, plus 32px, before it reappears on the other.
- **Depth.** Near creatures are `--g-shade-near` #080808; far ones mix toward `--g-shade-far`
  #121212 and soften by up to 2.4px of blur, painted once at raster time. The one blur in Graphite.
- **Performance.** Transform only (`translate3d` and `rotate`) on a `will-change` layer, from the
  shared frame clock, so the compositor moves raster that never repaints. The clock runs only while
  the layer is on screen (64px margin) and the page is visible; a step is capped at 50ms so nothing
  jumps after a hitch or a hidden tab. The server renders each creature at its anchor, and the first
  live frame is the same frame. Measured on the website (Chromium, 1440 by 900): 0 frames over 25ms
  while idle, sweeping the pointer across the creatures, scrolling and switching capabilities.
- **The pointer.** Hover never flickers and never changes layout. With `giveWay` (default, fine
  pointers only) a creature eases out of the pointer's way through a smooth field, read from the
  layer's parent: zero under the pointer and far from it, at most 22px, eased over a 0.9s time
  constant, so it can never snap or flip sides.
- **Reduced motion and `still`.** No clock at all: creatures hold where they are.

---

## 5. Website composition (auracode.si)

Since 2026-10-28 the home page is built in Shallows (4.16). It follows the anatomy of the reference
landing pages (5.10): few sections, one idea each, big type, a lot of black, every section as clean
as Vercel's. Four sections and a footer:

| Section | Built from |
|---|---|
| Hero and product (5.3) | x.ai's centred hero and Aside's hero panel, as lit water |
| Capabilities (5.4) | Harvey's timer tabs, in a Shallows panel |
| FAQ (5.5) | Vercel's FAQ |
| Closing panel (5.6) | Aside's closing panel, as lit water |
| Footer (5.7) | Vercel's footer, minimal |

The film card, its Play and Pause button, X Money's staggered tiles and the giant dithered footer
logo were removed on 2026-10-28 at the owner's request.

### 5.1 Page, type and rhythm

Black page, `.g-root` on `<html>`, body 16/24. One content column: 1200px with a 40px inset, so
1120px of content from 1024px up; gutters of 16, 24 and 40px (3.9). The hero panel spans the page,
inset 12px from the viewport (8px on phones, `--edge`) with 28px of inner padding (20 on tablets,
12 on phones, `--panel-pad`); the capabilities and closing panels sit on the column. Sections are
separated by space: 160px on desktops, 128 on tablets and 96 on phones. Only the FAQ draws
hairlines. Headings sit 56px above their content on desktops (48 and 40 below). Prerendered and
whole without JavaScript: swimmers render at their anchors and stay still, the capabilities panel
shows its first row, the FAQ opens natively, and the entrances are CSS gated on `.js`.

Type uses the website scale: the display at 72px on desktops, 56 on tablets and 36 to 40px on
phones (`clamp(36px, 11.25vw, 40px)`, so "One window for" fits at 320px); one heading size, 40px,
two-tone (the statement in fg-1, its continuation in fg-3 on its own line); one lead, 18/28 fg-2.
Status dots on the site are circles.

### 5.2 Nav

64px, sticky, edge to edge like Vercel's, its content on the hero panel's inner edges (40px from
the viewport on desktops, 32 on tablets, 20 on phones). It rests transparent on the hero's water at
the top of the home page and turns black once the page scrolls, over 300ms, with no rule under it.
Left: `Wordmark` 16 linking home. Right: Changelog and Sign in as 14/20 500 fg-2 links (hover fg-1;
the sibling dims, Harvey), then the one primary "Download" pill, magnetic (5.8). Under 768px the
links fold into a menu built on `<details>`; Download stays in the bar.

### 5.3 Hero

One `Shallows` panel with `shimmer`, pulled up under the nav so its top sits `--edge` below the
viewport's top, its light falling off over 760px. Its water layer is 640px tall (380 on phones):

- a turtle at 16% across and 40% down, `clamp(112px, 17vw, 252px)`, tilted -10 degrees;
- a seal swimming left at 80% and 28%, `clamp(150px, 23vw, 336px)`;
- a far turtle (depth 0.7, 6px a second) at 72% and 66%, hidden on phones.

Centred over the water, 172px below the panel's top (140 on phones):

- **Headline**: "One window for" / "Claude Code." The agent name rotates every 3000ms through every
  designed agent: the old letters rise 0.23em and fade, last first, 15ms apart over 250ms; the new
  name arrives 25ms apart; the slot takes the new width at once and the line glides to its new
  centre by a FLIP transform over 450ms `--g-ease-out`. No underline and no glint. The heading's
  accessible name is "One window for your coding agents". Reduced motion: no rotation.
- **Lead** (18/28 fg-2, max 540, 28px under): "The coding agents you already use, together in one
  chat on your machine. Free, with nothing to sign up for."
- **One button** (36px under): the magnetic primary 44 "Download".
- **Product** (88px under, 56 on phones): the real app (a captured screenshot, WebP sources, real
  alt text), up to 1120px wide at 16:10, radius 16 (12 on phones), a white 8% ring and one long soft
  shadow, with 96px of deep water below it (40 on phones).

**Entrance** (gated on `.js`): the light fades in over 1400ms; the headline's words rise
(`.g-rise`, 650ms, 55ms apart from 120ms); the lead and the button rise 12px and fade in (700ms, at
480 and 600ms); the swimmers fade in over 2400ms from 240ms; the product rises 40px from 0.985 over
1200ms at 720ms. Where scroll-driven animation runs, the screenshot settles from 1.05 to 1 as it
scrolls in. Reduced motion: everything present at first paint, the words by a 150ms fade.

### 5.4 Capabilities (Harvey's timer tabs)

Two-tone heading, centred: "Built for long turns." / "And for changing your mind." Then one
`Shallows` panel on the column, quieter than the hero's (radius 24, its water from surface-3), at
least 600px tall, with one seal drifting low at left.

- **Rows** (left, 380px): six one-line rows, 16/24 500, fg-3 (hover fg-2, active fg-1): "Your
  agents, as they are", "Switch agents mid-chat", "A checkpoint every turn", "Full auto by
  default", "Queue and steer", "Several chats at once". Under the active row a 2px timer fills over
  6.5s, and the next row takes over when it is full. Under the rows, the active row's one sentence
  cross-fades (14/22 fg-2).
- **View** (right): one inset window of the app (#050505, radius 16) built from tokens at the app's
  own sizes: the agent picker; a chat handed from Claude Code to Codex; a turn with its diff and a
  checkpoint to restore; the autonomy menu over the composer; a running turn with a message queued;
  five chats with circular status dots, the one that needs you in volt.
- **Motion**: the old view clears in 200ms; the new one rises 14px from 0.985 and fades in from
  120ms (460ms opacity, 820ms transform `--g-ease-out`). Hovering, focusing or clicking a row shows
  its view at once and holds the cycle, the active row's rule full, while the pointer or focus stays
  in the panel. The cycle also holds off screen, in a hidden tab and under reduced motion.
- **Access**: the rows are a tab list with automatic activation (arrow keys, Home, End); each tab's
  panel is its sentence; the views illustrate it and are hidden from assistive technology.

Tablets and phones stack the rows, the sentence and the view (520px tall, 460 on phones).

### 5.5 FAQ (Vercel)

The two-tone heading "Questions, answered." / "Before you install." and a quiet "Privacy notice"
link at left, over 4 of 11 columns; six questions at right on hairlines (`--g-line`), 68px rows,
summary 16/24 500 fg-1, a 12px plus whose upright turns flat as its answer opens (300ms, fg-3 to
fg-1). Answers 16/26 fg-2. All closed on load and one open at a time, built on `<details>`, so every
answer opens without JavaScript. An answer opens by `grid-template-rows` over 300ms
`--g-ease-quint` while it fades in, the site's one layout animation. "Nothing to sign up for" is
answered here and in the hero lead; the invitation-only accounts are answered here.

### 5.6 Closing panel

One `Shallows` panel with `shimmer` on the column, a turtle and a seal crossing it slowly: the
two-tone "Your agents." / "Your machine.", one line "Free for Windows and macOS. No account needed."
and the magnetic primary 44 "Download". 148px above the words and 140 below (112 and 104 on
phones).

### 5.7 Footer

The wordmark at left and three link columns at right (Product, Account, Legal; headings 14/20 500
fg-1, links 14/20 fg-3, hover fg-1), 160px wide; no rules and no giant art. Legal ends with
Notices, the generated third-party notices. Phones put the columns under the wordmark, three equal
columns.

### 5.8 Motion on the site

- **Reveals**: blocks rise 16px and fade in once, at 12% visible (700ms opacity, 900ms transform,
  `--g-ease-reveal`, 80ms apart via `--i`).
- **Magnetic pills**: the nav, hero and closing Download lean up to 6px across and 4px down toward
  the pointer, their label 60% further, following with a 0.12s time constant and settling back over
  0.34s. Transform only, so layout never moves; fine pointers only; off under reduced motion.
- **Hover**: links, rows and icons change colour over 150 to 300ms; buttons settle over 300ms.
- **Budget**: only transform and opacity animate, plus the FAQ's disclosure. Measured in Chromium
  at 1440 by 900 on the built site: 0 frames over 25ms while idle, sweeping the pointer over the
  swimmers, hovering the magnetic button, scrolling the page and switching capabilities; no long
  tasks; 14ms of layout and 52ms of paint over the whole run.

### 5.9 Inner pages

- **Download** (x.ai's "Choose how to get started"): two-tone title "Download auracode." / "Free,
  local, no account.", one lead line, two recessed cards (surface-1, radius 16, 16px apart), one
  per platform: name, architectures, spec rows on hairlines, and the action. "Before you install"
  keeps the two safety paragraphs. Linux is not offered.
- **Sign in, sign up**: a centred 480px column; the two-tone title ("Sign in." / "With a one-time
  code.", and "Invited sign-in." / "Your invitation starts here."), one line about access and the
  form in one recessed panel. One action per step.
- **Verify device**: framed by the desktop app at 190px, with no nav, footer or skip link.
- **Account**: settings groups separated by space in a narrow column; device and security lists
  keep their row rules; device status dots are circles.
- **Legal** (privacy, terms): 680px column, prose headings separated by space, body 16/24 fg-2.
  Third-party notices is generated plain text from the build.
- **Changelog**: one entry per release: the date and status at left, notes as prose.
- **404**: one `Shallows` panel with a turtle crossing it, the numerals "404" at up to 200px, the
  two-tone "This page does not exist." / "It may have moved." and a primary 44 "Go home".
- **Social card** (`og.png`, 1200 by 630): the lit water with a turtle and a seal and the logo in
  fg-1 at the centre, rendered at build time from the paths.

### 5.10 The landing-page study

Captured 2026-10-27 at 1440 and 390 (`target/design-research/landing/`; x.ai from the 2026-10-26
scroll frames and Mobbin, since it blocked automation). What the five pages share, and what we
took:

- **x.ai**: hero (centred 60px two-line headline, 18px lead, two pills, the product tiles 80px
  under), a developer split section, stats, news cards, two plan cards, footer (brand and
  copyright at left, link columns at right). About 160 to 270px between sections, 1232px column.
- **X Money**: eight blocks in about 6,160px: centred 48px hero with one product image, one line
  and one small pill; three two-tone feature sections; the six staggered tiles; the FAQ; footnotes;
  a footer of link columns over a giant outline wordmark. 80px above and below a hairline between
  sections, 1120px content, 13/20 captions.
- **Harvey**: split 72px serif hero with one CTA and a product frame; a logo wall; two cards; a
  launch section; tabs; testimonials; video cards; stats rows; security rows; a one-line closing
  bar with one CTA; footer columns. About 140 to 160px between sections.
- **Aside**: centred 48px hero, one download pill, the product in a sky panel; a lead-in paragraph;
  three captioned cards per feature section; benchmark bars; a closing panel with a two-line 44px
  statement and one download pill; footer columns over a hairline. About 120 to 140px between
  sections.
- **Vercel**: split 64px hero with two pills; a logo strip; two case-study sections with
  two-tone side copy; about 200px between sections and a dense footer of columns.

The common anatomy: one centred or split hero with at most two actions and the product right
under it, then a handful of single-idea sections each with one heading and one visual group, a
closing call to action and a quiet footer. We cut what none of them needs twice: the triptych, the
strip and the giant numerals of the earlier home page, and the hero's second button.

---

## 6. App surfaces

Measured in a 1440x900 window. Every behaviour from the Orbit spec carries over; only the
treatment changes.

### 6.1 Window and titlebar

The window is `--g-bg` (the native window is painted black, no vibrancy, no Mica). The sidebar sits
on it with no fill. The main pane is surface-1, radius 12, 1px line ring, inset 8px from the
window's top, right and bottom and from the sidebar; with the right panel open the main pane
narrows and the panel pane (surface-1, 380 wide, 320 to 560 by dragging the 8px gutter, arrow keys
in 20px steps while it has focus) sits 8px to its right. The top 52px is the drag region; macOS
traffic lights at x 18 to 70; Windows caption buttons are 46x52 hit areas with 10px fg-2 glyphs,
hover surface-3, close hover red with a black glyph. No title text in the band. Under 880px of chat
width the panel floats over the chat with the shadow.

### 6.2 Sidebar

264px, 12px insets, rows 240 wide, Grok's order. Every row's icon or square starts at x 20 and its
words at x 44; rows sit 4px apart. One row style: 14/20 fg-2 at rest, a surface-2 fill and fg-1
under the hand, surface-3 while pressed.

1. Band (52px, drags the window): only the 28px collapse toggle at the right (⌘\), Grok's; the
   band's left stays empty for the macOS traffic lights. The logo lives in the footer.
2. Utility rows (32px, radius 8): Search (⌘ K) and New chat (⌘ N) with 16px fg-3 icons. Their
   keycaps show only while the row is under the hand or the keyboard.
3. **Needs you** (only while a chat waits): "Needs you" in 14/20 500 fg-2 with the count in volt.
   Rows: a 6px volt square on the project squares' axis, the title in fg-1 and " · project" in fg-3
   as one run. Clicking opens the chat on its card.
4. **Projects**: "Projects" in 14/20 500 fg-3 with a chevron that folds the section, and New
   project (a 24px plus) at the label's end while the section is under the hand. Project rows 32px
   with a 6px square in fg-3, the name 14/20 500 fg-1, a chevron on hover (rotates 90 degrees
   open). No counts. A folded project shows its chats' state at its end: volt square, loader, or
   red square. "Archived chats" ends the list as a quiet fg-3 line (Grok's "See all").
5. **Chat rows** (32px, text inset 32, under the project name): title 14/20 fg-2 (fg-1 500 when unread or active). Trailing
   slot: idle, the relative time in mono 12 fg-3 ("4m", "Tue"); running, the loader and elapsed
   time with the title in fg-3; needs approval, a volt square and "Needs you" 12/16 500 volt; done
   and unseen, a white 6px square and the time; failed, a red square and "Failed" in red. The active
   chat is surface-3 with a 1px line-strong ring, radius 8. Hover (or an open row menu) swaps the
   trailing slot for archive and more icon buttons (24px). Archive acts at once with an Undo toast
   (⌘Z); Delete asks in a dialog. ⌘⌫ archives the open chat unless the caret is in text. Arrow
   keys move a surface-4 row with the 2px rail; Enter opens. "Show 12 more" in fg-3 ends long
   lists.
6. **Footer** (44px, Grok's calm foot, owner decision 2026-10-28): the 24px logo (fg-1) at x 20
   and one 28px ghost Settings button (16px gear, fg-3) under the band's toggle, with Graphite's
   tooltip "Settings (⌘ ,)". Nothing else: no agent tiles, no profile row, no status text. Agents
   live on the Agents screen (Settings and the palette's Open agents), profiles and sync on
   Settings' Account page, Diagnostics in the palette. One exception says where to look: an account
   whose sync is paused or failing puts a 6px fg-1 dot on the button's corner, cut out of the black,
   and the button's name says why ("Open settings, sync paused · 3 pending").

Collapsed rail: 72px (⌘\ or the toggle): the toggle, then Search and New chat as 32px icon rows,
and Settings at the foot; the logo and the projects step aside until it opens again.

### 6.3 Chat header

44px, padding 0 8 0 16, Grok's restraint: at most three controls. Left: the chat's live `AgentMark`
(16), 8px, the title 14/20 500 fg-1 (truncates at 420), the project in fg-3, then the status only
when it says something (working, "Waiting on you" in volt, failed or a sign-in in red); Ready and
Stopped stay for screen readers. Right (gap 4): the Changes panel toggle (28px ghost, surface-3
while open, ⌘ J) and the chat menu (28px). The menu (288px, plain 32px rows in groups on hairlines)
starts with the session's facts (agent, the version that runs, its path, context and cost), then
Git workspace, Show or Hide terminal (with its keycaps, 6.22), Open in editor, Conversation history;
Export chat, Copy debug bundle, Show log;
and the session's lifecycle last (Stop, or Resume and Start fresh). The command palette offers every
one of them by name. No border at rest.

### 6.4 Transcript

Column 720 max, centred, 24px under the header; bottom padding is the composer height plus 32.
**The gutter**: every agent line starts on a 24px gutter; icons, chevrons, `$` and the live
`AgentMark` (16) centre on x 12, words start at x 24, so a live line handing over to the next keeps
the mark and the words in place, and every row lands on the 4px grid (`check-layout.mjs`).

- **User message**: Grok's right-aligned block, max 82% of the column, surface-3, prose 15/24 fg-1,
  padding 12 16, one even radius 16, no ring. Over 10 lines it clamps with "Show all" (12/16 500
  fg-2, underlined). A steer adds its delivery state in 12/16 fg-3 under the block. Attachments:
  24px chips and 48px image thumbnails. Hover shows edit and copy (28px icon buttons) at its left,
  centred on the first line.
- **No byline**: like Grok, nothing names the agent above its answer; the header's mark and the
  composer's chip say who answers, and screen readers hear the name where the agent's part begins.
- **Prose**: bare on the pane, 15/24 fg-1, measure 600px, paragraphs 12 apart; h1 to h3 16/22 600
  (16 above, 6 below); bullets are 4px squares in fg-3, 18px indent; numbered items in fg-3 tabular;
  an item opening with a bold run keeps the run fg-1 600 and the rest fg-2 (Grok). Links fg-1 with a
  1px fg-4 underline 3px below (fg-1 on hover). Blockquotes: 2px line-strong left rule, fg-2.
  Tables per 4.7 at 14/20. Horizontal rule: the tear line.
- **Code blocks**: wells (4.8) at the full column, internal scroll past 420px.
- **Thinking**: collapsed, a 24px line with a 12px chevron in the gutter and "Thought for 6s" in
  14/20 fg-3 (the number tabular), or the agent's summary "Thought about the pacing math · 6s".
  Live: "Thinking" with the shimmer and " · 4s" ticking once a second, the live mark in the gutter;
  a live thought stays open until the next item arrives, then folds. Open: 14/20 fg-2 behind a 1px
  line spine on x 12, max 280 tall with internal scroll, 576 wide. Folds animate opacity and a clipped
  `transform` over 300ms `--g-ease-quint`; reduced motion, an instant fold.
- **Tool rows** (28px): a 14px icon in fg-3 in the gutter (read file-text, edit file-pen-line,
  write file-plus, delete file-minus, search search, glob folder-search, execute square-terminal,
  fetch link, subagent git-fork, MCP plug, other wrench); the verb 14/20 fg-2, the object in mono
  13 fg-1, a result in fg-3 ("42 lines", "no matches", "19 passed"), the duration in mono 12 fg-3 at
  right or the diffstat for edits. Hover surface-2 (radius 6) and a chevron; rows 4px apart.
  Running: the present progressive with the shimmer ("Reading"), the live mark in the gutter, the
  loader and elapsed time at right; a call that waited on you times from the answer. Groups: two
  or more consecutive calls fold into "Read 2 files, searched 1 pattern" with a chevron and the
  total; opened, children stack on a 1px line spine; finished turns fold every group. Opened call:
  a well under the row (margin 4 0 8 24) with key-value rows (22px; label 12/16 fg-3 in an 88px
  column, value mono 13 fg-1). Denied: text struck through in fg-3 inside a 1px dashed line-strong
  outline, "Denied" at right. Failed: a red square and "Failed" (or "exit 1") in red; the well opens
  itself.
- **Diffs** (4.9), **terminal** (4.10). **Search results**: 28px rows in a well, path in mono 13
  (folders fg-3), ":42" fg-3, the line in mono fg-2 with the match on surface-4 in fg-1; eight rows
  then "12 more". Web results show monochrome favicons.
- **Subagents**: "Spawned 3 subagents" with "2 running" and the loader; child rows (26px) on the
  spine: git-fork icon, task 14/20 500 fg-1, type fg-3, a 20px model chip, and a status at right:
  live StatusDot and "Running", "Done 3m 15s" in fg-2 with a white check, or "Failed" in red.
- **System events**: centred 28px lines in 12/16 fg-3 with entity chips (a 14px `AgentMark` and the
  name in fg-1 500; commands in mono fg-2): "Switched to Codex", "Full auto from here", "Reverted
  turn 3 · checkpoint 7f3a2c19", "Allowed once · cargo test -p aura-drivers · 0:09" logged right
  before the row it let through.
- **Now-row**: fills the gaps where nothing else is live: the live mark in the gutter and
  "Thinking" with the shimmer and " · 4s"; waiting, a volt mark and "Waiting on you · 0:09" in 14/20
  500 volt; stopping, "Stopping". It has the geometry of the line that replaces it; between items it
  waits 1.2s before fading in (150ms), so it never flashes.
- **Action row** (turn footer, Grok's): one 28px row under the answer, no tear line: copy (as
  Markdown), retry, fork and the receipt as 28px icon buttons with 16px fg-3 glyphs (surface-3 and
  fg-1 under the hand), the first glyph on the prose's edge (x 24); then the time in 12/16 fg-3
  tabular. A turn that ended normally says only its time; any other ending says how ("Stopped",
  "Failed" in red). Tokens and cost wait in the time's hint and in the copied receipt. Copy turns
  into a check once the clipboard takes the text; a refusal says what to do instead.
- **Sticky prompt**: scrolled past its user message, the prompt pins under the header as a 32px
  one-line strip on surface-3 (radius 0 0 12 12); click scrolls to it; 220ms opacity and 8px drop.
- **Jump to latest**: scrolled up during a stream, a 28px "Latest" pill (surface-2, 1px
  line-strong, the shadow, 12/16 500 fg-2 with an arrow) 12px above the composer.

### 6.5 Plan

- **Plan segment** (in the composer shell, 36px, surface-3): "Plan 2 of 3" in 12/16 fg-2, the
  current step 14/20 fg-1 with the shimmer while it runs, three 24x2 rules at right (done fg-1,
  active filling fg-1 over the step like Harvey's timer, pending line-strong), a chevron. Complete:
  "Plan complete" with a white check, folding away after 4s.
- **Plan card** (popover the composer's width, surface-2, radius 16): header "Plan" 14/20 500 and "2
  of 3" fg-3, a Hide ghost; steps 32px with 14px square nodes (done: white with a black check, label
  fg-3 struck in fg-4; active: a 14px loader, label fg-1 500; pending: 1px fg-4 outline, label fg-2)
  on a dashed 3/3 line spine; footer "Updated by Claude Code · 0:24" in 12/16 fg-3.
- **Plan approval**: a document well in the transcript: header with "plan.md" in mono 12 fg-2, a
  32px line-number gutter (mono 12 fg-4), markdown at 14/22, 16 lines then "Show all"; footer
  "Claude Code wants to start this plan" in 12/16 fg-3 and "Keep planning" (ghost, Q), "Comment"
  (soft, C), "Approve" (primary, A and Enter).

### 6.6 Permission card

Takes the composer's place until answered; the now-row reads "Waiting on you". Shell: the composer
width, surface-2, 1px line-strong, radius 16, padding 16, the shadow. First line: the agent's
`AgentMark` (16, waiting: the volt square) and the request as a two-tone sentence in 18/26 500:
"Run" fg-3, `cargo test -p aura-drivers` in mono 16.5 fg-1, "in" fg-3, `auracode` mono fg-1; the
wait "0:09" in mono 12 fg-3 at right, "1 of 2" when several queue. Then the reason in 14/20 fg-2
naming the autonomy level ("Auto-edit asks before running commands."), a tear line, key-value rows
(26px; label fg-3 left, value fg-1 right, literals mono): Command, Directory, Network, Autonomy,
Seen before ("Approved 3 times in this project"). Writes preview the first 6 diff rows. Risky
commands add one 14/20 fg-2 line led by a 6px volt square stating the consequence; buttons stay
neutral. Actions: "Allow once" (primary, keycaps 1 and Enter), "Allow in this chat" (soft, 2),
"Always allow in auracode" (soft, 3), "Deny" (ghost, Esc) at far right; a 12/16 fg-3 hint says what
the hovered answer does. The card takes focus without a ring; no key answers while a menu or dialog
covers it, and ⌘⇧A says "Answer Codex first". Last row: a 36px "Tell Codex what to do instead"
field; typing turns the primary into "Send". Answering morphs "Allow once" to "Allowed" with a white
check (400ms), folds the card over 300ms and logs the event; Deny logs "Denied" with a red square.
Unfocused window: an OS notification with "Allow once" and "Open".

### 6.7 Question card

Same place and shell: the mark and "Claude Code asks" in 14/20 500 fg-1 with the pager "1/3" in mono
12 fg-3 at right, the question in 16/24 500 fg-1, options as 40px rows (52 with a description) on
hairlines: a keycap numeral (chosen: a white keycap with a black numeral), the label 15/24 fg-1, a
description 12/16 fg-3; the focused row surface-4 with the rail. Last row "Other" is an inline
field. Footer: the pager, "Skip" ghost, "Continue" primary (⌘ Enter). Answers log as events.

### 6.8 Errors and notices

- **Turn error** (in the transcript): a well with a 2px red left edge (radius 0 8 8 0), padding 12
  16: a red square, the title 14/20 500 fg-1 ("Claude Code stopped: process exited with code 1"), the
  last stderr line in mono 13 fg-2, then 28px actions "Retry" (soft), "Open log" (ghost), "Continue
  with Codex" (ghost). A start that failed because the chat's own worktree folder was deleted
  leads with "Recreate folder" (the one primary, opening 6.19's confirmation) and Retry steps back to
  soft; once the folder is back one calm line in the dock says so and Retry is the way on.
- **Blocking notice** (composer segment, 36px, surface-3): a 6px volt square when it blocks sending,
  the fact in 12/16 fg-2 ("Rate limit reached · resets 5:00 PM"), one 500 fg-1 text action.
- **Warning** (transcript, 28px, 1px dashed line-strong, radius 8): a volt square, 12/16 fg-2 text,
  a text action.
- **Destructive confirm**: the dialog (4.6) with the red pill.

### 6.9 Composer

Grok's pill: the message on top, one row of controls under it, and never more than four controls
besides the box. Shell: 720 wide, 16px above the pane's bottom, surface-2, radius 16, 1px
line-strong ring (fg-4 while focused, fg-3 when the box is reached from the keyboard); no shadow.
Segments above it in the dock: queue, handoff, notices. Input: padding 16 16 8, prose 15/24,
placeholder fg-3 ("Message Claude Code"; while running "Queue a message for Claude Code"), grows to
240px. Attachments and mentions sit on top inside the pill as 28px surface-3 chips. Control row
(32px, padding 0 8 8, gap 4): attach (a 32px ghost circle whose glyph starts on the text's edge,
x 16); the agent chip (32px ghost pill: "Claude Code" 500 fg-1, the model in fg-2, the autonomy
ticks in fg-1, a chevron; surface-3 under the hand and while open); then at the right one send
control. Send: empty, a 32px surface-3 disc with an fg-4 arrow; ready, the white disc. While a
turn runs and the box is empty, the white disc is Stop (a black square, Esc). With a message
typed, Stop steps back to a soft disc and the send control becomes one 32px surface-3 pill holding
"Steer" in words and Queue as the white disc (Enter), both 24px and 4px in. An agent that takes
messages only between turns (Claude Code, Pi) has "After this turn" in fg-2 words where Steer
would be, never a dead control; the disc still queues. Cancelling: the red "Force stop" pill.
`@` mentions a project file and `/` lists commands; both open menus above the shell.

### 6.10 Pickers (agent, model, effort)

One popover for everything the next turn runs with, after Grok's voice popover (an option list
and compact fields). From the agent chip or ⌘.: 400 wide over the chip, surface-2, radius 16,
padding 4, the shadow, its parts stacked on hairlines. "Agent" and "Model" in 14/20 500 fg-2 head
their rows. Agent rows (36px, radius 12): the 16px mark, the name 14/20 500, the version in mono 12
fg-3, a white check on the current one; only one usable variant per product, as in the dock.
Model rows (44px): the name 500 over a one-line description 12/16 fg-3, a check on the current
one. Then two compact fields, the name at the left in 14/20 fg-2 (an 88px column) and the control
at the right: Effort as a quiet segmented track (32px, 24px levels 4px in), and Autonomy as a 32px select with the
level's ticks inside. The checkpoint note sits under them in 12/16 fg-3, and "More options" folds
the agent's other settings. Keys: up and down move within a part, left and right between parts,
Enter chooses, digits set the effort, letters jump to agents. Opens over 200ms (opacity, scale
0.98, 4px).

### 6.11 Autonomy

Level glyph: three 2px-wide square ticks 4, 6 and 8px tall, 2px apart; Ask fills one, Auto-edit two,
Full auto three, in fg-1; empty ticks fg-4. The ticks ride in the composer's agent chip, so the
level shows without a second control; the level is chosen in the picker's Autonomy field (6.10),
with the consequence under it ("Full auto. A local checkpoint is saved before each turn.") and the
agent's own mode when it reports one. Switching mid-chat logs "Full auto from here".

### 6.12 Queue

One segment over the composer, its width and radius 16 (surface-2, 1px line ring): "2 queued" in
12/16 500 fg-3 on a 32px head, then each waiting message on a 32px row (fg-1, one line) with a
24px remove icon at its end; Edit, Move up and Move down (24px ghost icons) sit before it, shown
under the hand or with focus in the row. Edit opens the words in a field in place (Enter saves,
Esc cancels without touching the turn). Held messages (after a stop, an error or a restart) add
"· held" to the head, a "held" chip on their rows, "Send queued" (24px soft) at the head's end and
one 12/16 fg-3 line saying why they wait.

### 6.13 Empty state

At 38% of the pane height: the agent's `AgentMark` at 56 (idle, its code), 20px, then a two-tone
`.g-text-display` sentence on one line: "**Claude Code** is ready in **auracode**." with the agent
and project in fg-1 and "is ready in" in fg-3; the agent name sits on the glint's grey rule. 24px
below, the composer; 24px below that, up to three 36px ledger rows of recent chats in this project
(never the current one): status square, title 14/20 fg-1, agent fg-3, outcome at right ("+59" and
the removal count in mono; "No changes" fg-3; "Needs you" volt; "Failed" red; "Working for 3m" with
the loader), age in mono 12 fg-3. Switching agent rises the new name per word and runs the glint
once; first paint does neither. No folder: "**Claude Code** is ready." with an outline "Choose a
folder" (⌘ O).

**New chat** (before a chat exists) follows Grok's start screen: the 40px logo centred, one two-tone
display line ("What are we working on?", then "**Claude Code** is ready in **auracode**.",
"Looking for **Codex**." or "**Codex** needs you to sign in."), one 15/24 fg-3 hint, and one
composer card (surface-2, radius 16, line-strong ring) anchored at 18vh so nothing above it moves.
The card's first row holds the agents that can run here as 32px pills over native radios, each with
its 24px round `AgentMark`: the walking loader while the agent is still detected (name in fg-3), its
code once found (the mark settles in once over 250ms `--g-ease-out`; never on first paint or under
reduced motion), the volt square once a sign-in check says it needs you; the selected pill is
surface-4 with an fg-3 ring. Refresh is a ghost icon at the row's end. The second row holds the
folder icon in the marks' column, the path in mono, the project folders, "Choose folder" (outline)
and "Create" (the one primary). Under the card, on one 16px axis: the worktree chip row, the
busy-folder well (Local only; one volt square and an explicit consent), the download note, errors,
the selected agent's version and path opening its details in place, and "Other agents" with each
one's reason.

**Worktree chip** (the Codex app's per-thread Local or Worktree, drawn as Grok's composer chip):
in a Git project folder the chat gets its own worktree by default, and one 32px ghost pill sits
16px under the card with its 16px icon on the axis: "**Worktree** from `main` on `aura/7f3a9c2e`"
(the mode 14/20 500 fg-1, the connectives fg-3, the branches mono 13/20 fg-2, a 12px chevron), or
"**Local** on `main`". While the folder is first reviewed it reads "Checking Git" beside the 12px
loader in the icon's slot; a later review shows the loader after the chip; a refused change adds a
6px red square. Its popover is the picker's shell (6.10) at 400 wide, under the chip while the
window has room and over it otherwise, parts on hairlines: the strong segmented control (Worktree,
Local) with one 12/16 fg-3 line on what it means; Start from (a mono select of local branches, the
current one marked) and New branch (a mono field, its generated name as the placeholder, Apply)
as compact fields with their help or refusal under the control in 12/16 (red for a refusal, with
the field's red border); Bring uncommitted changes and Run saved setup as switch rows with one
line each; then the new folder in mono and each consequence Rust names. Local shows only the
segmented control and its line. A plain folder shows no chip; a folder that cannot have a
worktree shows "Local" with the reason in 12/16 fg-3 under it. After Create, a saved setup command
waits in the terminal sheet (6.19) with "Setting up `branch`" and the loader in the chip's place,
and a chat with notes to read shows them in a calm well while Create becomes "Open chat".

### 6.14 Right panel

Tabs as Grok-quiet pills (28px): words in fg-2 on the pane and the open one on a surface-3 fill, so
white stays for the one primary action: "Changes 2" (the count in mono fg-3), "Files", "Plan",
"Session"; refresh and close at right; 44px header. **Changes**: a scope menu ("This turn", "This chat", "Branch since main"), the diffstat
as a hero ("+59" green and the removal count red at 32/32 500 tabular, ten 6px squares, "2 files ·
48s · Claude Code" 12/16 fg-3), "Copy patch" (⌘ ⇧ C); file rows (32px, hairlines: icon, path in
mono 13, counts mono 12, status letter M, A or D in mono 12 fg-3; selected surface-4); per-file
diffs with a sticky 34px header and a quiet Unified or Split segmented control; a sticky 40px footer
"Checkpoint saved before this turn" 12/16 fg-3 and "Revert" (opens the dialog; logs the event;
offers Undo). Empty: "No changes yet" 14/20 500, "Edits from this chat appear here." 12/16 fg-3, three
key hints. **Files**: touched files then the tree (28px rows), a read-only viewer in a well.
**Plan**: the plan card's steps at full height. **Session**: key-value rows (30px; label 12/16 fg-3
in a 96px column) for agent and model (24px chips, radius 6, 1px line-strong, the agent's 14px
mark), effort, autonomy, folder and branch in mono, the session id in mono with a middle ellipsis
and copy; two usage tiles (surface-2, radius 12, padding 16: "Cost" "$0" with superscript "21",
"Tokens" "6.9k"); a 4px context bar with a tick at the auto-compact threshold; a 24px turn timeline
strip on surface-1 with 1px fg-3 ticks per tool call and fg-4 blocks for thinking.

### 6.15 Command palette and menus

⌘K: the large dialog (760 wide) at y 120, surface-2, radius 16, the shadow; a 56px input (prose
15/24) with the close button at its end; scope chips (All, Chats, Projects, Files, Commands; 28px,
the selected one a surface-3 pill); 48px two-line result rows, the active one with the ↵ keycap and
the 2px rail; no key legend. With a chat open, its header menu's actions are commands by name (Show
changes, Git workspace, Show or Hide terminal, New terminal, Open in editor, Conversation history,
Export chat, Copy debug bundle, Show log, Stop or Resume session, Start fresh). Context menus (4.6): message (Copy, Copy as Markdown, Copy receipt; Retry, Edit
and resend, Fork into new chat; Delete), chat row (Rename, Pin, Move to project, Archive ⌘⌫;
Delete), tool row (Re-run, Copy command, Copy output).

### 6.16 Settings

Settings replace the pane (⌘,) and follow Grok's settings rows and X Money's grouped wells. The
sidebar becomes the settings nav on the chat sidebar's geometry (6.2): the logo in the top band,
"Back to chats", a "Settings" heading on a 32px line 16px below it, then 32px rows 4px apart of a
16px fg-3 icon at x 20 and a 14/20 fg-2 label at x 44; hover surface-2 and fg-1; the open page is Grok's filled pill
(surface-3, fg-1 500); a separator before the links out (Agents, Library). Page: a 680px column, a
`.g-text-title` title and nothing under it. Groups (X Money): an optional heading 16/22 500, at
most one short 14/20 fg-3 line, then a surface-2 well, radius 12, 12px below; 32px between groups.
A row is a label 14/20 500 with an optional one-line description 12/16 fg-3 and at most one control
at right (a 28px outline pill, a segmented control on a 36px track with its 28px choices 4px in,
a 220px select at an input's 36px for a choice from a list, or a switch); anything more (a form, a
key, a list, progress) opens under the row across both columns, starting at the label's column
when the row leads with an icon or a 32px badge. Rows are at least 60px with 12/16 padding (the
label 20 over its line 16, so a 28px control sits 16px in), on hairlines inset 16 on both sides. A row that only opens something is the whole row as a button with a
chevron (X Money). Empty states are Vercel's: one 14/20 500 title and one fg-3 line centred in the
well, and the one way forward. "Applies to new chats" in 12/16 fg-3 under a group when true.
General is three groups that save at once: New chats (Agent and Model as selects, the Model row
only once an agent is chosen and only with a select when that agent has listed its models; and
Autonomy as a strong segmented control, Ask, Auto-edit, Full auto, Full auto by default, with one
line saying what the level does), While agents work (switches for Notifications, Keep awake and
Keep running in the tray or menu bar) and App (Motion, a strong segmented control of Full, Reduced
and Off, Welcome and setup, Data folder). Agents: a roster in a hairline grid (mark, name, version chip, binary path in mono,
an enable switch, "Update to 0.165.0"). Permissions: default autonomy, Final confirm, tool rules
(Allow, Ask, Deny; Deny wins) and the access log (mono 13 table: time, agent, tool, target, a white
check or red square). Usage: per-agent rows with 32/32 tabular figures and a 1px fg-3 sparkline; a
"Hide costs and tokens" switch masks every figure with "••••" without reflow. Account and sync
panels follow the same groups: Profiles; Cloud account, where each step of the sign-in flow is one
row with its form under it, a sign-in error is one 12/16 red line under its field, the approved
account leads with a 32px check badge and one sync line, and Sign out is a chevron row; Devices; and
Security (secure storage, workspace restore, sync reset, removal), with confirm dialogs for
destructive steps. Shortcuts is one keycap table. About: the 40px logo, "auracode" and the version
in mono, then Updates (its phase, version and one next step; progress, notes and the install
question open under it), This device, Diagnostics and Third-party notices.

### 6.16a Instructions

Settings' Instructions page (docs/instructions.md), on Vercel's settings cards. One group of rows
first: "Applies to" with a 220px select (your user files, each project folder, and the open chat's
folder when opened from a chat) over the folder in mono, "Files" with the strong segmented control
(One file, Per agent) and Rust's one sentence, and a row per hand-edited managed copy ("Edited copy
for Pi", Resolve). Then "Text": per agent, the files as quiet mono pills (28px, the open one
surface-3); the file's head (its path in mono, lines and size in 12/16 fg-3 tabular); its notes as
12/16 lines led by a 6px circle (fg-3, or volt when it needs the person: a size limit, a file new
worktree chats will miss, a case variant); a mono textarea at the code size, on the page black, at
least 320px; and Vercel's card footer behind an inset hairline: who reads the file at left, then
28px outline actions (Rename, Copy into new worktree chats, Commit), Discard (ghost) and Review
changes, the page's one primary. Then "Agents": 60px rows of a 24px mark, the name and Rust's
sentence, size warnings as volt-circle lines, and at right the status as a word led by a 6px
circle (fg-3; volt for an edited copy, an override in the way, or nothing to read; a hollow fg-3
ring for an agent without a file there). Status here is a circle, not a square (owner decision,
2026-10-28). Agents that are not installed fold under "N agents not installed"; files in other
folders fold the same way. The review is the large dialog: the title, Rust's sentence, a radio list
of cards when a choice comes first (which text to keep, or restore against adopt), then each file
as its action word, path in mono and role in fg-3 over its diff (4.9), optional removals as
checkboxes in a well, the notes in 12/16 fg-3, then Cancel and Apply.

### 6.17 Onboarding and the dither intro

**First launch intro** (once, skippable with any key, about 2.4s): the window opens black; a
full-window DitherField (`standard`, density 0.45) starts live; from 200ms to 1400ms `progress` eases
0 to 1 (`--g-ease-out`, order "radial") into `{ kind: "path", d: LOGO_PATH, height: 0.3 }`, so the
field condenses into the logo; at 1400ms "auracode" rises under it (`Wordmark` text 32px, `.g-rise`);
at 1800ms the field reveals (800ms) into step 1. Reduced motion: one still frame of the formed mark
for 300ms, then step 1. Later launches skip it.

**Layout** (Grok's start screen, the website hero's field): no sidebar. One centred column, 480
wide (the window minus 48 when narrower), its top at `clamp(128px, 24vh, 208px)` so the heading
holds one place on every step, over a window-wide DitherField (`quiet`, density 0.36, edges 0.85,
ceiling 0.6, accent 0.001, `interactive`, still under reduced motion) that gathers at the sides and
clears to black behind the column (an ellipse at least 520px from the centre) and along the top
edge. `Wordmark` 16 top left and "Skip setup" (ghost) top right, just under the titlebar band.

**Progress**: four 6px pixels, fg-4 ahead, fg-3 done; the current one stretches to a 16px fg-1 bar
over 300ms quint. Each is a 24px button that visits its step. No numerals, no checklist.

**Steps** (each skippable: Continue never requires anything; Enter continues outside controls):

1. **Welcome**: "Welcome to auracode." / "Your agents, one window." and one sentence.
2. **Agents**: a two-tone display heading that follows the scan ("Looking for agents." / "Still
   looking for 2." then "Found 3 agents." / "6 more can be installed."). The roster is the Agents
   list (6.17a) in its compact form: 48px rows on hairlines, what this computer has first and the
   rest folded into "Show 6 not installed"; a row opens its details and actions in place. Refresh
   (ghost) under it; with no agents, "Explore the local demo" (outline).
3. **Account**: "Accounts are optional." / "And invite-only for now." and one sentence: auracode
   needs no account and no network, everything stays on this computer, and an account with an
   invitation adds sync between devices; "Open Account" (outline).
4. **First project**: "Add a first project." / "Any folder works." a 96px dashed drop zone ("Choose a
   folder", "or drop it here"), the name field and "Add project" once a folder is chosen, then
   "Clone a repository" (ghost) and, when projects exist, "Or choose a project".

**Clone a repository** replaces the step's content in place (X Money's one question per screen):
"Clone a repository." / "Git copies it into a new folder.", "Repository" (a 36px field, focused),
"Clone into" (the parent folder as a field-like button with its folder icon and name, an fg-3
separator, then the new folder's name as a field, joined like a path; Vercel's scope and name),
the exact command in a well (mono 13/20, inset hairline) with one 12/16 fg-3 line naming the Git
that runs it, then Clone (primary, Enter) and Back (ghost, Escape). A refused address or name says
why in 12/16 red under its field and Clone waits. Running: "Cloning owner/repository." / "Cancel
leaves nothing behind.", a status row (the pixel loader, Git's stage, the whole clone's figure in
mono at right) over a 2px fg-1 bar on a line-strong track that only scales, a meta line (what has
arrived, the destination in mono), the command dimmed, and Cancel clone (soft, Escape). Failed:
"The clone stopped." / "Nothing was added.", the red-edged well with one plain reason and Git's own
last lines in mono 12/16 fg-2, then Try again (primary, Enter) and Edit (ghost, Escape). A finished
clone becomes the first project and the step returns with "orbit is ready.". New project opens the
same form in a md dialog ("Clone a repository", one sentence, Cancel and Clone at right).

Motion is not a step: Full already follows the system setting, and Settings changes it. A setup
saved at the retired motion step resumes at First project. The one primary is "Get started",
"Continue" or "Open auracode", with the Enter keycap.

### 6.17a Agents

Vercel's project list. Back to chats and Run setup again (ghosts) on the top line; "Agents" in
`.g-text-title` with "3 of 9 installed on this computer." under it and Refresh (outline) at right.
One frame (a 1px line ring drawn over the rows, radius 12) of 60px rows on hairlines: a 32px `AgentMark`, the name 14/20 500
over the version in mono 12/16 fg-3, the status in 12/16 (a 6px square and a word: green
"Installed", volt "Needs sign-in", red "Unavailable", an fg-4 outline square and fg-3 "Not
installed", fg-3 "Looking"), the date auracode last verified the integration in 12/16 fg-3
tabular, at most one outline 28 action (Install, Update or Sign in) and a kebab menu (plain rows,
one divider) for the rest: Sign in, Check sign-in, Update, Installation guide, Copy path. A row
opens its details on surface-1: the description, facts on hairlines (runs from, installed with,
latest release, updates, verified) and the executable picker. Detection: the mark shows the pixel
loader while an agent is looked for (the row's one live indicator); when it is found the status and
version settle once (2px rise, 340ms reveal) and the green square scales in (250ms). Rows enter
with `.g-enter`. Reduced motion: everything in place, the loader still. Install appears only for
the reviewed, version-pinned installers (Claude Code, Codex, Pi, OpenCode 1, Grok Build) and opens
the TerminalSheet with the package, program, arguments and folder as rows before Start; Sign in
appears only where the vendor's CLI has its own login (Claude Code, Codex, Cursor, Grok Build,
OpenCode, Hermes). Every other agent keeps its Installation guide.

### 6.18 Plugin library

Vercel's project pages: Back, "Plugin library" in `.g-text-title` with one line under it and
Refresh (ghost icon) at right. Below, a 200px column of agents as plain 32px rows (a 16px
`AgentMark`, the name, a volt status dot only when an update is available; the current one filled
surface-3), and the chosen agent as one scrolling page beside it: its 32px mark, name 16/22 600 over
the version in mono and "Updated 4 minutes ago" in 12/16 fg-3, the page's one primary (Add plugin, or
Add package for Pi) and a kebab for the rest (Refresh listings, Add marketplace, Copy history, Open
Agents). Under it the harness line in a surface-1 well (a volt dot and Update when a release is
newer, a red dot when the binary failed, plain fg-2 otherwise), the reread notice after a version
change, the agent's one-sentence summary, and Sync across devices as one settings row with its
switch. Each feature follows as a 14/20 600 heading with its count, one 12/16 fg-3 line saying where
its rows came from (the CLI command, or why its files answer instead; red when the command failed),
and 60px rows on hairlines in a 12px ring drawn inset: the name 14/20 500, its facts in 12/16 fg-3,
Enabled or Disabled with a dot, an outline 28 Install for an available plugin, and a kebab (Preview
and copy, Enable or Disable, Update, Remove; each opens the reviewed command filled in). Available
plugins sit under their own 14/20 heading with a 280px search and "Showing 20 of 3,599". Empty
features are one 12/16 line. An item's preview and copy, and Copy history, open as large dialogs.

### 6.19 Dialogs and sheets

Every dialog is 4.6's shell, in one of its three widths, on Vercel's transfer dialog: the title,
one sentence saying what happens to what (the variables in fg-1 500), the details as key and value
rows on hairlines or a hairline grid of versions, then `.g-dialog-actions`: Cancel (soft) and one
primary, or the red pill for a removal. The TerminalSheet (sign-in, installs, vendor commands) is
the large dialog: its sentence says closing stops the process and output is not saved, the
reviewed command as rows, a status line led by its mark (a still green square while running, the
white check or red square after), the terminal well at 144px until Start and full height after,
and Copy selection beside the one Start.

**Quit auracode?** (sm width, in the window, never the light system dialog): the window comes forward, one fg-2 sentence per fact (active chats, open terminals, unsaved messages, an unconfirmed draft), then Keep auracode open (soft, focused, so Enter keeps it) and the explicit red pill ("Stop agents and quit"). Esc, the scrim and the close button keep auracode open. Only when the page cannot show it within 3 s does the system dialog ask, Keep open first and default.

**Recreate the deleted folder?** (the Git workspace dialog's missing worktree, sm width): Rust's
sentence that uncommitted files from the deleted folder are gone and everything committed is kept,
then Branch, Commit (12 characters) and Folder as 36px rows on inset hairlines with their values in
mono fg-1, Rust's other notes in 12/16 fg-3, a refusal in red, and Cancel beside Recreate folder.

**A conflicted merge** (the Git workspace dialog's merge review): "Conflicts to resolve first" in
red, the paths in mono, one fg-2 line that nothing has changed yet, then, for a chat that works in
that worktree, "Message to Claude Code" over the exact message in the review's well (both branches,
the folder, every path up to thirty, and what not to do), and 28px soft pills: Open in each detected
editor and "Ask Claude Code to resolve", which sends that message as the person's own visible chat
message and closes the dialog. Merge reviewed changes stays disabled until a new review finds no
conflicts. A chat outside the worktree gets one line saying where the work happens instead.

### 6.20 Notifications

Toasts (4.6). In-window agent cards when a chat you are not viewing finishes or starts waiting:
320px, top-right of the pane, surface-2, radius 16, the shadow, padding 12 14: the agent's 16px mark,
name 14/20 500 and "now" fg-3, a body in 14/20 fg-2 with the facts in fg-1 ("Finished **Wire up the
ACP client** · +69" with the figure in green, or "Needs you: **Run cargo test**" with a volt square),
"Open" and close; further cards stack 6px lower and 4% smaller, up to three. OS notifications:
"Claude Code finished" / "Fix the flaky orb pacing test · 2 files +59 · 48s"; "Codex needs you" /
"Run cargo test -p aura-drivers in auracode" with "Allow once" and "Open".

### 6.21 Error screens

Startup failure and an interrupted profile switch replace the app the same way: a black window, a
centred 600px column, the 32px logo in fg-2, the title in `.g-text-title`, aura-core's message in
15/24 fg-2, then what to do. The startup error shows the data path in a well with copy and a
Show in Explorer button, notices as rows, and one line saying nothing was deleted; configuration
recovery shows what its one action does and that action (the note to unlock the account first is
volt). Calm: nothing was changed or lost. Recovery notices use the warning row (6.8).

### 6.22 Terminal panel

The bottom of the conversation pane, under the composer, behind one inset hairline: Ctrl+` (⌘` on
macOS) shows or hides it, Ctrl+Shift+` adds a terminal, and the chat menu and the palette offer the
same.
Opening it with no terminal asks Rust to review the chat's folder (a worktree chat's worktree) and
starts the first shell Rust offers there; nothing else ever runs. Height 280 by default, 120 to 800
on the 4px grid, never taking the 240px the transcript and the composer keep; the top edge is the
resizer (a 2px line-strong rule under the hand and the keyboard; arrows step 20, Home and End go to
the bounds). Padding 0 8 8. A 36px header: the tabs as the right panel's quiet pills (28px, 500 fg-2,
the open one surface-3 and fg-1, its 12px close mark fg-3; an exited shell leads with a still fg-3
square, a failed one a red square), scrolling sideways when they outgrow the header; then the
reviewed folder in mono 12/16 fg-3, right-aligned and cut at its end; then 28px ghost icons: New
terminal, the shell menu (when Rust offers more than one shell, opening upward), Close the open
terminal and Hide. The terminal sits flush on surface-1 in the Term type and the ANSI palette (3.1).
A shell that is not simply running says so in one 28px line ("Starting PowerShell…", "PowerShell
exited. Output is not saved.", or Rust's refusal with a red square and Try again). Tabs take arrows,
Home and End, F2 to rename (40 characters) and Delete to close; focus moves into a shell only when
the person shows the panel, adds a terminal or clicks a tab, never on a chat switch. Escape on the
panel's own controls hides it; inside a shell every key but Ctrl+` belongs to the shell (on Windows,
Ctrl+C with a selection copies and Ctrl+V pastes). Shells keep running while the panel is hidden or
another chat is open; closing a tab, reloading or quitting stops them. Nothing animates.

---

## 7. Text quality and performance rules

- Integer weights only (400, 500, 600); no variable-weight tricks, no dark-mode weight reduction.
- UI text is 14px or larger; 12px is for meta and 11px only for keycaps; never 13px "UI".
- Every text colour is a solid hex from section 3.1; no `opacity` or alpha on text; disabled text is
  fg-4, not faded text.
- Text sits on opaque surfaces so WebView2 can use its best antialiasing; never put body text on
  a transparent layer over an animated canvas.
- `font-synthesis: none`; tabular numerals on anything that updates.
- No blur, `backdrop-filter`, glow or `text-shadow` anywhere, except a far swimmer's depth (4.16),
  painted once; one box shadow, for floating things.
- Never `transition: all`; never animate `width`, `height`, `top`, `left`, margins or padding; fold
  with opacity and clipped transforms. One website exception, short and one element at a time: an
  accordion panel opening by `grid-template-rows` (300ms).
- One live indicator animates at a time per row or card (a shimmer or a loader, not both). Shallows
  is the only ambient motion on a screen: on the website the hero, the capabilities panel, the
  closing panel and the 404. Until its Shallows branch, the app shows the dither field only during
  the first launch intro and behind the onboarding column, never behind the transcript.
- All animation shares one `requestAnimationFrame` loop (`frameClock()`); offscreen, hidden and
  reduced-motion elements own no frame; swimmers move by transform only; DitherField caps at
  30fps.
- Long lists virtualise; rows use `contain: layout style`.
- Pixel geometry lands on whole CSS pixels and uses `shape-rendering: crispEdges`.

---

## 8. Anti-slop and no-eyebrow checklist

Every screen ships only when all of these hold.

- [ ] No eyebrow text: no small uppercase or mono label above a heading, no tracked caps, no
      numbered "01" or "02" tags, no filler captions. A label exists only where the UI is ambiguous
      without it, and then it is sentence case in Geist, not mono.
- [ ] Mono only for machine data: paths, commands, code, durations, versions, keycaps, ids.
- [ ] Volt only for look here (needs you, live, new, the glint); never a button,
      a border, a background larger than a chip, or decoration.
- [ ] Green only for passed and added, red only for failed, removed and the one destructive pill;
      done is a white check. No orange, no agent hues, no project colours in chrome.
- [ ] No space imagery: no globe, orbit, satellite, starfield, orb or halo.
- [ ] No gradients except the lit water of Shallows and the shimmer and glint primitives; no
      glass, no texture, no noise, no glow, no sparkle icons, no 3D; blur only for a far swimmer.
- [ ] Two-tone headings at one size and weight; no serif, no italic, no gradient text.
- [ ] Structure from hairlines and value steps; cards only for things that float or dock.
- [ ] Pixels are square and crisp; status is a flat circle, never a glow.
- [ ] Nothing idles, breathes, pulses or parallaxes besides the swimmers' slow glide; motion
      starts with an event and ends with it;
      reduced motion is honoured from the OS and from `data-motion`, and content is never hidden.
- [ ] Concrete copy: verbs, objects and numbers ("Ran pnpm test · 19 passed · 4.2s"); no hype words,
      no emoji, no em dashes; risk said in words.
- [ ] Empty states are one sentence, the input and real recent work.
- [ ] Keys are visible: keycaps in menus, buttons, cards and hint lines.
- [ ] Nothing owned is copied: logos, wordmarks, illustrations, photography, font files.
