# Orbit: the auracode visual language

Status: the redesign direction for the Design Lab (M1a), written 2026-10-24 after the owner rejected
Aurora, Noir and Halo, and built in the lab as `#/orbit` (`apps/design-lab/src/directions/orbit/`).
Orbit is the chosen direction: the lab's gallery opens with it, marked as chosen, and it graduates
into the real UI in M2a. It replaces the "Aura" language in `docs/plan.md` (UX spec: app, design
language, thinking orbs, boot cinematic, onboarding step 4, and the website's "Aura design language");
`docs/plan.md` itself is not yet updated (see section 8). Every number here is meant to be built as
written.

---

## 1. Direction

**Name:** Orbit. **Id:** `orbit`.

**Thesis:** Mission control for your agents: black and white, plain sentences and real numbers, a
line-drawn orbit for every agent, and one orange that means look here.

What that looks like:

- The window reads like a SpaceXAI instrument or an X Money statement. Light theme is ink on warm white
  paper laid on a warm grey desk (Harvey's tray, x.ai's ivory). Dark theme is lights-out black (X,
  SpaceXAI). Surfaces are solid and separated by 1px hairlines, not glass, glow or shadow.
- One grotesk, Geist, sets every word of the interface. Geist Mono sets everything a machine made:
  paths, commands, durations, counts, versions, diffs.
- Agents report their work as sentences with numbers: "Ran pnpm test", "19 passed", "4.2s",
  "+59 −23". Finished work collapses to one line. Nothing is called "magic" and nothing sparkles.
- The glowing orb becomes the **Orbit mark**: a small node with a square satellite riding the agent's
  own 1px orbit. The orbit's shape is the agent's identity; what the satellite does is the agent's
  state. At hero size the body becomes SpaceXAI's calm solid globe with a sparse graticule, square
  markers and mono labels.
- Color is spent on four meanings and nothing else: **orange** (look here: an agent needs you,
  something is new, a warning), **green** (done, allowed, added), **red** (failed, denied, removed),
  and **ink** for everything else. There are no agent hues, no accent picker and no decorative
  gradients.

How it answers the owner's three messages:

- "Copy these sites in certain elements": the frame is Grok Bot's window laid on Harvey's tray; the
  composer and model menu are Grok's; numbers, receipts and confirm sheets are X Money's; the hero is
  SpaceXAI's globe with square markers; the composer control row and autonomy levels are Aside's.
  Section 2 lists every borrowing with its source.
- "Right now it kinda looks like AI slop": everything the rejected directions used to signal "AI" is
  gone: purple and pink wallpapers, glass panels, glow lobes, glossy blob orbs, italic serif heroes,
  sparkle icons, glowing buttons. Section 7 is the checklist.
- "Implement that type of styling everywhere": section 4 specifies every surface, from the titlebar
  to the boot moment and the website hero.

---

## 2. What we copy from where

Images are in the research folder
`/private/tmp/claude-501/-Users-itscool2b-Desktop-coding-folder-auracode/d8fa469e-d838-43ce-8a75-2cd4fce641be/scratchpad/refs/`;
paths below are relative to it. Each row's exact measurements are in that folder's
`<cluster>/catalog.json`. We copy layout, component treatment, type choice, spacing, color and motion.
We never copy logos, wordmarks, illustrations, photography or font files.

### 2.1 SpaceXAI (x.ai, Grok, Grok Bot, Grok Build): the owner's top reference

| # | Element | Source (app, link, image) | Becomes in auracode |
|---|---|---|---|
| 1 | Line-drawn globe, 16px zero-radius square markers, mono labels and coordinates, thin great-circle arcs | SpaceXAI Careers "Offices", https://x.ai/careers, `spacexai/spacexai-live-careers-globe-t9s.png`, `spacexai/spacexai-mobbin-careers-globe-offices.jpg` | The globe at the center of boot, onboarding discovery and the website, drawn solid and sparse with a graticule instead of the map (5.7); its square markers become every satellite (5) |
| 2 | Neutral three-pane agent window: one material, 1px rings, no drop shadow, 44px toolbar | Grok Bot desktop mockup, https://x.ai/bot, `spacexai/spacexai-live-bot-appmock-t2s.png`, `spacexai/spacexai-live-bot-dark-mock1.png` | Window, sidebar and pane structure (4.1) |
| 3 | Avatar state system: state lives inside the mark, color appears only when something changes | Designing Grok Bot, https://x.ai/news/designing-grok-bot, `spacexai/spacexai-live-news-dgb-avatar-states-sheet.jpg` | The Orbit mark's state rules; we keep the rules, not the characters with eyes (5) |
| 4 | Pending row at the transcript tail, the working agent's mark plus a quiet label | Grok Bot mockup, https://x.ai/bot, `spacexai/spacexai-live-bot-appmock-t2s.png` | The transcript's now-row (4.4) |
| 5 | 2x3 dot loader; filled diamond for awaiting, hollow diamond for idle | Grok Build terminal and Agent Dashboard, https://x.ai/build, https://x.ai/news/agent-dashboard, `spacexai/spacexai-live-build-05-subagents-t7s.png`, `spacexai/spacexai-live-news-agentdash-terminal2.png` | Sidebar status pips: loader means running, orange diamond means needs you (5.6) |
| 6 | Dashboard grouped by who needs you, counters split by thin bars | Agent Dashboard, https://x.ai/news/agent-dashboard, `spacexai/spacexai-live-news-agentdash-terminal1.png` | The sidebar's Needs you group and the menu bar dropdown (4.2, 4.17) |
| 7 | Inverted user bubble (darkest object on screen), near-invisible agent side | Grok Bot mockup, https://x.ai/bot, `spacexai/spacexai-live-bot-appmock-t2s.png`, `spacexai/spacexai-live-bot-dark-mock1.png` | The user message as an ink block; agent prose bare on the pane (4.4) |
| 8 | Centered one-line system events with entity chips | Grok Bot mockup and events demo, https://x.ai/bot, `spacexai/spacexai-live-bot-appmock-t17s.png` | Agent switches, autonomy changes, checkpoints, renames (4.4) |
| 9 | Thinking disclosure stamped with an exact duration | Grok product page, https://x.ai/grok, `spacexai/spacexai-live-grok-01-chat-t14s.png` | The "Thought for 6s" line (4.4) |
| 10 | Bold lead-in, muted continuation in list items | Grok product page, https://x.ai/grok, `spacexai/spacexai-live-grok-02-multi-agent-t14s.png` | Agent markdown lists (4.4) |
| 11 | Tool row: sans label for what happened, mono literal for the exact input, count at right | Grok search mockup, https://x.ai/grok, `spacexai/spacexai-live-grok-03-search-t8s.png` | Tool call rows (4.4) |
| 12 | Terminal grammar: verb, args, result, `[running]` and `[done]` tags | Grok Build, https://x.ai/build, `spacexai/spacexai-live-build-05-subagents-t13s.png` | Subagent rows and terminal status (4.4) |
| 13 | Inline diff with tinted rows and colored line numbers | Grok Build Skills, https://x.ai/build, `spacexai/spacexai-live-build-01-skills-t13s.png` | Diffs in the transcript (4.4) |
| 14 | plan.md document with line numbers and one-key approval | Grok Build Plan, https://x.ai/build, `spacexai/spacexai-live-build-02-plan-t13s.png` | Plan approval card (4.5) |
| 15 | Workflow phases with fan-out counts | Grok Build Workflows, https://x.ai/news/workflows, `spacexai/spacexai-live-news-workflows-terminal1.png` | Plan tab when subagents run (4.16) |
| 16 | Keyboard-first question card with numbered options and a pager | Grok Build Q&A, https://x.ai/build, `spacexai/spacexai-live-build-04-q-a-t13s.png` | Question card (4.7) |
| 17 | Receipt checklist turn summary | Grok Bot mockup, https://x.ai/bot, `spacexai/spacexai-live-bot-appmock-t17s.png` | Turn footer receipt (4.4) |
| 18 | Status bar: path, context meter, model and approval mode as plain text | Grok Build hero, https://x.ai/build, `spacexai/spacexai-live-build-terminal-statusbar-crop.png` | Composer control row and context meter (4.9) |
| 19 | Single-material composer; model control is text with a chevron | grok.com, https://grok.com, `spacexai/grok-web-composer-typed-dark.png`, `spacexai/grok-web-composer-typed-light.png` | Composer (4.9) |
| 20 | Model menu with one meaningful icon and a one-line subtitle per row | grok.com and Grok iOS, https://grok.com, `spacexai/grok-web-model-picker-crop-dark.png`, `spacexai/grok-ios-model-picker.jpg` | Picker model column (4.10) |
| 21 | Segmented control with one black pill | x.ai Pricing, https://x.ai/pricing, `spacexai/spacexai-live-pricing-01.png` | Right panel tabs, motion setting (4.16, 4.15) |
| 22 | Black pill primary, warm grey soft secondary, split button | x.ai site, https://x.ai, `spacexai/spacexai-live-home-hero-t7s.png`, `spacexai/spacexai-live-home-dark-y0.png` | All buttons; Queue or Steer split send (3.9, 4.9) |
| 23 | Mono and tracked-caps micro labels used only for data | Grok Bot changelog, Grok iOS settings, https://x.ai/changelog/bot, `spacexai/spacexai-live-botchangelog-02.png`, `spacexai/grok-ios-settings-mono-version-footer.jpg` | Section labels, eyebrows, version footer (3.2) |
| 24 | Announcement pill with the single orange accent ("New") | x.ai hero, https://x.ai, `spacexai/spacexai-live-home-hero-t7s.png` | The NEW chip, the website announcement, and the orange signal itself (3.1) |
| 25 | One-shot glint traveling under one rotating word | x.ai hero, https://x.ai, `spacexai/spacexai-mobbin-home-hero-imagine.jpg` | Agent switch in the empty state; the website's rotating agent name, recolored to an ink rule with an orange highlight (4.13, 4.19) |
| 26 | Code window chrome on a pixel-notched art frame | x.ai API, https://x.ai/api, `spacexai/spacexai-live-api-01.png`, `spacexai/spacexai-live-home-apicode-t2s.png` | Website product frame; code block header (4.19, 4.4) |
| 27 | Telemetry stats split by hairlines, drafting grid behind a big numeral | x.ai home dark and Colossus, https://x.ai/colossus, `spacexai/spacexai-live-home-dark-y1300.png`, `spacexai/spacexai-live-colossus-01.png` | Usage settings and the website stats row (4.15, 4.19) |
| 28 | Mission-checklist onboarding beside a black night-sky panel | Grok Console onboarding, https://mobbin.com/flows/0a988ace-d6ce-4fcb-a1bd-5e1db4b71236, `spacexai/grok-console-onboarding-create-team.jpg` | Onboarding layout (4.14) |
| 29 | Empty means empty: one sentence and the input | grok.com home, https://grok.com, `spacexai/grok-web-home-loggedout-light.png` | Empty state (4.13) |
| 30 | List-first settings with preview tiles and black switches | Grok web settings, https://mobbin.com/screens/e5aafdde-2235-443b-bcd1-5834f497d1ef, `spacexai/grok-web-settings-appearance-dark.jpg` | Settings (4.15) |
| 31 | Status badge rule: tone text on the same tone at 14%, a 5px mark | Grok Bot computer card, https://x.ai/bot, `spacexai/spacexai-live-bot-computer-card-t8s.png` | Status pills (3.9) |

### 2.2 X Money (money.x.com, X Money in the X app, X core)

| # | Element | Source (app, link, image) | Becomes in auracode |
|---|---|---|---|
| 32 | Two-tone stacked headline: same size and weight, second clause at 60% | money.x.com, https://money.x.com/en, `xmoney/xmoney-site-scroll-02.png` | Empty state, onboarding, settings headers, website (3.2) |
| 33 | Grey verb, full-contrast object sentence ("Transfer **$1** from **Mastercard**") | X Money Confirm Transfer, https://mobbin.com/screens/13e8280f-2f25-4984-bb7e-be55d3986dce, `xmoney/x-money-confirm-transfer-sheet.jpg` | Permission title, empty-state sentence, tool summaries (4.6, 4.13) |
| 34 | Floating detached confirm sheet with one decisive pill; red pill only for destruction | X Money confirm and close-account sheets, same link, `xmoney/x-money-confirm-transfer-sheet.jpg`, `xmoney/x-money-close-account-sheet.jpg` | Revert turn, delete chat, remove agent (4.8) |
| 35 | Dashed 8/8 tear line over right-aligned key-value rows | X Money transaction detail, https://mobbin.com/screens/cea08aae-677f-4a2c-92c2-9906491f1f0a, `xmoney/x-money-transaction-detail-menu.jpg` | Permission details, expanded tool rows, turn receipt (4.6, 4.4) |
| 36 | Hero numeral with superscript decimals at about 40% | X Money app in the site mocks, https://money.x.com/en, `xmoney/xmoney-zoom-phone-balance-dark.png` | Session tab cost and tokens, Changes summary (4.16) |
| 37 | Stat card pair and recessed tiles | X Money My account, https://mobbin.com/screens/808bd1da-961f-456c-bfd1-302558525e70, `xmoney/x-money-my-account.jpg`, `xmoney/xmoney-zoom-tiles-dark.png` | Session usage tiles, usage settings (4.16, 4.15) |
| 38 | Vertical stepper with dashed connector, pending rings | X Card tracking, https://mobbin.com/screens/485ba275-39a1-4d3f-8e1c-b99c798ddd01, `xmoney/x-money-card-ordered-tracking.jpg` | Plan stepper, onboarding checklist; the blue halo becomes a ring spinner (4.5, 4.14) |
| 39 | Orbital hairlines: partial circles, chords, a dashed orbit with a hollow node | X App Store art and the X Card line art, https://apps.apple.com/us/app/x/id333903271, https://mobbin.com/screens/a8d32e0d-9dfa-4061-b143-2a654fbde5f8, `xmoney/x-appstore-03.jpg`, `xmoney/x-money-order-metal-card-banner.jpg` | The Orbit mark's drawing technique, with our own geometry (5) |
| 40 | Ripple ring per event (scale 1 to 2, opacity 0 to .3 to 0, 620ms) | money.x.com contactless tile, https://money.x.com/en, `xmoney/xmoney-nfc-hover-04.png` | One ring per tool event and on entering waiting (5.4) |
| 41 | Grey-on-grey text shimmer (30% to 60% ink, 1.4s linear) | money.x.com shipped CSS, https://money.x.com/en, `xmoney/xmoney-site-viewport.png` | Every live label (3.8) |
| 42 | Verify-to-success morph ending in a stroke-drawn check | money.x.com security tile, https://money.x.com/en, `xmoney/xmoney-faceid-hover-08.png` | Allowed, plan step done, agent connected, turn done (5.4) |
| 43 | Per-word flip-up headline entrance | money.x.com hero, https://money.x.com/en, `xmoney/xmoney-zoom-hero-light.png` | Empty-state agent switch, onboarding headings, boot wordmark, website hero (3.8) |
| 44 | Switcher popover with two-line items and nested radii | money.x.com sidebar switcher, https://money.x.com/en, `xmoney/xmoney-switcher-open-dark.png` | Picker agent column, project switcher (4.10) |
| 45 | Sidebar nav whose hover changes letter weight, not a fill | money.x.com sidebar, https://money.x.com/en, `xmoney/xmoney-nav-hover-dark.png` | Sidebar rows, settings nav (4.2, 4.15) |
| 46 | Translucent dark toast | X Money toasts, https://mobbin.com/screens/384bd511-a32c-4290-8671-243d01fc0591, `xmoney/x-money-toast-extra-account.jpg` | Toasts, the one place CSS blur is allowed (4.17) |
| 47 | Notification celebrating with one green figure | X App Store "Create & earn", https://apps.apple.com/us/app/x/id333903271, `xmoney/x-appstore-04.jpg` | Agent-finished notification with +248 in green (4.17) |
| 48 | Card-peek stack that previews hidden state | X Money home, https://mobbin.com/screens/dc29dc0a-6428-4e28-a1a9-3e9b37ca6919, `xmoney/x-money-home.jpg` | Queue (4.12) |
| 49 | Accordion whose open item becomes a tinted well | money.x.com FAQ, https://money.x.com/en, `xmoney/xmoney-zoom-faq-dark.png` | Expanded tool rows, advanced settings (4.4) |
| 50 | Receipt card: amount, value-over-label stacks, id, dashed divider | X Money View receipt, https://mobbin.com/screens/75303d60-0af4-4ff8-9319-ecf461a1ef4a, `xmoney/x-money-receipt.jpg` | "Copy receipt" for a turn (4.4) |
| 51 | Grouped inset settings panels | X Money Security and Privacy, https://mobbin.com/screens/0ea8c478-32b3-446b-b8ab-7671bb8ddf6c, `xmoney/x-money-security-privacy-toggles.jpg` | Settings groups (4.15) |
| 52 | Selectable cards where selection is a rim and a filled check, no color | X web Premium paywall, https://mobbin.com/screens/f2ecab67-0c0c-4bd9-b73c-6814ec4a009d, `xmoney/x-web-premium-dark-paywall.jpg` | Autonomy menu selection, appearance tiles (4.11, 4.15) |
| 53 | Sparse static starfield on black | X web Premium paywall, same link, `xmoney/x-web-premium-dark-paywall.jpg` | Onboarding night panel and the dark boot only (4.14, 4.18) |
| 54 | Privacy mask that swaps every figure for asterisks without reflow | X Money balance hidden, https://mobbin.com/screens/af77fad2-56b6-47ce-8f8d-a03c93c80315, `xmoney/x-money-balance-hidden.jpg` | Secrets in terminal output; hide costs while screen sharing (4.4, 4.15) |
| 55 | Overflow menu with one destructive row, grouped last | X Money transaction menu, https://mobbin.com/screens/cea08aae-677f-4a2c-92c2-9906491f1f0a, `xmoney/x-money-transaction-detail-menu.jpg` | Message and chat context menus (4.20) |
| 56 | Strict columns and hairlines on true black | X web Lights out, https://mobbin.com/screens/c0ef7227-329b-4d89-a1ca-7630944fbf80, `xmoney/x-web-home-dark.jpg` | The dark theme's structure and the collapsed icon rail (4.1, 4.2) |
| 57 | Editorial square tiles holding miniaturized real UI | money.x.com feature grid, https://money.x.com/en, `xmoney/xmoney-site-scroll-03.png` | Website feature grid (4.19) |

### 2.3 Harvey (harvey.ai) and Legora, its closest competitor

| # | Element | Source (app, link, image) | Becomes in auracode |
|---|---|---|---|
| 58 | Warm tray with inset white panels and 8px gutters; separation by value and hairline | Harvey agent thread and Agent Builder renders, https://www.harvey.ai/platform/agents, `harvey/harvey-agents-hero-ui.png`, `harvey/harvey-agents-feature-f.png` | The window frame: a tray with inset panes (4.1) |
| 59 | Right panel with Progress, Context and Properties | Harvey agent thread render, same link, `harvey/crops/harvey-hero-rightpanel.png` | Right panel Session and Changes tabs (4.16) |
| 60 | Properties as key-value rows with small chips | Harvey right panel, same link, `harvey/crops/harvey-hero-rightpanel.png` | Session properties; the composer's agent readout (4.16, 4.9) |
| 61 | A fill only for what the human said; agent text bare | Harvey thread render, same link, `harvey/harvey-agents-hero-ui.png` | Transcript grammar (4.4) |
| 62 | Thread header with muted inline metadata, no breadcrumb bar | Harvey thread render, same link, `harvey/crops/harvey-hero-header-rail.png` | Chat header (4.3) |
| 63 | Plan checklist: two-tone ring spinner, strikethrough when done, "4 of 4 steps" | Harvey "Control the Quality of Work", same link, `harvey/harvey-agents-feature-d.png` | Plan stepper (4.5) |
| 64 | Pastel status pill with a saturated mark | Harvey agents list and orchestration renders, https://www.harvey.ai/platform/legal-work-orchestration, `harvey/harvey-agents-feature-b.png` | Status pills, with squares for marks (3.9) |
| 65 | Review queue that casts the human as reviewer ("Needs your judgment") | Harvey Contract Intelligence, https://mobbin.com/sites/sections/3d783bdf-aa90-4f3f-962d-5afd89e262f6, `harvey/harvey-site-contract-intelligence-queue.jpg` | The sidebar's Needs you group and its wording (4.2) |
| 66 | Neutral segmented control | Harvey right panel, https://www.harvey.ai/platform/agents, `harvey/crops/harvey-hero-rightpanel.png` | Unified or Split diff toggle (4.16) |
| 67 | Hover by dimming siblings and revealing an arrow | Harvey Platform menu, https://www.harvey.ai/, `harvey/harvey-live-megamenu-hover.png` | Command palette and picker hover (4.10, 4.20) |
| 68 | Segmented 2px timer rules that fill | Harvey product tabs, https://www.harvey.ai/platform/agents, `harvey/harvey-live-product-tabs.png` | Plan strip progress, boot progress (4.5, 4.18) |
| 69 | Ink panel for dark data inside a light page | Harvey black-theme sections, https://www.harvey.ai/platform/agents, `harvey/scroll/harvey-agents-10.png` | Onboarding night panel (4.14) |
| 70 | Product shown on graphite grain in muted tints | Harvey media frames, https://www.harvey.ai/platform/vault, `harvey/harvey-agents-hero-ui.png`, `harvey/harvey-vault-hero-ui.jpg` | Website product-frame backdrop, generated grain only (4.19) |
| 71 | Signed, timestamped notification card | Harvey orchestration render, https://www.harvey.ai/platform/legal-work-orchestration, `harvey/harvey-orchestration-hero-ui.png` | In-app notification cards (4.17) |
| 72 | Slow-settling tonal hover on ink buttons, never a glow or a bounce | Harvey buttons (measured), https://www.harvey.ai/, `harvey/harvey-live-home.png` | Button hover physics (3.8) |
| 73 | "Worked for 6s" run line | Legora Agent render, https://legora.com/product/agent, `harvey/legora-agent-plan-approval.png` | Collapsed run line above finished answers (4.4) |
| 74 | Step timeline with file children | Legora "The Legora difference", https://mobbin.com/sites/sections/030d5360-730d-4f1a-ae57-039fd948a652, `harvey/legora-site-agent-steps-difference.jpg` | Tool groups with a spine (4.4) |
| 75 | Deliverables manifest ("Files 3 created") | Legora Deliver render, https://legora.com/product/agent, `harvey/legora-agent-step-deliver.png` | Files-changed chip and Changes summary (4.4, 4.16) |
| 76 | Small square citation chips | Harvey iOS App Store screenshot, https://apps.apple.com/us/app/id6743734610, `harvey/harvey-ios-appstore-1.png` | file:line reference chips (4.4) |

### 2.4 Aside (aside.com) and the AI products with non-generic design

| # | Element | Source (app, link, image) | Becomes in auracode |
|---|---|---|---|
| 77 | Translucency only on chrome, an opaque pane for reading, double hairline edge | Aside hero product mock, https://aside.com, `aside/aside-live-hero-mock-t6000.png` | Materials rule: native material under the sidebar only (6) |
| 78 | 0.5px hairline rings and an ink-alpha text ladder | Aside CSS tokens, https://aside.com, `aside/aside-live-viewport.png` | Rings on retina, text ladder (3.1, 3.5) |
| 79 | Active sidebar row raised like a card; 12px ring spinner; 8px unread dot | Aside sidebar, https://aside.com, `aside/aside-live-hero-mock-t16000.png` | The active chat row as a lifted piece of the pane (4.2) |
| 80 | Composer control row: environment, permission, model, effort as quiet text | Aside new-tab mock, https://aside.com, `aside/aside-live-hero-mock-t20000.png` | Composer control row (4.9) |
| 81 | Autonomy menu with a plain-language scope and a "Final confirm" switch | Aside "Sandbox with guardrails", https://docs.aside.com/help/security, `aside/aside-site-guard-permission-popover.png` | Autonomy menu (4.11) |
| 82 | Effort ladder with numeric shortcuts | Aside Ultrabrowse menu, https://aside.com/features/browser-agent, `aside/aside-site-ultrabrowse-reasoning-menu.png` | Effort column with keys 1 to 5, no rainbow tier (4.10) |
| 83 | Muted step spine; state by verb tense ("Reading" then "Read") | Aside mock and launch video, https://aside.com, https://www.youtube.com/watch?v=Q-f0dQ764so, `aside/aside-live-hero-mock-t16000.png`, `aside/aside-launch-video-t65.png` | Tool groups and live verbs (4.4) |
| 84 | Nested result card for search hits | Aside memory search, https://aside.com, `aside/aside-live-hero-mock-t6000.png` | Grep, glob and web search results (4.4) |
| 85 | Subagent fan-out rows with model pills | Aside "Spawning subagents in parallel", https://aside.com, `aside/aside-live-hero-mock-t16000.png` | Subagent rows (4.4) |
| 86 | Approval card with the evidence on top and real answers as pills | Aside "Human approval at the edge", https://aside.com/features/password-manager, `aside/aside-site-human-approval-card.webp` | Permission card options (4.6) |
| 87 | Recent tasks with live timers ("Working for 3m 48s") | Aside new-tab mock, https://aside.com, `aside/aside-live-hero-mock-t20000.png` | Empty-state ledger (4.13) |
| 88 | Monospace access log with outcome glyphs | Aside "A record of every access", https://aside.com/features/password-manager, `aside/aside-site-access-audit-log.webp` | Permission history in settings (4.15) |
| 89 | Split primary button; follow-ups either Queue or Steer | Aside CTA and docs, https://aside.com, https://docs.aside.com/help/tasks, `aside/aside-live-display-type-2x.png` | Send button (4.9) |
| 90 | Monochrome orbit of agents: connected in ink, missing in grey | Aside "Bring your own subscription", https://aside.com, `aside/aside-live-slice-4.png` | Onboarding globe: ready agents ink, missing ones dashed grey (4.14) |
| 91 | Scroll-driven fade masks instead of frosted bars | Aside transcript CSS, https://aside.com, `aside/aside-live-hero-mock-t16000.png` | Transcript edges under the header and above the composer (4.4) |
| 92 | Every agent as a dot whose state is its color | Antimetal console header, https://antimetal.com, `aside/antimetal-live-dot-strip-stats-2x.png` | The sidebar agent dock as a live strip (4.2) |
| 93 | Checks card for long builds and tests | Antimetal "Fix and verify", https://antimetal.com, `aside/antimetal-live-fix-diff-card-2x.png` | Test and build summaries in terminal headers (4.4) |
| 94 | Approvable plan card with a numbered timeline and keycap buttons | Mistral Le Chat, https://mobbin.com/flows/a14877b3-3abe-4dc1-b4fc-ad2ec42a711f, `aside/mistral-lechat-research-plan-card.jpg` | Plan approval footer (4.5) |
| 95 | Docked question card with numbered keycaps, taking over the composer | Perplexity and Unify, https://mobbin.com/screens/fcdd9e2e-8b53-4f64-9597-cbefe3473b93, `aside/perplexity-ask-question-card.jpg`, `aside/unify-numbered-question-card.jpg` | Question card and permission keys (4.6, 4.7) |

### 2.5 The best apps

| # | Element | Source (app, link, image) | Becomes in auracode |
|---|---|---|---|
| 96 | Autonomy menu that names consequences, risk carried by words | ChatGPT iOS (Codex remote), https://mobbin.com/screens/b08ee878-3e6c-4f58-a442-a3fe83a5598a, `aichat/chatgpt-ios-codex-autonomy-permissions-menu.jpg` | Autonomy menu copy (4.11) |
| 97 | Permission card that takes the composer's place, exact command in a well, "Tell Codex what to do" | ChatGPT iOS (Codex remote), https://mobbin.com/screens/72c4abcc-2f9c-4126-9775-ab4d4c3cc9ef, `aichat/chatgpt-ios-codex-permission-approve-card.jpg` | Permission card placement and the deny-with-instructions field (4.6) |
| 98 | Two-tone model and effort label ("5.5 Medium") | ChatGPT iOS (Codex remote), https://mobbin.com/screens/bcd32d5b-87a4-46ff-9936-aa7489b675ab, `aichat/chatgpt-ios-codex-remote-new-thread-composer.jpg` | Composer agent pill (4.9) |
| 99 | Desktop sidebar rows with live status at the trailing edge | Codex macOS app, https://openai.com/codex/, `aichat/chatgpt-codex-mac-sidebar-official.webp` | Chat rows (4.2) |
| 100 | Grouped tool summaries with a hanging chevron | Claude Code web, https://mobbin.com/screens/40a2b9db-e22a-4ef8-94da-7f7d6f9ba445, `aichat/claude-code-web-collapsed-tool-rows-branch-bar.jpg` | Tool groups (4.4) |
| 101 | Bars fused to the composer (branch and PR, limits, unavailable) | Claude web and iOS, https://mobbin.com/flows/b8711d01-45b3-4327-92e4-608d817b8f3d, `aichat/claude-ios-composer-docked-limit-banner.jpg` | Composer segments: notices, handoff, queue, plan (4.9) |
| 102 | Ask-user card with numbered options and a pager | Claude iOS, https://mobbin.com/screens/465d155d-404f-40b5-8fc5-ba686cec318b, `aichat/claude-ios-ask-question-card-1of2.jpg` | Question card (4.7) |
| 103 | Sticky prompt peek at the top of a long turn | Claude desktop CSS, https://claude.ai/login, `aichat/claude-web-login-live-light.png` | Sticky prompt (4.4) |
| 104 | Word-by-word fade-in streaming, no caret | ChatGPT web, https://chatgpt.com/, `aichat/chatgpt-web-streaming-live-light.png` | Streaming text (3.8) |
| 105 | Status word plus elapsed seconds ("Working 2s", "Finished 3s") | Perplexity web, https://www.perplexity.ai/, `aichat/perplexity-web-answer-live-light-stream-1.png` | Live labels with timers (4.4) |
| 106 | Model menu with a nested thinking-level flyout; effort levels with consequence lines | Gemini web, Claude iOS, https://mobbin.com/screens/85f830b1-e0bf-4f8b-9fa4-c578e1963bf3, https://mobbin.com/screens/5f298f05-d4d6-4044-9fc2-d33c768ad2d6, `aichat/gemini-web-model-thinking-level-cascade.jpg`, `aichat/claude-ios-effort-sheet.jpg` | Picker cascade and effort copy (4.10) |
| 107 | Visual settings as preview tiles | Claude web settings, https://mobbin.com/screens/ab3dd469-8d71-4fed-bfe0-c582a11ea3ac, `aichat/claude-web-settings-appearance-tiles-dark.jpg` | Appearance tiles (4.15) |
| 108 | Outcome notifications with a verifiable fact | Claude iOS, https://mobbin.com/flows/b8711d01-45b3-4327-92e4-608d817b8f3d, `aichat/claude-ios-notification-permission-agent-cards.jpg` | OS notification copy (4.17) |
| 109 | Muted tool lines and changed-file chips with diffstats | Cursor desktop mock, https://cursor.com/, `devtools/cursor-live-home-fold.png` | Tool rows and files chip (4.4) |
| 110 | "Worked for 8 sec" line; composer with a lit top-left edge; ringed user message | Linear Agent, https://linear.app/agents, `devtools/linear-live-agents-fold.png`, `devtools/linear-live-agents-s1.png` | Thinking line; the dark composer's lit edge (4.4, 4.9) |
| 111 | Permission card with exact payload and keycap actions; exit-status edge on failed blocks | Warp agent docs, https://docs.warp.dev/agents/local-agents/interacting-with-agents/terminal-and-agent-modes/, `devtools/warp-docs-agent-conversation-view.webp` | Permission keys; failed terminal edge (4.6, 4.4) |
| 112 | Unified diff with alpha line tints, word highlights, diffstat squares | GitHub PR Files changed, https://github.com/primer/primitives/pull/1000/files, `devtools/github-live-pr-diff-fold.png` | Diffs (4.4, 4.16) |
| 113 | Review panel scoped to the branch | Zed Delta, https://zed.dev/blog/introducing-delta, `devtools/zed-delta-diff-comments-t6.png` | Changes scope selector (4.16) |
| 114 | Log viewer with a timestamp gutter and level-tinted rows | Vercel build logs, https://mobbin.com/screens/50a79ff4-37c0-4a9b-8df3-29599652a9fb, `devtools/vercel-build-logs-warn-error-rows.webp` | Long terminal output (4.4) |
| 115 | Menus that teach shortcuts; fixed action bar with key legend | Linear menus, Raycast launcher, https://mobbin.com/screens/b4e6b70d-27e2-4853-8d0b-b44ab3d54967, https://www.raycast.com/, `devtools/linear-doc-context-menu-submenu.webp`, `devtools/raycast-live-home-s2.png` | Menus and the picker footer (4.20, 4.10) |
| 116 | Agent roster with flattened glyphs and per-agent toggles | Linear Settings, Coding tools, https://mobbin.com/screens/332e33ea-6a11-476e-9442-06d1ec5a49bb, `devtools/linear-settings-coding-tools-agents.webp` | Settings agents page, onboarding roster (4.15, 4.14) |
| 117 | Buttons that carry their own letter key | Zed site, https://zed.dev/agentic, `devtools/zed-live-agentic-fold.png` | Keycaps on buttons (3.9) |
| 118 | Empty state that is a shortcut list | v0 code view, https://mobbin.com/screens/f2d792c6-ac0f-4c96-8023-be287b3aa365, `devtools/v0-editor-empty-keyboard-hints.webp` | Empty right panel (4.16) |
| 119 | Run timeline strip with ticks placed by time | Browserbase run detail, Antimetal tick strips, https://mobbin.com/flows/49b39051-8e71-4087-b67b-f00a583bc6c7, https://antimetal.com, `devtools/browserbase-run-steps-timeline.webp`, `aside/antimetal-live-attention-cards-2x.png` | Session tab turn timeline (4.16) |
| 120 | Three-level stepper with the consequence printed beside it; irreversible-action confirm with "Known address · 1 previous send" | Family iOS, https://mobbin.com/screens/efb3f375-645d-4d97-98cb-ab22e886f3e3, https://mobbin.com/screens/7c7c893c-6b22-4ad6-8c69-a50ca0aefbad, `craft/family-ios-confirm-urgent.jpg`, `craft/family-ios-confirm-normal.jpg` | Autonomy level glyph; permission "Seen before" row and calm warning (4.11, 4.6) |
| 121 | Labels that morph by shared letters; motion in the direction of travel | Family Values, https://benji.org/family-values, `craft/family-ios-amount-keypad.jpg` | "Allow once" to "Allowed"; queued messages flying into the transcript (3.8) |
| 122 | Command menu with single-letter keycaps and a selection rail; menu bar presence | Notion Calendar, https://www.notion.com/product/calendar, `craft/notioncal-live-y2700@2x.png`, `craft/notioncal-live-1440-scroll1.png` | Picker letter keys; macOS menu bar extra (4.10, 4.17) |
| 123 | Typeset numbers, "Esc to cancel" while running, "Command this instead" fallback | Mercury, https://mercury.com, https://mobbin.com/screens/3ea04b51-b13c-422d-b67b-f5045066fed7, https://mobbin.com/screens/02863cc8-6f0c-4f12-8ee8-7225e88c5445, `craft/mercury-home-dark.jpg`, `craft/mercury-command-running.jpg`, `craft/mercury-search-palette-fallback.jpg` | Numerals; running hint; command palette fallback (3.2, 4.9, 4.20) |
| 124 | Declined items as a dashed outline with strikethrough | Cron Calendar, https://mobbin.com/screens/e55ad79a-a1bc-4f78-85f1-9598d941759b, `craft/cron-event-inspector-hold-hint-toast.jpg` | Denied tool calls (4.4) |
| 125 | Undo toast instead of a confirm dialog | Superhuman, Linear, https://mobbin.com/screens/f3db6d1b-66ed-4be0-b6aa-82f75f30a762, `craft/superhuman-undo-toast.jpg`, `devtools/linear-toast-undo.webp` | Undo toasts (4.17) |
| 126 | Motion driven by real throughput (level meter follows the audio) | Granola iOS, https://mobbin.com/screens/e96bd18e-eec7-49cf-87c3-ff38ab46a47e, `craft/granola-ios-recording-sheet.jpg` | The streaming globe turns per batch of tokens (5.4) |
| 127 | Selected row lifted as a white pill | Arc sidebar, https://mobbin.com/sites/sections/93e6a6cd-ac70-457d-a0ce-633db04621ab, `craft/arc-site-spaces-sidebar.jpg` | Active chat row (4.2) |

### 2.6 What we deliberately leave behind

- **Harvey's serif titles** (TWK Ghost). It is Harvey's most recognizable trait, but the owner rejected
  serif display lines, and SpaceXAI and X Money, the top references, set everything in one grotesk.
  Harvey contributes structure (tray, panels, right panel, plan, review framing), not type.
- **SpaceXAI's rainbow glint.** The traveling glint stays; its colors become an ink rule with an orange
  highlight.
- **Grok Bot's characters** (eyes, pastel ribbons) and **Grok's voice aura**. We keep the state rules.
- **X Money's blue halo** on the live step, **Arc's project-hue chrome**, **Aside's rainbow effort tier
  and sky wallpapers**, **Gemini's radial glow**, **Superhuman's gradient stroke**, **ElevenLabs'
  iridescent edge**, **Legora's brand green** and **Harvey's highlighter yellow**: one orange does
  each of these jobs, or nothing does.
- Anything owned: the X logo and X Card art, the SpaceXAI coastline globe canvas, Harvey and Legora
  photography and grain artwork, App Store compositions, every proprietary font file.

---

## 3. Tokens

Both themes are first-class. The app follows the OS (`prefers-color-scheme`), with a Settings override
(System, Light, Dark). In the lab, every token below lives under `[data-direction="orbit"]` with
`[data-theme="light"]` and `[data-theme="dark"]` variants. Names use the `--o-` prefix.

### 3.1 Color

**One temperature.** Light is warm paper (x.ai ivory, Harvey's tray), dark is near-neutral black, and
the dark ink is a warm white so both themes feel like the same paper. Text is one ink at alpha steps,
never assorted greys. Throughout this document "ink" means `--o-ink`, near-black in light and warm
white in dark; "ink N%" is that color at N% alpha; an "ink pill" is an `--o-ink` fill with
`--o-on-ink` text, so it is black in light and warm white in dark.

**Surfaces and ink**

| Token | Light | Dark | Use |
|---|---|---|---|
| `--o-tray` | `#F3F2EF` | `#000000` | The desk: window base, sidebar, gutters around panes |
| `--o-tray-tint` | `rgb(243 242 239 / 0.86)` | `rgb(0 0 0 / 0.82)` | Laid over the native material under the sidebar (section 6) |
| `--o-pane` | `#FFFFFF` | `#0E0E0D` | Paper: transcript, right panel, settings |
| `--o-raised` | `#FFFFFF` | `#171716` | Floating objects: composer, menus, picker, cards |
| `--o-raised-2` | `#F7F6F3` | `#1F1F1E` | Fills inside raised objects and panes: composer segments, segmented tracks, soft buttons |
| `--o-well` | `#F3F2EF` | `#000000` | Code, terminal, open tool rows, search results. A well is a window down to the desk, so it equals the tray |
| `--o-hover` | ink 4% | ink 5% | Row and button hover |
| `--o-pressed` | ink 8% | ink 9% | Pressed |
| `--o-selected` | ink 6% | ink 7% | Selected rows and options |
| `--o-ink` | `#0A0A0A` | `#F2F1EE` | The one ink |
| `--o-text-1` | ink 100% | ink 100% | Primary text, the answer, variables in sentences |
| `--o-text-2` | ink 72% (`#4F4F4F` on pane, 8.2:1) | ink 70% (`#AEADAA`, 8.6:1) | Secondary: descriptions, tool verbs, thinking text |
| `--o-text-3` | ink 57% (`#717171`, 4.9:1; 4.75:1 in wells) | ink 50% (`#80807E`, 4.9:1) | Tertiary: meta, timestamps, two-tone continuations, placeholders. Still AA for body text |
| `--o-text-4` | ink 30% | ink 28% | Decorative and disabled only: leaders, empty ticks, disabled labels. Never carries information |
| `--o-on-ink` | `#FFFFFF` | `#0A0A0A` | Text and glyphs on ink-filled controls |
| `--o-user-bg` / `--o-user-fg` | `#0A0A0A` / `#FFFFFF` | `#E9E8E4` / `#0A0A0A` | The user message block (19.8:1 and 16.2:1) |

**Lines**

| Token | Light | Dark | Use |
|---|---|---|---|
| `--o-line` | ink 8% | ink 9% | Pane rings, card edges, wells |
| `--o-line-strong` | ink 14% | ink 15% | Inputs, outline buttons, chips, the active row's ring |
| `--o-rule` | ink 6% | ink 7% | Separators inside lists |
| `--o-dash` | ink 18% | ink 20% | Dashed 8/8 tear lines |

**Signal and semantics** (the only hues in the chrome)

| Token | Light | Dark | Meaning and use |
|---|---|---|---|
| `--o-signal` | `#EC5800` (3.5:1 on pane, 3.15:1 on tray) | `#FF6308` (6.5:1) | Look here: needs-you diamonds, NEW chips, warning glyphs, update squares, search-match tint base. Graphics only |
| `--o-signal-text` | `#BF4400` (5.2:1; 4.6:1 on tint) | `#FF7A2E` (7.4:1) | "Needs you", "NEW", warning words |
| `--o-signal-tint` | `rgb(255 99 8 / 0.10)` | `rgb(255 99 8 / 0.16)` | Behind NEW chips and search matches |
| `--o-green` | `#0A8F5C` graphics, `#007E50` text (5.1:1) | `#31C88E` (9:1) | Done checks, Allowed, passed tests, additions |
| `--o-green-tint` | `rgb(0 186 124 / 0.12)` | `rgb(49 200 142 / 0.14)` | Done pills |
| `--o-red` | `#D11A28` (5.4:1) | `#F64B5C` (5.6:1) | Failed, Denied, deletions, destructive actions |
| `--o-red-tint` | `rgb(244 33 46 / 0.09)` | `rgb(246 75 92 / 0.14)` | Failed pills, error well tint |
| `--o-scrim` | ink 24% | `rgb(0 0 0 / 0.56)` | Behind sheets |
| `--o-toast` | `rgb(20 20 20 / 0.88)` + blur, `#FFFFFF` text | `rgb(38 38 37 / 0.92)` + blur, `#F2F1EE` text, 1px ring ink 10% | Toasts |
| `::selection` | ink 12% | ink 18% | Text selection, neutral |

Rules:

- **No agent colors.** Agents are told apart by their orbit, their name and their glyph (section 5).
- **Project color** is user-chosen, but Orbit shows it as one of four muted tones, picked by the
  color's hue, and only as the 8px square beside the project's name: `--o-project-slate` `#8A98A6`
  (blues), `--o-project-stone` `#A59E92` (violets, greys and anything unreadable),
  `--o-project-sage` `#8C9C88` (reds, oranges, yellows) and `--o-project-clay` `#A88E80` (greens).
  The mapping is crossed on purpose: a warm pick never reads as the signal orange and a green pick
  never reads as done.
- Primary actions are ink (black pill in light, warm-white pill in dark), not orange. Orange is never a
  button fill, a border around a card, a glow, or a background larger than a chip.
- Risk is said in words. Red is reserved for failure, denial, deletion and the one destructive button
  in a confirm sheet.

**Diff tints** (in wells, from GitHub Primer and Grok Build)

| Token | Light | Dark |
|---|---|---|
| Added line | green `rgb(0 186 124 / 0.10)` | `rgb(49 200 142 / 0.12)` |
| Added word | `rgb(0 186 124 / 0.24)` | `rgb(49 200 142 / 0.28)` |
| Added line number and `+` | `#007E50` | `#31C88E` |
| Removed line | red `rgb(244 33 46 / 0.08)` | `rgb(246 75 92 / 0.12)` |
| Removed word | `rgb(244 33 46 / 0.19)` | `rgb(246 75 92 / 0.28)` |
| Removed line number and `−` | `#D11A28` | `#F64B5C` |
| Unchanged line number, and the other side's number on a changed row | `--o-text-3` | `--o-text-3` |
| Hunk header band | ink 4%, text `--o-text-3` | ink 5%, text `--o-text-3` |

Diff rows are monochrome: the code on a changed row stays in the code foreground, and only the line
tint, the word tint, the number and the marker carry the change. The `+` and `−` markers are the full
tone, so the mark itself reads and color is never the only cue.

**Code and terminal palette** (inside wells only; these hues never appear in chrome). Taken from Grok
Build's terminal tokens, with the light values darkened so each passes 4.5:1 on the light well.
Syntax highlighting follows x.ai's code window and spends only three hues: keywords red, strings blue,
numbers and attributes orange. Calls, types and names stay in the foreground; comments and
punctuation are dim. Green, teal, yellow and purple appear only where a program printed them (ANSI
output in the terminal).

| Role | Light | Dark |
|---|---|---|
| Foreground (code, calls, types, names) | `#2A2A29` | `#D7D1C9` |
| Bright | `#0A0A0A` | `#F2EDE5` |
| Dim (comments, punctuation, prompts) | `#6C6B6A` | `#8D867E` |
| Red (keywords, ANSI red) | `#BE2E31` | `#D7766C` |
| Blue (strings, ANSI blue) | `#2365D1` | `#8DB4FF` |
| Orange (numbers, attributes, ANSI orange) | `#A84E00` | `#D59556` |
| Green (ANSI green only) | `#1E7A2B` | `#91C17A` |
| Teal (ANSI cyan only) | `#00676C` | `#29C6BE` |
| Yellow (ANSI yellow only) | `#876500` | `#CFB47C` |
| Purple (ANSI magenta only) | `#6D48D1` | `#BC97FF` |

ANSI inverse colors (for example vitest's `RUN` badge) render as the hue at 16% behind the hue's text.
Comments are dim, never italic.

### 3.2 Type

**Faces.** Two families, both OFL and already bundled:

| Role | Face | Replaces (proprietary, seen in the references) |
|---|---|---|
| Everything you read in the interface, display included | **Geist** (variable, weights 100 to 900) | xVf and xVFDisplay (x.ai, money.x.com), Universal Sans (grok.com), Chirp (X), ABC Diatype (Harvey), AsideDisplay (Aside), CursorGothic |
| Everything a machine made | **Geist Mono** (variable) | xMono (money.x.com), Berkeley Mono (Linear, Cursor). x.ai already ships Geist Mono as is |

The SpaceXAI research rendered xVf beside open faces and found Geist the closest
(`spacexai/spacexai-specimen-xvf-vs-open-faces.png`); X Money's metrics pointed to Public Sans, but
Geist's x-height (0.53) and cap height (0.71) match xVF within a point, so one family covers both. No
serif and no italic exist anywhere in Orbit.

**Bundling.** The lab and the app already load both faces from `@auracode/ui/fonts.css`
(`@fontsource-variable/geist` 5.3.0 and `@fontsource-variable/geist-mono` 5.3.0, every subset by
`unicode-range`, offline). Orbit adds no font files. It does not use Instrument Serif, which stays
bundled for the other directions. Set `font-synthesis: none` so engines never fake italics or bold.

**Features (checked in the bundled files).** Geist ships `tnum`, `pnum`, `frac`, `liga` and `kern`;
it has no stylistic sets, no `zero` and no `sups`. So:

- Every number that updates or lines up (timers, counts, costs, diffstats, tokens, versions in sans)
  uses `font-variant-numeric: tabular-nums`.
- Superscript decimals are built, not requested: a span at 42% of the numeral's size, top-aligned to
  the cap height, 2px after the integer, no decimal point (X Money, Mercury).
- Geist Mono's zero is slashed by default, so ids and hashes stay unambiguous.

**Scale** (desktop px; dark mode lowers weights by 20 because light-on-black reads heavier, the
compensation Perplexity and Claude ship)

| Token | Face | Size / line | Weight light (dark) | Tracking | Case | Use |
|---|---|---|---|---|---|---|
| `hero` | Geist | 64 / 64 | 500 (480) | -0.035em | Sentence | Website hero |
| `display` | Geist | 30 / 36 | 500 (480) | -0.025em | Sentence | Empty-state sentence, onboarding headings, boot line |
| `title` | Geist | 22 / 28 | 500 (480) | -0.015em | Sentence | Settings page titles, sheet titles |
| `numeral` | Geist, tnum | 32 / 32 | 500 (480) | -0.03em | | Right panel heroes (cost, tokens, diffstat); decimals at 42% |
| `sentence` | Geist with Geist Mono objects | 18 / 26 (mono at 16.5) | 450 (430) | -0.01em | Sentence | Permission and question titles |
| `heading` | Geist | 15 / 22 | 600 (580) | -0.01em | Sentence | Markdown h1 and h2, card titles |
| `body` | Geist | 14 / 22 | 400 (380) | 0 | Sentence | Agent prose, composer input; user message at 14 / 21 |
| `ui` | Geist | 13 / 18 | 450 (430) | 0 | Sentence | Rows, menus, buttons, tool rows, composer controls |
| `meta` | Geist | 12 / 16 | 450 (430) | +0.01em | Sentence | Descriptions, captions, footers, timers in sentences |
| `caps` | Geist Mono | 10.5 / 14 | 500 | +0.08em | UPPERCASE | Section labels, eyebrows, status tags |
| `mono` | Geist Mono | 12 / 16 | 400 (380) | 0 | | Paths, commands, durations, ids, diffstats in rows |
| `code` | Geist Mono | 12.5 / 20 | 400 (380) | 0 | | Code blocks, diffs; inline code at 0.893em |
| `term` | Geist Mono | 12 / 18 | 400 (380) | 0 | | Terminal output |
| `key` | Geist Mono | 10.5 / 16 | 500 | 0 | | Keycaps |

Rules:

- **Two-tone, never italic.** Headlines put the first clause in `--o-text-1` and the rest in
  `--o-text-3`, same size and weight (X Money, Linear, Aside). Sentences that describe an action put
  connective words in `--o-text-3` and the variables (agent, command, path, number) in `--o-text-1`
  (X Money's confirm sheet).
- **Mono is data, never decoration.** Numbers inside a sans sentence stay Geist with `tnum`
  ("Thought for 6s"); standalone readouts (right-aligned durations, counters, diffstats) are mono.
- **Hierarchy by weight and alpha, not size jumps.** UI weights are 450, 500 and 600 (the sidebar's
  hover morph passes through 520); body is 400.
- Display sizes track tight (-0.015em to -0.035em); 12px and below track slightly open (+0.01em);
  caps track +0.08em.

### 3.3 Spacing

4px base. Steps: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96 (`--o-sp-2` to `--o-sp-96`).

| Measure | Value |
|---|---|
| Row heights | 24 compact, 28 tool rows, chips and menu rows, 30 sidebar rows, 32 buttons and inputs, 36 composer segments and prominent buttons, 44 headers and two-line rows, 52 titlebar band |
| Window | 1440 x 900 in the lab; titlebar band 52 |
| Sidebar | 264 wide; 12px side insets; collapsed rail 72 |
| Pane inset | 8px from the window's top, right and bottom, and between panes |
| Transcript column | 720 max, centered; 32px minimum side padding inside the pane |
| Right panel | 380 default, resizable 320 to 560 |
| Turn rhythm | 32 between turns, 12 between items in a turn, 10 between paragraphs |
| Card padding | 12 to 16 for cards, 16 to 18 for docked cards, 24 for sheets |
| Section rhythm | 24 between settings groups; 96 between website sections |

### 3.4 Radii

Deliberate contrast: zero-radius markers, small radii for content, pills for controls (X Money,
SpaceXAI). Nothing is rounded past 16 except the window frame (18 in the lab, native in the app).

| Token | Value | Use |
|---|---|---|
| `--o-r-0` | 0 | Satellites, globe markers, status squares, diffstat squares, project squares |
| `--o-r-xs` | 4 | Inline code, keycaps, caps tags, reference chips |
| `--o-r-sm` | 6 | Icon buttons, small chips, the diffstat chip |
| `--o-r-md` | 8 | Rows, wells, inputs, file chips, menu items |
| `--o-r-lg` | 12 | Panes, menus, cards in panels, tiles |
| `--o-r-xl` | 16 | Composer, picker, docked cards, notification cards, toasts |
| `--o-r-pill` | 9999 | Buttons, segmented controls, status pills, send, avatars |
| User block | 16 16 4 16 | The tail corner points at the composer it came from |

Nested radius rule: inner radius equals outer radius minus padding (picker 16 with 6 padding gives
10px items; menus 12 with 4 padding give 8px items). Use plain circular corners; where an engine
supports `corner-shape: superellipse(1.4)`, it may smooth panes and the composer as an enhancement.

### 3.5 Borders and dividers

- **One hairline.** 1px `--o-line` around panes, wells and cards; on displays of 2x and up, rings are
  `box-shadow: 0 0 0 0.5px` at double the alpha, the Aside trick that reads as machined.
- **Rules** inside lists: 1px `--o-rule`, inset to the text start, never full-bleed under icons.
- **Tear line:** dashed 8/8, 1px `--o-dash`, drawn as `linear-gradient(90deg, currentColor 50%,
  transparent 0) 0 0 / 16px 1px repeat-x` because native dashes are too short (X Money).
- **Selection rim:** 1.5px `--o-ink` around a selected card or tile (X Premium cards).
- **Rail:** 2px `--o-ink` on the left edge of a keyboard-focused row or the active settings item
  (Notion Calendar, X settings).
- **Spine:** 1px `--o-rule` vertical line joining tool-group icons and stepper nodes; dashed 3/3 for the
  plan stepper (X Money tracking).
- **Denied:** 1px dashed `--o-line-strong` outline, radius 6, with the text struck through (Cron).
- No border is ever colored, except the failed terminal's 2px red left edge.

### 3.6 Elevation

Flat by default: panes, rows and wells never cast shadows. Only floating objects lift, and dark mode
relies on rings because shadows vanish on black.

| Level | Light | Dark | Use |
|---|---|---|---|
| e0 | none | none | Panes, rows, wells, tiles |
| e1 | ring + `0 1px 2px rgb(10 10 10 / 0.06)` | ring + inset `0 1px 0 rgb(242 241 238 / 0.04)` | Active sidebar row, active segment |
| e2 | ring + `0 1px 2px rgb(10 10 10 / 0.04), 0 6px 16px -6px rgb(10 10 10 / 0.10)` | ring + `0 8px 24px -8px rgb(0 0 0 / 0.6)` + top inset highlight | Composer, docked cards |
| e3 | ring + `0 2px 6px rgb(10 10 10 / 0.05), 0 16px 40px -12px rgb(10 10 10 / 0.20)` | ring `--o-line-strong` + `0 16px 48px -12px rgb(0 0 0 / 0.7)` | Menus, picker, popovers, notification cards |
| e4 | `0 24px 64px -16px rgb(10 10 10 / 0.32)` over `--o-scrim` | same over `--o-scrim` | Sheets |

The dark composer also gets Linear's lit edge, the only light in the interface: a 1px border painted
with `linear-gradient(135deg, rgb(242 241 238 / 0.14), rgb(242 241 238 / 0.04) 30%)` on the border box.

### 3.7 Focus

- Keyboard focus (`:focus-visible`): 2px solid `--o-ink` ring with a 2px offset, following the
  element's radius plus the offset (Harvey, X Money). No blue, no glow.
- On ink-filled controls the offset gap shows the surface underneath, so the ring stays visible.
- Inputs: the border goes from `--o-line-strong` to ink 32%; no ring.
- Lists (sidebar, picker, menus, palette): focus is `--o-selected` plus the 2px rail, so arrow keys
  never draw rings around rows.

### 3.8 Motion

| Token | Duration | Easing | Use |
|---|---|---|---|
| `--o-instant` | 0ms | | Status pips flip with no tween (Warp's fleet grid) |
| `--o-micro` | 100ms | standard | Hover color and fill |
| `--o-fast` | 150ms | standard | Press, toggles, tooltips, chevrons, the scroll rule under the header |
| `--o-base` | 200ms | out | Menus, popovers, picker open; sidebar weight morph |
| `--o-dock` | 260ms | out | Composer segments in and out, now-row, cards docking, badge changes |
| `--o-slow` | 400ms | sheet | Sheets, right panel, sidebar collapse |
| `--o-hero` | 650ms per word, 40ms stagger | out | Headline flip-up |
| `--o-glint` | 900ms, once | linear | Glint under a new agent name |

Easings: **standard** `cubic-bezier(0.4, 0, 0.2, 1)`; **out** `cubic-bezier(0.23, 1, 0.32, 1)`;
**sheet** `cubic-bezier(0.32, 0.72, 0, 1)`; **in** `cubic-bezier(0.4, 0, 1, 1)` at 120ms for exits;
**linear** for orbits, loaders and shimmer. No springs and no overshoot anywhere.

What moves, and only when its event happens:

1. The Orbit mark, driven by the agent's state (section 5).
2. The shimmer on live labels: `background-clip: text`, a gradient from `--o-text-3` through
   `--o-text-1` back to `--o-text-3` at 100deg, `background-size: 250%`, 1.4s linear (X Money).
3. The 2x3 dot loader, 0.66s linear (5.6).
4. Streamed words: each word fades from 0 to 1 opacity over 300ms out, 8ms stagger capped at 120ms.
   Text only appends: a line already on screen never re-wraps or moves (ChatGPT, and Noir's one good
   rule).
5. Entering rows and cards: opacity plus a 4 to 8px rise, `--o-dock`.
6. Composer segments: height and opacity, `--o-dock`.
7. Headline flip-up: per word, opacity 0, `translateY(45%)`, `rotateX(-40deg)` to rest, `--o-hero`
   (X Money); used on agent switch in the empty state, onboarding headings, the boot wordmark and the
   website hero.
8. The glint: a 2px ink-14% rule under a word with an orange highlight band traveling left to right
   once, `--o-glint`, then resting as the grey rule (SpaceXAI, recolored).
9. One ripple ring per event (tool call, waiting entry, notification arrival), 620ms linear.
10. Check marks drawing with `stroke-dashoffset` 24 to 0 over 250ms out.
11. Label morphs by shared letters ("Allow once" to "Allowed", "Reading" to "Editing"), 180ms (Family).
12. Counters stepping digit by digit (diffstats, queue counts), 120ms per changed digit.
13. Sidebar hover: weight 450 to 520 and alpha `--o-text-2` to `--o-text-1`, `--o-base` (X Money).
14. Buttons: press scales to 0.98 for 80ms; large buttons settle their hover over 300ms
    `cubic-bezier(0, 0.7, 0.3, 1)` (Harvey).

What never moves: the window, the panes, the sidebar, the composer's position, any background,
any text being read. Nothing breathes, pulses, drifts, floats, parallaxes or bounces. Blur radii never
animate. Hover never scales rows or cards.

Reduced motion (OS setting or `?motion=reduce`): shimmer becomes static `--o-text-2`; the loader shows
dots 1, 2 and 4 lit; orbits stop and show state by geometry alone (5.5); streamed words appear
instantly; flip-ups become a 150ms fade; ripples and glints are skipped; panels open with a 120ms fade.

### 3.9 Shared components

| Component | Spec |
|---|---|
| Primary button | Ink pill, `--o-on-ink` `ui` 500 label; heights 28, 32, 36, 44; padding 0 14px; hover light ink at 84% / dark pure `#FFFFFF`; pressed 0.98 scale |
| Soft button | `--o-raised-2` fill, `--o-text-1`; hover ink 10% (x.ai's warm grey secondary) |
| Outline button | Transparent, 1px `--o-line-strong`, `--o-text-1`; hover `--o-hover` |
| Ghost button | `--o-text-2`; hover `--o-hover` and `--o-text-1` |
| Destructive button | Red pill with white label; only inside a confirm sheet, one per sheet |
| Split button | A pill and a 28px chevron segment joined by a 1px divider at on-ink 20% (x.ai, Aside) |
| Icon button | 28px square (24 compact), radius 6, 16px Lucide icon at stroke 1.5 in `--o-text-3`; hover fill and `--o-text-1` |
| Keycap | 18px tall, min width 18, padding 0 5px, radius 4, `key` type; light ink 6% fill with a 1px ink 10% ring, dark ink 8% with a 12% ring, glyph `--o-text-2`; on ink buttons on-ink 16% fill and on-ink 80% glyph (Zed, Raycast) |
| Input | 32px, radius 8, `--o-pane` fill, 1px `--o-line-strong`, `ui` text, placeholder `--o-text-3` |
| Switch | 28 x 16 track, 12px knob; off ink 14%; on `--o-ink` with an `--o-on-ink` knob (Harvey, Grok) |
| Segmented, strong | `--o-raised-2` track, radius pill, padding 2; active segment is an ink pill with an `--o-on-ink` `meta` 500 label (SpaceXAI) |
| Segmented, quiet | Same track; active segment is `--o-pane` with ring and e1, `--o-text-1` label (Harvey) |
| Status pill | 20px, radius pill, padding 0 8px, `meta` 500 in the tone's text color on the tone at 12% (dark 16%), with a 5px zero-radius square of the tone, or the loader for running (Grok Bot, Harvey). Tones: ink, signal, green, red |
| NEW chip | 18px, radius 4, padding 0 6px, `caps` at 10px in `--o-signal-text` on `--o-signal-tint` (SpaceXAI) |
| Version chip | `caps` in `--o-text-2`, 1px `--o-line`, radius pill, padding 2px 8px (Grok Bot changelog) |
| Avatar | 28px circle, ink 6% fill, initials 10px 600 `--o-text-2` |
| Tooltip | Light `#0A0A0A` at 92% with `#FFFFFF` 12px text; dark `#E9E8E4` with `#0A0A0A` text; radius 6, padding 4px 8px; includes the keycap when a shortcut exists; 400ms delay |
| Scrollbar | Overlay, 6px thumb at ink 18%, radius pill, visible while scrolling |
| Icons | Lucide, 16px in toolbars and menus, 14px in rows, stroke 1.5, `--o-text-3` |

---

## 4. Surfaces

All measurements assume the lab's 1440 x 900 window. "Light / dark" values come from the tokens above.

### 4.1 Window and titlebar

- **The window is the tray.** The whole window is `--o-tray`. Under the sidebar it is the native
  material with `--o-tray-tint` over it (section 6); elsewhere it shows only as 8px gutters.
- **Panes are paper.** The main pane runs from x 264 to 1432 and y 8 to 892 (1168 x 884), radius 12,
  `--o-pane`, a 1px `--o-line` ring, no shadow (Harvey's tray, Grok Bot's rings). With the right panel
  open, the main pane narrows to 780 and the right panel pane (380 wide) sits 8px to its right.
- **Titlebar band:** the top 52px of the window is the drag region. Over the sidebar: traffic lights at
  x 18 to 70 (centered on y 26) and a 28px sidebar-toggle icon button at x 224. Over the main pane,
  the pane's own 44px header (y 8 to 52) sits inside the band; its empty areas stay draggable
  (`data-tauri-drag-region`). No window title text: the title lives in the pane header.
- **Windows and Linux:** no traffic lights; three caption buttons at the band's right edge, each a 46 x
  52 hit area with a 10px 1px glyph in `--o-text-2`; hover `--o-hover`; close hover `--o-red` fill with
  a white glyph. The pane header stops 138px earlier to clear them.
- **Resize:** the right panel resizes by dragging the 8px gutter (a 1px ink-30% line appears on hover,
  `col-resize` cursor). The sidebar collapses to a 72px rail with `--o-slow`.
- **Window edge:** the lab's WindowChrome draws it (radius 18); the app uses the native frame.

### 4.2 Sidebar

264px on the tray, 12px side insets, so rows are 240 wide. Top to bottom:

1. **Band** (52px): traffic lights and the sidebar toggle.
2. **Utility rows** (30px each, radius 8): New chat (square-pen icon, `⌘N` keycap right) and Search
   (search icon, `⌘K`). `ui` 450 in `--o-text-2`, icons `--o-text-3`. Hover: `--o-hover`, text to
   `--o-text-1`, weight 450 to 520 (X Money's weight morph). Search opens the command palette (4.20).
3. **Needs you** (only while at least one chat waits, 16px above Projects): `caps` label
   "NEEDS YOU 2" in `--o-signal-text`. Rows show the orange diamond pip, then the chat title in
   `--o-text-1` and " · auracode" in `--o-text-3` as one run of text, so when room runs out the
   project gives way before the title. Clicking opens the chat on its permission or question card.
   This is SpaceXAI's "grouped by who needs you" and Harvey's review queue. A waiting chat is listed,
   and counted, only here: its project's rows and count leave it out.
4. **Projects:** `caps` label "PROJECTS" with a `--o-text-4` count; a 20px "+" icon button appears on
   hover. Project row (30px): an 8px zero-radius square in the project's tone (3.1), the name in `ui`
   500 `--o-text-1`, the chat count right-aligned in `mono` 11px `--o-text-3`, and a 12px chevron on
   hover that rotates 90 degrees when open. A folded project carries its chats' state in place of its
   count: the diamond pip for a waiting chat, the loader for a running one, the red × and "1 failed"
   in `--o-red` for a failed one.
5. **Chat rows** (30px, text inset 32px so titles align under the project name): title `ui` 450
   `--o-text-2`, or `--o-text-1` 500 when unread or active. Trailing slot, right-aligned:

   | Chat state | Trailing slot |
   |---|---|
   | Idle | Relative time, `mono` 11px `--o-text-3` ("4m", "Tue") |
   | Running | 2x3 loader in `--o-text-2` and live elapsed time ("2m"); the title dims to `--o-text-3` (Codex) |
   | Needs approval | Orange diamond pip and "Needs you" in `meta` 11px 500 `--o-signal-text` |
   | Done, unseen | 6px ink square pip and the time; the title in `--o-text-1` 500 |
   | Error | Red × pip and "Failed" in `meta` 11px `--o-red` |

   **The active chat** is a piece of the pane lifted onto the desk: `--o-pane` fill in light, `--o-raised`
   in dark, a `--o-line-strong` ring, e1, radius 8 (Aside, Arc). Hover (or the row's menu being open)
   swaps the trailing slot for two 16px icon buttons, archive and more (Superhuman). Archive acts at
   once and says so in a toast with Undo (⌘Z); more opens the chat menu (Rename, Pin, Move to project,
   Archive ⌘⌫, then Delete, which asks in the destructive sheet). ⌘⌫ archives the open chat unless
   the cursor is in text. Keyboard: up and down move a `--o-selected` row with the 2px rail; Enter opens.
   "Show 12 more" closes long lists in `--o-text-3`.
6. **Agent dock** (pinned at the bottom above the account row, after a 1px rule): `caps` label
   "AGENTS" with "5/7" in `--o-text-4` and a "Manage" ghost link on hover. Below it, one 32 x 44px
   cell per known agent: a 24px Orbit mark and, 2px under it, the agent's two-letter code in Geist
   Mono 10px 500 +0.06em `--o-text-3` (CC, CX, PI, MP, AG, HM, CU, GB, OC; any other agent takes the
   first two letters of its name), so the strip reads without tooltips (SpaceXAI's marker over its
   label). Installed agents are in ink; missing agents are ghosts (all strokes `--o-text-4`, orbit
   dashed, hollow satellite, code in `--o-text-4`); more than seven agents wrap to a second row. An
   agent with an update shows a 5px orange square at its mark's top-right corner, except while it
   waits, when its diamond is the cell's one orange. A running agent's mark moves; a waiting agent's
   satellite is the orange diamond. This strip is the at-a-glance live view of every agent
   (Antimetal's dot strip, Warp's fleet grid, drawn as orbits). Hover tooltip: "Codex 0.164.0 ·
   update to 0.165.0". Click opens the **agent card** (280px popover, radius 16, e3; Esc closes it and
   nothing else): 32px mark, name `heading`, version in `mono` `--o-text-3`, "Signed in" or a "Sign
   in" link in `--o-signal-text`, the binary path in `mono`, default model and effort, "Update to
   0.165.0" as a primary pill when available, and "Agent settings" as a ghost button.
7. **Account row** (44px): 28px avatar ("L" for local), "Local" `ui` 500, "Sign in to sync" `meta`
   `--o-text-3`; a 28px settings icon button at the right.

**Collapsed rail** (72px, ⌘\ toggles it): the band keeps the traffic lights; below them 32px icon
buttons for new chat and search, 10px project squares each with its project's pip (a rail shows no
chat rows, so an open project carries its state too), the agent dock as a vertical column of 24px
marks, and the avatar (X core's icon rail).

### 4.3 Chat header

44px inside the pane, padding 0 16px.

- **Left:** the live Orbit mark (16px) of the chat's agent, 8px gap, the title in `ui` 500
  `--o-text-1` (truncates at 420px), then muted inline metadata in `ui` 450 `--o-text-3`:
  "auracode · " followed by a 12px git-branch icon and "main" in `mono`, plus "· worktree" when the
  chat is isolated (Harvey's thread header). When room runs out the metadata goes first, then the
  title cuts.
- **Rename:** the title is a button; a click (or Rename in the chat menu) swaps it in place for a
  26px field (radius 6, `--o-pane`, a 1px `--o-line-strong` inset edge that darkens to ink 32% on
  focus, no ring, as 3.7 says for inputs) as wide as the title plus 12px (160 to 420), with the text
  selected. Enter or leaving the field commits; Esc restores the old title and
  goes no further (it never stops the agent).
- **Right** (4px gaps): the diffstat chip (24px, radius 6, 1px `--o-line`, "+59" and "−23" in `mono` 12
  green and red, plus five 6px diffstat squares; hidden when nothing changed) which opens Changes; the
  right panel toggle (28px icon button, filled `--o-raised-2` while the panel is open); a more button
  that opens the chat menu downward (Rename, Pin, Move to project, Archive ⌘⌫, then Delete).
- **Edge:** no border at rest. Content scrolls under a 32px scroll-driven fade (Aside); once scrolled,
  a 1px `--o-rule` fades in under the header over `--o-fast`.

### 4.4 Transcript

Column 720 max, centered; 24px below the header; the bottom pads to the composer's height plus 32px,
with a 32px fade above the composer.

**The gutter.** Every line of an agent turn starts with the same 22px gutter: tool icons, chevrons,
the `$` of an open command and the agent's live mark sit centered in it (on x 11), and the words of
every row start at x 22. Whatever line is live (a thought, a tool row, the now-row) carries the
agent's 16px live mark in its gutter, so when one live line hands over to the next the mark and the
words stay where they are and only the text changes (Grok Bot's single status line).

**User message** (Grok Bot's inverted bubble, X Money's single tail corner)

- Right-aligned block, max 82% of the column, `--o-user-bg` fill, `body` 14/21 in `--o-user-fg`,
  padding 10px 14px, radius 16 16 4 16, 20px below.
- Over 12 lines it clamps, fades into its own fill and shows "Show all" (12px 500, underlined, fg
  70%) at its foot; opened, the link reads "Show less".
- A steer (a message sent into a running turn) is the same block with "STEERED AT 0:31" in `caps`
  `--o-text-3` above it, right-aligned.
- Pasted code inside: `code` on on-ink 12% (light) or ink 7% (dark), radius 4.
- Attachments and context under it, right-aligned, 6px gaps: 24px chips (radius 6, 1px `--o-line`,
  `--o-pane` fill, 12px icon, `mono` 12 `--o-text-2`); images as 48px thumbnails with a ring. Linear's
  "added to context" line in `meta` `--o-text-3` when the agent pulled files itself.
- Hover reveals edit, copy and more as 24px icon buttons to the block's left.

**Agent byline** (once per agent turn): 24px row. The agent's Orbit mark (16px, static) in the
gutter, then the name in `ui` 500 `--o-text-1`. On a chat's first turn, and whenever they change, the
model follows in `--o-text-2` and the effort in `--o-text-3` at the same size, one two-tone string
("Claude Code Opus 5.5 High"); between turns that run on the same model and effort the byline is the
mark and the name, so the transcript does not repeat itself. On hover, the time in `mono` 11
`--o-text-3` and a more button appear at the right. 8px below it, the turn begins.

**Markdown** (agent prose sits bare on the pane, no bubble)

- Running text (paragraphs, lists, quotes, headings, and the text of an open thought) keeps a 560px
  measure, about 89 characters at 14px (Harvey's thread measure); code blocks, tables, tool rows and
  wells keep the full column.
- Paragraphs `body` 14/22 `--o-text-1`, 10px apart.
- h1 and h2 `heading` 15/22 600 (16px above, 6px below); h3 14/22 600.
- Bullets are 4px zero-radius squares in `--o-text-3` (SpaceXAI's markers), 18px indent; numbered
  items use `--o-text-3` tabular numerals. An item that opens with a bold run keeps the run in
  `--o-text-1` 600 and sets the rest of the item in `--o-text-2` (Grok).
- Inline code: Geist Mono at 0.893em, `--o-text-1`, ink 5% (dark ink 7%) fill, radius 4, padding 1px
  5px, 1px `--o-line` ring.
- Links: `--o-text-1`, 1px underline in `--o-text-4` offset 3px, `--o-text-1` underline on hover
  (X Money: links are ink, not blue).
- File references ("pacing.ts:42") are chips: `mono` 12 on the inline-code fill, radius 4, a 10px
  arrow-up-right; click opens the file in the right panel's Files tab (Perplexity, Harvey citations).
- Tables: 13px, header `meta` 500 `--o-text-3`, 32px rows on 1px `--o-rule`, no vertical rules,
  numbers right-aligned in `tnum`. Blockquotes: 2px ink-14% left rule, `--o-text-2`. Horizontal rule:
  the dashed tear line.

**Code blocks:** `--o-well`, 1px `--o-line`, radius 8. Header 30px: the language in `caps`
`--o-text-3` ("TYPESCRIPT") at left; "Copy" (12px `--o-text-3` with a 12px icon) at right, which
morphs to "Copied" with a check for 1.2s. Body padding 10px 14px, `code` 12.5/20 in the code palette,
no wrap (a setting turns wrap on), horizontal scroll, internal scroll past 420px.

**Thinking**

- Collapsed: a 24px line, a 12px chevron in the 22px gutter, "Thought for 6s" in `meta` 13px
  `--o-text-3` (number in `tnum`). When the agent writes a summary: "Thought about the pacing math ·
  6s". No pill, no icon, no sparkle (Grok, ChatGPT, Linear).
- Live: "Thinking" (or the agent's summary) with the shimmer and " · 4s" ticking once a second; the
  agent's live mark replaces the chevron in the gutter. A live thought is open, and it stays open
  after it ends until the next item arrives, so the words being read never vanish under the reader;
  then it folds.
- Open: 13/20 `--o-text-2` behind a 1px spine on x 11, text from x 22, max 280px tall with an
  internal scroll and a bottom fade that shows only while more text is below.
- Every fold in the transcript (thoughts, groups, calls, outputs) animates height and opacity over
  `--o-dock`; under reduced motion it is a 120ms fade.

**Tool call rows** (Grok's label plus literal, Cursor's muted lines, Aside's verb tense)

- One call is a 28px row: a 14px icon in `--o-text-3` centered in the gutter; from x 22, the verb in
  `ui` 450 `--o-text-2`, the object in `mono` 12 `--o-text-1`, an optional result in `--o-text-3`
  ("42 lines", "no matches", "19 passed"); at right the duration in `mono` 11 `--o-text-3`, or the
  diffstat for edits. Hover: `--o-hover` fill (radius 6) and a chevron. Rows in a run sit 2px apart.
- Running: the verb turns present progressive with the shimmer ("Reading", "Running"), the agent's
  live mark takes the icon's place in the gutter, and the right side shows the 2x3 loader and
  elapsed time. A call that waited for your answer times from the answer, not from the request.
- Icons by kind (Lucide): read `file-text`, edit `file-pen-line`, write `file-plus`, delete
  `file-minus`, search `search`, glob `folder-search`, execute `square-terminal`, fetch `globe`,
  subagent `git-fork`, MCP `plug`, other `wrench`.
- **Groups:** two or more consecutive calls collapse into one summary row ("Read 2 files, searched 1
  pattern") with a chevron in the gutter and the total duration at right (Claude Code). While a
  group runs, its summary names the live call as a live verb and a mono literal ("Reading"
  `pacing.test.ts`) with the shimmer on the verb and the agent's mark in the gutter. Opened, the
  children stack under it with a 1px `--o-rule` spine on x 11 passing behind their icons (Legora,
  Aside). Every finished turn collapses its tool rows into groups; the answer stays bright.
- **Opened call:** a well under the row (margin 4px 0 8px 22px, `--o-well`, 1px `--o-line`, radius 8,
  padding 10px 12px) with key-value rows (22px, label `meta` `--o-text-3` in an 88px column, value
  `mono` 12 `--o-text-1`): File or Target, Duration, Output. Edits open their diffs (below), searches
  their results, commands their output (Terminal output, below).
- **Denied or skipped:** the row's text struck through in `--o-text-3` inside a 1px dashed outline
  (radius 6), "Denied" at right (Cron).
- **Failed:** a red × and "Failed" (a command: "exit 1") in `mono` 11 `--o-red` at right; the well
  opens by itself.

**Diffs** (edit calls; Grok Build's inline diff with GitHub's tints)

- In the call's well: a 32px header with a 14px file icon, the path in `mono` 12 (folders
  `--o-text-3`, giving way from their start when room runs out; file name `--o-text-1`, never cut),
  "+19 −5" in `mono` 12 green and red, five 6px diffstat squares (1px gaps; green share, red share,
  rest ink 12%), then "Open in Changes" and "Copy path" icon buttons at right.
- Rows are 20px in `code`: one 36px number column (`--o-text-3` on unchanged lines; removed lines
  show the old number in red, added lines' numbers in green), a 14px marker column ("+" or "−" in the
  full tone, so color is never the only cue), then the code in the code foreground over the line
  tint, with changed words on the word tint. Diff code is not syntax-colored (3.1).
- Collapsed to 14 rows with a fade and "Show 34 more lines"; gaps between hunks read "12 unchanged
  lines" in `mono` 11 `--o-text-3` and expand on click.

**Terminal output** (Grok Build grammar, Warp's exit edge, Vercel's log rows)

- A command's row is its block's header, so a command reads the same open or closed: the verb
  ("Ran", "Running" with the shimmer) and the command in `mono` 12 `--o-text-1`, plus "19 passed" in
  `--o-text-3` when the output ends with a test runner summary (an exit code is said once, by the
  status). Opened, the row and its output share one well (`--o-well`, 1px ring, radius 8) and the
  icon in the gutter becomes "$" in `--o-text-3`; while the command runs, the agent's live mark holds
  the gutter instead.
- A running command opens by itself and shows its last 6 printed lines live, blank runs closed up;
  done, it folds back into the row unless it failed. The well stays on the block until the output has
  folded away.
- Status at right: running = loader and "4s"; closed and done = "4.2s"; open and passed = 12px green
  check and "exit 0 · 4.2s"; failed = red × and "exit 1 · 2.1s"; stopped = a filled square and
  "Stopped · 1.0s" in `--o-text-3`. An open block adds "Copy output" and, when lines are hidden, an
  expand icon button.
- Body: padding 4px 12px 10px 22px, so output lines start on the word column under the command;
  `term` 12/18 in the terminal palette, 12 visible lines with a top fade when more exist, newest at
  the bottom, and "Show all 214 lines" under it. Warning and error lines get Vercel's full-width tint
  (signal tint and red tint). A failed run adds a 2px `--o-red` inset left edge to the well.
- Secrets that look like keys or tokens render as "••••" with an eye toggle (X Money's privacy mask).

**Search results** (Aside's nested result card)

- Row: "Searched" + the query in `mono` + "in packages/ui/src" + "3 matches" in `--o-text-3`.
- Opened well: 28px result rows with a 12px file icon, the path in `mono` 12 (folders `--o-text-3`,
  name `--o-text-1`), ":42" in `--o-text-3`, then the matching line in `mono` 12 `--o-text-2` with the
  match on `--o-signal-tint` in `--o-text-1`. Eight rows, then "+ 12 more". Web results show
  favicons in grayscale (full color on hover) so the transcript stays monochrome.

**Subagents** (Aside's fan-out rows, Grok Build's tags): the group row reads "Spawned 3 subagents"
with "2 running" and the loader at right. Opened, each child row (26px, on the spine) shows a
`git-fork` icon, the task in `ui` 500 `--o-text-1`, the agent type in `--o-text-3`, a 20px model pill
(`--o-raised-2`, `meta` `--o-text-2`), and a `caps` tag at right: "[RUNNING]" with the loader,
"[DONE 3M 15S]" in green, or "[FAILED]" in red.

**System events** (Grok Bot): centered 28px lines in `meta` `--o-text-3` with entity chips (a 14px
Orbit mark, the smallest a mark is drawn, and the agent name in `--o-text-1` 500; commands and ids
in `mono` `--o-text-2` after a `--o-text-4` dot). Examples: "Switched to [mark] Codex",
"Full auto from here", "Reverted turn 3 · checkpoint 7f3a2c19", "Renamed to Fix the flaky orb
pacing test", "✓ Allowed once · cargo test -p aura-drivers · 0:09". An answer is logged where it
took effect: right before the row of the call it let through, so the transcript reads "allowed,
then ran". A line that can be taken back says so in its toast (4.17), not in the transcript.

**The now-row** (the live end of a running turn, Grok Bot's pending row) fills the gaps where no
other line is live: before the first item, between items while the agent thinks, while it waits on
you, and while it stops. A running tool row or a streaming thought carries the live mark itself,
and a streaming answer shows the work in its words, so the now-row never doubles one. It has the geometry of the line that will replace it: a
24px line at the start of a turn (where the first thought will be), a 28px row 2px under the last
item otherwise. The agent's live mark (16px) sits in the gutter and the words start at x 22: "Thinking"
with the shimmer and " · 4s" in `--o-text-3`. While waiting: the diamond-satellite mark and "Waiting
on you · 0:09" in `--o-signal-text` 500; while stopping, "Stopping". At the start of a turn it rises
8px with opacity over `--o-dock`. In a gap between items it waits 1.2s before it shows (most gaps are
shorter, so it never flashes for a frame) and then only fades in, in place, because the row that
replaces it will sit exactly there.

**Turn footer, the receipt** (X Money's receipt, Grok Bot's receipt checklist, Mistral's telemetry)

- 12px after the last item: the dashed tear line, then one 28px row.
- Left: "Done in 48s · 4.8k in · 2.1k out · $0.21" in `meta` `--o-text-3` with `tnum`, the dots in
  `--o-text-4`. Hover over the cost shows cached tokens and the per-model breakdown.
- Middle: the **files-changed chip** (24px, radius 6, 1px `--o-line`): a 12px file-diff icon, "2 files"
  in `meta` `--o-text-2`, "+59" and "−23" in `mono` 12 green and red, and the five diffstat squares.
  Click opens Changes scoped to this turn (Cursor, Legora's deliverables).
- Right: copy, retry, fork and more as 24px icon buttons, always visible on the last turn and on hover
  elsewhere (and while the menu is open). More opens upward, since the composer sits right under the
  last receipt: Copy (the words as read), Copy as Markdown (the source), Copy receipt (the turn as an
  X Money-style receipt: agent, model, duration, files, tests, cost, checkpoint id); Retry, Edit and
  resend, Fork into new chat; then Delete.

**Sticky prompt** (Claude): while you scroll through a long turn whose user message is out of view,
the prompt pins under the header as a 32px one-line strip in `--o-user-bg` (radius 0 0 12 12), text
truncated; click scrolls to it. It takes no room in the column, and the pane's top fade carries on
for 24px under it so text never ends hard against its edge. Hidden, it takes no clicks and no focus.
Enters and leaves over 220ms (opacity and an 8px drop). Toasts move down below it while it shows.

**Jump to latest** (Linear): when you scroll up during a stream, a 26px "↓ Latest" pill (`--o-raised`,
ring, e2, `meta` `--o-text-2`) floats 12px above the composer.

### 4.5 Plan

**Plan segment** (docked in the composer shell, 4.9), 36px, `--o-raised-2`: `caps` "PLAN" in
`--o-text-3` with "2/3" in `mono` `--o-text-2`; the current step in `ui` `--o-text-1` with the shimmer
while it runs (truncated); at right three 24 x 2px rules with 3px gaps (done `--o-text-1`, active
`--o-text-2` with the shimmer sweeping through it, pending `--o-line-strong`; Harvey's timer rules) and
a 12px chevron-up. When the plan completes the segment reads "Plan complete 3/3" with a green check,
then folds away after 4s.

**Plan card** (opens from the segment as a popover the composer's width, `--o-raised`, radius 16, e3):

- Header 40px: "Plan" `ui` 500, "2 of 3" in `--o-text-3`, a "Hide" ghost button.
- Steps are 32px rows with a 14px node (X Money's tracking stepper, Harvey's checklist):

  | Step | Node | Label |
  |---|---|---|
  | Done | 14px `--o-ink` disc with an 8px `--o-on-ink` check | `--o-text-3`, struck through in `--o-text-4` |
  | Active | 14px ring, 2px `--o-line-strong` track with a 90 degree ink arc turning 1s linear | `--o-text-1` 500 |
  | Pending | 14px 1px ring in `--o-text-4` | `--o-text-2` |

  Nodes are joined by a dashed 3/3 spine in `--o-text-4`. Sub-lines sit under a label in `meta`
  `--o-text-3`. Footer: "Updated by Claude Code · 0:24" in `meta` `--o-text-3`.

**Plan approval** (plan mode; SpaceXAI's plan.md, Mistral's plan card): a document card in the
transcript, `--o-well`, 1px `--o-line`, radius 8.

- Header 32px: the file name "plan.md" in `mono` 11 `--o-text-2`, centered between two 1px `--o-rule`
  lines, a close × at right.
- Body: a 32px line-number gutter (`mono` 11 `--o-text-4`), markdown at 13/20 (headings 13 600
  `--o-text-1`, square bullets), 16 lines then "Show all".
- Footer: "Claude Code wants to start this plan" in `meta` `--o-text-3` at left; at right "Keep
  planning" (ghost, keycap Q), "Comment" (soft, keycap C), "Approve" (ink pill, keycaps A and Enter).
  Approving adds "Approved · 4:21 PM" as a system event and turns the plan into the plan segment.

### 4.6 Permission card

The decision sits where your hands are: the card **takes the composer's place** until answered
(Codex iOS, Claude's AskUserQuestion, Perplexity), and the transcript's now-row reads "Waiting on you"
at the point of the request.

- **Shell:** the composer's width (720), `--o-raised`, 1px `--o-line-strong` ring, e3, radius 16,
  padding 16px 18px 14px.
- **Eyebrow** (16px): a 7px orange diamond and "CODEX NEEDS YOU" in `caps` `--o-signal-text`; at
  right the wait time "0:09" in `mono` 11 `--o-text-3` and "1 of 2" when several requests queue.
- **Title** (10px below), X Money's sentence in `sentence` 18/26: "Run" in `--o-text-3`, the command
  `cargo test -p aura-drivers` in Geist Mono 16.5px `--o-text-1`, "in" in `--o-text-3`, the folder
  `auracode` in mono `--o-text-1`. At most two lines; the full command is below.
- **Reason** (4px below): `ui` 13/20 `--o-text-2`, naming the level the request was asked under:
  "Codex wants to run a command. Auto-edit asks before running commands." (Ask: "Ask asks before
  every edit and command."; Full auto with Final confirm: "Final confirm asks before this command.")
- **Tear line** (14px above, 10px below), then **key-value rows** (26px, `ui` 13; label `--o-text-3`
  left, value `--o-text-1` right, literals in `mono`): Command (full, selectable, wraps), Directory
  (`~/Desktop/auracode`), Network ("Off"), Autonomy ("Auto-edit · asks before commands"), and Seen
  before ("Approved 3 times in this project", Family's "Known address").
- **Preview** for writes and edits: the first 6 diff rows in a well before the actions (Aside shows the
  evidence above the choice).
- **Calm warning** for risky commands (force pushes, writes or deletes outside the project, anything
  that touches a remote): one `ui` line in `--o-text-2` led by a 7px orange diamond, stating the
  consequence: "This rewrites main on origin. Checkpoints only cover files in this folder." The buttons
  stay ink; risk is said in words, not painted red (Family, ChatGPT).
- **Actions** (14px below): "Allow once" (ink pill, keycaps 1 and Enter), "Allow in this chat" (soft
  pill, keycap 2), "Always allow in auracode" (soft pill, keycap 3); at the far right "Deny" (ghost,
  keycap Esc) (Aside's real answers, Perplexity's numbered keys, Warp's keyboard actions). Under them
  a `meta` `--o-text-3` hint says what the hovered answer does: "Runs this command once. The next one
  asks again.", "Saves the rule `cargo test *` for this chat only.", and at rest which answers save
  the rule.
- **Focus:** the card itself takes focus when it arrives (no ring), so 1, 2, 3, Enter and Esc answer
  at once without a heavy ring sitting on "Allow once" at rest. No key answers while a menu or sheet
  is over it, and ⌘⇧A (cycle autonomy) does not answer it either: it says "Answer Codex first".
- **Instead** (last row, after a 1px `--o-rule`): a 36px field with a pencil icon, "Tell Codex what to
  do instead". Typing turns the primary pill into "Send" (deny with instructions).
- **Answer:** the primary label morphs "Allow once" to "Allowed" and a green check draws (X Money's
  verify-to-success, Family's morph), 400ms; then the card folds back into the composer over
  `--o-dock`, and the transcript gains the event line "✓ Allowed once · cargo test -p aura-drivers ·
  0:09" right before the row of the command it let through, whose timer starts at the answer. Deny
  morphs to "Denied" with a red × and logs "× Denied".
- **Unfocused window:** an OS notification with "Allow once" and "Open" actions (4.17).

### 4.7 Question card

Same place and shell as the permission card (Claude's ask-user card, Perplexity and Unify, Grok
Build's Q&A).

- Eyebrow: orange diamond, "CLAUDE CODE NEEDS YOU", and the pager "1/3" at right.
- Question in `sentence` 16/24 500 `--o-text-1`.
- Options: 40px rows (52 with a description) on 1px `--o-rule`: an 18px keycap numeral at left (idle
  `--o-raised-2` with `--o-text-2`; chosen `--o-ink` with `--o-on-ink`), the label in `body` 14
  `--o-text-1`, an optional description in `meta` `--o-text-3`. The focused row takes `--o-selected`.
- The last row is "Other", an inline field "Type your own answer" with a pencil.
- Footer: "‹ 1/3 ›" in `--o-text-3` at left; "Skip" (ghost) and "Continue" (ink pill, keycaps ⌘ and
  Enter) at right. Answers log as a system event.

### 4.8 Error and notice cards

| Kind | Where | Spec |
|---|---|---|
| Turn error (agent crashed, exited, auth expired) | In the transcript where it happened | `--o-well` with a 2px `--o-red` left edge (radius 0 8 8 0), padding 10px 14px. A 12px red ×, the title in `ui` 500 `--o-text-1` ("Claude Code stopped: process exited with code 1"), the last stderr line in `mono` 12 `--o-text-2`, then 28px actions: "Retry" (soft), "Open log" (ghost), "Continue with Codex" (ghost, hands off; not shown when the failed agent is Codex) |
| Blocking notice (rate limit, sign-in needed, model unavailable) | A composer segment (4.9) | 36px `--o-raised-2` row: a 7px orange diamond when it blocks sending, the fact in `meta` `--o-text-2` ("Rate limit reached · resets 5:00 PM"), and one action as a text button in `--o-text-1` 500 ("Switch agent", "Sign in") (Claude's docked banners) |
| Warning notice (non-blocking) | In the transcript, left-aligned | 28px row in a 1px dashed `--o-line-strong` outline, radius 8 (Mistral's dashed notice): a 7px orange diamond, `meta` `--o-text-2` text ("Claude Code's settings forbid bypass, so this chat runs in Auto-edit"), and a "Settings" text button |
| Info | In the transcript | A centered system event line (4.4) |
| Destructive confirm (revert a turn, delete a chat, remove an agent) | Floating sheet | X Money's detached sheet: 440px, centered, `--o-raised`, radius 16, e4 over `--o-scrim`, padding 24. Title `title` 22/28 as a sentence with grey verbs ("Revert **turn 3** in **auracode**"), a key-value block (Files, Checkpoint, Created), a calm line in `--o-text-2` ("Your changes after this point move to a new checkpoint."), then "Cancel" (soft) and the single red pill ("Revert"). Enters with `--o-slow` sheet easing from 16px below |

### 4.9 Composer

One object that grows upward in segments (Grok's single material, Aside's control row, Claude's fused
bars).

- **Shell:** width 720 (the column), 16px above the pane's bottom edge, `--o-raised`, radius 16,
  1px ring (light ink 10%; dark ink 9% plus the lit edge from 3.6), e2. Segments stack inside the
  shell above the input, each 36px on `--o-raised-2` and separated by 1px `--o-rule`, in this order
  from the top: blocking notice, plan, queue, handoff. At most two segments show at once; when more
  exist, the lower-priority ones collapse into a "+1" chip at the right end of the top segment.
- **Input:** padding 12px 16px 6px, `body` 14/22 `--o-text-1`, placeholder in `--o-text-3`: "Message
  Claude Code" (new chat), "Queue a message for Claude Code" (while running). Grows to 12 lines, then
  scrolls. Ink caret.
- **Control row** (32px, padding 0 12px 8px, 6px gaps), left to right:
  - Attach: 28px square button, radius 8, a 16px plus in `--o-text-2` (X's square attach).
  - **Agent pill:** 28px, radius 8, padding 0 8px 0 6px, no fill or border at rest: a 14px Orbit mark,
    "Claude Code" in `ui` 500 `--o-text-1`, "Opus 5.5" in `--o-text-2`, "High" in `--o-text-3`, a 12px
    chevron. Hover `--o-hover`; open `--o-selected`. Opens the picker (4.10).
  - **Autonomy chip:** 28px, radius 8, padding 0 8px: the 10px level glyph, "Full auto" in `ui` 450
    `--o-text-2`, a chevron (4.11).
  - Spacer.
  - **Context meter** (Grok Build's status bar): a 28 x 4px track (ink 10%, radius 2) filled in
    `--o-text-2` (`--o-signal` from 85%), then "62%" in `mono` 11 `--o-text-3`. Tooltip: "62% of 200k
    context used". It shows only once the agent has reported its usage; a new chat has no meter
    rather than a made-up 0%.
  - **Send** (X's primary that changes with state):

    | State | Control |
    |---|---|
    | Empty | 32px ink-12% circle with a `--o-text-4` up arrow |
    | Ready | 32px `--o-ink` circle with a 16px `--o-on-ink` up arrow |
    | Running, empty input | 32px `--o-ink` circle with a 10px `--o-on-ink` square (Stop, Esc) |
    | Running, text typed | Split ink pill: "Queue" with an Enter keycap, then a 28px chevron for "Steer instead" (⌘ Enter) when the agent supports it (Aside's Queue or Steer) |

- **Hint line** under the shell (18px, centered, `mono` 11 `--o-text-3`), only while running or
  queueing: "esc to stop · enter to queue · ⌘ enter to steer" (Mercury, Cursor CLI). A second Esc
  force-stops, and the line says so after the first ("esc again to force stop"). With a queue and
  no turn running it reads "enter to send", or "enter to send · queue paused" after a stop. The line
  keeps its height when empty, so the composer never jumps.
- **Handoff segment** (after switching agents): the new agent's 14px mark, "Next message goes to
  **Codex** with a handoff · 412 tokens" in `meta` `--o-text-2`, a "Preview" text button and a ×
  that keeps the chat's agent. Preview opens the **handoff card** above the composer (the plan
  card's shell): "Handoff to Codex" and the token count, a tear line, then X Money's receipt rows
  (Chat, Turns, Files with the diffstat, Last answer) and a footer, "Codex reads this summary, not
  the other agent's session." Esc or Hide closes it.
- **Narrow:** the control row is a container query on the composer. Under 560px the pill keeps the
  mark and agent name and drops the model, the effort and the meter's percentage; under 420px the
  autonomy chip keeps only its glyph and the meter goes. Nothing wraps.
- **Attach** in the lab says it is not built yet (a toast), like every control the lab cannot do.
- **Drop:** dragging files over the pane draws a 1px dashed ink-24% outline around the shell (radius
  16) with "Drop to attach" in `meta` `--o-text-2`.
- **Mentions and commands:** `@` opens a file list and `/` a command list above the shell, each as a
  menu (4.20) whose rows show the path or command in `mono` and a description aligned to a second
  column (Warp's slash menu), with the key legend "↑ ↓ to move · enter to insert · esc to close".

### 4.10 Agent > model > effort picker

Opens from the agent pill (or ⌘.), anchored 8px above it and left-aligned with the composer.

- **Panel:** 640 wide, up to 420 tall, `--o-raised`, radius 16, padding 6, e3. Three columns split by
  1px `--o-rule`: Agent 226, Model 244, Effort 156. Each column starts with a `caps` label in
  `--o-text-3`. Items have radius 10. The focused column's selected row takes `--o-selected` and the
  2px ink rail (Notion Calendar's rail, in ink).
- **Agent rows** (44px, two lines; X Money's switcher items): the agent's 16px Orbit mark, the name in
  `ui` 500 `--o-text-1`, and a `mono` 11 `--o-text-3` line ("2.1.310 · signed in"); at right a
  single-letter keycap (C Claude Code, X Codex, G Grok Build, U Cursor, P Pi, M oh-my-pi, O OpenCode,
  H Hermes, A Antigravity; any other ACP agent takes its first free letter). Not signed in: "Sign in"
  in `--o-signal-text`. Update available: "0.164.0 → 0.165.0" and an "Update" link in
  `--o-signal-text`. Agents that are not installed sit under a rule and a "NOT INSTALLED" label as
  ghosts with an "Install" link; clicking the row copies the install command and says so in a toast.
- **Model rows** (44px; Grok's and Claude's menus): the model in `ui` 500 `--o-text-1`, a short
  description that always fits one line in `meta` `--o-text-3` ("Most capable", "Fast, everyday
  coding"; the full sentence is its tooltip), the context size in `mono` 11 `--o-text-3` at right,
  a check on the current model.
- **Effort rows** (36px; Aside's ladder, Claude's effort sheet): five 2 x 8px level ticks (ink up to
  the level, `--o-text-4` after), the label in `ui` `--o-text-1`, "default" in `meta` `--o-text-3` on
  the default level, and a numeral keycap 1 to 5 at right. Models without effort show "No effort
  setting" in `--o-text-3`.
- **Footer** (32px, 1px `--o-rule` above): the key legend in `meta` `--o-text-3` with keycaps
  ("↑ ↓ move · ← → column · enter choose · esc close", Raycast's action bar) and, for the hovered
  effort, its consequence at the right ("High: thinks longer on hard steps; uses limits faster").
- **Behavior:** opens on the current agent; letters jump to agents, digits set effort, left and right
  change column, Enter commits all three. With the mouse, clicking an agent moves to it, and a click
  on a model or an effort, or a second click on the chosen agent, commits. Hovering a row dims its siblings' labels to `--o-text-3` (Harvey). Open and close over
  `--o-base`: opacity, scale 0.98 to 1, 4px rise.
- **Narrow** (composer under 640px): two columns, Agent on the left spanning both rows, Model over
  Effort on the right; the effort consequence in the footer is dropped.

### 4.11 Autonomy control and badge

- **Level glyph** (Family's three-level stepper): three 2px-wide vertical ticks, 4, 6 and 8px tall,
  2px apart. Ask fills one, Auto-edit two, Full auto three, in ink; empty ticks are `--o-text-4`. It
  is an instrument reading, not an icon.
- **Badge:** the composer chip (glyph plus "Full auto") is the always-visible badge the plan asks for.
  Switching mode mid-chat logs "Full auto from here" as a system event. No modal.
- **Menu** (300px, `--o-raised`, radius 16, padding 6, e3; opens above the chip):
  - Three 56px rows (radius 10): the glyph, the title in `ui` 500, a consequence in `meta`
    `--o-text-3` (ChatGPT's consequence lines, Aside's scope sentence), and a keycap 1, 2 or 3.
    - Full auto: "Edits files and runs commands without asking. Every turn is checkpointed."
    - Auto-edit: "Edits files without asking. Asks before running commands."
    - Ask: "Asks before every edit and command."
  - The selected row carries a 1.5px ink rim and a filled 14px ink check in place of its keycap
    (X Premium's selection).
  - After a rule, a 44px switch row: "Final confirm", "Always ask before rm, force pushes and writes
    outside the project", and a switch (Aside's Final confirm).
  - Footer hint: "⌘ ⇧ A cycles autonomy" in `mono` 11 `--o-text-3`.
- **Agents that cannot ask** (Pi): Ask and Auto-edit show disabled in `--o-text-4` with "Pi never asks
  before acting"; switching to Pi adds the warning notice from 4.8.

### 4.12 Queue

- **Queue segment** in the composer shell (36px): `caps` "QUEUED" and "2" in `mono` `--o-text-2`, the
  next message's first line in `ui` `--o-text-2` (truncated), then "Edit" (ghost) and a × icon button.
- **A stop pauses the queue.** Stopping a turn never sends the next queued message by itself: the
  segment adds "· paused" in `--o-text-3` and a "Send next" text button, and the queue resumes when
  you send.
- **Card peek** (X Money's wallet stack): for each further queued message, a 4px sliver of
  `--o-raised-2` with a ring peeks above the shell, inset 12px more per level, up to two slivers.
- **Opened list** (popover the composer's width): numbered 36px rows (the numeral in `mono`
  `--o-text-3`, the message in `ui` `--o-text-1`, the target agent's 12px mark and name when it
  differs, a six-dot drag handle, a ×). Rows reorder by drag or ⌥ up and down.
- **Sending:** when a queued message starts, its row flies up into the transcript and becomes the user
  block (280ms out, Family's directional motion); the count steps down digit by digit.

### 4.13 Empty state

One sentence, the input, and what just happened. No illustration, no glow, no prompt-chip soup
(Grok's "empty means empty", Aside's new tab).

- At about 38% of the pane's height: the active agent's Orbit mark at 56px (idle: a small hollow node,
  the orbit with its dashed far half, the satellite), then 20px, then the sentence in `display` 30/36
  on one line, built as X Money builds a confirm title: "**Claude Code** is ready in **auracode**."
  with the agent and project (and the period) in `--o-text-1` and "is ready in" in `--o-text-3`. The
  agent's name rests on the glint's 2px ink-14% rule.
- 24px below: the composer at full width.
- 24px below the composer: `caps` "RECENT IN AURACODE" in `--o-text-3` and up to three 32px ledger
  rows (Aside's recent tasks, Cursor's outcome ledger), never including the chat you are in: the
  status pip, the title in `ui` `--o-text-1`, the agent's name in `--o-text-3`, the outcome at right
  ("+59 −23" in `mono`; "No changes" in `--o-text-3`; "Needs you" in `--o-signal-text`; "Failed" in
  `--o-red`; "Working for 3m" with the loader), and the age in `mono` `--o-text-3` ("now" while it
  runs). A row opens its chat.
- **Agent switch:** choosing another agent in the pill flips the agent's name word by word
  (`--o-hero`), runs the glint once along the rule under the new name, and draws the new agent's
  orbit in (`stroke-dashoffset`, 400ms). On first paint nothing flips or draws: the arrival is shown
  only when you chose it.
- **No folder:** "**Claude Code** is ready." with a "Choose a folder" outline button (keycap ⌘O).

### 4.14 Onboarding and agent discovery

Grok Console's mission checklist beside a night-sky panel, with SpaceXAI's globe as the hero. Every
step is skippable, keyboard-driven and resumable.

- **Layout:** no sidebar. The left column (40% of the window, clamped to 440 to 568px; padding 64px
  64px 40px) sits on `--o-pane`. The right is the **night panel**: a pane inset 8px from the window,
  radius 12, `#000000` in both themes with a 1px ring at white 8%, holding the globe (Harvey's ink
  panel, Grok Console's black panel). A static starfield of 1 to 2px dots at white 10 to 40% (about
  one per 6,000 square pixels) sits behind it.
- **Left column top:** the wordmark (an SVG slot; until the owner's logo lands, "auracode" in Geist 600
  15px) and "Skip setup" as a ghost button, which goes straight to a new chat.
- **Checklist** (X Money and Grok Console steppers): 18px circled numerals (1px `--o-text-3` ring;
  active `--o-ink` with an `--o-on-ink` numeral; done `--o-ink` with a check) joined by a dashed spine.
  Titles in `heading` 15; pending titles in `--o-text-3`. The active step opens in place (height and
  opacity over `--o-dock`); a done step folds to its title and a summary in `meta` `--o-text-3`
  ("4 ready, 1 to sign in, 2 to install", "Sync on for you@example.com" or "Local only, no
  account", "Dark theme · full motion"), and clicking it opens that step again. Enter continues from
  anywhere outside a button. Headlines balance their lines, so a wrapped clause never leaves one word
  alone.
  1. **Agents.** Heading (`display`, two-tone, flip-up) that follows the scan: "Looking for agents." /
     "Still looking for 2." while it runs, then "Found 5 agents." / "2 more can be installed." The
     roster (Linear's coding-tools list) has a slot for every agent from the first frame, so nothing
     below it moves as detection streams: a slot still being checked shows the loader and "Looking
     for Cursor" in `--o-text-3`, then resolves in place (opacity and a 4px rise over `--o-dock`).
     48px rows on 1px `--o-rule`, each with the agent's 20px Orbit mark, the name in `ui` 500, a
     `mono` 11 `--o-text-3` line with the binary path and version ("~/.local/bin/claude · 2.1.310",
     or "Not installed"), and a status at right: "Ready" with a 5px green square; "Sign in" in
     `--o-signal-text`, which reveals the agent's own login command ("agy login") as a copyable
     `mono` chip, since signing in happens in the agent's CLI; "Install" as a 26px outline pill that
     reveals the install command the same way. Under the roster, `mono` 11 `--o-text-3`: "Scanned
     PATH, ~/.local/bin and WSL in 1.2s". Continuing holds the scan finished. No agents: "No agents
     found." / "Install one, or try the demo." with install rows and a "Try the demo chat" soft pill.
  2. **Account** (M6): "Sync across your machines." / "Or keep auracode local." with a 32px email
     field (radius 8, the input edge from 3.7), "A 6-digit code signs you in. No password, and agents
     keep their own keys." in `meta` `--o-text-3`, then "Continue" (or "Send code" once an email is
     typed) and "Skip, use auracode locally". The code entry and the recovery-key card follow in M6.
  3. **Make it yours:** "Make it yours." / "Change it later in Settings." Appearance as three
     preview tiles (System, Light, Dark; 104 x 72, radius 8, miniatures of the window drawn from the
     theme swatch tokens; the selected tile takes the 1.5px ink rim and a filled check by its label)
     and motion as a strong segmented control (Full, Reduced, Off). Both apply at once. Orbit has one
     signal color and no agent hues, so the plan's accent choice becomes the appearance choice.
  4. **First project:** "Add a first project." / "Any folder works." A 120px dashed drop zone (1px ink
     24%, radius 12): "Drop a folder" with "Choose folder" (outline, keycaps ⌘ O) and "Clone from
     GitHub" (ghost, with a branch icon, never the GitHub mark). A chosen folder replaces the zone's
     contents with its square, name and path and a "Change" text button.
  - Buttons: "Continue" (ink pill, Enter keycap; "Open auracode" on the last step) and "Skip" (ghost).
- **The globe** (5.7) fills the night panel. As each agent is found, its orbit draws in
  (`stroke-dashoffset`, 500ms) and its satellite lands at its parked point over 240ms with its label.
  Missing agents get a dashed orbit, a hollow satellite and "NOT INSTALLED". An agent that needs
  sign-in shows the orange diamond and "SIGN IN" in orange on its data line. The globe turns once per
  120s while discovery runs and stops when it ends. At step 4, the project lands as a 12px square
  marker on the globe's surface with its label ("AURACODE" / "~/Desktop/auracode"), and a 1px arc
  at white 50% draws from it to each ready agent, 60ms apart. Top-left of the panel: `caps` "AGENTS
  5/7 · LIVE", then "AGENTS 5/7 · ✓ DONE", in white 50%. Bottom-left: a two-tone caption, "Agents run
  on this Mac." / "auracode never sees their keys."

### 4.15 Settings

Settings replace the main pane's content (⌘,), and the sidebar swaps to the settings nav.

- **Nav:** `caps` group labels; 30px rows with X Money's weight-morph hover; the active item in
  `--o-text-1` with the 2px ink rail. Items: General, Appearance, Agents, Permissions, Notifications,
  Shortcuts, Account and sync, Usage, About.
- **Page:** a 680px column, 40px top padding. Title in `title` 22/28 with a two-tone line in `ui`
  `--o-text-3` ("Agents" / "Turn agents on, pick their defaults, keep them updated.").
- **Groups** (X Money's inset panels): a section header in `ui` 500 outside the group; the group on
  `--o-raised-2`, radius 12, no border; 52px rows with the label in `ui` 500, a one-line description in
  `meta` `--o-text-3`, and the control at right (switch, value with chevron, outline "Manage" pill);
  rows split by 1px `--o-rule` inset 16px; 24px between groups. Changes that apply to new chats show
  "Applies to new chats" in `meta` `--o-text-3` under the group (Grok).
- **Appearance:** theme tiles (as in onboarding), motion (strong segmented), "Translucent sidebar"
  switch (section 6), density (Comfortable, Compact), code wrap.
- **Agents** (Linear's roster): one row per agent with its Orbit mark, name, version chip, binary path
  in `mono`, an enable switch, and "Update to 0.165.0" when available; opening a row shows default
  model and effort selects, autonomy support, config locations, and sign-in status.
- **Permissions:** default autonomy (the three selectable rows from 4.11), Final confirm, tool rules
  (Allow, Ask, Deny per tool, Deny wins), and the **access log** (Aside): a table in `mono` 12 with
  time, agent, tool, target and an outcome glyph (green check, red ×), filterable by agent.
- **Usage** (SpaceXAI telemetry rows, Harvey's editorial stats): per-agent rows split by hairlines with
  `numeral` figures (tokens, cost with superscript cents, time saved) and an axis-free 1px sparkline
  per agent (X Money). A "Hide costs and tokens" switch applies X Money's privacy mask app-wide.
- **About:** `caps` footer "AURACODE 0.1.0 (BUILD 214)" in `--o-text-3` (Grok iOS).

### 4.16 Right panel

A second pane (380 wide), toggled from the header (⌘J). **Tabs:** a strong segmented control (24px,
one ink pill; SpaceXAI): "Changes 2", "Files", "Plan", "Session"; a close × at right; the header is
44px. It resizes from 320 to 560 by the gutter (drag, or the arrow keys in 20px steps while the
gutter has focus). When the window is too narrow to keep the chat at least 560px wide beside it,
the panel floats over the chat with a strong ring and e3 instead of squeezing it.

**Changes** (the `changes` lab state)

- **Summary** (padding 16): `caps` "THIS TURN" with a scope menu ("This turn", "This chat", "Branch
  since main"; Zed). The diffstat as a hero: "+59" and "−23" in `numeral` 32/32 green and red, ten 6px
  diffstat squares, and "2 files · 48s · Claude Code" in `meta` `--o-text-3`. Actions: "Copy patch"
  (ghost, keycaps ⌘ ⇧ C) and "Open in editor" (ghost; disabled in the lab). Reverting lives in the
  footer.
- **Files** (32px rows on 1px `--o-rule`): 14px file icon, path in `mono` 12 (folders `--o-text-3`,
  name `--o-text-1`), "+19 −5" in `mono` 11 green and red, and a status letter (M, A, D) in `mono` 11
  `--o-text-3`. The selected file takes `--o-selected`.
- **Diff** (GitHub, Codex web, Zed): one section per file with a sticky 34px header (chevron, path,
  counts, squares, a 14px "Viewed" checkbox, a more menu with Unified (checked), Split and Copy
  path). Rows are 20px `code` with two 36px number columns (old and new, `--o-text-3`; the changed
  side's number in its tone), the 14px marker column and the monochrome code (3.1). Hunk headers are 24px bands (ink 4%) with "@@ −12,7 +12,9 @@
  shouldDrawFrame" in `mono` 11 `--o-text-3`. "Show 120 unchanged lines" expands context. The diff view
  toggle (Unified, Split) is the quiet segmented control.
- **Footer** (40px, sticky): "Checkpoint saved before this turn" in `meta` `--o-text-3` and "Revert"
  as a text button (or ⌘⇧Z anywhere), which opens the destructive confirm from 4.8. A revert logs
  "Reverted turn 3 · checkpoint 7f3a2c19" in the transcript and offers Undo in its toast.
- **No changes yet** (v0's shortcut-list empty state): "No changes yet" in `ui` 500, "Edits from this
  chat appear here." in `meta` `--o-text-3`, then three key hints (⌘J toggle panel, ⌘⇧C copy patch,
  ⌘⇧Z revert turn).

**Files:** `caps` "TOUCHED IN THIS CHAT", then the project tree; 28px rows with a 14px file icon, the
path in `mono` 12 (folders `--o-text-3`, name `--o-text-1`), its diffstat and a status letter (A, M,
or R for read) in `mono` 11 `--o-text-3`. Selecting a file opens a read-only viewer under its row:
a well with a `--o-text-3` line-number gutter and the code in the code palette, no wrap, scrolling
inside.

**Plan:** the plan card's stepper at full height. When subagents run, Grok Build's phases panel: two
columns, phases with `mono` counts ("6/6") and the current phase in 500 with an ink chevron, and the
live agents of that phase with loaders.

**Session** (Harvey's Properties, X Money's numbers)

- **Properties** (key-value, 30px rows, label `meta` `--o-text-3` in a 96px column): Agent and Model
  as Harvey's property chips (24px, radius 6, 1px `--o-line-strong` inset ring; the agent's chip
  holds its 14px mark), Effort, Autonomy (glyph and label), Folder (`mono`), Branch (`mono` with a
  git icon), Session (`mono` id with a middle ellipsis, "019e…7f5f", and copy).
- **Usage tiles** (X Money's stat pair): two tiles side by side on `--o-raised-2`, radius 12, padding
  14: "Cost" as `numeral` "$0" with superscript "21", and "Tokens" as "6.9" with a small "k"; under
  each a `meta` `--o-text-3` line ("this turn $0.21", "4.8k in · 2.1k out"). Before anything is
  reported the figures read "$0" and "0" in `--o-text-4` with "none yet".
- **Context:** a full-width 4px bar with a tick at the auto-compact threshold and "62% of 200k" in
  `mono` 11.
- **Turn timeline** (Browserbase, Antimetal): a 24px strip on `--o-well`, radius 6, with 1px ink-40%
  ticks for each tool call placed by time, ink-15% blocks for thinking, and "0:00" and "0:48" in
  `mono` 10 at its ends.

### 4.17 Notifications

- **Toasts** (X Money, Linear, Superhuman): top center of the main pane, 12px under the header; 32px
  tall, radius 16 (so a one-line toast is a pill), `--o-toast` with `backdrop-filter: blur(16px)
  saturate(1.2)` (written with the `-webkit-` prefix too); text `ui` 13 in the toast's text color; an
  optional action in 500 with its keycaps ("Archived Tray icon states · Undo ⌘Z", "Stopped Codex ·
  Resume"); ⌘Z runs Undo while the toast shows. Anything the lab cannot do yet says so here ("Search
  is not in this lab yet") instead of doing nothing. Enter: opacity and scale 0.96 to 1 over
  `--o-base`; stay 4s, held while the pointer is on it; leave with the **in** easing over 120ms.
  While the sticky prompt shows, toasts sit 12px under it instead of over it. Archive acts at once and
  offers Undo (Superhuman's undo instead of a confirm); delete and revert ask in the sheet first
  (4.8) and still offer Undo in their toast.
- **Agent cards in the window** (Harvey's signed card): when a chat you are not viewing finishes or
  starts waiting, a 320px card slides into the main pane's top-right (`--o-raised`, radius 16, e3,
  padding 12px 14px): the agent's 16px mark, its name in `ui` 500 and "now" in `--o-text-3`; the body
  in `ui` `--o-text-2` with the facts in ink: "Finished **Wire up the ACP client** · +69 −0" with +69
  in green (X's single green figure), or "Needs you: **Run cargo test -p aura-drivers**" with the
  orange diamond. Actions: "Open" and ×. Further cards stack behind it, 6px lower and 4% smaller each,
  up to three (X's stacked depth). One ripple ring marks arrival.
- **Several waiting:** the sidebar's Needs you group (4.2) is the inbox; no extra banner.
- **OS notifications** (window unfocused, Claude's outcome cards): title "Claude Code finished", body
  "Fix the flaky orb pacing test · 2 files +59 −23 · 48s"; or title "Codex needs you", body "Run cargo
  test -p aura-drivers in auracode", actions "Allow once" and "Open". Opening one skips the boot.
- **Menu bar extra** (Notion Calendar): a 16px monochrome template icon of the Orbit glyph; while any
  agent waits, its satellite becomes a filled diamond (template icons cannot be colored, so shape
  carries it). The dropdown is a native menu: "Needs you" rows ("◆ Codex · Run cargo test -p
  aura-drivers"), "Running" rows with elapsed times, "Done" rows, then "Stop all agents" and "Open
  auracode".

### 4.18 The boot moment

About 1.6s on a cold launch, skippable with any key, 0.6s on warm launches, skipped when opened from a
notification or link, a 300ms static frame under reduced motion. It plays from cached detection and
reconciles later; it never waits on a shell.

| Time | What happens |
|---|---|
| 0 to 300ms | The window shows the tray (dark: `#000000` with the sparse starfield; light: `--o-tray`). The globe's outline draws as a 1px circle at 220px (`stroke-dashoffset`) |
| 300 to 900ms | The graticule fades in and turns 10 degrees; each cached agent's orbit draws and its satellite drops to its parked point, 60ms apart; mono labels type in character by character |
| 900 to 1,300ms | Under the globe the wordmark flips up (`--o-hero`); a status line in `mono` 11 `--o-text-3` with the shimmer reads "5 AGENTS · READY", over a 2px progress rule that fills in segments (Harvey's timer lines) |
| 1,300 to 1,600ms | The globe shrinks and travels to the sidebar's agent dock while the orbits separate into the dock's marks (one shared element); panes rise 8px into place with opacity |

### 4.19 The website's landing hero (auracode.si)

Same tokens and type; light by default, dark by OS preference. Works without JavaScript and WebGL.

- **Nav** (72px, x.ai): the wordmark at left; Download, Changelog and Docs as `ui` 500 links (hover
  dims siblings, Harvey); at right "Sign in" (soft pill) and "Download for macOS" as an ink split pill
  whose chevron lists every platform (x.ai, Aside).
- **Announcement pill** (SpaceXAI): 34px, 1px `--o-line`, a NEW chip, "auracode 0.4 · Grok Build
  support" in `ui` `--o-text-1`, and a 24px arrow coin on `--o-raised-2`.
- **Headline** (`hero` 64/64, centered, two lines, per-word flip-up on load): "One window for" then the
  rotating agent name "**Claude Code**." Every 3s the name flips to the next agent (Codex, Grok Build,
  Cursor, Pi, OpenCode, Hermes) and the glint runs once under it: a 3px grey rule with an orange band
  traveling across (SpaceXAI's rotating word, recolored).
- **Lead** (18/28 `--o-text-2`, 576px measure): "auracode drives the coding agents you already use
  through one chat. Local-first. No account needed."
- **Buttons** (44px): "Download for macOS" (ink pill with a download icon and the platform chevron)
  and "Create account" (soft pill).
- **The product:** 64px below, the real app window (the lab's settled state, rendered, not drawn) inside
  SpaceXAI's pixel-notched frame: a 1232px art panel of generated graphite grain (SVG `feTurbulence`,
  base frequency 0.8, two octaves, 8 to 12% over `#1A1918`; Harvey's texture fields), its four corners
  notched by 14px squares in the page color with a second square stepped diagonally inward.
- **Below the fold:** the globe section ("AGENTS" caps eyebrow; two-tone "Found automatically." / "No
  setup. No login."; the globe with every agent's orbit, square markers and mono labels, arcs drawn
  between agents to show a handoff); a telemetry row split by hairlines ("8 agents", "3 platforms", "0
  accounts required" in `numeral` sizes); X Money's numbered square tiles with miniaturized real UI
  for features; a quiet footer.

### 4.20 Menus, tooltips and the command palette

- **Menus** (X Money, Linear): `--o-raised`, radius 12, padding 4, e3. Rows 30px, radius 8, a 14px
  icon in `--o-text-3`, the label in `ui` `--o-text-1`, the shortcut right-aligned as keycaps or
  `mono` 11 `--o-text-3`. `caps` group labels; rules with 4px margins; the one destructive item in
  `--o-red`, grouped last. A choice that is on (Unified or Split) shows a check where the shortcut
  would be. Open over 150ms: opacity and scale 0.97 to 1 from the anchor, and away from whatever
  would cover them: down from the header, up from a turn's receipt above the composer. While a menu
  is open it owns the keyboard: up and down move, Enter picks, Esc closes it and returns focus to
  its button, and nothing reaches the window behind it. A row that is not built yet stays visible,
  disabled, with a tooltip saying so; a shortcut is shown only where it works.
- **Context menus:** message (Copy, Copy as Markdown, Copy receipt; Retry, Edit and resend, Fork
  into new chat; then Delete); chat row (Rename, Pin, Move to project, Archive ⌘⌫, then Delete); tool
  row (Re-run, Copy command, Copy output).
- **Command palette** (⌘K; Mercury, Linear, Raycast): 640 wide at y 120, `--o-raised`, radius 16, e3.
  A 48px input; scope chips (Chats, Projects, Files, Commands, Settings) as 26px chips, the selected one
  ink-filled; 36px result rows with right-aligned keycaps; hover dims siblings (Harvey). No match turns
  into "Ask Claude Code instead" with ⌘ Enter (Mercury's fallback). Footer key legend as in the picker.

---

## 5. The orb, redesigned: the Orbit mark

### 5.1 Idea

The glowing blob becomes an orbital diagram drawn with 1px lines. The small node in the middle is
the **body**, your workspace. The agent is a **square satellite** on its own **orbit** around it. The
orbit is the agent's identity, so it is the brightest line; what the satellite does is the agent's
state. The mark is a line around a node, the way X draws its orbital hairlines, not a planet with a
ring. At hero size the body becomes a solid globe and every agent orbits it at once.

It is built from the owner's references: SpaceXAI's line-drawn globe with zero-radius square markers,
mono labels and great-circle arcs; X's orbital hairlines and the X Card's dashed orbit with a hollow
node; Grok Bot's rule that state lives inside the mark and color appears only when something changes;
Grok Build's diamonds; X Money's ripple ring and drawn check. It has no glow, no blur and no 3D
shading; its only fills are the small node, the satellite and the surface under a large body, and
its only gradient is the fade along a moving satellite's trail.

### 5.2 Anatomy (S is the canvas size)

| Part | Geometry | Stroke and fill |
|---|---|---|
| Body | A node at the center: radius 0.06 S below 48px, 0.09 S from 48px. Always well inside the narrowest orbit's minor axis (0.126 S at k 0.30), so every orbit reads as a line around a node; a body as wide as the minor axis turned the ellipse into a capsule with a hole (pills and eyes at 14 to 24px, a thermometer at 56) | Below 48px a filled dot in `--o-text-2` with no outline. From 48px hollow: 1px `--o-text-3`, filled with the surface beneath, so the orbit's far side passes behind it |
| Orbit | Ellipse with semi-major a = 0.42 S and semi-minor a x k, tilted by the agent's angle, centered unless the signature shifts it | 1px `--o-text-2` (1.25px at 14 and 16px, where a 1px line thins to nothing on a 2x screen); from 48px the far half is the X Card's 2/2 dash |
| Satellite | Square, side max(4, round(0.18 S)), capped at 10px; zero radius; rides the orbit, hidden while it passes behind a hollow body. The SVG uses `overflow: visible` because a satellite at the end of the orbit may cross the box by up to 2px | Solid `--o-ink` |
| Trail | The 90 degrees of orbit behind a streaming satellite, in six steps | 1.25px `--o-text-1`, each step 14% fainter |
| Check | Replaces the node while it shows: 0.3 S below 48px, 0.24 S from 48px | 1.5px `--o-green`, round caps |
| Ripple | Circle centered on the satellite, from half its side to 2.2 times its side, at 30% peak opacity | 1px `--o-text-2` (`--o-signal` when waiting) |

There is no graticule below the globe: at mark sizes the lines read as noise, not a sphere.

**Sizes**

| Size | Where | Detail |
|---|---|---|
| 14 | Composer agent pill, system event chips, Session chips | Node, 1.25px orbit, satellite |
| 16 | Chat header (live), bylines and the gutter's live mark, notifications, picker rows, menus | Node, 1.25px orbit, satellite |
| 20 | Onboarding roster | Node, orbit, satellite |
| 24 | Sidebar agent dock (live) | Node, orbit, satellite, its two-letter code under it (5.3) |
| 56 | Empty state | Hollow body, the dashed far half of the orbit |
| Panel-sized | Boot, onboarding night panel, website | The globe (5.7) |

Below 14px the mark is not drawn; lists use the pip (5.6).

### 5.3 Identity: every agent flies its own orbit

Each agent has a signature: the orbit's tilt and shape, and how its satellite moves. Silhouettes stay
distinct at 16px, they need no color, and they carry no trademark, so they also replace the official
logos the plan allowed only for a private build. Angles are counterclockwise from horizontal.

| Agent | Orbit | Tilt | Shape (k = b/a) | Satellite motion | Period |
|---|---|---|---|---|---|
| Claude Code | Inclined | +28.5° (the launch latitude of Cape Canaveral) | k 0.34, centered | Smooth, counterclockwise | 2.4s |
| Codex | Equatorial | 0° | k 0.30, centered | 12 discrete steps per revolution, 200ms each, like a terminal cursor | 2.4s |
| Pi | Polar | 90° | k 0.30, centered | Smooth and perfectly even | 3.0s |
| oh-my-pi | Polar pair | 90° | k 0.30, centered | Two satellites 180° apart | 3.0s |
| Antigravity | Steep | +62° | k 0.36, centered | Faster on the rising half | 2.0s |
| Grok Build | Molniya | −35° | a 0.36 S, k 0.42, center shifted 0.12 S along the major axis toward the lower right, so the orbit swings out to one side | Kepler speed: fast near the body, slow far out | 2.4s |
| Cursor | Ring | none | A circle, radius 0.42 S, concentric | Smooth | 4.0s |
| OpenCode | Retrograde | −62° | k 0.36, centered | Runs clockwise; every other agent runs counterclockwise | 1.8s |
| Hermes | Transfer | 0° | a 0.38 S, k 0.40, center shifted 0.10 S to the right | Fast | 1.4s |
| Any other ACP agent | Unknown | 0° | k 0.30, the whole orbit dashed 2/2 | A hollow satellite | 3.0s |

The idle (parked) point is the front of the orbit, 40 degrees above its rightmost point. Next to a
mark, the agent's name always appears in lists, bylines and menus. Where a strip is too narrow for
names (the sidebar's agent dock), each mark carries its two-letter code under it, as SpaceXAI sets a
short label under a marker: CC Claude Code, CX Codex, PI Pi, MP oh-my-pi, AG Antigravity, HM
Hermes, CU Cursor, GB Grok Build, OC OpenCode; any other agent takes the first two letters of its
name. The glyph (the flattened monochrome logo in the private build, a two-letter monogram before
public release) appears only in the agent card and settings.

### 5.4 States

| State | Satellite | Orbit | Body | Motion |
|---|---|---|---|---|
| idle | Parked, ink | `--o-text-2` | The node | None |
| thinking | Travels at 1.5 times the agent's period (Codex steps) | `--o-text-2` | The node | Linear travel; no trail |
| streaming | Travels at the agent's period with the trail | `--o-text-1` | The node | Travel and trail |
| tool | Stops where it is | `--o-text-1` | The node | One ripple when a call starts and one when it ends (X Money) |
| waiting | Glides to the top of its orbit (300ms out), or straight to just above the body when the orbit's top would not clear it (Codex, Hermes, unknown agents), turns 45° into a diamond and becomes `--o-signal`; it is never hidden behind the body, and oh-my-pi's pair shows one diamond | `--o-text-3`: only the satellite spends color | The node | One orange ripple on entry, then nothing moves |
| error | Drops to just below the body (400ms standard) and becomes `--o-red` | Dashed 2/3, `--o-text-3` | The node | Static |
| done | Finishes its revolution and eases to the parked point (500ms out) | `--o-text-2` | A green check replaces the node: draws over 250ms, holds 1.6s, fades over 300ms | Then idle |

### 5.5 Reduced motion and accessibility

- Reduced motion removes travel, trails, ripples, draw-ins and rotation. State reads from geometry:
  active states (thinking, streaming, tool) park the satellite and draw the orbit in `--o-text-1`;
  waiting is the orange diamond at the top; error is red below the body with a dashed orbit; done is
  a static check for 1.6s.
- Color is never the only cue: waiting is also a diamond and the words "Needs you"; error is also a
  position, a dashed orbit and "Failed"; done is a check.
- Every mark has an accessible name that is the state sentence ("Claude Code, running pnpm test").

### 5.6 The pip (list-sized state, an 8px slot)

| State | Glyph |
|---|---|
| Running | The 2x3 dot loader in `--o-text-2`: 2px dots, 1px gaps (5 x 8px), each dot cycling transparent to color and back over 0.66s linear (keyframes 0%, 13.6%, 50%, 63.6%) with delays 0, −550, −110, −440, −220 and −330ms so a light walks the grid; reduced motion lights dots 1, 2 and 4 (Grok Build) |
| Needs you | A 6px zero-radius square turned 45°, `--o-signal` |
| Done, unseen | A 6px zero-radius square, `--o-ink` |
| Error | An 8px × with 1.5px strokes, `--o-red` |
| Idle | Nothing; the row shows its time |

### 5.7 The globe (panel-sized)

SpaceXAI's careers globe: calm, solid and sparse, so the agents and their labels are what you read.

- **Body:** a solid sphere one value step above its panel (`--o-night-body` `#121212` on the black
  night panel), with a faint 1px rim at white 10%. Over it a sparse graticule at white 7%: the
  equator, the ±30° parallels and four meridians, seen from 18° above the equator so the parallels
  read as arcs on a sphere. We draw a graticule, not coastlines: the map is not ours to copy. The
  meridians turn one revolution per 120s while discovery runs or any agent works, and stop when
  everything is idle (and under reduced motion).
- **Size:** the globe's radius R is a fifth of its panel's shorter side (about 173px in the lab's
  night panel), centered a little left of the panel's middle (6% of its width, at most 56px) so the
  labels on the right sit as far from the panel's edge as those on the left. Orbits fly outside it.
- **Agents:** every known agent's signature orbit around the globe, with its tilt and shape and a
  semi-major axis staggered from 1.18 R to 1.62 R so no two coincide, in a quiet 1px line at white
  20% (missing agents dashed 3/4 at white 18%). Satellites are 12px squares in white 94%; a missing
  agent's is hollow, one that needs sign-in is the orange diamond. Each rests at a parked point
  chosen so that no label touches another label, a satellite, the sphere or the panel's edge, in the
  full panel and in a narrow one, with the labels spread around the globe.
- **Labels** (the way SpaceXAI labels a city with its coordinates): Geist Mono 13px, +0.04em, 16px
  lines, on a black plate 16px out from the satellite along its orbit's outward normal, so no orbit
  line ever runs through text. Line one is the name, uppercase, at white 82%; line two the version
  at white 50% (or "SIGN IN" in orange, or "NOT INSTALLED"); line three the binary path at white 36%.
  Under 700px of panel width the path line is dropped.
- **Projects:** 12px white squares on the globe's surface with the same label (folder name, path).
- **Arcs:** 1px arcs at white 50%, lifted off the surface, drawn with `stroke-dashoffset`: from a new
  project to its agents (onboarding step 4) and between agents for a handoff (website).

### 5.8 Building it

- Inline SVG for every mark and for the globe (about 30 paths at 440px); no WebGL, no canvas, no
  shaders. This direction does not use `<Orb>` or `<AuraField>` from `@auracode/ui`.
- Positions are pure functions of the playhead time, the time the state began and the agent's
  signature, so `?t=` renders the same frame every time and several instances of one agent move in
  step. Marks pause when offscreen (IntersectionObserver).
- Satellite travel is a parametric point on the ellipse. Grok Build's Kepler speed maps time to angle
  through Kepler's equation with an eccentricity of 0.6 for timing only (three Newton steps are
  plenty); Codex's steps quantize the angle into 12 positions.

---

## 6. Materials

- **Native material appears in one place: under the sidebar** (and the titlebar strip above it),
  heavily tinted with `--o-tray-tint`, so any desktop wallpaper, purple included, shows only as a faint
  neutral shimmer and the sidebar reads as warm grey (light) or black (dark).
  - macOS 26: a transparent window with a behind-window `NSVisualEffectView` (sidebar material) under
    the sidebar region only. The system draws the traffic lights; auracode uses no Liquid Glass for its
    own controls.
  - macOS 13 to 15: sidebar vibrancy, same tint.
  - Windows 11: Mica (not Acrylic) under the sidebar region, same tint.
  - Windows 10, Linux, the OS "Reduce transparency" setting, or the Settings switch "Translucent
    sidebar" off: a solid `--o-tray`.
- **Everything else is solid:** both panes, the composer, every card, menu, popover, the picker,
  permission and question cards, sheets, settings, the right panel, every well, the boot and onboarding.
- **The only CSS blur** is on toasts (16px). Headers use scroll-driven fade masks, never frosted bars.
- **In the lab:** the direction's root lays `--o-tray-tint` over WindowChrome's simulated glass.
  Orbit opens, and is shot, on `satin`, the lab's plain neutral desk with faint grain and no ribbons.
  The sidebar must still read neutral on `wall=graphite`, `wall=dusk` and `wall=dawn`; if it does
  not, the tint is too thin.

---

## 7. Anti-slop rules

Drawn from what made Aurora, Noir and Halo look generated (their shots in `apps/design-lab/shots/`)
and from the researchers' findings. Every screen ships only if all of these hold.

**Light and color**

- [ ] No wallpaper, decorative gradient, nebula or colored light behind or inside the app. The window
      sits on a neutral desk. The only gradients are functional and tiny: the grey shimmer on a live
      label, the one-shot glint, and the dark composer's 1px lit edge. (The website's product frame may
      sit on generated grain.)
- [ ] No glow of any kind: no light lobes, auras, radial glows, halos around buttons, glowing rings or
      colored shadows.
- [ ] Only four meanings carry color: orange (look here), green (done, added), red (failed, removed),
      ink. No agent hues, no accent picker, no purple, no blue links.
- [ ] Orange is never a button fill, a card border, a background larger than a chip, or decoration.
- [ ] Primary actions are ink pills. No glowing send or stop, no amber "Allow" button.
- [ ] One ink at alpha steps; no assorted greys; `--o-text-4` never carries information.

**Glass and depth**

- [ ] No frosted panels. Native material under the sidebar only; CSS blur on toasts only.
- [ ] No floating cards with gaps showing a background; panes are inset paper on a tray.
- [ ] Shadows only on floating objects (composer, menus, popovers, cards, sheets); content never floats.
- [ ] Hairlines and value steps make structure, not drop shadows or glass edges.

**Type**

- [ ] No serif and no italic anywhere: no italic accent word, no serif wordmark, no serif title.
- [ ] No gradient text, except the grey shimmer on a live label. Headlines are Geist, two-tone,
      tightly tracked.
- [ ] Mono only for literals and data; never as decoration or for whole paragraphs.
- [ ] No 16px-everything chat text: UI at 13, prose at 14, meta at 12.

**Shapes and icons**

- [ ] No 3D or shaded spheres, no blobs, no particles. Marks are 1px lines and solid squares.
- [ ] No sparkle, wand or star icons for AI; thinking is a line of text.
- [ ] No pills around non-controls ("Thought for 6s" is a line, not a pill) and no chip soup in the
      composer.
- [ ] Radius contrast holds: 0 for markers, 8 for rows and wells, 12 for panes, 16 for floating
      objects, pills for controls. Nothing but the window frame is rounded past 16.
- [ ] Agent and app logos are flattened monochrome glyphs where they appear at all; never a row of
      colorful logos or orbs.

**Motion**

- [ ] Nothing breathes, pulses, floats, drifts or loops for its own sake. Motion starts with an event
      and ends when the event does.
- [ ] One ripple per event; no repeating beacons, rainbow loaders or shimmering cards.
- [ ] Text being read never moves; streamed text only appends.
- [ ] No springs, overshoot, parallax, hover scaling or animated blur.
- [ ] Reduced motion is honored everywhere.

**Copy**

- [ ] Concrete verbs, objects and numbers: "Ran pnpm test · 19 passed · 4.2s", not "AI is thinking..."
      or "Something went wrong".
- [ ] No hype words (magic, supercharge, unleash), no emoji, no em dashes.
- [ ] Risk in plain words ("Checkpoints only cover files in this folder"), not red banners.

**Layout**

- [ ] Empty states are one sentence, the input and real recent work; no illustration, no hero glow, no
      grid of suggestion cards.
- [ ] Keyboard is visible: keycaps in menus, buttons, cards and hint lines.
- [ ] Finished work collapses; the answer and the changed files stay brightest.
- [ ] Nothing copied that is owned: logos, wordmarks, illustrations, photography, font files.

---

## 8. Notes for the builder

**Identity.** Direction id `orbit`; display name **Orbit**; gallery tagline: "Mission control for your
agents: black and white, sentences and numbers, a line-drawn orbit for every agent, and one orange for
look here."

**Fonts to add: none.** Use Geist Variable and Geist Mono Variable, already bundled through
`@auracode/ui/fonts.css` (`@fontsource-variable/geist` 5.3.0 and `@fontsource-variable/geist-mono`
5.3.0, OFL, every subset by `unicode-range`). Do not use Instrument Serif in this direction; leave it
installed for the others. Set `font-synthesis: none`; use `font-variant-numeric: tabular-nums` for
data; build superscript decimals with a sized span (the bundled Geist has no `sups`, `zero` or
stylistic sets). The website uses the same two families.

**Lab states and themes to build: seven states, each in dark and light.**

| State | What it shows |
|---|---|
| `streaming` | The golden turn playing; freeze frames at `t=7.5` (thinking ends) and `t=24` (tests run under the plan) |
| `settled` | The golden turn finished: answer, receipt footer, plan complete |
| `empty` | A new chat in auracode: mark, sentence, composer, recent ledger |
| `permission` | The Codex chat with the permission card in the composer's place |
| `picker` | The settled chat with the agent > model > effort picker open |
| `changes` (new) | The settled chat with the right panel open on Changes, scope "This turn", `packages/ui/src/orb/pacing.ts` expanded |
| `onboarding` (new) | First-run discovery, step 1: Claude Code, Codex, Pi and Antigravity found, Hermes landing, Cursor and Grok Build still being looked for, the globe filling in |

Each in `dark` and `light`: 14 state and theme pairs. With streaming's two freeze frames and the
reduced-motion `settled` frame, the shooter writes 18 images per engine, named
`<engine>-<theme>-<shot>.png` (`node scripts/shoot.mjs --direction orbit --themes dark,light`), plus
one streaming video per theme, `<engine>-<theme>-streaming.webm`. In WebKit and Chromium that is 36
images and 4 videos, listed in `apps/design-lab/shots/index.json`.

**Shared lab changes** (they go through the lab owner; the direction folder alone cannot add them).
All four are built:

1. `LabState` gains `"changes"` and `"onboarding"`, with `STATE_INFO` entries and `sceneFor` cases.
   `changes` is the golden recording at its end plus a new `Workspace` field such as
   `rightPanel: { tab: "changes", scope: "turn", expandedFile: string | null }`. `onboarding` is a
   scene with no chat and a discovery timeline the player drives, for example: Claude Code found at
   0.5s, Codex 0.8s, Pi 1.1s, Antigravity 1.3s, Hermes 1.5s (its orbit draws until 2.0s), Cursor and
   Grok Build reported missing at 2.3s and 2.4s, done at 2.6s, held 4s, looping. Freeze the shot at
   `t=1.6`, when four agents are in and Hermes is landing.
2. A `theme` URL parameter (`dark`, the default, or `light`) that the lab passes to the direction as
   the `theme` prop and sets as `data-theme` around it, and a shoot script option (`--themes
   dark,light`) that shoots each theme with `prefers-color-scheme` emulated to match. The lab has no
   `system` value: a URL must render the same frame on every machine. In the app, the System
   appearance follows the OS.
3. `scripts/shoot.mjs`: both themes, the two new states, the new file names.
4. The lab's default wallpaper is `dusk`, the purple and pink field the owner called slop. A
   direction now names its own in `meta.ts`, and the lab has a neutral grayscale `satin` wallpaper;
   Orbit opens and is shot on it.

**Direction folder** (`apps/design-lab/src/directions/orbit/`): `App.tsx`, `meta.ts`, `README.md`,
scoped CSS (`*.module.css` or `[data-direction="orbit"]`), a `tokens.css` holding section 3 for both
themes, and components: `OrbitMark` (SVG, signatures from 5.3, states from 5.4, positions from the
playhead), `Globe`, `DotLoader`, `Pip`, `Keycap`, `DiffSquares` and `DiffCounts` (the diffstat),
`LevelGlyph`, `StatusPill`. No new dependencies; Lucide, Motion and Tailwind are installed. Overlays
stay inside the window. Time comes from the player, never the wall clock.

**Build order:** tokens and both themes; the frame (tray, panes, sidebar, header); transcript items;
composer and its segments; the Orbit mark and pips; permission and question cards; the picker and
autonomy menu; empty state; Changes; onboarding and the globe; boot (if time allows); motion polish
last.

**Acceptance checks before shooting:**

- Text contrast: `--o-text-3` at 4.5:1 or better on panes and wells in both themes (computed values in
  3.1); signal and semantic text as listed.
- WebKit first (`--engines webkit`), with `-webkit-backdrop-filter` beside `backdrop-filter` on toasts.
  Headless WebKit does not paint backdrop blur, so judge toasts in the Chromium shots.
- `?motion=reduce` frames show every state by geometry alone.
- No em dashes in copy (the lab's test checks), no italics, no serif, no decorative gradients, no
  glow: run the section 7 checklist against every shot.
- Product copy as written in section 4: plain, short, concrete.

**Now that the owner has picked Orbit,** update `docs/plan.md` (not done yet): "UX spec: app" (design language, thinking orbs,
boot cinematic, onboarding step 4) and "UX spec: website" (no orb hero, no glass sections) to match
this document, and retire the orb shader, the aura field and Instrument Serif from `@auracode/ui` once
no direction uses them.
