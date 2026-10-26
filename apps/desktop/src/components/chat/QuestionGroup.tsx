import { useId, useState } from "react";
import type { UiAnswer, UiQuestion } from "../../bindings";
import {
  chooseQuestionOption,
  EMPTY_QUESTION_DRAFT,
  type QuestionDraft,
  type QuestionDrafts,
  questionsAnswer,
  writeQuestionText,
} from "../../lib/chat/questions";

/** A group is submitted together, after the user answers every question. */
export function QuestionGroup({
  questions,
  busy,
  onRespond,
}: {
  readonly questions: readonly UiQuestion[];
  readonly busy: boolean;
  readonly onRespond: (answer: UiAnswer | null) => void;
}) {
  const [drafts, setDrafts] = useState<QuestionDrafts>(() => new Map());
  return (
    <QuestionGroupForm
      questions={questions}
      drafts={drafts}
      busy={busy}
      onRespond={onRespond}
      onChange={(id, draft) => setDrafts((current) => new Map(current).set(id, draft))}
    />
  );
}

/** Controlled fields keep the draft and pending-request state separate. */
export function QuestionGroupForm({
  questions,
  drafts,
  busy,
  onChange,
  onRespond,
}: {
  readonly questions: readonly UiQuestion[];
  readonly drafts: QuestionDrafts;
  readonly busy: boolean;
  readonly onChange: (id: string, draft: QuestionDraft) => void;
  readonly onRespond: (answer: UiAnswer | null) => void;
}) {
  const formId = useId();
  const answer = questionsAnswer(questions, drafts);
  return (
    <form
      className="chat-questions"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && answer !== null) onRespond(answer);
      }}
    >
      {questions.map((question, questionIndex) => {
        const draft = drafts.get(question.id) ?? EMPTY_QUESTION_DRAFT;
        const inputId = `${formId}-${questionIndex}`;
        return (
          <fieldset
            className="chat-question"
            key={question.id}
            disabled={busy}
            data-testid="question-group"
            data-test-question-id={question.id}
          >
            <legend className="chat-question-legend">
              <span className="chat-block-tag">{question.header}</span>
              <span>{question.question}</span>
            </legend>
            <p className="ui-muted chat-question-hint">
              {question.multi_select ? "Choose one or more." : "Choose one."}
            </p>
            <div className="chat-question-options">
              {question.options.map((option, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the answer is the option's stable index.
                <label className="chat-question-option" key={index}>
                  <input
                    type={question.multi_select ? "checkbox" : "radio"}
                    name={inputId}
                    checked={draft.selected.includes(index)}
                    disabled={busy}
                    aria-labelledby={`${inputId}-label-${index}`}
                    aria-describedby={`${inputId}-option-${index}`}
                    data-testid="question-option"
                    data-test-question-id={question.id}
                    data-test-index={index}
                    onChange={() =>
                      onChange(question.id, chooseQuestionOption(question, draft, index))
                    }
                  />
                  <span className="chat-question-option-copy">
                    <span id={`${inputId}-label-${index}`}>{option.label}</span>
                    <span className="ui-muted" id={`${inputId}-option-${index}`}>
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {question.allow_free_text ? (
              <label className="ui-field" htmlFor={`${inputId}-text`}>
                {question.multi_select ? "Other answer (optional)" : "Or write your own answer"}
                <input
                  className="ui-input"
                  id={`${inputId}-text`}
                  value={draft.text}
                  disabled={busy}
                  data-testid="question-free-text"
                  data-test-question-id={question.id}
                  onChange={(event) =>
                    onChange(
                      question.id,
                      writeQuestionText(question, draft, event.currentTarget.value),
                    )
                  }
                />
              </label>
            ) : null}
          </fieldset>
        );
      })}
      <div className="ui-row">
        <button
          type="submit"
          className="ui-button"
          data-kind="primary"
          data-testid="question-submit"
          disabled={busy || answer === null}
        >
          Submit answers
        </button>
        <button
          type="button"
          className="ui-button"
          data-kind="quiet"
          data-testid="question-dismiss"
          disabled={busy}
          onClick={() => onRespond(null)}
        >
          Dismiss
        </button>
      </div>
    </form>
  );
}
