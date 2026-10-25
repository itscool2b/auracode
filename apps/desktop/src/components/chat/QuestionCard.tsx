import { useId, useState } from "react";
import type { UiAnswer } from "../../bindings";
import type { RequestState } from "../../lib/chat/chatStore";
import { questionResolutionLabel } from "../../lib/chat/present";
import type { QuestionItem } from "../../lib/chat/transcript";

/**
 * The agent asks the user something: Yes and No, one button per choice, or a text field and
 * Submit, with Dismiss. Never answered automatically. A resolved question shows its answer; one
 * that only informs (`notify`) has nothing to answer.
 */
export function QuestionCard({
  item,
  request,
  onRespond,
}: {
  readonly item: QuestionItem;
  readonly request: RequestState | undefined;
  /** `null` dismisses the question. */
  readonly onRespond: (answer: UiAnswer | null) => void;
}) {
  const { prompt } = item.request;
  const closed = item.resolution !== null || request?.gone === true;
  const busy = request?.busy === true;
  return (
    <div className="chat-block" data-kind="question" data-resolved={closed}>
      <div className="chat-block-head">
        <span className="chat-block-title">{prompt.message}</span>
        <span className="chat-block-tag">Question</span>
      </div>
      {item.resolution !== null ? (
        <p className="chat-resolution">{questionResolutionLabel(item.resolution, prompt)}</p>
      ) : request?.gone ? (
        <p className="chat-resolution">This question is no longer waiting for an answer.</p>
      ) : prompt.type === "notify" ? null : (
        <Answers prompt={prompt} busy={busy} onRespond={onRespond} />
      )}
      {request?.error ? (
        <span role="alert" className="ui-error">
          {request.error}
        </span>
      ) : null}
    </div>
  );
}

function Answers({
  prompt,
  busy,
  onRespond,
}: {
  readonly prompt: Exclude<QuestionItem["request"]["prompt"], { type: "notify" }>;
  readonly busy: boolean;
  readonly onRespond: (answer: UiAnswer | null) => void;
}) {
  const [text, setText] = useState("");
  const inputId = useId();
  const dismiss = (
    <button
      type="button"
      className="ui-button"
      data-kind="quiet"
      disabled={busy}
      onClick={() => onRespond(null)}
    >
      Dismiss
    </button>
  );
  switch (prompt.type) {
    case "confirm":
      return (
        <div className="ui-row">
          <button
            type="button"
            className="ui-button"
            data-kind="primary"
            disabled={busy}
            onClick={() => onRespond({ type: "confirm", yes: true })}
          >
            Yes
          </button>
          <button
            type="button"
            className="ui-button"
            disabled={busy}
            onClick={() => onRespond({ type: "confirm", yes: false })}
          >
            No
          </button>
          {dismiss}
        </div>
      );
    case "select":
      return (
        <div className="ui-row">
          {prompt.options.map((option, index) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: the answer is the choice's index.
              key={index}
              type="button"
              className="ui-button"
              disabled={busy}
              onClick={() => onRespond({ type: "select", index })}
            >
              {option}
            </button>
          ))}
          {dismiss}
        </div>
      );
    case "input":
      return (
        <form
          className="ui-row"
          onSubmit={(event) => {
            event.preventDefault();
            onRespond({ type: "input", text });
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            Your answer
          </label>
          <input
            id={inputId}
            className="ui-input"
            value={text}
            placeholder={prompt.placeholder ?? ""}
            disabled={busy}
            onChange={(event) => setText(event.currentTarget.value)}
          />
          <button type="submit" className="ui-button" data-kind="primary" disabled={busy}>
            Submit
          </button>
          {dismiss}
        </form>
      );
  }
}
