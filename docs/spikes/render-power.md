# Spike: render cost and power

M0 spike 1 ("worst-case render on WebKit and WebView2 with idle power").

**Status:** open. Measured so far, on 2026-10-24 on the development Mac: the real app with its
window not visible, and the page's own render cost in WebKit. Not measured: the real window
visible on screen, which is where the glass-versus-opaque idle cost and the real window's frame
rate come from, and everything on Windows (WebView2). So the spike's questions about glass, Mica
and WebView2 are still open, and so is M0 until they are answered. The harness for both remaining
runs is in [render-power/](render-power/).

## Verification

| Part | What it answers | Result | Evidence |
|---|---|---|---|
| macOS app, window not visible (debug and release) | the hidden cost, and whether streaming continues while hidden | done | [section A](#a-the-real-app-window-not-visible-locked-screen) |
| macOS page in WebKit, nothing hidden (Playwright) | frame rate and cost trends by orb count | done | [section B](#b-the-page-in-webkit-with-nothing-hidden-playwright-webkit-production-bundle) |
| macOS app, window visible (debug and release) | glass versus opaque idle cost, the real window's frame rate, a true hide | pending | blocked on 2026-10-24: the screen stayed locked all day and the CPU was saturated (see [Conditions](#conditions-read-these-before-the-numbers)); steps in [Finishing the macOS half](#finishing-the-macos-half) |
| Windows suite's unit tests, on Windows PowerShell 5.1 and 7 | that the suite runs at all before anyone spends 12 minutes on it | pending | `test-render-power.ps1` has only been checked statically: running PowerShell on the Mac was not allowed in that session |
| Windows app (WebView2), all scenarios | WebView2's cost, Mica versus opaque, what minimizing stops, frame rate | pending | needs a CI-built Windows binary, which does not exist yet, and the user's PC; steps in [Windows](#windows-webview2-half-still-to-run) |

When a part is done, set its result, fill in its results section, and revisit the
[Bottom line](#bottom-line) and [Conclusions](#conclusions); the status becomes "decided" only
when no part is pending.

## Bottom line

Everything below is macOS (WebKit), from hidden-window and engine-level runs on a saturated CPU.

- **Hiding the window stops animation, not streaming.** With the window not visible, WebKit runs
  no animation frames at all (0 frames in every hidden run), so the orbs and the frame meter stop
  and an idle app costs 0.0 % CPU and no GPU time. A streaming chat keeps costing: the page keeps
  rendering the 200 tokens/s stream nobody can see, about 20 to 32 % of one core across the app's
  processes (230 to 370 mW of CPU energy) plus 23 to 192 ms/s of GPU time in WebKit's GPU process
  (+29 to +145 mW of GPU power). Debug and release builds behave about the same.
- **No orb count dropped the page below 60 fps in WebKit.** The real stress view in WebKit with
  the production bundle held 60 fps in steady state from 1 to 24 orbs with the aura and a 200
  tokens/s stream. The renderer's budget of at most 8 orb draws per frame is why: the GPU
  process's cost rises from 1 to 8 orbs and then almost stops rising, and past 8 busy orbs each
  orb animates slower instead (60 fps each up to 8, 30 at 16, 20 at 24). The only dips were
  stalls of 2 to 3 seconds within 26 seconds of the page loading (0 to 16 fps), then a steady
  60 fps (no second below 59.6) for the rest of every run; on this saturated machine they look
  like warm-up (a first large garbage collection or JIT work starved of CPU), to recheck on a
  quiet one.
- **The idle main screen is not idle.** Its one idle orb keeps a 60 Hz animation-frame loop
  running to draw 24 frames a second; in WebKit that is about 5 % of one core (around 50 mW of
  CPU energy) and 23 ms/s of GPU time, before any glass cost. With reduced motion, where orbs
  draw one frame and stop, the same screen measured 0.0 % and no GPU time, so all of it is that
  loop. The plan's budget is near-zero idle CPU with orbs paused, so idle orbs must stop their
  loop (see the recommendations).
- **The glass window's idle cost is not measured yet.** While the window is occluded, glass and
  opaque windows both cost nothing, as expected. The visible comparison is still pending (see
  [Verification](#verification)).
- **`top`'s POWER column is just %CPU here.** For every process in every sample (2,232 rows) it
  equalled %CPU exactly, so it carries no GPU or wakeup cost. The numbers below use the SoC's
  energy counters and per-process energy instead, all readable without root.
- **Nothing is measured on WebView2 yet, and one difference is expected.** From the sources,
  minimizing auracode on Windows probably stops nothing at all: wry never tells WebView2 that its
  window was minimized, and Microsoft documents that the app has to. If the Windows run confirms
  it, the shell must hide the webview while minimized; see
  [section D](#d-the-real-app-on-windows-webview2-not-measured-yet).

## Conditions (read these before the numbers)

| | |
|---|---|
| Machine | MacBook Air 15" M3 (Mac15,13): 4 performance + 4 efficiency cores, 10-core GPU, 24 GB, fanless |
| Display | built-in 2880 x 1864 Retina, 60 Hz; the window is 1440 x 900 points (2880 x 1800 pixels) |
| Software | macOS 26.6.2 (25G83), WebKit 21624.5.1.11.3 (Safari 26.6.2), Tauri 2.12.5, wry 0.57.1, tao 0.37.2 |
| Power | on AC, battery full |
| Builds | debug (the binary `tauri dev` builds, against the Vite dev server, React in development mode) and release (`tauri build --bundles app`, production React) |

Three things limit these numbers:

1. **The screen was locked** (since 04:44, before this spike started). A locked session's windows
   are occluded, which WebKit treats the way it treats a minimized window: the view is not
   visible, `document.hidden` is true (the frame log recorded `hidden: true` in every sample) and
   animation frames stop. So every real-app run below is a hidden-window run.
2. **The CPU was saturated by unrelated processes.** Three orphaned test binaries from an earlier
   mutation-testing run (`aura_drivers-697ae2bc58e25387`, parent long gone) spun on all 8 cores for
   the whole session; `top` reported 0.0 % machine idle in every run. Stopping them was outside
   this spike's permissions. CPU percentages are therefore contended (threads may land on
   efficiency cores at lower clocks, inflating %CPU for the same work) and SoC-wide CPU power is
   meaningless (pinned near 11 W). Per-process CPU energy and everything GPU-side are still valid.
   Run-to-run spread under these conditions was 12 to 20 % (the two 24-orb hidden runs per build).
3. **GPU busy time depends on the GPU clock.** When our GPU work raises the GPU's frequency,
   WindowServer's unchanged work finishes faster, so its GPU ms/s can drop below its baseline
   (seen below as small negative deltas). GPU power in mW is the energy measure; ms/s shows who
   is busy.

The first two still held when this doc was revised later the same day: the screen was locked
(`winctl locked` printed 1), the same three orphaned binaries were still running (parent
`launchd`, started 03:44 to 03:54), and parallel builds pushed the load average above 40 on 8
cores. No valid visible-window run was possible, so section C stays empty.

## Method

### Scenarios

Each run launches the app fresh with the scenario's environment, waits for the window, settles
(15 s debug, 10 s release), then samples for 30 s and quits the app. A baseline run (no app)
sits at the start and end of each suite.

| # | Scenario | Environment |
|---|---|---|
| 1 | idle main screen | (none) |
| 2 | stress, 1 orb, aura off | `AURACODE_STRESS=orbs=1,rate=200,aura=0,seconds=0` |
| 3 | stress, 24 orbs, aura, 200 tokens/s | `AURACODE_STRESS=orbs=24,rate=200,aura=1,seconds=0` |
| 4 | 3 with the window minimized | as 3; minimizing needs Accessibility permission this session lacked, and hiding the app (`NSRunningApplication.hide`) was refused while locked, so the hidden state came from the locked screen (see Conditions); that run appears below as "3/4 again" |
| 5a | 1 without glass | `AURACODE_NO_GLASS=1` |
| 5b | 3 without glass | `AURACODE_NO_GLASS=1` plus 3's `AURACODE_STRESS` |
| extra | 24 orbs, aura off | separates the aura from the orbs |
| sweep | 1, 4, 8, 12, 16, 24 orbs with the aura (engine-level runs) | |

With `seconds=0` the stress view streams 30-second turns back to back (6,000 tokens each at
200 tokens/s), so every 30-second window holds about one full turn.

### What is measured, and how (no root)

`powermetrics` needs root, so everything here uses counters any user can read:

- **CPU % and energy impact per process:** `top -l 31 -s 1 -stats pid,command,cpu,power,idlew`
  with one `-pid` per process, first sample dropped.
- **CPU time and CPU energy per process:** `proc_pid_rusage(RUSAGE_INFO_V6)`: user plus system
  time (in Mach ticks on Apple silicon, converted with `mach_timebase_info`) and `ri_energy_nj`,
  the kernel's per-process CPU energy estimate. Reported as % of one core and as mW. Works for the
  user's own processes, so not for WindowServer (its CPU comes from `top`).
- **SoC power:** IOReport's "Energy Model" channel group (`libIOReport`, the source `powermetrics`
  reads): CPU, GPU (+ GPU SRAM), DRAM, display, as mW per 1-second interval.
- **GPU time per process:** each `AGXDeviceUserClient` under the GPU's IOAccelerator carries
  `IOUserClientCreator` ("pid 411, WindowServer") and `AppUsage[].accumulatedGPUTime` (ns), the
  per-process GPU time Activity Monitor shows. Summed per pid, as ms of GPU time per second.
- **GPU utilization:** the IOAccelerator's `PerformanceStatistics` "Device Utilization %".
- **Frame rate:** the stress view's per-second frame log (below), read out of WebKit's
  localStorage file after each window: average over the window and the lowest one-second rate.

A small C sampler ([render-power/sampler.c](render-power/sampler.c)) does the rusage, IOReport and
IORegistry parts once a second; a Python driver ([render-power/measure.py](render-power/measure.py))
launches the app, attributes processes, runs `top` and the sampler for the window, reads the frame
log and stops everything it started.

### Attributing WebKit's processes

WKWebView's WebContent, GPU and Networking processes are XPC services: `launchd` starts them, so
their parent pid is 1, not the app. The driver snapshots every `com.apple.WebKit.*` pid just before
launching and attributes the new ones to the app. **Caveat:** any other app that starts a WebKit
process during the settle (Mail, Messages, Spotlight previews) would be counted too. So each new
pid is cross-checked with `responsibility_get_pid_responsible_for_pid`: the services report the
app's responsible process (launched from a terminal, that is the terminal, which the app reports
as well). Every run found exactly three new processes (WebContent, GPU, Networking), all
confirmed, none left running after the app quit.

WindowServer (pid 411) is sampled in every run, baseline included; its numbers are reported as the
difference from the baseline.

### The frame log (the one app change)

The on-screen readout shows only the latest half second, and nothing outside the app could read
it, so the stress view now also keeps a rolling per-second frame count (`FrameLog` in
`apps/desktop/src/lib/fps.ts`, with tests) and writes it to localStorage under
`auracode.stress.frames` once a second. It runs on a timer, not on animation frames, so it keeps
recording while the window is hidden, which is exactly when frames stop. The driver copies
WebKit's `localstorage.sqlite3` (and its WAL) and reads the key from the copy. The same log is
what the Windows steps read through DevTools.

### Engine-level runs (Playwright WebKit)

Because the real window could not be shown, the page's own render cost was also measured in
Playwright's WebKit (headless, its own WebKit build, 1440 x 900 at 2x) on the production bundle,
with the Tauri IPC mocked to replay a real aura-drivers stress turn (dumped frame by frame from
`MockScript::stress` at 200 tokens/s, 6,000 tokens, 16 ms frames, so the page receives exactly
what the shell sends). Headless WebKit does not stop animation frames on a locked screen. It has
no native window, no glass and no WindowServer: it composites inside WebKit's GPU process, which
inflates that process's numbers compared with the app (where WindowServer composites). Use these
runs for frame rate and for trends across orb counts, not as the app's absolute cost.

## Results

### A. The real app, window not visible (locked screen)

App-side = the app process plus WebKit's WebContent, GPU and Networking processes. Deltas are
against the baseline run (WindowServer about 8.5 % CPU and 172 ms/s GPU, SoC GPU about 345 mW:
the lock screen's animated wallpaper). FPS was 0 in every stress run (animation frames stop).

Debug build:

| Scenario | App % | WebContent % | GPU proc % | App-side % (CPU mW) | GPU proc GPU ms/s | WindowServer CPU % delta | SoC GPU mW delta |
|---|---|---|---|---|---|---|---|
| 1 idle main screen, glass | 0.0 | 0.0 | 0.0 | 0.0 (0) | 0 | +0.2 | +0 |
| 5a idle main screen, opaque | 0.0 | 0.0 | 0.0 | 0.0 (0) | 0 | -0.0 | +2 |
| 2 stress, 1 orb, aura off | 3.6 | 11.9 | 7.0 | 23.7 (265) | 39 | -0.3 | +67 |
| 3/4 stress, 24 orbs + aura | 3.7 | 14.2 | 5.8 | 24.9 (290) | 33 | -0.1 | +32 |
| 3/4 again (repeat run) | 3.1 | 11.1 | 4.9 | 19.9 (232) | 23 | -0.1 | +29 |
| stress, 24 orbs, aura off | 3.7 | 14.4 | 11.6 | 30.8 (366) | 149 | -0.1 | +124 |
| 5b stress, 24 orbs + aura, opaque | 3.7 | 13.8 | 5.8 | 24.5 (280) | 32 | -0.1 | +52 |

Release build:

| Scenario | App % | WebContent % | GPU proc % | App-side % (CPU mW) | GPU proc GPU ms/s | WindowServer CPU % delta | SoC GPU mW delta |
|---|---|---|---|---|---|---|---|
| 1 idle main screen, glass | 0.0 | 0.0 | 0.0 | 0.0 (0) | 0 | -0.0 | +3 |
| 5a idle main screen, opaque | 0.0 | 0.0 | 0.0 | 0.0 (0) | 0 | -0.1 | -1 |
| 2 stress, 1 orb, aura off | 4.3 | 10.6 | 8.5 | 24.9 (266) | 60 | -0.6 | +65 |
| 3/4 stress, 24 orbs + aura | 4.4 | 11.3 | 7.1 | 24.3 (258) | 35 | -0.4 | +32 |
| 3/4 again (repeat run) | 3.9 | 9.9 | 6.2 | 21.4 (231) | 28 | -0.7 | +30 |
| stress, 24 orbs, aura off | 4.3 | 11.8 | 14.3 | 31.9 (372) | 192 | -0.8 | +145 |
| 5b stress, 24 orbs + aura, opaque | 4.3 | 11.2 | 6.9 | 23.9 (266) | 41 | -0.8 | +31 |

`top`'s POWER (energy impact) equalled %CPU in every row, so it is not repeated here.

### B. The page in WebKit with nothing hidden (Playwright WebKit, production bundle)

30-second windows after a 10-second settle; frame rates from the frame log. "Lowest 1 s" is the
worst one-second window; "p10" is the 10th percentile of one-second windows. SoC GPU power is
absolute here (the baseline is about 345 mW). The reduced-motion row emulates
`prefers-reduced-motion: reduce`, under which the orb renderer draws one static frame and runs no
loop; nothing else on the idle screen moves (the aura is paused there).

| Page | FPS avg | Lowest 1 s | p10 | WebContent % (mW) | GPU proc % (mW) | GPU proc GPU ms/s | SoC GPU mW |
|---|---|---|---|---|---|---|---|
| idle main screen | n/a | n/a | n/a | 2.1 (21) | 2.5 (23) | 23 | 351 |
| idle main screen, reduced motion (orb static) | n/a | n/a | n/a | 0.0 (0) | 0.0 (0) | 0 | 343 |
| 1 orb, aura off | 60.0 | 60 | 60 | 19.7 (195) | 34.3 (374) | 267 | 637 |
| 1 orb, aura | 60.0 | 60 | 60 | 20.6 (201) | 39.1 (421) | 252 | 631 |
| 4 orbs, aura | 60.0 | 60 | 60 | 23.9 (229) | 52.1 (551) | 346 | 681 |
| 8 orbs, aura | 55.7 | 7 | 60 | 24.8 (241) | 54.5 (568) | 368 | 675 |
| 12 orbs, aura | 60.0 | 60 | 60 | 26.6 (252) | 59.4 (610) | 388 | 698 |
| 16 orbs, aura | 60.0 | 60 | 60 | 26.8 (255) | 60.3 (624) | 388 | 691 |
| 24 orbs, aura | 60.0 | 60 | 60 | 27.4 (264) | 61.6 (639) | 396 | 700 |
| 24 orbs, aura off | 56.1 | 12 | 60 | 25.7 (251) | 53.8 (549) | 391 | 684 |

The two dips were checked with 60-second re-runs of 8 orbs, 24 orbs and 24 orbs without the aura,
keeping every sample. Each had one or two stalls 14 to 26 s after the page loaded, during which
even the frame log's one-second timer fired 2 to 3 s late (the main thread was blocked): 16.4 and
10.9 fps (8 orbs), 0.0 fps over 2 s (24 orbs, aura off), 15.2 and 7.9 fps (24 orbs). From 30 s
after load on, all three ran at 60.0 fps on average with no second below 59.6, for 48 to 49
seconds and through turn boundaries every 30 s. So the stalls are not a steady cost of the orbs;
they fit warm-up work (a first large garbage collection or JIT compilation) whose helper threads
were starved by the saturated CPU, and need a recheck on a quiet machine with Web Inspector's
timeline.

The development-mode page (the Vite dev server, React's development build, as in the debug app)
behaved the same way: 60 fps with 1 orb; with 24 orbs and the aura, the same two early stalls,
then 60 fps. Its WebContent process used 10 to 20 % more CPU than the production bundle's (23.7
against 19.7 % with 1 orb, 29.9 against 27.4 % with 24).

### C. The real app, window visible: not measured yet

Scenarios 1 to 3, 5a and 5b with the window on screen (debug and release), the 8 and 16 orb sweep,
and scenario 4 as a true hide. This is where the glass-versus-opaque idle cost (WindowServer's CPU
and GPU deltas, SoC GPU power) and the real window's frame rate come from. Blocked by the locked
screen and the saturated CPU (see Conditions); see
[Finishing the macOS half](#finishing-the-macos-half).

### D. The real app on Windows (WebView2): not measured yet

The same scenarios through [render-power/render-power.ps1](render-power/render-power.ps1), plus an
idle and a 24-orb run with the window minimized; steps in
[Windows](#windows-webview2-half-still-to-run). Two things are expected from the sources, for the
run to confirm or refute:

- **Minimizing probably stops nothing.** wry 0.57.1 hosts WebView2 as a child window and its
  parent window procedure skips `WM_SIZE` with `SIZE_MINIMIZED` (`parent_subclass_proc` in
  `src/webview2/mod.rs`); the only path to `ICoreWebView2Controller::put_IsVisible(FALSE)` is
  `Webview::hide()` (`WebviewMessage::Hide` in tauri-runtime-wry), and nothing calls it on
  minimize. Microsoft's reference for `IsVisible` says that a WebView2 child window gets no
  window message when the top window is minimized or restored, that apps should set `IsVisible`
  to `FALSE` on `SIZE_MINIMIZED` and back on `SIZE_RESTORED`, and that hiding the page is what
  lets Chromium throttle its animations and tasks. So where macOS stopped every animation frame,
  WebView2 likely keeps drawing the orbs and the stream while minimized. If so, `s24-minimized`'s
  frame log shows frames counted with `hidden` false, and auracode's own processes (the app and
  WebView2's, not `dwm.exe`) cost about as much CPU and GPU in `idle-minimized` and
  `s24-minimized` as in `idle` and `s24`. `idle-minimized` has no frame log, since only the stress
  view writes one and the suite reads it only in stress scenarios, so that comparison with `idle`
  is its only evidence.
- **The glass cost lands in dwm.exe.** DWM draws Mica behind the window and composites
  WebView2's output, so the glass-versus-opaque difference shows as `dwm.exe` CPU and GPU against
  the baseline runs, as WindowServer's does on macOS. With transparency effects off (or Energy
  saver on) Windows draws Mica flat, so the suite records that setting and warns about it.

## Conclusions

**Is the glass window's idle cost acceptable?** Not answerable from this run. Hidden, glass and
opaque windows cost the same (zero, rows 1 and 5a). Visible, the glass material is drawn by
WindowServer, which only recomposites when something in or behind the window changes; on the idle
main screen something always changes, because the idle orb redraws 24 times a second. Whatever the
glass adds per recomposite is therefore paid 24 times a second today, and nothing once idle orbs
stop drawing (recommendation 2). That makes the measurement still worth finishing, but no longer
blocking: a static idle window has no ongoing glass cost by construction. The same question for
Mica, drawn by DWM on Windows, is open until section D is measured.

**How many orbs before frame drops?** None up to the maximum of 24 in WebKit: the per-frame draw
budget turns extra orbs into slower orbs rather than slower frames. What does scale is cost: from 1
to 8 orbs, each busy orb adds roughly 2 % of a core in the GPU process, 0.6 % in WebContent, 17 ms
of GPU time per second and 6 mW of GPU power (engine-level numbers, where the GPU process also
composites). Past 8 it barely grows: 24 orbs cost about 7 % of a core more than 8 in the GPU
process (compositing more canvases), with the same number of draws. The real window's frame rate
under WindowServer compositing is part of the unfinished visible run, and WebView2's (Chromium
runs the same page with its own compositor) is part of section D.

**Does minimizing stop the work?** Partly. Everything driven by animation frames stops: orbs,
the frame meter, and the idle app goes to zero. Streaming does not: the shell keeps sending frames,
React keeps re-rendering the transcript, and WebKit keeps working on it although nothing reaches
the screen (WebContent at 10 to 14 % of a core, the GPU process at 5 to 14 % plus 23 to 192 ms/s
of GPU time), 20 to 32 % of a core and up to 145 mW of extra GPU power in all for one 200 tokens/s
stream. The agents must keep running while auracode is hidden (that is the product), but
rendering their output must not. That is macOS. On Windows, minimizing may stop nothing at all,
idle orbs included, until the shell hides the webview itself (section D); the Windows run decides.

**Debug versus release.** Hidden, release cost about the same as debug (WebContent 10 to 20 %
lower, inside the run-to-run spread), so most of the hidden cost is not React's development mode.
Visible frame rates still need both builds.

**An open oddity.** Hidden, the 24-orb page without the aura made WebKit's GPU process do four to
five times more GPU work than with it (149 and 192 ms/s against 33 and 35, reproduced in both
builds), while visible in Playwright the aura made no difference. A plausible cause is layer
structure: the aura's composited layer forces the content above it into its own layers, so
streamed text repaints a small layer; without it, the text may repaint a much larger one. Worth a
look in Safari Web Inspector's Layers tab during M2a; it disappears anyway if hidden pages stop
painting.

## Recommendations for M2a

1. **Orb budget: keep `MAX_DRAWS_PER_FRAME = 8`, do not cap the orb count.** The budget is what
   keeps the page at 60 fps, and the round-robin degrades fairly. Design for at most 8 busy orbs on
   screen at once (onboarding's discovery screen with every agent fits: 10 busy orbs run at 48 fps
   each). Beyond that, prefer showing extra agents as CSS mini-orbs (the plan's sidebar design)
   over more WebGL orbs.
2. **Idle: settled idle orbs draw one frame and stop.** Only thinking, streaming and tool run at
   60 fps, and waiting at 30. If idle motion is wanted, schedule it with a timer at 10 to 12 fps
   instead of a per-vsync animation-frame loop that wakes 60 times a second to draw 24 frames.
   The reduced-motion run shows what that buys: the idle main screen went from 5 % of a core and
   23 ms/s of GPU time to nothing measurable, and a static window gives the glass nothing to
   recomposite.
3. **Hidden: stop rendering, keep streaming.** While `document.hidden`, keep reducing events into
   the store (cheap, and the transcript must stay complete) but skip React commits and markdown
   work; render once on `visibilitychange`. Measured here, that is 20 to 32 % of a core and up to
   145 mW of GPU power per 200 tokens/s chat while auracode is minimized or covered. It belongs
   with the transcript store in M2a, so M2b's chats inherit it.
4. **Aura: keep it as designed.** Compositor-only transforms on blurred layers cost little in
   WebKit: in the engine-level runs the aura added at most about 8 % of a core to the GPU process
   and 16 mW of GPU power, and nothing measurable to frame rate. Keep it paused when idle (it
   already is on the main screen) and confirm its WindowServer cost in the visible run, since the
   real window composites the blur there.
5. **Frame-rate targets for the orb shader stay:** 60 fps active, 24 to 30 fps waiting and error,
   static idle. DPR is already clamped to 2.
6. **Finish the visible run before tuning further.** It answers the glass question and the real
   window's frame rate under WindowServer, ideally on a quiet machine.
7. **Windows: hide the webview while the window is minimized** (pending the Windows run). If
   `idle-minimized` and `s24-minimized` confirm section D, the shell calls `Webview::hide()` when
   the window is minimized and `show()` when it is restored; tauri 2.12.5 exposes both on the
   webview, and on Windows they set `IsVisible`, as Microsoft recommends. Without it,
   `document.hidden` may never become true on Windows and recommendation 3 does nothing there.

## Finishing the macOS half

It needs about 20 minutes on an unlocked Mac that nobody touches, with the lid open and nothing
covering the app's window area, after other work on the machine has stopped: no builds or test
runs, and no stray CPU hogs (`top -o cpu`; on 2026-10-24 three orphaned `aura_drivers-...` test
binaries from a cargo-mutants run held three cores all day, so look for leftovers like those).
Quit any running auracode.

From the repository root, build the two helpers next to the driver (the folder's `.gitignore`
keeps them and the results out of git):

```sh
H=docs/spikes/render-power
clang -O2 -o "$H/sampler" "$H/sampler.c" -framework CoreFoundation -framework IOKit -lIOReport
swiftc -O -o "$H/winctl" "$H/winctl.swift"
"$H/winctl" locked   # must print 0
```

Then, with the debug binary built (`tauri dev` once) and the Vite dev server running
(`pnpm --filter @auracode/desktop dev`):

```sh
python3 "$H/measure.py" --build debug --out "$H/runs/visible" --settle 15 \
  baseline idle idle-noglass s1 s1-aura s8 s16 s24 s24-noaura s24-noglass s24-hidden baseline
pnpm --filter @auracode/desktop tauri build --bundles app
python3 "$H/measure.py" --build release --out "$H/runs/visible" --settle 10 \
  baseline idle idle-noglass s1 s24 s24-noaura s24-noglass s24-hidden baseline
```

About 11 and 7 minutes. Check in each result's JSON that `locked_at_start` and `locked_at_end` are
false, the main window's line says `onscreen=1`, `machine_idle_pct` is high, and stress runs logged
frames. `s24-hidden` hides the app (`NSRunningApplication.hide`); if macOS refuses, it covers the
screen with a black window for the window's length instead, which WebKit treats the same way.
Fill section C of the results from them, set the visible-window row of
[Verification](#verification) to done, and revisit the Bottom line and Conclusions.

## Windows (WebView2) half: still to run

WebView2 (Chromium) composites through DWM with Mica, so none of the macOS numbers carry over.
WebView2's processes are ordinary children of the app (`msedgewebview2.exe` browser, renderer, GPU
and utility processes), so they are found by walking the process tree, and `dwm.exe` plays
WindowServer's part. The suite is [render-power/render-power.ps1](render-power/render-power.ps1).
It needs no Rust, Node or pnpm on the PC, only a CI-built auracode and two script files, and it
runs every scenario unattended.

1. **Get a build from CI.** The Build workflow (`.github/workflows/build.yml`) uploads an artifact
   named `auracode-<commit>-windows-x64` that holds the installer `auracode_0.1.0_x64-setup.exe`.
   Run it (SmartScreen: More info > Run anyway). It installs per user into
   `%LOCALAPPDATA%\auracode`, needs no administrator, and installs the WebView2 runtime if it is
   missing; the suite finds the installed `auracode.exe` by itself. A bare `auracode.exe` from
   `tauri build --no-bundle` works too: pass it with `-Exe`, after `Unblock-File` if it came from
   a download (the suite refuses a file SmartScreen would stop).
   No Windows build exists yet: GitHub Actions is blocked for the account by a billing problem,
   so no workflow has run. Once it runs, Build makes the Windows installer for every push to
   main, nightly when main's newest commit has none, by hand
   (`gh workflow run build.yml --ref <branch>`, offered only once the workflow file is on the
   default branch), and for a push to a milestone branch such as `m0-scaffold` whose newest
   commit message contains `[bundle]`, for example
   `git commit --allow-empty -m "Build installers [bundle]"`.
2. **Get the scripts.** Download `render-power.ps1` and `test-render-power.ps1` from
   `docs/spikes/render-power/` into one folder (on GitHub: open each file, then Download raw file).
3. **Run the tests first.** They take seconds and catch a script problem before the long run:
   `powershell -ExecutionPolicy Bypass -File .\test-render-power.ps1`. Every test must print ok and
   the last line must read "0 failed". If one fails, send its output; the fix goes into the script
   before anything is measured.
4. **Prepare.** Quit auracode (check the notification area too) and close other apps. Keep the
   display at its usual refresh rate and scaling. Turn transparency effects on (Settings >
   Personalization > Colors) and Energy saver off, since without transparency Windows draws Mica
   flat. Plugged in or on battery both work; on battery the results also hold the battery's
   discharge rate.
5. **Run the suite and leave the machine alone** (about 12 minutes; auracode opens and closes 11
   times, and any click elsewhere makes its window inactive, which flattens Mica):
   `powershell -ExecutionPolicy Bypass -File .\render-power.ps1`
6. **Report:** zip the `render-power-results\<date-time>` folder it prints and send it. If a run
   failed, its JSON file holds the error and the suite carried on with the rest.

The default suite, in order (name any subset instead, for example
`.\render-power.ps1 baseline s24 s24-minimized baseline`):

| Scenario | auracode starts with |
|---|---|
| `baseline` | nothing (measures dwm.exe alone, at the start and again at the end) |
| `idle`, `idle-noglass` | the main screen, with Mica, then opaque (`AURACODE_NO_GLASS=1`) |
| `idle-minimized` | the main screen, then minimized |
| `s1`, `s1-aura` | the stress view with 1 orb and a 200 tokens/s stream, without and with the aura |
| `s8`, `s16`, `s24` | the stress view with 8, 16 and 24 orbs and the aura |
| `s24-noaura`, `s24-noglass` | 24 orbs without the aura, and with an opaque window |
| `s24-minimized` | 24 orbs and the aura, then minimized |

Each run waits for the window, settles for 10 s and measures for 30 s, using the same stress
settings as the macOS harness. It records:

- for every process in auracode's tree and for `dwm.exe`, CPU as a percentage of one core
  (`Win32_Process` CPU times, which cover `dwm.exe` without elevation) and 3D GPU engine
  utilization (`\GPU Engine(*engtype_3D)\Utilization Percentage`), summed per role (app, WebView2
  browser, renderer, GPU, utility, dwm);
- the frame rate over exactly the measured window, for stress scenarios only (the main screen
  keeps no frame log, so the idle runs have none). auracode starts with WebView2's DevTools port
  open on loopback (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, which WebView2 appends to the app's
  own arguments), and after the window the suite reads the stress view's frame log through it;
  nothing attaches while the window is measured. Release builds turn WebView2's DevTools window
  off, and whether that also closes the port is not documented. If it does, the run records the
  error, and the frame rate has to come from the on-screen readout;
- whether the window was minimized, visible and in front at the start and end of the window, with
  a warning when a visible run lost the foreground;
- battery state at both ends of the window, and in `machine.json` the Windows build, the GPUs and
  their refresh rates, scaling, transparency effects, the theme and the session type.

Mica only exists on Windows 11 (build 22000 and later). On Windows 10 the window is opaque either
way, so the `-noglass` runs measure the same thing as the others.

**When the first run trips.** The suite has never run on Windows: it was written on a Mac and
checked only statically (no PowerShell there). It checks everything it can before the first
scenario (the exe, SmartScreen's mark, a running auracode, the DevTools port, the GPU counter), and
each metric fails on its own without stopping the run. Send the console output and the results
folder of a failed run; fixes go into the script and its tests, and the results fill section D.

## Appendix: the harness

Everything is in [render-power/](render-power/), next to this doc:

| File | What it does |
|---|---|
| [measure.py](render-power/measure.py) | macOS driver: launches the app per scenario, attributes WebKit's processes, runs `top` and the sampler for the window, reads the frame log from WebKit's localStorage file, stops everything it started, writes one JSON result per run |
| [sampler.c](render-power/sampler.c) | once a second, without root: SoC power from IOReport's "Energy Model" group, per-process GPU time from the IORegistry, per-process CPU time and energy from `proc_pid_rusage` |
| [winctl.swift](render-power/winctl.swift) | lock state, the app's window bounds and on-screen flag from `CGWindowList`, hiding the app, and the full-screen cover window |
| [render-power.ps1](render-power/render-power.ps1) | the Windows suite (see the Windows section) |
| [test-render-power.ps1](render-power/test-render-power.ps1) | unit tests for the Windows suite's logic, run before it |

`measure.py`, `sampler.c` and `winctl.swift` are the harness behind section A, moved out of this
doc unchanged apart from `winctl`'s usage text, which now names `cover`. Build the two
helpers next to `measure.py` (commands in [Finishing the macOS half](#finishing-the-macos-half));
the folder's `.gitignore` keeps the binaries and the `runs/` output out of git. The engine-level
runs used a fourth script, Playwright's WebKit driving the production bundle through a mocked IPC
as described in Method; it is not reproduced here.
