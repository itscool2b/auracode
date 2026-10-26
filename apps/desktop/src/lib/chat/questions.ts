import type { UiAnswer, UiQuestion, UiQuestionAnswer } from "../../bindings";

/** Unsubmitted input stays local to the question card. No option is selected by default. */
export interface QuestionDraft {
  readonly selected: readonly number[];
  readonly text: string;
}

export type QuestionDrafts = ReadonlyMap<string, QuestionDraft>;

export const EMPTY_QUESTION_DRAFT: QuestionDraft = { selected: [], text: "" };

/** Radio choices replace free text; checkbox choices preserve the other selected answers. */
export function chooseQuestionOption(
  question: UiQuestion,
  draft: QuestionDraft,
  index: number,
): QuestionDraft {
  if (!Number.isInteger(index) || index < 0 || index >= question.options.length) return draft;
  if (!question.multi_select) return { selected: [index], text: "" };
  const selected = draft.selected.includes(index)
    ? draft.selected.filter((value) => value !== index)
    : [...draft.selected, index].sort((a, b) => a - b);
  return { ...draft, selected };
}

/** A single-select free-text answer replaces its radio choice. */
export function writeQuestionText(
  question: UiQuestion,
  draft: QuestionDraft,
  text: string,
): QuestionDraft {
  if (!question.allow_free_text) return draft;
  return { selected: question.multi_select ? draft.selected : [], text };
}

/** Form validation only; Rust validates the submitted answer against the pending request too. */
export function questionsAnswer(
  questions: readonly UiQuestion[],
  drafts: QuestionDrafts,
): Extract<UiAnswer, { type: "questions" }> | null {
  if (
    questions.length === 0 ||
    new Set(questions.map((question) => question.id)).size !== questions.length
  ) {
    return null;
  }
  const answers: UiQuestionAnswer[] = [];
  for (const question of questions) {
    if (question.id.length === 0) return null;
    const draft = drafts.get(question.id) ?? EMPTY_QUESTION_DRAFT;
    const text = draft.text.trim().length === 0 ? null : draft.text;
    if (text !== null && !question.allow_free_text) return null;
    if (new Set(draft.selected).size !== draft.selected.length) return null;
    if (
      draft.selected.some(
        (index) => !Number.isInteger(index) || index < 0 || index >= question.options.length,
      )
    ) {
      return null;
    }
    const count = draft.selected.length + Number(text !== null);
    if (count === 0 || (!question.multi_select && count !== 1)) return null;
    answers.push({
      question_id: question.id,
      selected: [...draft.selected].sort((a, b) => a - b),
      text,
    });
  }
  return { type: "questions", answers };
}
