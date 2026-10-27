import { describe, expect, it } from "vitest";
import type { UiQuestion } from "../../bindings";
import {
  chooseQuestionOption,
  EMPTY_QUESTION_DRAFT,
  type QuestionDraft,
  questionsAnswer,
  writeQuestionText,
} from "./questions";

const single: UiQuestion = {
  id: "format",
  header: "Format",
  question: "Which format should I use?",
  options: [
    { label: "Summary", description: "A brief overview." },
    { label: "Detailed", description: "Include examples." },
  ],
  multi_select: false,
  allow_free_text: true,
};
const multiple: UiQuestion = { ...single, id: "sections", multi_select: true };

describe("grouped question input", () => {
  it("has no implicit selections and waits for every distinct question", () => {
    expect(questionsAnswer([single, multiple], new Map())).toBeNull();
    const one = new Map([[single.id, chooseQuestionOption(single, EMPTY_QUESTION_DRAFT, 0)]]);
    expect(questionsAnswer([single, multiple], one)).toBeNull();
    one.set(multiple.id, chooseQuestionOption(multiple, EMPTY_QUESTION_DRAFT, 1));
    expect(questionsAnswer([single, multiple], one)).toEqual({
      type: "questions",
      answers: [
        { question_id: "format", selected: [0], text: null },
        { question_id: "sections", selected: [1], text: null },
      ],
    });
  });

  it("keeps a radio choice and a custom answer mutually exclusive", () => {
    const selected = chooseQuestionOption(single, EMPTY_QUESTION_DRAFT, 0);
    expect(chooseQuestionOption(single, selected, 1)).toEqual({ selected: [1], text: "" });
    const written = writeQuestionText(single, selected, "Use a table");
    expect(written).toEqual({ selected: [], text: "Use a table" });
    expect(questionsAnswer([single], new Map([[single.id, written]]))?.answers[0]).toEqual({
      question_id: "format",
      selected: [],
      text: "Use a table",
    });
    expect(chooseQuestionOption(single, written, 0)).toEqual(selected);
  });

  it("toggles multiple choices independently and keeps custom text", () => {
    let draft = writeQuestionText(multiple, EMPTY_QUESTION_DRAFT, "Also mention risks");
    draft = chooseQuestionOption(multiple, draft, 1);
    draft = chooseQuestionOption(multiple, draft, 0);
    expect(questionsAnswer([multiple], new Map([[multiple.id, draft]]))?.answers[0]).toEqual({
      question_id: "sections",
      selected: [0, 1],
      text: "Also mention risks",
    });
    expect(chooseQuestionOption(multiple, draft, 1)).toEqual({
      selected: [0],
      text: "Also mention risks",
    });
  });

  it("rejects blank, duplicate, out-of-range and conflicting answers before submission", () => {
    const invalid: QuestionDraft[] = [
      { selected: [], text: " \n\t " },
      { selected: [0, 0], text: "" },
      { selected: [2], text: "" },
      { selected: [-1], text: "" },
      { selected: [0.5], text: "" },
      { selected: [Number.NaN], text: "" },
      { selected: [0, 1], text: "" },
      { selected: [0], text: "another answer" },
    ];
    for (const draft of invalid) {
      expect(questionsAnswer([single], new Map([[single.id, draft]]))).toBeNull();
    }
    expect(questionsAnswer([], new Map())).toBeNull();
    expect(questionsAnswer([single, single], new Map())).toBeNull();
    expect(questionsAnswer([{ ...single, id: "" }], new Map())).toBeNull();
    const restricted = { ...single, allow_free_text: false };
    expect(writeQuestionText(restricted, EMPTY_QUESTION_DRAFT, "custom")).toBe(
      EMPTY_QUESTION_DRAFT,
    );
    expect(
      questionsAnswer([restricted], new Map([[single.id, { selected: [], text: "custom" }]])),
    ).toBeNull();
  });
});
