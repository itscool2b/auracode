# Local dictation

The composer's microphone adds speech to the current draft. It never sends a message. The first
use offers a 142 MiB download of multilingual Whisper base. After that, recording and recognition
work offline. Use the system's default input device, click Finish recording, review the text, then
send normally. Esc discards a recording or cancels transcription or download. Each recording is
limited to two minutes, with a visible time and microphone level.

Audio is held in bounded memory and discarded when the operation ends. No audio files, transcript
logs, cloud speech APIs, external executables, Python installation, account, or API key are used.
The resulting text becomes a normal draft and follows the existing draft persistence behavior.
Closing the chat, hiding the window, reloading the page, switching profiles, or quitting cancels
the recording. If the draft changed while speech was processed, the result is appended without
overwriting those edits. Otherwise it is inserted at the captured selection.

The model lives in `<data root>/models/dictation/ggml-base.bin`, outside profile sync. Its download
is pinned to upstream revision `5359861c739e955e79d9a303bcbc70fb988958b1`, exact size 147951465 bytes,
and SHA-256 `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`. It is downloaded to a
temporary file and published only after verification. Cancellation or failure removes the temporary
file. The digest is checked again before model loading. The error panel offers a new download for
repair. Only this download requires network access. Offline recognition keeps the spoken language;
it does not translate to English.

## Implementation and builds

`apps/desktop/src-tauri/src/dictation` owns recording, model installation, and recognition. CPAL
opens the native input stream; rubato converts mono audio to 16 kHz with an antialiasing filter;
whisper-rs statically links CPU-only whisper.cpp. One operation can run at a time. Every operation
is tied to its webview and profile generation and exposes cancellable progress through typed
Tauri channels. CPU work runs off the UI/async executor. The microphone closes before recognition.
No new webview filesystem, network, process, or microphone permission is granted.

Native Whisper/GGML logs are disabled, including token traces emitted by debug builds. The scoped
callback bridge avoids whisper-rs 0.16.0's unsafe closure-type cast in its safe abort helper and
its leaked callback allocations. Callback storage lives only for one synchronous inference call;
cancel intent remains separate from UI errors, so a failed cancel request cannot insert late text.

Building the native dependency adds CMake 3.15 or newer and LLVM/libclang to the existing C++ toolchain
requirements. Windows MSVC needs `cmake` on PATH and `LIBCLANG_PATH` pointing to the directory
containing `libclang.dll`. Visual Studio's Desktop development with C++ and LLVM components provide
the compiler and libclang. macOS needs CMake and the Xcode command line tools. These tools are
build dependencies only.
Windows x64/ARM64 and universal macOS remain the release targets. Linux/WSL remain deferred.

### Capture errors

cpal 0.18 reports glitches and reroutes through the same stream error callback as failures. On
Windows an early capture packet routinely carries WASAPI's data discontinuity flag, which cpal
reports as `Xrun`. Until November 2026 any callback ended the recording, so on Windows every
recording failed about 120 ms after it began with "The microphone disconnected or stopped
responding" and never reached transcription. `Xrun`, `DeviceChanged` (the stream follows the new
default device) and `RealtimeDenied` now leave the recording running. `PermissionDenied` names the
privacy setting; every other kind ends it, since cpal ends its capture thread after them. A
watchdog also ends a stream that delivers no audio within 5 seconds, or stops delivering for 3.
Each failure carries a reason (`model`, `microphone`, `no_speech`, `unsupported`, `other`), and the
panel offers "Download model again" only for model failures.

Windows' own microphone usage list (CapabilityAccessManager `NonPackaged`) did not record these
short sessions on build 26300, even successful ones, so it is no evidence either way.

### Recognition

The webview's `navigator.language` selects Whisper's language (`en-US` becomes `en`); a tag Whisper
does not know falls back to its detection, which misreads short clips. whisper.cpp already drops a
segment it judges silent (no-speech probability above 0.6 and low confidence, OpenAI's rule); the
app no longer drops segments again on the probability alone, which discarded clear speech. Text is
read lossily, so a token that ends inside a multi-byte character cannot fail a transcript, and
Whisper's bracketed upper-case markers such as `[BLANK_AUDIO]` are removed. Decoding uses up to 8
threads.

### Processor instructions

ggml-cpu is built with AVX, AVX2, FMA, F16C and SSE4.2 (`.cargo/config.toml`); BMI2 and host
tuning (`GGML_NATIVE`) stay off. Without them Whisper runs scalar code. On a Ryzen 7 5800X3D the
pinned model took 18.0 s for upstream's 11 s `jfk.wav` with the old settings, and 0.65 s with these
and 8 threads, with identical text; a 14.6 s synthesized sentence went from 18.3 s to 0.71 s.
Encoding less than Whisper's 30 s window (`audio_ctx`) saved a further third but misheard words,
so it stays off.

Every Mac that runs macOS 13.3 has these instructions. Windows x64 processors from before Intel's
2013 Haswell and AMD's 2015 Excavator lack AVX2, so the app must still start on them:

- ggml applies the flags to ggml-cpu only. Its objects contain no dynamic initializers
  (`dumpbin /headers` finds no `.CRT$XCU` section in `ggml-cpu.lib`); the startup initializers are
  in whisper and ggml-base, which are built without them.
- 112 functions, all MSVC standard library helpers, are defined both in ggml-cpu and in the other
  libraries. A `/MAP` of the linked app showed that each of the 27 kept in the image came from a
  non-AVX object (25 from `whisper.obj`, 2 from `ggml.c.obj`); the other 85 were discarded. So no
  code that runs before dictation can call an AVX2 copy.
- `dictation::audio::cpu_supported()` checks AVX, AVX2, FMA and F16C before any Whisper call.
  `dictation_model` reports the result and the panel explains, without retry or download offers.

Repeat the map check after updating whisper-rs-sys or the MSVC toolchain. whisper-rs-sys forwards
`GGML_*` and `CMAKE_*` variables to CMake but does not rebuild when they change, so the Cargo
config also sets `BINDGEN_EXTRA_CLANG_ARGS` to a revision marker, which it does track: bump it
with any whisper build setting.

Windows ARM64's release matrix selects Ninja and `.github/cmake/windows-arm64-clang.cmake` only
after exporting host bindings. whisper.cpp 1.8.3 rejects ARM with MSVC's `cl.exe`, so the toolchain
uses `clang-cl` with explicit `aarch64-pc-windows-msvc` C and C++ targets and the runner's MSVC ABI,
headers, and libraries. Ninja avoids cmake-rs's Visual Studio `-Thost=x64` conflict with a ClangCL
toolset selection. cmake-rs retains the target-specific MSVC/SDK `LIB`, `INCLUDE`, and `PATH` that
the `cc` crate discovers and passes them to both configure and build. C++-only `/EHsc` restores
exception handling that cmake-rs's supplied flags
otherwise omit. The Windows runner already provides Ninja and LLVM; missing tools fail the setup
step. The x64 bundle, host binding export, and other Rust/native compiler settings are unchanged.

An isolated local probe compiled the pinned Whisper/GGML static libraries with this toolchain;
`dumpbin /HEADERS` identified their objects as ARM64. Because this host has no ARM64 MSVC runtime
libraries, the probe used static-library compiler checks. The release workflow retains normal
link checks. A full ARM64 app, installer, or on-device inference has not been verified here, nor
has a macOS build. No CI run was dispatched. A successful Windows x64 bundle does not close those
platform checks.

On MSVC, the Cargo config also selects CMake's `CMP0091=NEW` and
`CMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded` for whisper.cpp. This statically links its C/C++ runtime
as well as Whisper/GGML, so the installer needs no Visual C++ Redistributable, Whisper DLL, or
OpenMP DLL. It does not change Rust's CRT flags. CMake ignores the runtime selection on other
platforms. A prior warm target may retain Whisper's dynamic-runtime objects because its upstream
build script does not track these environment values. Move aside only that dependency's build
output and matching run-build fingerprint directories before the first rebuild after changing
them, preserving compiled build-script binaries. Check the actual bundled
executable's imports with `dumpbin /DEPENDENTS`; it must not import `MSVCP*.dll`, `VCRUNTIME*.dll`,
`VCOMP*.dll`, or Whisper/GGML DLLs. Windows system and Universal CRT API-set DLLs are expected.

macOS bundles include `NSMicrophoneUsageDescription` and the hardened-runtime audio-input
entitlement. The local signing helper preserves that entitlement. Windows uses the system's
desktop-app microphone permission. A missing, denied, unsupported, disconnected, or silent input
produces a recoverable message and leaves the draft intact.

Upstream references: [CPAL](https://docs.rs/cpal/0.18.2/cpal/),
[whisper-rs](https://docs.rs/whisper-rs/0.16.0/whisper_rs/),
[Whisper model](https://huggingface.co/ggerganov/whisper.cpp/blob/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin),
[rubato](https://docs.rs/rubato/0.16.2/rubato/), and
[Apple microphone usage key](https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription).

## Verification

Unit coverage exercises operation ownership, cancellation, stale channels, bounded capture,
sample normalization, resampling and silence, digest checks, delayed command admission, stale
UI results, and insertion while a draft is being edited. `?preview=dictation` uses an explicitly
scripted transport; it never opens audio hardware or downloads a model. The browser check drives
download, recording, cancellation, errors, draft insertion, and chat switching in both appearances
and browser engines. Browser fixtures establish UI behavior only. Live microphone permissions,
audio quality, and platform-specific packaging still need native verification on each target.

On Windows x64, the desktop Rust suite passed (244 tests, one optional engine fixture ignored),
Clippy passed with warnings denied, and the full desktop UI suite passed (618 tests, 19 skipped).
The production frontend build, style checks, Biome, and notice-script tests passed. Biome retains
the existing context-panel specificity warnings. Chromium and WebKit passed the dictation fixture
in light and dark appearances, including accessibility checks and retained screenshots.

The optional `dictation::audio::tests::offline_model_fixture` also passed with the actual pinned
model: production download and integrity verification, multilingual CPU inference of upstream's
`samples/jfk.wav`, and cancellation during a second inference. Native output contains no decoded
tokens. This establishes inference behavior; it does not establish microphone capture or OS
permission behavior. To repeat it, place the [upstream WAV](https://github.com/ggml-org/whisper.cpp/blob/v1.8.3/samples/jfk.wav)
in a temporary directory, set `AURACODE_DICTATION_FIXTURE_DIR` to that directory, and run
`cargo test -p auracode-desktop --lib offline_model_fixture -- --ignored --nocapture`.
The test downloads the model if absent and reuses the verified local copy on subsequent runs.
The file must be named `jfk.wav` and retain the upstream 16 kHz mono signed 16-bit PCM format;
this small test reader is not a general WAV decoder. The model is stored below the fixture root
at `models/dictation/ggml-base.bin`, separate from the installed app's model. The fixture verifies
an expected English phrase and cancels a second inference after 250 ms. It does not measure a
cancellation latency bound, multilingual accuracy, microphone capture, or two-minute recordings.

The November 2026 fix was reproduced and checked natively on Windows 11 (build 26300, Ryzen 7
5800X3D). The installed release build, run with a scratch `AURACODE_DATA_DIR` and driven over
CDP, failed every recording at 438 ms with the disconnect message. The fixed debug app recorded 4 s
from the real microphone (level peak 0.17), transcribed in 0.65 s and completed with the spoken
text. The dictation unit tests, both opt-in model tests (`offline_model_fixture`,
`offline_model_timing`, which times every 16 kHz WAV in the fixture folder) and
`check-dictation.mjs` passed. The browser check now also covers the Finish button taking focus
(Enter finishes), focus returning to the draft, and the recovery offered per failure reason.

The Windows runtime fix was checked with a fresh Whisper rebuild, all eight targeted dictation
unit tests, and the optional pinned-model fixture, which passed in 40.6 seconds on this host.
The actual debug app rebuilt successfully, and `dumpbin /DEPENDENTS` showed only Windows system
and Universal CRT API-set DLLs, with no MSVCP, VCRUNTIME, VCOMP, Whisper, or GGML DLL imports.
The Windows x64 release installer's actual embedded application also passed that import inspection
and the stream, 33-check chat and eight-check reopen smoke suites in isolated data folders. This
does not extend the microphone or non-Windows acceptance claims above.
