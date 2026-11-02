import { useId, useState } from "react";
import type { UiAnswer } from "../../bindings";
import type { RequestState } from "../../lib/chat/chatStore";
import { questionResolutionLabel } from "../../lib/chat/present";
import type { QuestionItem } from "../../lib/chat/transcript";
import { QuestionGroup } from "./QuestionGroup";

/**
 * An answer as `data-test-answer` carries it: `confirm:yes`, `confirm:no`, `select:<index>`,
 * `input:<text>`, `questions:<JSON answers>`, or `dismissed` for none.
 */
export function answerMark(answer: UiAnswer | null): string {
  if (answer === null) return "dismissed";
  switch (answer.type) {
    case "confirm":
      return answer.yes ? "confirm:yes" : "confirm:no";
    case "select":
      return `select:${answer.index}`;
    case "input":
      return `input:${answer.text}`;
    case "questions":
      return `questions:${JSON.stringify(answer.answers)}`;
  }
}

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
    <div
      className="chat-block"
      data-kind="question"
      data-notify={prompt.type === "notify" ? "" : undefined}
      data-resolved={closed}
      data-testid="item"
      data-test-kind="question"
      data-test-request-id={item.request.request_id}
      data-test-resolved-by={item.resolution?.by ?? ""}
      data-test-answer={item.resolution === null ? "" : answerMark(item.resolution.answer)}
      data-test-gone={String(request?.gone === true)}
    >
      <div className="chat-block-head">
        <span className="chat-block-title" data-testid="question-prompt">
          {prompt.message}
        </span>
      </div>
      {item.resolution !== null ? (
        <p className="chat-resolution" data-testid="question-resolution">
          {questionResolutionLabel(item.resolution, prompt)}
        </p>
      ) : request?.gone ? (
        <p className="chat-resolution" data-testid="question-resolution">
          This question is no longer waiting for an answer.
        </p>
      ) : prompt.type === "notify" ? null : (
        <Answers key={item.request.request_id} prompt={prompt} busy={busy} onRespond={onRespond} />
      )}
      {request?.error ? (
        <span role="alert" className="ui-error" data-testid="question-error">
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
      className="g-button g-button-ghost"
      data-testid="question-dismiss"
      disabled={busy}
      onClick={() => onRespond(null)}
    >
      Dismiss
    </button>
  );
  switch (prompt.type) {
    case "questions":
      return <QuestionGroup questions={prompt.questions} busy={busy} onRespond={onRespond} />;
    case "confirm":
      return (
        <div className="ui-row">
          <button
            type="button"
            className="g-button g-button-primary"
            data-testid="question-yes"
            disabled={busy}
            onClick={() => onRespond({ type: "confirm", yes: true })}
          >
            Yes
          </button>
          <button
            type="button"
            className="g-button"
            data-testid="question-no"
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
              className="g-button"
              data-testid="question-choice"
              data-test-index={index}
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
            if (!busy) onRespond({ type: "input", text });
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            Your answer
          </label>
          <input
            id={inputId}
            className="g-input"
            data-testid="question-input"
            value={text}
            placeholder={prompt.placeholder ?? ""}
            disabled={busy}
            onChange={(event) => setText(event.currentTarget.value)}
          />
          <button
            type="submit"
            className="g-button g-button-primary"
            data-testid="question-submit"
            disabled={busy}
          >
            Submit
          </button>
          {dismiss}
        </form>
      );
  }
}
