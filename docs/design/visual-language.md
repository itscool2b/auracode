# Graphite: the auracode visual language

Status: **Graphite replaces Orbit on 2026-10-26 (owner decision).** The product is **dark only**
(desktop, onboarding and website): no light theme, no system switching, no appearance setting. One
accent, **volt** `#CCFF33`, means look here. The signature is a **live ordered-dither field**.
The foundation ships in `@auracode/ui/graphite` (tokens, stylesheet, `DitherField`, `AgentMark`,
`Logo`, `Wordmark`, `StatusDot`, `PixelLoader`, `Keycap`, `CopyButton`); the website and the
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
   dither field, the 2x3 loader, the pixel check, status squares. No curves for decoration, no
   glow, no gradient, no glass, no blur. The logo (4.14) is the one curved shape, and it is a
   mark, not decoration.
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
| Announcement pill: chip, sentence, arrow coin | **Not taken** until a release is published (5.3) | None |
| White primary pill beside a dark secondary pill; colour 150ms `cubic-bezier(0.4, 0, 0.2, 1)`, no scale on press (measured) | Hero and closing CTAs (5.3, 5.12) | Primary and outline buttons (4.1) |
| Film card: a centred one-line heading, a large rounded card, "Play" and a caption line in large type | Film card replaying one turn (5.7) | None |
| Terminal card: mono, line numbers, "Thought for 4.1s"; 2x3 dot loader on a 660ms cycle (measured) | Product fragments in the film card and tiles (5.7, 5.8) | Code wells, the thinking line, `PixelLoader` (4.5, 6.4) |
| Sparse footer | Footer, without the dashed rule (5.13) | None |

### 2.2 X Money (money.x.com): two tones, tiles, FAQ, shimmer

| Trait | Lands on the website | Lands in the app |
|---|---|---|
| Two-tone stacked heading, same size and weight, second line grey | Every section heading (5) | Empty state, settings titles, onboarding (6) |
| Per-word flip-up: from `translateY(45%) rotateX(-40deg)` in a 1200px perspective, 650ms `cubic-bezier(0.23, 1, 0.32, 1)`, 100ms then 55ms per word (measured, identical at x.ai) | `.g-rise` on the hero and section headings (4.12) | Onboarding headings (6.17) |
| Recessed square tiles holding miniature real UI, the text set against each tile's bottom edge, one wide tile with a two-way toggle; hovering one dims the others to 0.5 over 500ms `cubic-bezier(0.32, 0.72, 0, 1)` (measured) | Staggered tiles with the checkpoint toggle (5.8) | Settings usage tiles (6.16) |
| Hairlines across the full column between sections | **Not taken**: sections are separated by space (5.1) | Settings groups (6.16) |
| FAQ accordion: 300ms ease-out-quint, the open row's tinted well slides between rows in about 270ms, the icon turns 90 degrees in 200ms (measured) | FAQ (5.11) | Advanced settings, expanded tool rows (6.4) |
| Grey-on-grey text shimmer: 100deg band, 250% wide, 1400ms linear (measured) | None | Thinking, running, live verbs (4.12) |
| Success check drawn in 250ms (measured) | None | `AgentMark` done check (4.13) |

### 2.3 Harvey (harvey.ai): word wheel, stats, timer tabs, slow hover

| Trait | Lands on the website | Lands in the app |
|---|---|---|
| Timer-driven vertical word wheel: one row step every 1100ms (600ms move on `cubic-bezier(0.7, 0, 0.7, 0.7)`, 500ms hold), 7 visible rows, opacity by distance 1, 0.6, 0.3, 0.1 (measured from the archived source) | Agent wheel in the first triptych tile (5.6), as solid greys | None |
| "Top performers" triptych: three tall textured tiles, a sentence-case title and grey paragraph under each | Triptych (5.6) | None |
| Stats with a rule above each number (Harvey's is 2px with 32px above the numeral) | **Not taken**: the numerals keep one rule (5.10) | Usage settings (6.16) |
| Capability list whose active item's 2px rule fills as a timer: 7500ms linear by `translateX(-100%)` to 0, paused on hover, switch 300ms `cubic-bezier(0.7, 0, 0.3, 1)` (measured) | **Not taken** on the website: the film card tells the turn (5.7) | Plan strip progress (6.5) |
| Nav hover dims the siblings over 300ms `cubic-bezier(0.3, 0.3, 0.3, 1)` (measured) | Nav (5.2) | None |
| Slow-settling button hover: 300ms `cubic-bezier(0, 0.7, 0.3, 1)`, 90% by 120ms, settled near 240ms (measured) | All buttons (4.1) | All buttons (4.1) |
| Harvey's serif | **Not taken.** Graphite is one grotesk | Not taken |

### 2.4 Aside (aside.com): column frame, lead-ins, rows

| Trait | Lands on the website | Lands in the app |
|---|---|---|
| Content column framed by full-height 1px side rules (1248px column, measured) | **Not taken**: no column rules (5.1) | None |
| Bold lead sentence, grey continuation, one paragraph | Feature copy, intro paragraphs (4.12) | Settings descriptions, onboarding (6) |
| Rows entering: 8px rise, 340ms `cubic-bezier(0.22, 1, 0.36, 1)`, 70ms apart (measured) | `.g-enter` on rows (4.12) | Ledger and roster rows (6.13, 6.17) |
| Rows on hairlines with a segmented control | Spec rows on the download cards, account lists (5.14) | Settings, right panel tabs (6.14, 6.16) |
| Airy footer | Footer spacing (5.13) | None |
| Composer control row of quiet text controls | None | Composer (6.9) |

### 2.5 Vercel: grid frames, cells, real fragments

| Trait | Lands on the website | Lands in the app |
|---|---|---|
| Hairline grid frames with "+" crosshairs on the corners: 21px crosses with 10px arms in `#878787`, guides at white 9% (measured) | **Not taken**: no guides or crosshairs (5.1) | None |
| One frame of joined panels divided by its own rule | The strip (5.9) | Settings agent roster (6.16) |
| Mocks built from real UI fragments: timelines, agent tables, status dots | The strip (5.9) | The same components, live (6) |
| Geist everywhere; command pill with copy | Geist everywhere (5.1) | Code blocks (4.8) |
| Dark buttons `#0A0A0A` to `#1F1F1F` in 150ms; footer links in 100ms (measured) | `--g-dur-fast`, `--g-dur-micro` (3.8) | Rows and icon buttons |

### 2.6 AI in Design Report 2026: uniqueness bar, not copied

The report sets the bar for distinctiveness: giant edge-to-edge type, dithered and pixel imagery,
big numerals split by rules, numerals counting up in about 950ms (measured). We copy none of its
artwork or layout; its dither is a baked video, ours is drawn live. Our answers to the bar are the
dither field (4.15) with its seals and turtles (5.4), the giant Geist Pixel numerals condensing
out of the field (5.10) and the giant dithered footer wordmark (5.13).

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

4px base: `--g-space-2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160`. The desktop
app writes every margin, padding and gap with these tokens (only 0 and 1px hairlines are literal);
geometry that follows a layout value (the 24px transcript gutter, the 52px titlebar band, a mark's
width) is written from that value. `.github/scripts/check-styles.mjs` keeps the app's stylesheets on
the colour, space, radius, type, weight and motion tokens.
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
| idle | The agent's code in Geist, fg-2: one letter under 24px at `0.56 * size`, two letters from 24px at `0.38 * size`; weight 500, or 600 below a 12px glyph |
| thinking, streaming, tool | The 2x3 pixel loader (4.5) at its state's tempo |
| waiting | A solid volt square, `0.375 * size` (parity-adjusted to centre on whole pixels) |
| done | A white pixel check (cells `max(2, round(size / 8))`), drawn once a pixel at a time, 50ms apart (about 250ms, X Money's check), by CSS |
| error | A solid red square, same geometry as waiting |
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
24 (onboarding roster, agent dock, library), 32 (Agents, settings), 48 (settings), 56 (empty
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
- `og.png`, a 1200 x 630 social card with the logo at half height in a still dither field that
  thins to black around it.

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

---

## 5. Website composition (auracode.si)

### 5.1 Page and type

Black page, `.g-root` on `<html>`, body 16/26. One content column, max 1200px, gutters
`clamp(16px, 4vw, 40px)`, content inset 40px from 1024px up. Sections are separated by space
alone (88, 120 and 152px above and below each at phone, tablet and desktop widths), never by
rules: no column guides, no section or footer hairlines, no crosshairs. A section keeps at most one
deliberate line system where its reference has one: the strip's frame (5.9), the numerals' rule
(5.10), spec rows on cards. Prerendered; works without JavaScript: fields fall back to their images
and the entrances are CSS.

Type is locked to the hero (x.ai's h1 60/60 450 and h2 48/48 500, Aside's hero 48/52 400, measured;
Graphite rounds the weights to 500). The display style is Geist 500 at -0.04em, for the hero and the
closing statement. Every section heading, and every inner page title, is one size, `clamp(32px,
1.75vw + 23px, 48px)` / 1.06 / -0.035em, and two-tone: the statement in fg-1, its continuation in
fg-3 on its own line (the film card's one-line heading keeps both on one line). One lead (20/30,
18/28 on phones, fg-3), one body (16/26), and captions as a 16/26 500 fg-1 title over 16/26 fg-3
text. Geist Pixel sets only the giant numerals (5.10).

### 5.2 Nav

64px, sticky; transparent over the stage, black once scrolled, with no rule under it. Left:
`Wordmark` 16 linking home. Download and Changelog as 14/20 500 fg-2 links (hover fg-1; the
siblings dim to fg-3 over 300ms `--g-ease-soft`, Harvey). Right: "Sign in" and the primary
"Download". Under 768px the links fold into a menu button opening a full-width sheet.

### 5.3 Hero

The stage DitherField fills the hero and continues behind the product frame: `standard`, density
0.4, `edges` 0.5, `ceiling` 0.78, accent 0.012, `interactive`, its own seed. Three clearings: one
measured around the headline, lead and buttons (1.55 times their half-width across and 1.7 times
their half-height down; 3 and 1.8 on phones, where the copy fills the width), one along the product
frame's top edge, and one fading the field out toward the stage's bottom edge, so the field gathers
at the sides, stays calm behind the copy and never meets the frame in a blob. Seals and turtles swim
through it (5.4). Centred over it:

- **Headline** (`--g-web-hero`, line height 1, -0.04em, 500): "One window for" / "Claude Code."
  The agent name rotates every 3000ms through every designed agent (x.ai, measured): the old
  letters leave last-first, 15ms apart, each fading and rising 0.23em in 250ms `--g-ease-out`; the
  new letters arrive from 0.23em below, 25ms apart; the slot's width morphs to the new name in
  300ms and the underline follows it, its volt glint sweeping 400ms after each swap. The headline
  never reflows: both lines keep their height and position for every name. Reduced motion: no
  rotation.
- **Lead** (20/30, max 600, 32px under): "**The coding agents you already use, together in one
  chat.** auracode runs each one through its own harness, on your machine. Free, local, and no
  account needed."
- **Buttons** (40px under, gap 12): primary 44 "Download", outline 44 "Invited sign-in".
- **Load choreography** (x.ai, measured): the headline words flip up (`.g-rise`) from 100ms, 55ms
  apart; the underline draws over 800ms at 800ms; the lead fades in over 380ms at 580ms and the
  buttons at 700ms; the product frame fades in over 1250ms at 760ms. Reduced motion: everything
  present at first paint, words by the 150ms fade.

### 5.4 Seals and turtles

Sprites (4.15) drawn as pixel art in the field's greys: a sea turtle seen from above (31 by 34
cells, four frames in which the front and rear flippers stroke in turn, 2.5 frames a second) and a
harbour seal from the side (49 by 15 cells, four frames of body undulation and a fanning tail, 4
frames a second, now and then a lazy roll). Turtles glide at 8 to 10px a second, seals at 16 to
24px. The hero carries a seal in the open water above the headline and a turtle and a seal in the
side wings; on a phone, two seals keep above the headline. The closing band carries a turtle and a
seal, and on a phone two seals above and below the statement. They fade into the clearings, leave
one side before returning on the other, ease away from the pointer lens, freeze where they are under
reduced motion and appear in the fallback images' first frame.

### 5.5 Product frame

Under the hero, the real app (a captured screenshot, WebP sources, real alt text) in a 1200px frame,
radius 12, one 1px line-strong ring and nothing around it. Its own field dissolves into the
screenshot (`order "down"`, `reveal`): `progress` is already about 0.35 when the page opens, so the
top of the screenshot has formed at first sight, and reaches 1 when the frame's top is at 55% of the
viewport. Phones, where a dithered screenshot is too small to read, reduced motion and no
JavaScript show the screenshot at once.

### 5.6 Triptych (Harvey's top performers)

Two-tone heading: "Bring the agents you already use." / "auracode runs each one through its own
harness." Three 4:5 recessed tiles (surface-1, radius 16) on a dim, still grain field (`quiet`,
density 0.72, `ceiling` 0.42, transparent), 24px apart, each with a caption under it:

1. "Your agents, as they are": the agent word wheel (Harvey, measured from its archived source):
   seven rows of 32px names; every 1100ms the column moves up one pitch over 600ms `--g-ease-step`
   and holds 500ms; colour by distance as solid greys (fg-1, fg-3, fg-4, line-strong), no fade
   mask. It runs only in view; reduced motion and no JavaScript show a static list.
2. "Switch agents mid-chat": two cursor chips, "Claude Code" and "Codex", drifting over a chat card
   that shows the switch, as Harvey's two cursors share one document.
3. "Runs where you work": a list of true platform facts (Windows x64, Windows ARM64, macOS on Apple
   silicon, macOS on Intel, works offline, no account needed, your own agent logins) scrolling
   upward, 24s a loop.

### 5.7 Film card (x.ai)

Centred one-line heading: "One turn, start to finish." A card (surface-1, radius 24) over a dimmed,
transparent field (`quiet`, density 0.62, `ceiling` 0.5, calm behind the copy). Left: a Play or
Pause text button with a pixel icon, and the caption line, both 26 to 32px. Right: a 440px window
replaying one turn from Graphite fragments over 10.4s: the empty state, the prompt typing into the
composer, the agent working, Read and Edited tool rows, an approval card for `cargo test` that
resolves to "Ran cargo test, 14 passed", the diff, and the receipt (48s, 2 files, +59 −12). The
caption changes with each step. It plays once when 35% in view and then holds the finished turn;
Play replays it and Pause holds it (a real button named by its visible label). The server render,
reduced motion and no JavaScript show the finished turn without the button.

### 5.8 Staggered tiles (X Money)

Two-tone heading: "Full auto by default." / "Every control within reach." Square recessed tiles
(surface-1, radius 16) with live miniatures, two pairs to a row, each tile's text block (caption
style) set against its bottom edge beside it; the middle row's wide tile starts where the first
pair's text would be, as X Money's does. No numbers. Items: "Full auto, by default" (the autonomy
menu, its selection walking the three levels every 2400ms), "Queue and steer" (a running turn, two
messages queued behind it and the hint line), "A checkpoint every turn" (the wide tile: "This turn"
and "Before it" toggle buttons show the file as the turn left it and as the checkpoint kept it,
alternating every 3200ms until someone picks a side), "Plans you can read" (the plan card) and
"Keyboard first" (⌘N, ⌘K, ⌘J, ⌘, and Esc lighting in turn). Tablets set one pair per row; phones
stack each tile over its text.

### 5.9 Strip (Vercel)

Two-tone heading: "Run several at once." / "Each chat works on its own.", with a lead at right.
One framed band (1px line, radius 16, 340px tall), the frame's rule between its three joined
panels: one turn's tool calls on a timeline (ACP kinds in mono, duration bars growing in turn, the
running one in fg-1), the sessions running side by side (title, agent, and Running with the loader,
Waiting on you in volt or Done) scrolling slowly upward, and every supported agent as chips
drifting in three rows. Under it one row of three notes, each a pixel glyph and a sentence-case
title over grey text: the Needs you inbox, marks that show state, notifications. Phones stack the
panels and drop the chips.

### 5.10 Giant numerals (AI in Design)

Two-tone heading: "Local by default." / "Nothing to sign up for." Three numerals, 9, 2 and 0, in
Geist Pixel at 340px (128px on phones), each condensing out of its own `bright` field (density
0.22, a text target, scatter order) as the section scrolls in, left to right; one 1px line-strong
rule splits them from their captions (title 20/30 500, note 16/26 fg-3): agents supported, plus any
agent that speaks ACP; platforms, Windows and macOS; accounts needed, to use the app. Phones set
each numeral beside its caption, without the rule. Reduced motion: the formed frames. No
JavaScript: the numerals as Geist Pixel text.

### 5.11 FAQ (X Money)

Two equal columns from 1024px: left, the two-tone heading "Questions, answered." / "Before you
install." and an outline 36 "Privacy notice"; right, disclosure rows 4px apart (52px closed rows),
summary 16/24 500, body 16/26 fg-2, one open at a time, the first open on load, no rules between
them. Opening: 300ms `--g-ease-quint`, the surface-2 well sliding from the previously open row in
about 270ms (4.11).

### 5.12 Closing

Centred: "Your agents." / "Your machine." in the display style (`clamp(44px, 6vw, 80px)`), 40px
gap, the primary 44 "Download". Behind it a dark band field (`standard` capped by a `ceiling` of
0.55, calm behind the words and fading out toward the band's top and bottom edges) with a turtle and
a seal (5.4).

### 5.13 Footer with the giant dithered wordmark

No rules. A top row: `Wordmark` 16 and "One window for your coding agents." in 14/22 fg-3 at left,
link columns (Product, Account, Legal) at right, heading 14/22 500 fg-1, links 14/22 fg-3 (hover
fg-1). Then, edge to edge, a DitherField `clamp(120px, 20vw, 280px)` tall: `target { kind: "text",
text: "auracode", anchor: "bottom", inset 8 }`, `bright` palette, `order "up"`, progress
scroll-linked from 0 as it enters to 1 when its bottom reaches the viewport's bottom; `still` once
formed. Reduced motion: the formed still frame. No JavaScript: the word as text.

### 5.14 Inner pages

- **Download**: two-tone title "Download auracode." / "Free, local, no account." Two recessed cards
  (surface-1, radius 16), one per platform: name, architectures, spec rows on hairlines (the page's
  one line system), and the action. Linux is not offered.
- **Sign in, sign up, verify device**: a centred 480px column; the title in the section heading
  style, two-tone; a recessed panel (surface-1, radius 16, no border) holding the form. One action
  per screen.
- **Account**: settings groups separated by space in a narrow column; device and security lists
  keep their row rules.
- **Legal** (privacy, terms, third-party notices): 680px column, prose headings separated by space,
  body 16/26 fg-2 with fg-1 emphasis.
- **Changelog**: one entry per release, separated by space: the date and status at left, notes as
  prose 16/26.
- **404**: a full-viewport DitherField with a text target "404" (`bright`, `still` under reduced
  motion) and under it a two-tone line "This page does not exist." / "It may have moved." with a
  primary 44 "Go home".

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

1. Band (52px, drags the window): the 24px logo (fg-1) at x 20, or at x 84 on macOS, clear of the
   traffic lights (`data-os` on the app); the 28px collapse toggle at the right (⌘\).
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
6. **Agent dock** (above the account row, no line): one 28px `AgentMark` tile per usable product,
   4px apart from x 20. A product is a brand (Claude Code and its ACP adapter are one); its tile is
   the first ready variant in catalog order, which lists native before adapters. Missing, broken and
   alternate variants, and the scripted demo while a real agent is usable, wait behind a dashed
   "+N" tile whose menu starts a chat with a usable variant or opens the Agents screen to install
   one. Each state has its own look and one small motion: detecting, a dashed open tile with the
   code in fg-3 and a 1px fg-3 line scanning it top to bottom (1400ms, linear); found, the filled
   tile settles in once (opacity and scale 0.86 to 1, 250ms `--g-ease-out`); a sign-in or an update,
   a 4px fg-1 square on the corner; working, the walking loader; needs you, the volt square, arriving
   once and never pulsing. Under the hand the ring and code step up to fg over Harvey's 300ms settle.
   Reduced motion holds every tile still. Graphite's tooltip names the agent, state and version
   after 500ms. Click opens the agent card (296px): 32px mark, name 16/22 600, version and state in
   mono 12 fg-3, one line about it, "New chat with Claude Code" (soft 28), "Agent settings" (ghost),
   then the verified install's actions.
7. **Account row** (44px, after Vercel's user row and Grok's avatar): a 28px round avatar with the
   profile's initials (surface-3, line-strong ring, 12/16 600 fg-1), the name 14/20 500 fg-1 over its
   storage or sync state in 12/16 fg-3, and a 28px kebab that opens a 220px menu: Settings (⌘ ,),
   Agents, Diagnostics.

Collapsed rail: 72px (⌘\ or the toggle): the toggle, then Search and New chat as 32px icon rows;
the logo, the projects, the dock and the account row step aside until it opens again.

### 6.3 Chat header

44px, padding 0 8 0 16, Grok's restraint: at most three controls. Left: the chat's live `AgentMark`
(16), 8px, the title 14/20 500 fg-1 (truncates at 420), the project in fg-3, then the status only
when it says something (working, "Waiting on you" in volt, failed or a sign-in in red); Ready and
Stopped stay for screen readers. Right (gap 4): the Changes panel toggle (28px ghost, surface-3
while open, ⌘ J) and the chat menu (28px). The menu (288px, plain 32px rows in groups on hairlines)
starts with the session's facts (agent, the version that runs, its path, context and cost), then
Git workspace, Terminal and editor, Conversation history; Export chat, Copy debug bundle, Show log;
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
  with Codex" (ghost).
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
and "Create" (the one primary). Under the card, on one 16px axis: the busy-folder well (one volt
square and an explicit consent), the download note, errors, the selected agent's version and path
opening its details in place, and "Other agents" with each one's reason. A later worktree chip row
goes directly under the card.

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
changes, Git workspace, Terminal and editor, Conversation history, Export chat, Copy debug bundle,
Show log, Stop or Resume session, Start fresh). Context menus (4.6): message (Copy, Copy as Markdown, Copy receipt; Retry, Edit
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
3. **Account**: "Accounts are optional." / "auracode works without one." and one sentence saying sync
   is invite-only and how to use an invitation, with "Open Account" (outline).
4. **First project**: "Add a first project." / "Any folder works." a 96px dashed drop zone ("Choose a
   folder", "or drop it here"), the name field and "Add project" once a folder is chosen, then
   "Clone from GitHub" (ghost) and, when projects exist, "Or choose a project".

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
with `.g-enter`. Reduced motion: everything in place, the loader still.

### 6.18 Library

Vercel's page grammar: Back, "Library" in `.g-text-title` with one line under it, Refresh (ghost
icon) and Manage integrations (outline) at right, then a 36px search and two selects (source,
agent). One frame of three panes on the page's 32px column: the views as plain 32px rows with
counts (the current one filled surface-3) and Copy history after one divider (a volt square when a
copy needs recovery), Sources folded at the bottom; the items as 56px rows on hairlines (a 24px
`AgentMark`, name 14/20 500, agent and scope in 12/16 fg-3; the selected row surface-2 with the
rail); the chosen item with its title 16/22 600, its file in a well with a 36px head, and "Copy to"
with Review copy (the page's one primary). Empty states are a title and one line.

### 6.19 Dialogs and sheets

Every dialog is 4.6's shell, in one of its three widths, on Vercel's transfer dialog: the title,
one sentence saying what happens to what (the variables in fg-1 500), the details as key and value
rows on hairlines or a hairline grid of versions, then `.g-dialog-actions`: Cancel (soft) and one
primary, or the red pill for a removal. The TerminalSheet (sign-in, installs, vendor commands) is
the large dialog: its sentence says closing stops the process and output is not saved, the
reviewed command as rows, a status line led by its mark (a still green square while running, the
white check or red square after), the terminal well at 144px until Start and full height after,
and Copy selection beside the one Start.

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
  launch intro and behind the onboarding column, never behind the transcript.
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
