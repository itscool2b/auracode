import { useEffect, useId, useRef, useState } from "react";
import type { UiAnswer, UiQuestion } from "../../bindings";
import {
  chooseQuestionOption,
  EMPTY_QUESTION_DRAFT,
  type QuestionDraft,
  type QuestionDrafts,
  questionsAnswer,
  writeQuestionText,
} from "../../lib/chat/questions";

/** One question at a time; the agent receives the complete group in one response. */
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
  const [questionIndex, setQuestionIndex] = useState(0);
  return (
    <QuestionGroupForm
      questions={questions}
      drafts={drafts}
      questionIndex={questionIndex}
      onNavigate={setQuestionIndex}
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
  questionIndex,
  onNavigate,
  busy,
  onChange,
  onRespond,
}: {
  readonly questions: readonly UiQuestion[];
  readonly drafts: QuestionDrafts;
  readonly questionIndex: number;
  readonly onNavigate: (index: number) => void;
  readonly busy: boolean;
  readonly onChange: (id: string, draft: QuestionDraft) => void;
  readonly onRespond: (answer: UiAnswer | null) => void;
}) {
  const formId = useId();
  const answer = questionsAnswer(questions, drafts);
  const index = Math.max(0, Math.min(questionIndex, questions.length - 1));
  const question = questions[index];
  const currentAnswer = question ? questionsAnswer([question], drafts) : null;
  const last = index === questions.length - 1;
  const heading = useRef<HTMLSpanElement>(null);
  const previous = useRef(index);
  useEffect(() => {
    if (previous.current !== index) heading.current?.focus();
    previous.current = index;
  }, [index]);
  return (
    <form
      className="chat-questions"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || currentAnswer === null) return;
        if (!last) onNavigate(index + 1);
        else if (answer !== null) onRespond(answer);
      }}
    >
      {question
        ? (() => {
            const draft = drafts.get(question.id) ?? EMPTY_QUESTION_DRAFT;
            const inputId = `${formId}-${index}`;
            return (
              <fieldset
                className="chat-question"
                key={question.id}
                disabled={busy}
                data-testid="question-group"
                data-test-question-id={question.id}
              >
                <legend className="chat-question-legend">
                  <span ref={heading} tabIndex={-1}>
                    {question.question}
                  </span>
                </legend>
                <p className="ui-muted chat-question-hint">
                  {questions.length > 1 ? `Question ${index + 1} of ${questions.length}. ` : ""}
                  {question.options.length === 0
                    ? "Write your answer."
                    : question.multi_select
                      ? "Choose one or more."
                      : "Choose one."}
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
                    {question.options.length === 0
                      ? "Your answer"
                      : question.multi_select
                        ? "Other answer (optional)"
                        : "Or write your own answer"}
                    <input
                      className="g-input"
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
          })()
        : null}
      <div className="ui-row">
        {index > 0 ? (
          <button
            type="button"
            className="g-button"
            data-testid="question-back"
            disabled={busy}
            onClick={() => onNavigate(index - 1)}
          >
            Back
          </button>
        ) : null}
        <button
          type="submit"
          className="g-button g-button-primary"
          data-testid="question-submit"
          disabled={busy || currentAnswer === null || (last && answer === null)}
        >
          {last ? "Submit answers" : "Next"}
        </button>
        <button
          type="button"
          className="g-button g-button-ghost"
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
