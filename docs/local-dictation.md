# Local dictation

The composer's microphone dictates into the draft. It never sends a message. Recognition runs on
this device with two models that ship inside the app, so there is nothing to install or download:
NVIDIA's Parakeet TDT-CTC 110M (English, with punctuation and capitals) and Silero VAD v6.2 (voice
activity). There is no time limit (owner, 4 November 2026: "don't have a limit for it", "don't make
them install it").

## Using it

Click the microphone. The composer's controls give way to the bar: Cancel, the live waveform of the
microphone's level (dark where speech was heard), the time, and Finish where Send was. Finish holds
focus, so Enter finishes; Enter in the message box finishes too, and Esc cancels.

While the microphone listens, the words heard so far appear at the cursor as ghost text, lighter
than the draft. Phrases already settled, and words two passes agreed on, are fg-2; words still
forming are fg-3 and may change. The theme's mark is the caret, and an empty draft reads
"Listening". The message box is read-only meanwhile, and the ghost draws the draft itself with the
box's own metrics, so dictated words sit exactly where they will land.

- **Finish** closes the microphone. The last phrase settles, the final text goes into the draft at
  the selection captured when dictation began (or at the end, if the draft changed since), and one
  sweep sets it in ink, its leading edge in the theme's mark. The caret follows the new words.
- **Cancel** (or Esc) dissolves the words, newest first, and the draft is as it was.
- **Failures** show inside the bar, with Try again where it can help. If the microphone stops
  mid-recording, the words already heard stay in the draft and the bar says so. Recording with no
  speech says to check the microphone. Typing in the draft closes a failure.

Closing the chat, hiding the window, switching profiles or quitting cancels a recording. Reduced
motion (the system's or the app's) keeps every state and drops the movement: no sweep, dissolve,
word fade, caret pulse or waveform slide.

## Privacy

Audio lives only in memory and is zeroed when the recording ends: at most a 4 s capture backlog,
the phrase in progress (at most 20 s) and the last 30 s of settled phrases. No audio or transcript
is written to disk or logged; transcribe.cpp's and ggml's native logging is turned off before the
first model loads. Nothing makes a network request, and no account, API key, cloud speech service,
Python or external executable is involved. The finished text becomes a normal draft and follows
the draft's usual persistence.

## How it works

`apps/desktop/src-tauri/src/dictation` owns recording and recognition:

- **Engine** (`engine.rs`). [transcribe.cpp](https://github.com/handy-computer/transcribe.cpp) 0.4.1
  (MIT, through `transcribe-cpp`) statically links ggml. The two models load once, memory-mapped,
  and stay loaded, so later recordings start at once; each recording gets its own sessions. Passes
  run on at most two threads. macOS builds also enable ggml's Metal backend, the crate's default.
- **Capture** (`audio.rs`). CPAL opens the default input; mono audio passes through a chunked rubato
  FFT resampler to 16 kHz, and Silero VAD scores every 32 ms frame. The loop reports every 80 ms.
  Watchdogs end a stream that delivers nothing within 5 s or stops for 3 s; glitch reports (`Xrun`,
  `DeviceChanged`, `RealtimeDenied`) leave the recording running, since cpal reports them through
  the same callback as failures (the November 2026 Windows fix, #68).
- **Live text** (`live.rs`). Parakeet is an offline model, so live text comes from phrases. A phrase
  opens when the speech probability reaches 0.5, keeping 0.25 s of audio before it, and closes after
  0.7 s below 0.35, or at 20 s. While it runs it is transcribed again every 0.8 s, and the words two
  consecutive passes agree on become stable: the local-agreement policy of streaming Whisper. A
  closed phrase is transcribed once more and settles. Silence costs only voice detection.
- **Finishing** transcribes the last 30 s of phrases again as one clip, so a pause in the middle of
  a sentence cannot split its words; a failed or empty pass keeps the phrases' own text.
- **Events** reach the webview over a typed channel: `preparing`, then `listening` every 80 ms with
  the time, the level, whether a phrase is open and the text so far (`settled`, `stable`,
  `tentative`), then `finishing` and `complete`, or `cancelled`, or `failed` with a reason (`model`,
  `microphone`, `no_speech`, `unsupported`, `other`). One recording runs at a time, tied to its
  webview and profile generation.

`apps/desktop/src/lib/dictation.ts` owns one recording per composer: late events and command
completions cannot reach another chat, and cancelling discards a late result.
`components/chat/Dictation.tsx` draws the bar, the waveform and the ghost; `dictation.css` holds
their motion, timed by `--g-dur-wave` (80 ms), `--g-dur-ink` (560 ms) and `--g-dur-dissolve`
(320 ms).

### Measurements

On a Ryzen 7 5800X3D (Windows 11 build 26300), with the bundled models and two threads:

- Upstream's `jfk.wav` (11.0 s): the live passes took 2.35 s, 21.3% of real time, with 14 live
  updates, and the final text was exact: "And so my fellow Americans, ask not what your country can
  do for you. Ask what you can do for your country." A live pass had heard "as not What" across a
  pause; finishing's single pass over the window corrected it.
- A synthesized 14.6 s sentence: 3.15 s of passes (21.5%), and it came out whole.
- Four threads finished the passes sooner (14% of real time) but used more processor overall
  (about 0.56 cores against 0.43), so two it is.
- Loading both models took 80 to 106 ms. In the debug app, the first report arrived 143 ms after
  starting, and listening to a silent room used 2.3% of one core (the idle app: 0.6%).

## Bundling and builds

The models are pinned in `apps/desktop/scripts/dictation-models.mjs` to a Hugging Face revision, a
size and a SHA-256:

| File | Source | Size | License |
| --- | --- | ---: | --- |
| `parakeet-tdt_ctc-110m-Q6_K.gguf` | [handy-computer/parakeet-tdt_ctc-110m-gguf](https://huggingface.co/handy-computer/parakeet-tdt_ctc-110m-gguf/tree/1c3f0d5378fdd358905cc410a93ed9e64f52d170) | 112,311,264 B | CC-BY-4.0 |
| `silero-vad-v6.2-F32.gguf` | [handy-computer/silero-vad-v6.2-gguf](https://huggingface.co/handy-computer/silero-vad-v6.2-gguf/tree/a9b2d61c20ae4ddf3644edb34969e8185a485448) | 1,241,056 B | MIT |

Q6_K keeps Parakeet at 2.44% WER on LibriSpeech test-clean (F32: 2.43%). `pnpm bundle` fetches any
model that is missing and verifies every one before `tauri build` packages
`src-tauri/resources/dictation/` as the app's `dictation/` resources; the Build workflow runs the
same script. The files are not committed. For a debug build, run `node scripts/dictation-models.mjs`
from `apps/desktop` once (`--check` only verifies); without them dictation says the build is missing
its models. The app checks their sizes at runtime; the installer and updater signatures cover their
contents. A test keeps the Rust pins and the script's in step, and the notices generator fails when
`third-party/models.json` disagrees with the script. The notices carry each model's license, its
GGUF conversion's NOTICE and an attribution.

Building needs CMake 3.15 or newer with the usual C/C++ toolchain (Visual Studio's C++ workload on
Windows, the Xcode command line tools on macOS). transcribe-cpp-sys ships its bindings, so libclang
is no longer needed.

- **Instruction set.** `.cargo/config.toml` passes `TRANSCRIBE_CMAKE_ARGS`, which the crate forwards
  to CMake after its own defaults and rebuilds on: AVX, AVX2, FMA, F16C and SSE4.2 on, BMI2 and
  host tuning (`GGML_NATIVE`) off, so a release runs on every Mac that runs macOS 13.3 and on Intel
  (2013) and AMD (2015) processors onward. `dictation::audio::cpu_supported()` checks AVX, AVX2,
  FMA and F16C before any engine call, and the bar explains, without a retry, on older processors.
  ggml applies the flags to its CPU backend only, so the rest of the app starts and works there.
  ARM builds ignore the x86 flags.
- **Runtime.** The same arguments select CMake's `CMP0091=NEW` and
  `CMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded`, so the engine's C/C++ runtime is in the static
  library and the installer needs no Visual C++ Redistributable. `dumpbin /DEPENDENTS` on the
  November 2026 debug app listed only Windows system and Universal CRT API-set DLLs: no `MSVCP*`,
  `VCRUNTIME*`, `VCOMP*` or ggml DLL. Repeat it on the bundled executable after changing the engine
  or the toolchain.
- **Windows ARM64.** ggml accepts MSVC's `cl.exe` on ARM only when it tunes to the build machine, so
  the Build workflow selects Ninja and `.github/cmake/windows-arm64-clang.cmake` (clang-cl with the
  runner's MSVC ABI, headers and libraries, and C++ `/EHsc`) for that row only.
- **macOS** bundles keep `NSMicrophoneUsageDescription` and the hardened-runtime audio-input
  entitlement. Windows uses the system's desktop-app microphone permission.

## Verification

- `cargo test -p o7-desktop --lib dictation`: capture, conversion, voice detection, live
  agreement, settling, the finishing window, zeroing, operation ownership and the model pins (16
  tests). The opt-in `bundled_models_transcribe_fixture_audio_live` runs the bundled models over
  every 16 kHz mono WAV in `O7_DICTATION_FIXTURE_DIR` as the microphone would deliver it, and
  prints the live updates, timing and final text (`-- --ignored --nocapture`).
- `vitest run src/lib/dictation.test.ts`: the controller (live text, the bounded waveform, finishing,
  cancelling, late results, kept words, failures) and insertion at the selection.
- `node scripts/check-dictation.mjs` against the `?preview=dictation` fixture on Vite (port 1448):
  Chromium and WebKit, light and dark, axe in every state, focus, the read-only draft, insertion at
  the caret, Esc and Cancel, chat switching, every failure, a microphone that drops, and, with full
  motion, the sweep and the dissolve ending and typing ending the sweep. It also compares the draft
  as the ghost draws it with the message box pixel for pixel. The fixture never opens a microphone.
- Natively, on Windows x64 (debug app, scratch profile, driven over CDP): the bundled models were
  found and loaded, the real microphone reported every 80 ms (level peak 0.04 in a quiet room),
  finishing with no speech said so, and cancelling ended the recording.

Not yet verified: real speech through the native microphone (the test machine cannot be spoken to;
accuracy comes from the model fixtures), the macOS build and its Metal backend, the Windows ARM64
build, and any on-device run of either. Linux is deferred with the rest of the Linux port.

The bundled model is English only. The plan's optional multilingual download is deferred;
transcribe.cpp also runs Whisper's GGUF models, so it can come later without a second engine.
