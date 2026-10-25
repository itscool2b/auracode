# Orbit

Mission control for your agents: black and white, sentences and numbers, a line-drawn orbit for every
agent, and one orange that means look here. Built from the design language in
[docs/design/visual-language.md](../../../../../docs/design/visual-language.md); section numbers
below refer to it.

`#/orbit` renders every lab state, `streaming`, `settled`, `empty`, `permission`, `picker`,
`changes` and `onboarding`, in both themes (`?theme=dark`, the default, and `?theme=light`). It opens
on `satin`, the lab's plain neutral desk; any `wall` still works, and the sidebar reads neutral on
every one. It is the chosen direction: the gallery lists it first and marks it as chosen.

## What it borrows, and from where

- **SpaceXAI (x.ai, Grok, Grok Bot, Grok Build).** The window is one material with 1px rings and no
  drop shadow (Grok Bot). The user's message is the one ink block, the agent's prose sits bare. Tool
  rows are a sans verb plus a mono literal (Grok), and every line of a turn shares one 22px gutter
  where the agent's live mark rides from line to line (Grok Bot's status line). A command's row is
  its terminal block's header: opened, the row and its output share one well, with `$` in the gutter
  and the status at right (Grok Build). Code is x.ai's near-monochrome window: keywords red, strings
  blue, numbers orange, the rest in the foreground. The picker's model column is Grok's menu, the
  right panel's tabs are x.ai's segmented control with one ink pill, the dock prints SpaceXAI-style
  two-letter codes under its marks, and onboarding is the Grok Console checklist beside a black night
  panel holding the careers page's calm solid globe (a sparse graticule, not the coastlines), square
  markers and three-line mono labels on black plates.
- **X Money.** Two-tone headlines ("Claude Code is ready in auracode."), the confirm sheet's grey verbs
  and bright objects (the permission title, the revert and delete sheets), the dashed tear line over
  key-value rows, the receipt under every turn and the handoff card, built superscript cents in the
  Session tab, the switcher's two-line items, the overflow menu, the translucent toast with Undo and
  the sidebar's weight-morph hover.
- **Harvey.** The warm tray with inset white panes (light), the right panel's properties, the plan
  checklist with a two-tone ring and strikethrough, the timer rules in the plan segment, the review
  framing of "Needs you".
- **Aside.** The composer's control row (attach, agent, autonomy, context, send), the autonomy menu with
  consequences and Final confirm, Queue or Steer as a split send, the muted step spine.
- **The best apps.** Codex's permission card in the composer's place, Claude Code's grouped tool rows
  and receipt actions, Perplexity's keycaps, Cursor's files chip, GitHub's diff tints, Linear's lit
  composer edge in dark, Notion Calendar's letter keys and selection rail, Family's level glyph.

Nothing owned is copied: no logos, wordmarks, illustrations, photography or font files. Every word is
set in Geist; everything a machine made (paths, commands, durations, counts, diffs) in Geist Mono.

## The Orbit mark

The glowing orb is gone. Each agent is a square satellite on its own orbit around a small node
(section 5), a line around a node the way X draws its orbital hairlines: Claude Code inclined at 28.5
degrees, Codex equatorial and stepping like a cursor, Pi polar, Grok
Build a Molniya orbit with Kepler timing, Cursor a ring, OpenCode retrograde, and so on. The orbit is
the identity, the satellite is the state: it travels while the agent thinks or streams (with a trail
when streaming), stops for tools with one ripple per call, glides to the top and turns into an orange
diamond when it waits, drops to the bottom in red on an error, and finishes its revolution and draws a
green check when the turn is done. Positions are pure functions of the playhead (`geometry.ts`), so
`?t=` always renders the same frame. Under reduced motion the satellites park and the state reads from
geometry alone.

## Interactions

- Tool groups, calls, thoughts and the finished plan open and close with an animated fold; an open
  command folds back from its own row. A live thought stays open until the next item arrives.
- The picker opens from the agent pill or Cmd .; letters jump to agents (C, X, P, A, H), arrows move
  within and across columns, digits 1 to 5 set the effort, Enter commits all three, Esc closes. With
  the mouse, a click on a model or an effort (or a second click on the chosen agent) commits; a
  missing agent's row copies its install command. Choosing another agent adds the handoff segment,
  whose Preview opens the handoff card, and logs the switch when you send.
- The permission card takes focus and answers with 1 (or Enter), 2, 3 and Esc; hovering an answer
  says what it saves. Typing in "Tell Codex what to do instead" turns the primary into Send. The
  label morphs to Allowed or Denied, the card folds back into the composer, and the transcript logs
  the answer right before the command it let through.
- While the agent works, Enter queues (Cmd Enter steers), Esc asks for a second press and then stops
  the turn, and the hint line under the composer says so. A stop pauses the queue: "Send next" sends
  it on.
- The autonomy chip opens the menu (1 to 3 choose); Cmd Shift A cycles levels (not while a request
  waits); changes are logged as "Auto-edit from here". Cmd J toggles the right panel; the files chip
  and the header's diffstat open Changes; the panel resizes from its gutter and floats over a narrow
  window.
- Chat rows show archive and more on hover. Archive (or Cmd Backspace) acts at once with Undo (Cmd Z)
  in a toast; Delete, and Revert (Cmd Shift Z or the Changes footer), ask in X Money's sheet first.
  The header title renames in place. Cmd Shift C copies the turn's patch; Cmd N opens a new chat;
  Cmd \\ folds the sidebar to its rail. Controls the lab does not build yet (search, settings,
  attach, fork) say so in a toast.
- The empty state's ledger rows open their chats; choosing another agent there flips its name, runs
  the glint and draws its orbit. After a recording ends, sending a message plays a scripted reply
  through the same reducer, marked "Scripted reply · no agent is connected in the lab".
- Onboarding steps continue with Enter, fold to summaries you can reopen, and apply the theme and
  motion choices to the lab at once; Skip setup goes to a new chat.

## Files

| File | What it holds |
|---|---|
| `App.tsx` | The window and its local state: composer choices, queue, stop, answers, panel, extras, toasts, sheets, shortcuts |
| `tokens.css` | Section 3 for both themes: colour, type scale, spacing, radii, motion, elevation |
| `orbit.css` | Section 4: every surface |
| `geometry.ts` | The Orbit mark as numbers: signatures, travel, states, frames |
| `OrbitMark.tsx`, `Globe.tsx` | The mark and the onboarding globe, inline SVG |
| `Sidebar.tsx`, `Header.tsx`, `Transcript.tsx`, `Tools.tsx`, `Markdown.tsx`, `Plan.tsx` | The chat |
| `Composer.tsx`, `Picker.tsx`, `Permission.tsx` | The composer, the picker, the autonomy menu, the permission card |
| `RightPanel.tsx` | Changes, Files, Plan and Session |
| `EmptyState.tsx`, `Onboarding.tsx` | The new chat and first-run discovery |
| `Menu.tsx`, `Sheet.tsx`, `Toast.tsx` | Menus, the destructive confirm, toasts with Undo |
| `state.ts`, `local.ts`, `clock.ts` | What the window adds after a recording: its state, the events it writes, its clock |
| `keys.ts`, `live.ts`, `text.ts`, `syntax.ts`, `nav.ts` | Pure logic: keys, the live end, words and numbers, code colours, moving between lab states |
| `*.test.ts(x)` | Tests for all of the above, and every state in both themes |

A chat in the sidebar with no recording opens on a short stub of its history ("Earlier work" and a
note that its history is not in the lab) rather than pretending to be new.
