# Graphite: the auracode visual language

Status: **Graphite replaces Orbit on 2026-10-26 (owner decision).** The product is **dark only**
(desktop, onboarding and website): no light theme, no system switching, no appearance setting. One
accent, **volt** `#CCFF33`, means look here. The signature is a **live ordered-dither field**.
The foundation ships in `@auracode/ui/graphite` (tokens, stylesheet, `DitherField`, `AgentMark`,
`PixelMark`, `Wordmark`, `StatusDot`, `PixelLoader`, `Keycap`, `CopyButton`); the website and the
desktop app adopt it next. Every number here is meant to be built as written. Motion values are
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

---

## 1. Direction and thesis

**Name:** Graphite. **Id:** `graphite`.

**Thesis:** a black instrument with one living surface. Type and hairlines do the work, a grey
ladder carries every hierarchy, the only living thing is a field of ordered-dither pixels, and the
only colour is the thing that needs you.

1. **Type does the work.** Geist at integer weights (400, 500, 600), solid colours, two-tone
   headlines at one size. Geist Mono only for what a machine made.
2. **Pixels are the ornament.** Everything decorative is square pixels on whole CSS pixels: the
   dither field, the pixel "a", the 2x3 loader, the pixel check, status squares. No curves for
   decoration, no glow, no gradient, no glass, no blur.
3. **One accent, one meaning.** Volt marks needs-you, live and new, the glint and rare lit pixels
   in the field. It is never a fill larger than a chip and never a button.
4. **Structure from hairlines and value steps** (Vercel, X Money, Aside), not from cards and
   shadows. One soft shadow exists, for things that float.
5. **Motion only on events.** The dither field is the single ambient motion, and it stops for
   reduced motion, for hidden pages and offscreen.
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
| Centred two-line hero; one word rotates every 3000ms, letters leave up 14px and arrive from 14px below 25ms apart (250ms, `cubic-bezier(0.16, 1, 0.3, 1)`); a 3px underline 4px below draws in over 800ms; a glint sweeps it in 3000ms linear, 400ms after each swap (measured; recoloured to one volt band) | Hero headline with the agent name rotating (5.3) | Empty state agent switch (6.13) |
| Load choreography: pill 320ms at 320, words from 100 plus 55 per word, lead 380ms at 580, CTAs 380ms at 700, tiles 1250ms at 760, all `cubic-bezier(0.22, 1, 0.36, 1)` (measured) | Hero entrance (5.3) | None |
| Announcement pill: chip, sentence, arrow coin | Release pill above the hero (5.3) | None |
| White primary pill beside a dark secondary pill; colour 150ms `cubic-bezier(0.4, 0, 0.2, 1)`, no scale on press (measured) | Hero and closing CTAs (5.3, 5.10) | Primary and outline buttons (4.1) |
| Three product tiles with a quiet "Explore" corner label | Feature tiles in the hairline cells (5.7) | None |
| Terminal card: mono, line numbers, "Thought for 4.1s"; 2x3 dot loader on a 660ms cycle (measured) | Product fragments in tiles (5.7) | Code wells, the thinking line, `PixelLoader` (4.5, 6.4) |
| Sparse footer, dashed rule between brand and link columns | Footer (5.11) | None |

### 2.2 X Money (money.x.com): two tones, tiles, FAQ, shimmer

| Trait | Lands on the website | Lands in the app |
|---|---|---|
| Two-tone stacked heading, same size and weight, second line grey | Every section heading (5) | Empty state, settings titles, onboarding (6) |
| Per-word flip-up: from `translateY(45%) rotateX(-40deg)` in a 1200px perspective, 650ms `cubic-bezier(0.23, 1, 0.32, 1)`, 100ms then 55ms per word (measured, identical at x.ai) | `.g-rise` on the hero and section headings (4.12) | Onboarding headings (6.17) |
| Recessed square tiles holding miniature real UI; hovering one dims the others to 0.5 over 500ms `cubic-bezier(0.32, 0.72, 0, 1)` (measured) | Feature cells (5.7) | Settings usage tiles (6.16) |
| Hairlines across the full column between sections | Section edges (5.1) | Settings groups (6.16) |
| FAQ accordion: 300ms ease-out-quint, the open row's tinted well slides between rows in about 270ms, the icon turns 90 degrees in 200ms (measured) | FAQ (5.9) | Advanced settings, expanded tool rows (6.4) |
| Grey-on-grey text shimmer: 100deg band, 250% wide, 1400ms linear (measured) | None | Thinking, running, live verbs (4.12) |
| Success check drawn in 250ms (measured) | None | `AgentMark` done check (4.13) |

### 2.3 Harvey (harvey.ai): word wheel, stats, timer tabs, slow hover

| Trait | Lands on the website | Lands in the app |
|---|---|---|
| Timer-driven vertical word wheel: one 62.4px row step every 1100ms (600ms move on `cubic-bezier(0.7, 0, 0.7, 0.7)`, 500ms hold), 7 visible rows, opacity by distance 1, 0.6, 0.3, 0.1 (measured from the archived source) | Agent wheel (5.5), as solid greys | None |
| Stats with a rule above each number (Harvey's is 2px with 32px above the numeral) | Stats row (5.8), as a hairline | Usage settings (6.16) |
| Capability list whose active item's 2px rule fills as a timer: 7500ms linear by `translateX(-100%)` to 0, paused on hover, switch 300ms `cubic-bezier(0.7, 0, 0.3, 1)` (measured) | Capability band (5.6) | Plan strip progress (6.5) |
| Nav hover dims the siblings over 300ms `cubic-bezier(0.3, 0.3, 0.3, 1)` (measured) | Nav (5.2) | None |
| Slow-settling button hover: 300ms `cubic-bezier(0, 0.7, 0.3, 1)`, 90% by 120ms, settled near 240ms (measured) | All buttons (4.1) | All buttons (4.1) |
| Harvey's serif | **Not taken.** Graphite is one grotesk | Not taken |

### 2.4 Aside (aside.com): column frame, lead-ins, rows

| Trait | Lands on the website | Lands in the app |
|---|---|---|
| Content column framed by full-height 1px side rules (1248px column, measured) | Page frame (5.1) | None |
| Bold lead sentence, grey continuation, one paragraph | Feature copy, intro paragraphs (4.12) | Settings descriptions, onboarding (6) |
| Rows entering: 8px rise, 340ms `cubic-bezier(0.22, 1, 0.36, 1)`, 70ms apart (measured) | `.g-enter` on rows (4.12) | Ledger and roster rows (6.13, 6.17) |
| Rows on hairlines with a segmented control | Download and account pages (5.12) | Settings, right panel tabs (6.14, 6.16) |
| Airy footer | Footer spacing (5.11) | None |
| Composer control row of quiet text controls | None | Composer (6.9) |

### 2.5 Vercel: grid frames, cells, real fragments

| Trait | Lands on the website | Lands in the app |
|---|---|---|
| Hairline grid frames with "+" crosshairs on the corners: 21px crosses with 10px arms in `#878787`, guides at white 9% (measured) | Hero frame and feature cells (5.7) | None |
| Feature cells divided by lines, not cards | Feature cells (5.7) | Settings agent roster (6.16) |
| Mocks built from real UI fragments: timelines, agent tables, status dots | Tiles (5.7) | The same components, live (6) |
| Geist everywhere; command pill with copy | Install command (5.12) | Code blocks (4.8) |
| Dark buttons `#0A0A0A` to `#1F1F1F` in 150ms; footer links in 100ms (measured) | `--g-dur-fast`, `--g-dur-micro` (3.8) | Rows and icon buttons |

### 2.6 AI in Design Report 2026: uniqueness bar, not copied

The report sets the bar for distinctiveness: giant edge-to-edge type, dithered and pixel imagery,
big numerals split by rules, numerals counting up in about 950ms (measured). We copy none of its
artwork or layout; its dither is a baked video, ours is drawn live. Our answers to the bar are the
dither field (4.15), the giant dithered footer wordmark (5.11) and the stats row (5.8).

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

| Role | Size / line | Weight | Tracking | Class |
|---|---|---|---|---|
| Hero | `clamp(48px, 7vw, 96px)` / 0.98 | 500 | -0.045em | `.g-web-hero` |
| Section heading | `clamp(36px, 4.4vw, 56px)` / 1.04 | 500 | -0.035em | `.g-web-h2` |
| Subheading | 24 / 30 | 500 | -0.02em | `.g-web-h3` |
| Lead | 20 / 30, fg-2 | 400 | 0 | `.g-web-lead` |
| Body | 16 / 26 | 400 | 0 | `.g-web-body` |
| Small | 14 / 22 | 400 | 0 | `.g-web-small` |
| Wordmark display | `clamp(96px, 20vw, 280px)` | 600 | -0.06em | DitherField text target |
| Stat numeral | 72 / 72 (48 under 640px) | 500 | -0.04em | tabular |

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

4px base: `--g-space-2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160`.
Row heights: 24 compact, 28 tool rows and menu-dense rows, 32 menu rows, buttons and sidebar rows,
36 inputs and composer segments, 44 headers and two-line rows. Website section rhythm: 160px
between sections at 1024px and wider, 96px from 640 to 1023, 72px below.

### 3.4 Radii

`--g-radius-4` keycaps, inline code, "New"; `-6` chips, icon buttons, tooltips; `-8` inputs,
rows, wells, menu items; `-12` panes, menus, tiles, accordion wells; `-16` composer, dialogs,
docked cards; `-pill` buttons, segmented controls, switches. Pixels, status squares, loader cells
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

No springs, no overshoot, no bounce. Nothing idles, breathes, pulses, floats or parallaxes; the
dither field (4.15) is the one ambient motion. Only `opacity`, `transform`, colour and
`background-position` (shimmer, glint) animate; never `height`, `top`, `left`, margins, blur or
`transition: all`. One exception: the hero's rotating word slot morphs its `width` over 300ms
`--g-ease-out` (x.ai), because re-centring the line by transform would distort the type.

**Reduced motion** is the OS setting or the app's own (`setMotionPreference` in `motion.ts` writes
`html[data-motion="reduced"|"off"]`; "full" never overrides the OS). Both are honoured in CSS and
in components. Movement durations (`letter`, `panel`, `row`, `step`, `headline`, `reveal`,
`count`, `glint`) and every stagger become 0ms; colour and opacity changes stay (`micro`, `fast`,
`base`, `settle`, `dim`), as on every reference site. Headlines arrive by a 150ms fade with no
transform; the rotating word stops on its first word with a static grey rule and no glint; the word
wheel and tab timers stop advancing (the active tab shows a full rule); counters show their final
values; the shimmer becomes static fg-2; rows render in place; the pixel check appears whole;
loaders hold their static pattern; every DitherField renders one still frame and owns no animation
frame, and a field that reveals content shows the content at once. Content is never hidden waiting
for motion.

### 3.9 Layout tokens

`--g-web-max 1200px`, `--g-web-gutter clamp(16px, 4vw, 40px)`, `--g-app-column 720px`,
`--g-app-sidebar 264px`, `--g-app-header 44px`, `--g-app-panel 380px`.

---

## 4. Components

Primitives live in `graphite.css` as one class each, states inside `:where()`, so one app class
loaded later always wins. React components live in `@auracode/ui/graphite`.

### 4.1 Buttons (`.g-button`)

Pill, 14/20 500, gap 6, 1px transparent border. Heights: `.g-button-28` (padding 0 12, gap 4),
default 32 (0 14), `.g-button-36` (0 16), `.g-button-44` (0 20, 15/20, gap 8; website CTAs).
`.g-button-icon` makes it square. Colour changes settle over 300ms `--g-ease-settle`; pressing
drops the transition to 0. Hover rules apply only on `(hover: hover)`.

| Variant | Rest | Hover | Pressed |
|---|---|---|---|
| Soft (default) | surface-3, fg-1 | surface-4 | surface-4 |
| `.g-button-primary` | `#EDEDED`, black label | `#FFFFFF` | `#D6D6D6` |
| `.g-button-outline` | transparent, 1px line-strong | border fg-4, fill surface-2 | surface-4 |
| `.g-button-ghost` | transparent, fg-2 | surface-3, fg-1 | surface-4 |
| `.g-button-danger` | red, black label; confirm dialogs only, one per dialog | `#FF7A7A` | |
| Disabled | surface-2, fg-4, `not-allowed` | | |

One primary per view. A split button joins a pill and a 28px chevron segment with a 1px divider
at `#D6D6D6`. Keycaps inside a primary take `#D6D6D6` with a `#222222` glyph.

### 4.2 Inputs (`.g-input`)

36px, radius 8, surface-1, 1px line-strong, 14/20, padding 0 12, placeholder fg-3. Hover border
fg-4; focus border fg-3 plus the focus ring; invalid (`aria-invalid="true"`) border red with the
reason under the field in 12/16 red; disabled border line, text fg-4. Textareas: height auto, min
72, padding 8 12, vertical resize. Website forms use 44px inputs (padding 0 16, 16/24). Labels
sit above in 14/20 500 fg-1, with help text under in 12/16 fg-3.

### 4.3 Segmented control and switch

`.g-segmented`: surface-3 track, 32px, padding 2, gap 2, pill. `.g-segment`: 28px, padding 0 12,
14/20 500 fg-2, hover fg-1. Active (`aria-pressed`, `aria-selected`, `aria-checked` or
`data-active`): a white pill with a black label (strong, SpaceXAI). `.g-segmented-quiet` makes
the active segment surface-1 with a 1px line-strong inset ring and fg-1 (Harvey). Colour 150ms.
`.g-switch` (a native checkbox with `role="switch"`): 32x18 track, 12px knob 3px in; off surface-4
with a line-strong ring and an fg-3 knob; on white with a black knob moved 14px over 150ms.

### 4.4 Chips, "New" and keycaps

`.g-chip`: 22px, radius 6, padding 0 8, surface-3, 12/16 500 fg-2, an optional 6px status square.
`.g-new`: 20px, radius 4, padding 0 6, volt on volt-tint, "New" in sentence case 12/16 500.
`Keycap` (`kbd.g-keycap`): 20px tall, min width 20, padding 0 5, radius 4, surface-3 with a 1px
line-strong inset ring, Geist Mono 11/16 500 fg-2. One keycap per key in a chord (`⌘` `K`), 4px
apart. Buttons, menus, cards and hint lines show keycaps wherever a key works.

### 4.5 Status: `StatusDot` and `PixelLoader`

`StatusDot` is a square, never a circle and never a glow: 6px default (4 to 32), tone neutral fg-2,
volt, green or red; decorative unless `label` is set, since the text beside it speaks. `live`
swaps the square for the loader at twice the size (at least 12px) with the head in the tone.

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
- **Dialog** (`.g-dialog` on a native `<dialog>`): 440px (max viewport minus 32), padding 24,
  surface-2, 1px line-strong, radius 16, the shadow, scrim `rgb(0 0 0 / 0.72)`. Title 22/28 500 as
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
surface-3, radius 4, padding 1 5. File references (`pacing.ts:42`) are inline-code chips with a
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
| idle | The agent's code in Geist, fg-2: one letter under 24px at `0.56 * size`, two letters from 24px at `0.38 * size`; weight 500, or 600 below a 12px glyph |
| thinking, streaming, tool | The 2x3 pixel loader (4.5) at its state's tempo |
| waiting | A solid volt square, `0.375 * size` (parity-adjusted to centre on whole pixels) |
| done | A white pixel check (cells `max(2, round(size / 8))`), drawn once a pixel at a time, 50ms apart (about 250ms, X Money's check), by CSS |
| error | A solid red square, same geometry as waiting |
| ghost (any state) | Transparent tile, 1px dashed line-strong outline, the code in fg-4 |

Codes: CC Claude Code, CX Codex, PI Pi, MP oh-my-pi, AG Antigravity, HM Hermes, CU Cursor, GB
Grok Build, OC OpenCode; any other agent takes the first two letters of its id; an empty or
generic id shows "?" (`agentCode()`). Root: `span.g-agent-mark[role="img"]` with `aria-label`
"Claude Code, waiting for approval" (from `ORB_STATE_LABELS`, or `label`), `data-agent` (the brand
id, "generic" for unknown), `data-state`, `data-ghost`. No canvas. Idle, hidden, offscreen and
reduced-motion marks own no animation frame; the check uses no frame at all. Volt and red differ
in luminance as well as hue (17.9:1 against 6.9:1 on black), and the label and the words beside
the mark always say the state.

Sizes in use: 14 (composer pill, event chips), 16 (header, bylines, live gutter, pickers, menus),
20 (onboarding roster), 24 (agent dock, library), 32 and 48 (settings, error screen), 56 (empty
state).

### 4.14 `PixelMark`, `Wordmark` and the app icon

The auracode glyph is a lowercase "a" on a 6x6 grid (`PIXEL_MARK_GRID`):

```
.####.
.....#
.#####
#....#
#....#
.#####
```

`PixelMark` draws it in `currentColor` as one SVG path of merged runs, `shape-rendering:
crispEdges`, cells `floor(size / 6)` and offset `floor((size - 6 * cell) / 2)`: centred on whole
pixels at every even size (16: 2px cells, 20: 3px, 24: 4px, 32: 5px). Decorative unless `label` is
set. Of five candidates (this rounded classic, a spurred bowl, a square seven-segment form, a 5x5,
and one with a cursor pixel) the classic read as "a" soonest at 16px and stayed calm beside the
wordmark; the field, not the glyph, is the loud part of the brand.

`Wordmark`: "auracode" as real text in Geist 600, tracking -0.035em, after the glyph at `6 *
max(2, round(0.75 * fontSize / 6))` px (12 at 16px type, 18 at 24, 24 at 32) sitting on the
baseline like a letter, gap 0.3em, fg-1. In a nav link it names the link.

App icon and favicons come from `pixelMarkSvg({ size, padding, color, background, radius })`:
default 1024px black tile, radius 22.5% (the macOS shape), glyph fg-1 at 25% padding, crisp. The
favicon is the glyph on black at 16 and 32 with `padding: 0.125` (2px cells at 16, centred).
Never recolour the glyph volt.

### 4.15 `DitherField`

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
(0 holds); `density` 0.5; `accent` 0.02; `interactive` false; `target`; `progress` (0, or 1 when
only a target is set); `reveal` false; `order` "scatter"; `palette` "standard" (or 2 to 4 greys);
`transparent` false (black cells clear, to layer over a surface); `clearing`; `fallbackSrc`;
`still` false; `seed` `0x6a09e667`; `fps` 30; `label` (otherwise `aria-hidden`).

- **Lens** (`interactive`, fine pointers with hover only): within 120 CSS px of the pointer the
  field develops: the floor drops by up to 0.16 and contrast rises by up to 60%, both falling off
  with the square of distance; the lens eases toward the pointer and fades out when it leaves.
- **Target**: `{ kind: "text", text, fontFamily, fontWeight 600, fontSize | "fit", tracking
  -0.06em, align, anchor, inset, texture 0.25 }`, `{ kind: "image", src, fit "cover", texture 0 }`
  (same-origin images; luminance lifted by a 0.6 gamma so dark UI keeps texture; a tainted image
  leaves the field as noise and still reveals), or `{ kind: "grid", rows, scale }` (a pixel grid
  such as `PIXEL_MARK_GRID`, crisp at any size). Text waits for its font to load and redraws.
  `texture` lets the live field shade the resolved target.
- **Dissolve** (`progress` 0 to 1): each cell leaves the field when progress passes its threshold:
  half a per-cell random value, half a slow noise, so pixels go in ragged islands rather than as
  salt and pepper; `order` "down", "up" or "radial" adds a direction. Cells crossing the front
  flash one step brighter for 2.5% of progress.
- **Reveal**: with `reveal`, at progress 1 the canvas fades out over 800ms `--g-ease-out` and stops
  drawing, showing `children`; it returns if progress drops. Under reduced motion it reveals at
  once.
- **Clearing**: an ellipse in fractions of the field (`{ x 0.5, y 0.5, rx, ry }`) where the field
  thins to black a pixel at a time, so a headline set over it stays readable.

**Performance.** Draws from the shared frame clock, at most `fps` (30) times a second, only while
the field intersects the viewport (64px margin), the page is visible, motion is allowed, `still`
is off and it is not revealed; otherwise it renders single frames on demand (resize, target or
progress change). Measured: about 2.5ms a frame in Chromium and 4.9ms in WebKit for a 1440x720
hero at 4px cells, lens and clearing included.

**Server, no JS, no canvas.** Server rendering emits the wrapper, the optional fallback `<img>` and
an empty canvas, touching no browser API. The fallback shows until the first frame lands and stays
if the canvas is unavailable. For a field without a target, `renderDitherFrame({ cols, rows,
cellPx, seed, density, accent, clearing })` (clearing in cells, time 0) renders the identical first
frame in Node, so a build step can write the fallback PNG at one pixel per cell and the hand-off is
seamless. With `children` and no scripting, the field steps aside (`@media (scripting: none)`).
Give the field a size; it fills its box.

---

## 5. Website composition (auracode.si)

### 5.1 Frame

Black page, `.g-root` on `<html>`, body 16/26. One content column, max 1200px, gutters
`clamp(16px, 4vw, 40px)`, framed by full-height 1px `--g-line` vertical rules at its edges from
1024px up (Aside). Sections are separated by full-column hairlines and 160px of space; every
section heading is a two-tone `.g-web-h2` with no eyebrow above it. Prerendered; works without
JavaScript: fields fall back to their images, and the entrances are CSS, so they need no script.

### 5.2 Nav

64px, sticky, black, a 1px line under it once scrolled (150ms). Left: `Wordmark` 16 linking home.
Centre-left: Download, Changelog, Docs as 14/20 500 fg-2 links in a `.g-dim-text` group (hover
fg-1; the siblings dim to fg-3 over 300ms `--g-ease-soft`, Harvey). Right: "Sign in" ghost 32 and
the platform primary 32 ("Download for Windows" or "Download for macOS", detected; a 28px chevron
segment lists every build). Under 768px the links fold into a 32px menu button opening a
full-width sheet.

### 5.3 Hero

Top padding 120px. A DitherField fills the hero (min height 720, `standard` palette, `interactive`,
`clearing { rx 0.36, ry 0.42, y 0.38 }`, `fallbackSrc` from `renderDitherFrame`). Centred over it:

- **Announcement pill**: 34px, radius pill, 1px line-strong, black fill, padding 0 14 0 8, a
  `.g-new` chip, the release sentence in 14/20 fg-1 and the version in fg-3; links to the
  changelog. Hover: border fg-4, 150ms.
- **Headline** (`.g-web-hero`, 2 lines, centred, 24px under the pill): "One window for" / "**Claude
  Code**." The agent name rotates every 3000ms through Codex, Grok Build, Cursor, OpenCode, Pi,
  Hermes, Antigravity (x.ai's measured rotation, without its blur): the old name's letters leave
  last-first, 15ms apart, each fading and rising 0.23em in 250ms `--g-ease-out`; when they are gone
  the new letters arrive from 0.23em below, 25ms apart, 250ms; the slot's width morphs to the new
  name in 300ms `--g-ease-out` under `clip-path: inset(-4px 0)`, and the underline follows it. The
  underline is `.g-glint`, re-keyed on every swap, so its volt band sweeps 400ms after each one.
  Reduced motion: no rotation; "Claude Code" on a static grey rule.
- **Lead** (`.g-web-lead`, max 560px, 24px under): "auracode drives the coding agents you already
  use through one chat. Local first. No account needed."
- **Buttons** (32px under, gap 12): platform primary 44 with a download icon, outline 44 "Create
  account".
- **Load choreography** (x.ai, measured): the pill fades and rises 8px over 320ms at 320ms; the
  headline words flip up (`.g-rise`) from 100ms, 55ms apart; the underline draws (`.g-draw-x`) over
  800ms at 800ms; the lead fades in over 380ms at 580ms and the buttons at 700ms; the product frame
  fades in over 1250ms at 760ms; all `--g-ease-reveal` except the words (quint) and the draw (out).
  The field is live from its first frame. Reduced motion: everything present at first paint, words
  by the 150ms fade.

### 5.4 Product frame with the dither dissolve

40px under the hero, a 1200px frame with Vercel crosshairs at its four corners holds the real app
window (a captured screenshot of the shipped app, 1px line ring, radius 12) inside a DitherField:
`target { kind: "image", src, fit: "cover" }`, `reveal`, `order "down"`, children = the `<img>`
with real alt text. Scroll drives `progress` from 0 when the frame's top reaches 85% of the
viewport to 1 at 35%; the field fades out at 1 and the screenshot remains. Reduced motion or no
JavaScript: the screenshot shows at once.

### 5.5 Agent word wheel (Harvey)

Timer-driven, as Harvey's is (measured from its archived source), not scroll-linked. Left (33%):
"auracode runs" in 20/26 fg-1. Centre: a 7-row window (7 times the pitch, minus the gap: 424.8px)
of agent names in Geist 48/50.4 500 -0.03em, 12px apart, so the pitch is 62.4px; eight rows render
(three above the active one, four below). Every 1100ms (`--g-dur-tick`) the column moves up one
pitch over 600ms `--g-ease-step` (`transform` only), holds 500ms, then the index advances and the
column snaps back with no transition. Colour by distance from the active row, as solid greys so the
type stays crisp (Harvey's opacities 1, 0.6, 0.3, 0.1): 0 fg-1, 1 fg-3, 2 fg-4, 3 or more
line-strong; the colour change rides the same 600ms step. No fade mask: the grey ladder already
fades the edges. Right: outline 36 "See every agent". It runs only while in view and the page is
visible. Reduced motion: a static column with the active name in fg-1, changing every 3000ms with
no movement.

### 5.6 Capability band with timer tabs (Harvey)

Full-bleed surface-1 band, 120px padding. Left column (40%): four capabilities ("Run any agent",
"Approve what matters", "Review every change", "Keep it local"), 24px apart; each item has a 2px
line-strong track, label row padding 20 0 12, title 20/26 500 fg-3. The active item's title turns
fg-1 (300ms `--g-ease`), its description (16/26 fg-2, max 440) opens under it (height and fade,
300ms `--g-ease-in-out`), and a 2px fg-1 bar fills the track in 7500ms linear by `transform:
translateX(-100%)` to 0; when it completes the next item activates. Hovering the list pauses the
timer (`animation-play-state: paused`) and fades the bar out over 300ms; leaving resumes it.
Clicking an item activates it and restarts its timer. Right column: a tile with the matching real
UI fragment, crossfading over 500ms `--g-ease-in-out`. Reduced motion: no autoplay, the active
track full and static, switching instant.

### 5.7 Hairline feature cells

A `.g-hairline-grid` of three columns (one under 768px) with crosshairs at the outer corners. Each
cell: padding 32, a 4:3 `.g-tile` showing a live fragment (a tool row group with a loader, the
permission card, a diff with the diffstat), then a `.g-lead-in` paragraph, max 320px ("**Asks
before it acts.** Every command waits for you unless you chose full auto."). The cells form a
`.g-dim-group`: hovering one dims the others to 0.5 over 500ms `--g-ease-smooth` (X Money). An
"Explore" link with an arrow may sit in the cell's bottom-right in 14/20 fg-3. Cells enter with
`.g-enter`, 70ms apart. No icons with caps labels, no numbers.

### 5.8 Stats with count-up

Three columns, gap 24, each with a 1px line-strong rule above (Harvey's is 2px; ours stays a
hairline) and 32px above the numeral: the numeral (72/72 500 -0.04em, tabular) and a 16/26 fg-2
label ("9 agents supported", "0 accounts required", "2 platforms, Windows and macOS"). When 10% of
the row is visible each counts from 0 once, over 950ms `--g-ease-out` (AI in Design), digits
stepping in place (tabular, no reflow). Only true numbers. Reduced motion: final values.

### 5.9 FAQ

Two columns from 1024px: left, a two-tone heading and an outline 36 "See all questions"; right,
`.g-disclosure` items 4px apart (X Money: 52px closed rows, padding 16 18), summary 16/24 500, body
16/26 fg-2, one open at a time, the first open on load. Opening: 300ms `--g-ease-quint`, the
surface-2 well sliding from the previously open row in about 270ms (4.11).

### 5.10 Closing CTA

Centred: a two-tone `.g-web-h2` ("Bring your agents." / "Keep your keys."), 32px gap, the platform
primary 44 and outline 44 "All downloads". Behind it a 360px DitherField band, `quiet` palette,
`clearing { rx 0.3, ry 0.45 }`, `still` until in view.

### 5.11 Footer with the giant dithered wordmark

Padding 96 0 0. A top row: `Wordmark` 16 and "© 2026 auracode" in 12/16 fg-3 at left, a dashed
1px line-strong vertical rule, then link columns (Product, Company, Legal) 140px wide, heading
14/22 500 fg-1, links 14/22 fg-3 (hover fg-1), 12px apart. Then, edge to edge, a DitherField
`clamp(120px, 20vw, 280px)` tall: `target { kind: "text", text: "auracode", anchor: "bottom", inset
8 }`, `bright` palette, `order "up"`, progress scroll-linked from 0 as the footer enters to 1 when
its bottom reaches the viewport's bottom; `still` once formed. The version in mono 12/16 fg-3
closes the page. Reduced motion: the formed still frame.

### 5.12 Inner pages

- **Download**: two-tone heading "Download auracode." / "Free, local, no account." A hairline grid
  of builds (Windows x64, Windows ARM64, macOS universal): name 16/24 500, file name and size in mono
  13 fg-3, the detected build's primary 36, the rest outline 36. Checksums in a well with
  `CopyButton`. Requirements as rows on hairlines. Linux is not offered.
- **Sign in, sign up, verify device**: a centred 400px column on black, a DitherField band 160px tall
  above (`quiet`, still). Title 24/30 500 two-tone ("Sign in." / "Invite only for now."), the email
  input at 44px, a full-width primary 44 ("Send code"), the 6-digit code as six 44x52 boxes in mono
  20/28, Turnstile under the form, errors in 12/16 red under the field that caused them, help in
  12/16 fg-3. One action per screen.
- **Account**: settings-style groups (6.16) in a 680px column: email, devices (rows with a status
  square and last seen), sync, export, and "Delete account" in red text that opens a confirm dialog
  with the red pill.
- **Legal** (privacy, terms, third-party notices): 680px column, h1 as `.g-web-h2`, h2 24/30 500,
  body 16/26 fg-2 with fg-1 emphasis, lists with 4px square bullets in fg-3, tables per 4.7.
- **Changelog**: one entry per release on hairlines: the version in mono 14/20 fg-1, the date in
  14/20 fg-3, "New" on the latest only, notes as prose 16/26.
- **404**: a full-viewport DitherField with a text target "404" (`bright`, `still` under reduced
  motion) and under it a two-tone line "This page does not exist." / "It may have moved." with an
  outline 44 "Go home".

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

264px, 12px insets, rows 240 wide.

1. Band (52px): traffic lights and a 28px sidebar toggle.
2. Utility rows (32px, radius 8): New chat (keycaps ⌘ N) and Search (⌘ K), 14/20 fg-2 with 16px
   fg-3 icons; hover surface-3 and fg-1.
3. **Needs you** (only while a chat waits): a sentence-case label "Needs you" in 12/16 500 fg-2
   with the count in volt. Rows: a 6px volt square, the title in fg-1 and " · project" in fg-3 as
   one run (the project gives way first). Clicking opens the chat on its card. A waiting chat is
   listed and counted only here.
4. **Projects** (no label): project rows 32px with a 6px square in fg-3, the name 14/20 500 fg-1,
   the chat count in mono 12 fg-3 right, a chevron on hover (rotates 90 degrees open). A folded
   project shows its chats' state in place of the count: volt square, loader, or red square and "1
   failed".
5. **Chat rows** (32px, text inset 28): title 14/20 fg-2 (fg-1 500 when unread or active). Trailing
   slot: idle, the relative time in mono 12 fg-3 ("4m", "Tue"); running, the loader and elapsed
   time with the title in fg-3; needs approval, a volt square and "Needs you" 12/16 500 volt; done
   and unseen, a white 6px square and the time; failed, a red square and "Failed" in red. The active
   chat is surface-3 with a 1px line-strong ring, radius 8. Hover (or an open row menu) swaps the
   trailing slot for archive and more icon buttons (24px). Archive acts at once with an Undo toast
   (⌘Z); Delete asks in a dialog. ⌘⌫ archives the open chat unless the caret is in text. Arrow
   keys move a surface-4 row with the 2px rail; Enter opens. "Show 12 more" in fg-3 ends long
   lists.
6. **Agent dock** (above the account row, after a 1px line): one 32x44 cell per known agent, a
   24px `AgentMark` (live) with its two-letter code under it in mono 11 fg-3; missing agents as
   ghosts; more than seven wrap. An update shows a 4px volt square at the mark's corner, except
   while it waits. Hover tooltip: "Codex 0.164.0 · update to 0.165.0". Click opens the agent card
   popover (280px): 32px mark, name 16/22 600, version in mono fg-3, sign-in status, binary path in
   mono, default model and effort, "Update to 0.165.0" primary when available, "Agent settings"
   ghost.
7. **Account row** (44px): a 28px square avatar (surface-3, initial 12/16 600 fg-2), "Local" 14/20
   500, "Sign in to sync" 12/16 fg-3, a 28px settings icon button.

Collapsed rail: 72px (⌘\), 32px icon buttons, project squares with their state, the dock as a
column of 24px marks, the avatar. It collapses over 300ms `--g-ease-quint` by translating the
content inside a clipped container, never by animating `width` per frame.

### 6.3 Chat header

44px, padding 0 16. Left: the chat's live `AgentMark` (16), 8px, the title 14/20 500 fg-1 (truncates
at 420), then fg-3 metadata: "auracode · " a 12px branch icon and the branch in mono 13. The title
is a button: click (or Rename) swaps in a 28px input as wide as the title plus 12 (160 to 420), text
selected; Enter or blur commits, Esc restores and goes no further. Right (gap 4): the diffstat chip
(24px, radius 6, 1px line, "+59" green and the removal count red in mono 12, five 6px squares;
hidden when nothing changed; opens Changes), the panel toggle (28px, surface-3 while open), more
(chat menu). No border at rest; once scrolled a 1px line fades in under it (150ms).

### 6.4 Transcript

Column 720 max, centred, 24px under the header; bottom padding is the composer height plus 32.
**The gutter**: every agent line starts on a 22px gutter; icons, chevrons, `$` and the live
`AgentMark` (16) centre on x 11, words start at x 22, so a live line handing over to the next keeps
the mark and the words in place.

- **User message**: right-aligned block, max 82% of the column, surface-3, prose 15/24 fg-1,
  padding 10 14, radius 16 16 4 16 (the tail points at the composer). Over 12 lines it clamps with
  "Show all" (12/16 500 fg-2, underlined). A steer adds "Steered at 0:31" in 12/16 fg-3 under the
  block. Attachments: 24px chips (radius 6, 1px line, surface-1, 12px icon, mono 12 fg-2) and 48px
  image thumbnails. Hover shows edit, copy and more (24px icon buttons) to its left.
- **Agent byline** (once per turn, 24px): the `AgentMark` (16, idle), the name 14/20 500 fg-1; on the
  first turn and whenever they change, the model in fg-2 and the effort in fg-3 at the same size
  ("Claude Code Opus 5.5 High"). On hover the time in mono 12 fg-3 and a more button.
- **Prose**: bare on the pane, 15/24 fg-1, measure 600px, paragraphs 12 apart; h1 to h3 16/22 600
  (16 above, 6 below); bullets are 4px squares in fg-3, 18px indent; numbered items in fg-3 tabular;
  an item opening with a bold run keeps the run fg-1 600 and the rest fg-2 (Grok). Links fg-1 with a
  1px fg-4 underline 3px below (fg-1 on hover). Blockquotes: 2px line-strong left rule, fg-2.
  Tables per 4.7 at 14/20. Horizontal rule: the tear line.
- **Code blocks**: wells (4.8) at the full column, internal scroll past 420px.
- **Thinking**: collapsed, a 24px line with a 12px chevron in the gutter and "Thought for 6s" in
  14/20 fg-3 (the number tabular), or the agent's summary "Thought about the pacing math · 6s".
  Live: "Thinking" with the shimmer and " · 4s" ticking once a second, the live mark in the gutter;
  a live thought stays open until the next item arrives, then folds. Open: 14/22 fg-2 behind a 1px
  line spine on x 11, max 280 tall with internal scroll. Folds animate opacity and a clipped
  `transform` over 300ms `--g-ease-quint`; reduced motion, an instant fold.
- **Tool rows** (28px): a 14px icon in fg-3 in the gutter (read file-text, edit file-pen-line,
  write file-plus, delete file-minus, search search, glob folder-search, execute square-terminal,
  fetch link, subagent git-fork, MCP plug, other wrench); the verb 14/20 fg-2, the object in mono
  13 fg-1, a result in fg-3 ("42 lines", "no matches", "19 passed"), the duration in mono 12 fg-3 at
  right or the diffstat for edits. Hover surface-2 (radius 6) and a chevron; rows 2px apart.
  Running: the present progressive with the shimmer ("Reading"), the live mark in the gutter, the
  loader and elapsed time at right; a call that waited on you times from the answer. Groups: two
  or more consecutive calls fold into "Read 2 files, searched 1 pattern" with a chevron and the
  total; opened, children stack on a 1px line spine; finished turns fold every group. Opened call:
  a well under the row (margin 4 0 8 22) with key-value rows (22px; label 12/16 fg-3 in an 88px
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
- **Receipt** (turn footer): 12px after the last item, the tear line, one 28px row: "Done in 48s ·
  4.8k in · 2.1k out · $0.21" in 12/16 fg-3 tabular (dots fg-4); the files chip (24px, radius 6, 1px
  line: file-diff icon, "2 files" fg-2, the diffstat in mono 12, five squares; opens Changes for the
  turn); copy, retry, fork and more icon buttons (always on the last turn). More opens upward: Copy,
  Copy as Markdown, Copy receipt; Retry, Edit and resend, Fork into new chat; then Delete.
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
width, surface-2, 1px line-strong, radius 16, padding 16 18 14, the shadow. First line: the agent's
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

- **Turn error** (in the transcript): a well with a 2px red left edge (radius 0 8 8 0), padding 10
  14: a red square, the title 14/20 500 fg-1 ("Claude Code stopped: process exited with code 1"), the
  last stderr line in mono 13 fg-2, then 28px actions "Retry" (soft), "Open log" (ghost), "Continue
  with Codex" (ghost).
- **Blocking notice** (composer segment, 36px, surface-3): a 6px volt square when it blocks sending,
  the fact in 12/16 fg-2 ("Rate limit reached · resets 5:00 PM"), one 500 fg-1 text action.
- **Warning** (transcript, 28px, 1px dashed line-strong, radius 8): a volt square, 12/16 fg-2 text,
  a text action.
- **Destructive confirm**: the dialog (4.6) with the red pill.

### 6.9 Composer

One object growing upward in segments. Shell: 720 wide, 16px above the pane's bottom, surface-2,
radius 16, 1px line-strong ring; no shadow, no lit edge. Segments (36px, surface-3, 1px line
between) stack above the input in order: blocking notice, plan, queue, handoff; at most two show,
the rest collapse into a "+1" chip. Input: padding 12 16 6, prose 15/24, placeholder fg-3 ("Message
Claude Code"; while running "Queue a message for Claude Code"), grows to 12 lines. Control row (32px,
padding 0 12 8, gap 6): attach (28px, radius 8, plus icon fg-2); the agent pill (28px, radius 8,
padding 0 8 0 6: a 14px `AgentMark`, "Claude Code" 500 fg-1, "Opus 5.5" fg-2, "High" fg-3, chevron;
hover surface-3; open surface-4); the autonomy chip (the level glyph, "Full auto" fg-2, chevron); a
spacer; the context meter (a 28x4 track on surface-4, fill fg-2, volt from 85%, "62%" mono 12 fg-3;
only after the agent reports usage); send. Send: empty, a 32px surface-3 circle with an fg-4
arrow; ready, a white circle with a black arrow; running and empty, a white circle with a black
10px square (Stop, Esc); running with text, a split primary "Queue" (Enter) and a chevron for
"Steer instead" (⌘ Enter). Hint line under the shell (18px, mono 12 fg-3, only while running or
queueing, keeps its height when empty): "esc to stop · enter to queue · ⌘ enter to steer", then "esc
again to force stop". Handoff segment: the new agent's 14px mark, "Next message goes to Codex with
a handoff · 412 tokens" in 12/16 fg-2, "Preview" text button and a close. Drop: a 1px dashed fg-3
outline around the shell with "Drop to attach". `@` and `/` open menus above the shell with the key
legend "↑ ↓ to move · enter to insert · esc to close". Under 560px the pill drops model and effort;
under 420px the autonomy chip keeps only its glyph and the meter goes.

### 6.10 Pickers (agent, model, effort)

From the agent pill or ⌘.: 640 wide, up to 420 tall, surface-2, radius 16, padding 6, the shadow,
three columns split by 1px line (Agent 226, Model 244, Effort 156), no column captions. Agent rows
(44px, radius 10): 16px mark, name 14/20 500, a mono 12 fg-3 line ("2.1.310 · signed in"), a
letter keycap (C Claude Code, X Codex, G Grok Build, U Cursor, P Pi, M oh-my-pi, O OpenCode, H
Hermes, A Antigravity); "Sign in" and "Update" as 500 fg-1 links with a volt square; uninstalled
agents follow a 1px line as ghosts with "Install" (copies the command, says so in a toast). Model
rows (44px): name 500, a one-line description 12/16 fg-3, context size mono 12 fg-3, a check on the
current one. Effort rows (36px): five 2x8 ticks (fg-1 up to the level, fg-4 after), the label, "default"
fg-3, keycaps 1 to 5. Footer (32px, 1px line): the key legend with keycaps and, for the hovered
effort, its consequence. Letters jump to agents, digits set effort, left and right change column,
Enter commits all three; hovering a row dims its siblings' labels to fg-3. Opens over 200ms
(opacity, scale 0.98, 4px). Narrow: two columns.

### 6.11 Autonomy

Level glyph: three 2px-wide square ticks 4, 6 and 8px tall, 2px apart; Ask fills one, Auto-edit two,
Full auto three, in fg-1; empty ticks fg-4. Menu (300px): three 56px rows (glyph, title 500, a 12/16
fg-3 consequence, keycap 1 to 3): "Full auto: edits files and runs commands without asking. Every
turn is checkpointed." / "Auto-edit: edits files without asking. Asks before running commands." /
"Ask: asks before every edit and command." The selected row takes the 1.5px fg-1 rim and a white
check. Then a switch row "Final confirm" ("Always ask before rm, force pushes and writes outside the
project") and the hint "⌘ ⇧ A cycles autonomy". Agents that cannot ask show the other levels
disabled with the reason. Switching mid-chat logs "Full auto from here".

### 6.12 Queue

Segment: "2 queued" 12/16 fg-2, the next message's first line 14/20 fg-2, "Edit" ghost and a close.
A stop pauses the queue ("· paused" and "Send next"). Further messages peek as 4px surface-3 slivers
above the shell (inset 12 per level, up to two). Opened list: numbered 36px rows (numeral mono fg-3,
message fg-1, a target mark when it differs, a drag handle, close), reorder by drag or ⌥ arrows.
Sending flies the row up into the transcript as the user block (300ms `--g-ease-quint`).

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

### 6.14 Right panel

Tabs as a strong segmented control (28px): "Changes 2", "Files", "Plan", "Session"; a close at right;
44px header. **Changes**: a scope menu ("This turn", "This chat", "Branch since main"), the diffstat
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
and copy; two usage tiles (surface-2, radius 12, padding 14: "Cost" "$0" with superscript "21",
"Tokens" "6.9k"); a 4px context bar with a tick at the auto-compact threshold; a 24px turn timeline
strip on surface-1 with 1px fg-3 ticks per tool call and fg-4 blocks for thinking.

### 6.15 Command palette and menus

⌘K: 640 wide at y 120, surface-2, radius 16, the shadow; a 48px input (prose 15/24); scope chips
(Chats, Projects, Files, Commands, Settings; 26px, the selected one a white pill); 36px result rows
with keycaps right; hovering dims siblings; no match becomes "Ask Claude Code instead" (⌘ Enter);
footer key legend. Context menus (4.6): message (Copy, Copy as Markdown, Copy receipt; Retry, Edit
and resend, Fork into new chat; Delete), chat row (Rename, Pin, Move to project, Archive ⌘⌫;
Delete), tool row (Re-run, Copy command, Copy output).

### 6.16 Settings

Settings replace the pane (⌘,); the sidebar becomes the settings nav: 32px rows, 14/20 fg-2, hover
fg-1, active fg-1 500 with the 2px rail; no group captions (separators instead). Page: a 680px
column, 40px top padding, title `.g-text-title` with a two-tone continuation in 14/20 fg-3
("Agents" / "Turn agents on, pick their defaults, keep them updated."). Groups: a heading 14/20 500
outside; the group on surface-2, radius 12, rows 52px (label 14/20 500, description 12/16 fg-3,
control at right), 1px line separators inset 16, 24px between groups; "Applies to new chats" in
12/16 fg-3 under a group when true. Motion is a strong segmented control (Full, Reduced, Off) that
applies at once. Agents: a roster in a hairline grid (mark, name, version chip, binary path in mono,
an enable switch, "Update to 0.165.0"). Permissions: default autonomy, Final confirm, tool rules
(Allow, Ask, Deny; Deny wins) and the access log (mono 13 table: time, agent, tool, target, a white
check or red square). Usage: per-agent rows with 32/32 tabular figures and a 1px fg-3 sparkline; a
"Hide costs and tokens" switch masks every figure with "••••" without reflow. Account and sync
panels (sign-in, devices, vault, export, reset, remove) follow the same groups with confirm dialogs
for destructive steps. About: "auracode 0.1.0 (build 214)" with the version in mono, the notices
dialog and the data path in mono.

### 6.17 Onboarding and the dither intro

**First launch intro** (once, skippable with any key, about 2.4s): the window opens black; a
full-window DitherField (`standard`, density 0.45) starts live; from 200ms to 1400ms `progress` eases
0 to 1 (`--g-ease-out`, order "radial") into `{ kind: "grid", rows: PIXEL_MARK_GRID }`, so the field
condenses into the pixel "a"; at 1400ms "auracode" rises under it (`Wordmark` text 32px, `.g-rise`);
at 1800ms the field reveals (800ms) into step 1. Reduced motion: one still frame of the formed mark
for 300ms, then step 1. Later launches skip it.

**Layout**: no sidebar. Left column (40% of the window, 440 to 568 wide, padding 64 64 40) on bg:
`Wordmark` 16 and "Skip setup" (ghost). Right: a pane inset 8px (surface-1, radius 12, 1px line)
filled by a calm DitherField (`quiet`, `interactive`, still under reduced motion) with a two-tone
line at its bottom-left in 14/20: "Agents run on this machine." / "auracode never sees their keys."
This replaces the Orbit night panel and globe.

**Steps** (a checklist joined by a dashed line spine; 20px square numerals, active white with a
black numeral, done white with a check; titles 16/22 600, pending fg-3; the active step opens in
place over 300ms; done steps fold to a 12/16 fg-3 summary and reopen on click; Enter continues):

1. **Agents**: a two-tone display heading that follows the scan ("Looking for agents." / "Still
   looking for 2." then "Found 5 agents." / "2 more can be installed."). The roster has a slot per
   agent from the first frame: checking slots show the loader and "Looking for Cursor" in fg-3, then
   resolve in place (`.g-enter`: opacity and an 8px rise, 340ms). 48px rows on hairlines: a 20px
   `AgentMark`, name 14/20 500, a mono 12 fg-3 line with path and version, status at right: "Ready"
   with a green square, "Sign in" (500 fg-1 with a volt square; reveals the agent's own login
   command as a copyable mono chip), or an outline 28 "Install" that opens the TerminalSheet. Under
   it, mono 12 fg-3: "Scanned PATH and ~/.local/bin in 1.2s". No agents: "No agents found." /
   "Install one, or try the demo." with a soft "Try the demo chat".
2. **Account**: "Sync across your machines." / "Or keep auracode local." a 36px email field, "A
   6-digit code signs you in. No password, and agents keep their own keys." in 12/16 fg-3, then
   "Continue" (or "Send code") and "Skip, use auracode locally".
3. **Motion**: "Make it yours." / "Change it later in Settings." with the Full, Reduced, Off
   segmented control, applied at once. There is no theme or accent choice.
4. **First project**: "Add a first project." / "Any folder works." a 120px dashed drop zone (1px
   fg-4, radius 12) with "Choose folder" (outline, ⌘ O) and "Clone from GitHub" (ghost, branch icon);
   a chosen folder shows its name and path and "Change".

Buttons: "Continue" primary (Enter; "Open auracode" last) and "Skip" ghost.

### 6.18 Library

The library lists skills, instructions, MCP servers, plugins and packages across agents. Header:
title 22/28 with a two-tone continuation, a 36px search input, and a segmented control for the
kind (Everything, Skills, Instructions, MCP servers, Plugins, Packages). Items are 44px rows on
hairlines: a 16px icon in fg-3, the name 14/20 500, the source agent as a 24px `AgentMark` and name
in fg-3, a mono 12 fg-3 path; status per source as a status square and words. Selecting opens a
preview pane (surface-1) with the file in a well and "Copy to Codex" style actions as soft buttons;
copies produce a receipt in a well and an event toast. The vendor dialog uses the dialog shell.

### 6.19 Dialogs and sheets

Every dialog is 4.6's shell. The TerminalSheet (vendor install and setup commands) is a 640px
dialog: the command in a well with copy, a "Start" primary that is the only thing that launches it,
the output in a terminal well (4.10), and the exit status as a check or red square with words. Sign
out, notices, profile pickers and recovery dialogs reuse the same parts.

### 6.20 Notifications

Toasts (4.6). In-window agent cards when a chat you are not viewing finishes or starts waiting:
320px, top-right of the pane, surface-2, radius 16, the shadow, padding 12 14: the agent's 16px mark,
name 14/20 500 and "now" fg-3, a body in 14/20 fg-2 with the facts in fg-1 ("Finished **Wire up the
ACP client** · +69" with the figure in green, or "Needs you: **Run cargo test**" with a volt square),
"Open" and close; further cards stack 6px lower and 4% smaller, up to three. OS notifications:
"Claude Code finished" / "Fix the flaky orb pacing test · 2 files +59 · 48s"; "Codex needs you" /
"Run cargo test -p aura-drivers in auracode" with "Allow once" and "Open".

### 6.21 Error screens

Startup failure replaces the app: black window, a centred 600px column, a 48px `AgentMark` in the
error state (red square), the title in `.g-text-title`, aura-core's message in 15/24 fg-2, the data
path in a well with copy, notices as rows, and "Copy diagnostics" (soft) and "Quit" (ghost). Calm:
nothing was changed or lost. Recovery notices use the warning row (6.8).

---

## 7. Text quality and performance rules

- Integer weights only (400, 500, 600); no variable-weight tricks, no dark-mode weight reduction.
- UI text is 14px or larger; 12px is for meta and 11px only for keycaps; never 13px "UI".
- Every text colour is a solid hex from section 3.1; no `opacity` or alpha on text; disabled text is
  fg-4, not faded text.
- Text sits on opaque surfaces so WebView2 can use its best antialiasing; never put body text on
  a transparent layer over an animated canvas.
- `font-synthesis: none`; tabular numerals on anything that updates.
- No blur, `backdrop-filter`, glow or `text-shadow` anywhere; one box shadow, for floating things.
- Never `transition: all`; never animate `width`, `height`, `top`, `left`, margins or padding; fold
  with opacity and clipped transforms. Two measured website exceptions, both short and one element
  at a time: the rotating word slot's width (300ms) and an accordion panel opening by
  `grid-template-rows` (300ms).
- One live indicator animates at a time per row or card (a shimmer or a loader, not both); the
  dither field is the only ambient motion on a screen, and the app shows it only during the first
  launch intro and on the onboarding panel, never behind the transcript.
- All animation shares one `requestAnimationFrame` loop (`frameClock()`); offscreen, hidden and
  reduced-motion elements own no frame; DitherField caps at 30fps.
- Long lists virtualise; rows use `contain: layout style`.
- Pixel geometry lands on whole CSS pixels and uses `shape-rendering: crispEdges`.

---

## 8. Anti-slop and no-eyebrow checklist

Every screen ships only when all of these hold.

- [ ] No eyebrow text: no small uppercase or mono label above a heading, no tracked caps, no
      numbered "01" or "02" tags, no filler captions. A label exists only where the UI is ambiguous
      without it, and then it is sentence case in Geist, not mono.
- [ ] Mono only for machine data: paths, commands, code, durations, versions, keycaps, ids.
- [ ] Volt only for look here (needs you, live, new, the glint, lit dither pixels); never a button,
      a border, a background larger than a chip, or decoration.
- [ ] Green only for passed and added, red only for failed, removed and the one destructive pill;
      done is a white check. No orange, no agent hues, no project colours in chrome.
- [ ] No space imagery: no globe, orbit, satellite, starfield, orb or halo.
- [ ] No gradients (except the shimmer and glint primitives), no glass, no blur, no glow, no
      sparkle icons, no 3D.
- [ ] Two-tone headings at one size and weight; no serif, no italic, no gradient text.
- [ ] Structure from hairlines and value steps; cards only for things that float or dock.
- [ ] Pixels are square and crisp; status is a square, never a glowing dot.
- [ ] Nothing idles, breathes, pulses or parallaxes; motion starts with an event and ends with it;
      reduced motion is honoured from the OS and from `data-motion`, and content is never hidden.
- [ ] Concrete copy: verbs, objects and numbers ("Ran pnpm test · 19 passed · 4.2s"); no hype words,
      no emoji, no em dashes; risk said in words.
- [ ] Empty states are one sentence, the input and real recent work.
- [ ] Keys are visible: keycaps in menus, buttons, cards and hint lines.
- [ ] Nothing owned is copied: logos, wordmarks, illustrations, photography, font files.
