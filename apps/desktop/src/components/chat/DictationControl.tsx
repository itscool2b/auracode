import { Download, Mic, Square, X } from "lucide-react";
import { type RefObject, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  type DictationApi,
  DictationController,
  dictationBusy,
  insertDictation,
  offersModelDownload,
  offersRetry,
} from "../../lib/dictation";
import "./dictation.css";

export function DictationControl({
  api,
  input,
  text,
  setText,
  disabled,
  onBusy,
}: {
  readonly api: DictationApi;
  readonly input: RefObject<HTMLTextAreaElement | null>;
  readonly text: string;
  readonly setText: (value: (current: string) => string) => void;
  readonly disabled: boolean;
  readonly onBusy: (busy: boolean) => void;
}) {
  const insertion = useRef({ text, start: text.length, end: text.length });
  const latest = useRef({ setText, input });
  latest.current = { setText, input };
  const [controller] = useState(
    () =>
      new DictationController(api, (transcript) => {
        const selection = insertion.current;
        latest.current.setText((current) =>
          insertDictation(current, transcript, selection.text, selection.start, selection.end),
        );
        latest.current.input.current?.focus();
      }),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const busy = dictationBusy(state);
  const visible = state.state !== "idle";
  const control = useRef<HTMLSpanElement>(null);
  const finish = useRef<HTMLButtonElement>(null);
  const recording = state.state === "recording";
  useEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);
  // Enter or Space finishes a recording: its button takes focus when listening starts.
  useEffect(() => {
    if (recording) finish.current?.focus();
  }, [recording]);
  // A closing panel would leave focus on nothing; the draft takes it back. Only on closing: the
  // first render never moves focus.
  const wasVisible = useRef(visible);
  useEffect(() => {
    const closed = wasVisible.current && !visible;
    wasVisible.current = visible;
    if (!closed) return;
    const focused = document.activeElement;
    if (!focused || focused === document.body || control.current?.contains(focused))
      latest.current.input.current?.focus();
  }, [visible]);
  useEffect(() => {
    controller.activate();
    return () => {
      controller.dispose();
    };
  }, [controller]);
  useEffect(() => {
    if (disabled) void controller.cancel();
  }, [controller, disabled]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) void controller.cancel();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || controller.getSnapshot().state === "idle") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void controller.cancel();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("keydown", onEscape, true);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("keydown", onEscape, true);
    };
  }, [controller]);
  const rememberSelection = () => {
    insertion.current = {
      text,
      start: input.current?.selectionStart ?? text.length,
      end: input.current?.selectionEnd ?? text.length,
    };
  };
  const start = () => {
    rememberSelection();
    void controller.start();
  };
  return (
    <span className="dictation-control" ref={control}>
      <button
        type="button"
        className="chat-composer-attach"
        aria-label="Dictate a message"
        title="Dictate a message on this device"
        disabled={disabled || busy}
        aria-expanded={visible}
        onClick={() => {
          rememberSelection();
          void controller.open();
        }}
      >
        <Mic size={16} />
      </button>
      {visible ? (
        <section className="dictation-panel" aria-label="Dictation" data-testid="dictation-panel">
          <div className="dictation-heading">
            <strong>Dictation</strong>
            <button
              type="button"
              className="g-button g-button-icon"
              aria-label={busy ? "Cancel dictation" : "Close dictation"}
              disabled={state.state === "cancelling" && !state.message}
              onClick={() => void controller.cancel()}
            >
              <X size={14} />
            </button>
          </div>
          {state.state === "needs_model" || state.state === "ready" ? (
            <>
              <p>
                Speech stays on this device. Audio is never uploaded or saved. Review the text
                before sending.
              </p>
              {state.state === "needs_model" ? (
                <>
                  <p>
                    Download Whisper base once (142 MiB) to dictate offline in multiple languages.
                  </p>
                  <button
                    type="button"
                    className="g-button g-button-28"
                    onClick={() => void controller.download()}
                  >
                    <Download size={14} /> Download model
                  </button>
                </>
              ) : (
                <button type="button" className="g-button g-button-28" onClick={start}>
                  <Mic size={14} /> Start recording
                </button>
              )}
            </>
          ) : null}
          {state.state === "checking" || state.state === "preparing" ? (
            <p role="status">
              {state.state === "checking" ? "Checking the local model…" : "Preparing dictation…"}
            </p>
          ) : null}
          {state.state === "downloading" ? (
            <>
              <p role="status">
                Downloading model · {Math.floor((state.received / state.total) * 100)}%
              </p>
              <progress aria-label="Model download" value={state.received} max={state.total} />
            </>
          ) : null}
          {state.state === "recording" ? (
            <>
              <p role="status">
                Listening · {state.seconds}s / {state.limit_seconds}s
              </p>
              <meter aria-label="Microphone level" min={0} max={1} value={state.level ?? 0} />
              <button
                ref={finish}
                type="button"
                className="g-button g-button-28"
                onClick={() => void controller.stop()}
              >
                <Square size={12} /> Finish recording
              </button>
              <p>Enter finishes and adds the text to your draft. Esc cancels.</p>
            </>
          ) : null}
          {state.state === "transcribing" ? (
            <>
              <p role="status">Transcribing on this device · {state.percent}%</p>
              <progress aria-label="Transcription" value={state.percent} max={100} />
            </>
          ) : null}
          {state.state === "cancelling" ? (
            state.message ? (
              <>
                <p role="alert" className="ui-error">
                  {state.message}
                </p>
                <button
                  type="button"
                  className="g-button g-button-28"
                  onClick={() => void controller.cancel()}
                >
                  Try stopping again
                </button>
              </>
            ) : (
              <p role="status">Stopping dictation…</p>
            )
          ) : null}
          {state.state === "failed" ? (
            <>
              <p role="alert" className="ui-error">
                {state.message}
              </p>
              {offersRetry(state) ? (
                <div className="dictation-recovery">
                  <button
                    type="button"
                    className="g-button g-button-28"
                    onClick={() => {
                      rememberSelection();
                      void controller.open();
                    }}
                  >
                    Try again
                  </button>
                  {offersModelDownload(state) ? (
                    <button
                      type="button"
                      className="g-button g-button-28"
                      onClick={() => void controller.download()}
                    >
                      Download model again
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </span>
  );
}
