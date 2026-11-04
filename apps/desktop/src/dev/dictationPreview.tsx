/** Scripted UI fixture. Never opens a microphone, downloads a model, or invokes Rust. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DictationEvent } from "../bindings";
import { Composer } from "../components/chat/Composer";
import type { ComposerTransport } from "../lib/composer";
import type { DictationApi } from "../lib/dictation";

function Preview() {
  const [sent, setSent] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [fixture] = useState(() => {
    const scenario = new URLSearchParams(location.search).get("case");
    let installed = scenario !== "download";
    let event: (value: DictationEvent) => void = () => {};
    const api: DictationApi = {
      model: async () => ({
        installed,
        name: "Whisper base",
        bytes: 147951465,
        supported: scenario !== "unsupported",
      }),
      download: async (_id, receive) => {
        event = receive;
        receive({ state: "downloading", received: 73975732, total: 147951465 });
      },
      start: async (_id, receive) => {
        event = receive;
        if (scenario === "denied")
          receive({
            state: "failed",
            reason: "microphone",
            message:
              "Microphone access is turned off for desktop apps. Allow it in your system privacy settings, then try again.",
          });
        else if (scenario === "damaged")
          receive({
            state: "failed",
            reason: "model",
            message: "The dictation model did not pass its integrity check. Download it again.",
          });
        else receive({ state: "recording", seconds: 3, level: 0.4, limit_seconds: 120 });
      },
      stop: async () => {
        event({ state: "transcribing", percent: 50 });
      },
      cancel: async () => {
        event({ state: "cancelled" });
      },
    };
    const composer: ComposerTransport = {
      dictation: api,
      draft: async () => ({ input: { text: "", attachments: [], mentions: [] }, files: [] }),
      saveDraft: async () => {},
      pick: async () => null,
      import: async () => {
        throw new Error("Not used by this fixture");
      },
      paste: async () => {
        throw new Error("Not used by this fixture");
      },
      mentions: async () => [],
      send: async () => {
        throw new Error("No agent runs in this fixture");
      },
    };
    return {
      composer,
      complete: () => event({ state: "complete", text: "Add a regression test." }),
      downloaded: () => {
        installed = true;
        event({ state: "model_ready" });
      },
    };
  });
  return (
    <main
      className="chat-main"
      style={{ height: "100vh", padding: 24, justifyContent: "flex-end" }}
    >
      <h1>Dictation preview</h1>
      <nav aria-label="Fixture controls" style={{ display: "flex", gap: 8 }}>
        <button type="button" className="g-button" onClick={fixture.complete}>
          Complete transcription
        </button>
        <button type="button" className="g-button" onClick={fixture.downloaded}>
          Complete download
        </button>
        <button type="button" className="g-button" onClick={() => setMounted((value) => !value)}>
          Switch chat
        </button>
        <output aria-label="Messages sent">{sent}</output>
      </nav>
      <div className="chat-compose-slot" style={{ marginTop: "auto" }}>
        {mounted ? (
          <Composer
            key="original"
            chatId="dictation-preview"
            contextApi={fixture.composer}
            commands={[]}
            status="ready"
            error={null}
            onSend={async () => {
              setSent((n) => n + 1);
              return true;
            }}
            onStop={() => {}}
            onForceStop={() => {}}
          />
        ) : (
          <p>Another chat</p>
        )}
      </div>
    </main>
  );
}
export function mountDictationPreview(container: HTMLElement) {
  createRoot(container).render(
    <StrictMode>
      <Preview />
    </StrictMode>,
  );
}
