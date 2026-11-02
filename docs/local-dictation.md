# Local dictation

The composer's microphone adds speech to the current draft. It never sends a message. The first
use offers a 142 MiB download of multilingual Whisper base. After that, recording and recognition
work offline. Use the system's default input device, click Finish recording, review the text, then
send normally. Esc discards a recording or cancels transcription or download. Each recording is
limited to two minutes, with a visible time and microphone level.

Audio is held in bounded memory and cleared when the operation ends. No audio files, transcript
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

Building the native dependency adds CMake and LLVM/libclang to the existing C++ toolchain
requirements. Windows MSVC needs `cmake` on PATH and `LIBCLANG_PATH` pointing to the directory
containing `libclang.dll`. Visual Studio's Desktop development with C++ and LLVM components provide
the compiler and libclang. macOS needs CMake and the Xcode command line tools. These tools are
build dependencies only. The repository's Cargo config disables build-host CPU instruction
selection so Windows and macOS bundles do not inherit the build machine's AVX requirements.
Windows x64/ARM64 and universal macOS remain the release targets. Linux/WSL remain deferred.

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
