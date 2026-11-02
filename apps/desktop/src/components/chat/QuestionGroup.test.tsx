import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UiQuestion } from "../../bindings";
import type { QuestionDrafts } from "../../lib/chat/questions";
import { QuestionCard } from "./QuestionCard";
import { QuestionGroup, QuestionGroupForm } from "./QuestionGroup";

const questions: [UiQuestion, UiQuestion] = [
  {
    id: "q0",
    header: "Format",
    question: "How should I format the output?",
    options: [
      { label: "Summary", description: "Brief overview of the key points." },
      { label: "Detailed", description: "Include examples." },
    ],
    multi_select: false,
    allow_free_text: true,
  },
  {
    id: "q1",
    header: "Sections",
    question: "Which sections should I include?",
    options: [
      { label: "Tests", description: "Verification results." },
      { label: "Risks", description: "Open limitations." },
    ],
    multi_select: true,
    allow_free_text: true,
  },
];

const drafts: QuestionDrafts = new Map([
  ["q0", { selected: [1], text: "" }],
  ["q1", { selected: [0, 1], text: "Next steps too" }],
]);

describe("grouped question cards", () => {
  it("shows only the first question with its full options and no implicit selection", () => {
    const onRespond = vi.fn();
    const html = renderToStaticMarkup(
      <QuestionGroup questions={questions} busy={false} onRespond={onRespond} />,
    );
    for (const question of questions.slice(0, 1)) {
      expect(html).toContain(`data-test-question-id="${question.id}"`);
      expect(html).toContain(question.question);
      for (const option of question.options) {
        expect(html).toContain(option.label);
        expect(html).toContain(option.description);
      }
    }
    expect(html).not.toContain(questions[1].question);
    expect(html).toContain("Question 1 of 2.");
    expect(html).toContain("Next");
    expect(html.match(/<fieldset/g)).toHaveLength(1);
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html).not.toContain('type="checkbox"');
    expect(html.match(/data-testid="question-free-text"/g)).toHaveLength(1);
    expect(html).not.toContain('checked=""');
    expect(html).toMatch(/data-testid="question-submit" disabled=""/);
    expect(onRespond).not.toHaveBeenCalled();
  });

  it("enables submission only after all questions have answers and disables all input while sending", () => {
    const render = (busy: boolean, current: QuestionDrafts, questionIndex = 1) =>
      renderToStaticMarkup(
        <QuestionGroupForm
          questions={questions}
          drafts={current}
          questionIndex={questionIndex}
          onNavigate={vi.fn()}
          busy={busy}
          onChange={vi.fn()}
          onRespond={vi.fn()}
        />,
      );
    const partial = render(false, new Map([["q0", { selected: [0], text: "" }]]));
    expect(partial).toMatch(/data-testid="question-submit" disabled=""/);
    const missingFirst = render(false, new Map([["q1", { selected: [0], text: "" }]]));
    expect(missingFirst).toMatch(/data-testid="question-submit" disabled=""/);
    const first = render(false, new Map([["q0", { selected: [0], text: "" }]]), 0);
    expect(first).not.toMatch(/data-testid="question-submit" disabled=""/);
    expect(first).not.toContain('data-testid="question-back"');
    const complete = render(false, drafts);
    expect(complete).toContain('value="Next steps too"');
    expect(complete.match(/checked=""/g)).toHaveLength(2);
    expect(complete).toContain("Question 2 of 2.");
    expect(complete).toContain('data-testid="question-back"');
    expect(complete).not.toMatch(/data-testid="question-submit" disabled=""/);
    const busy = render(true, drafts);
    expect(busy.match(/<fieldset[^>]*disabled=""/g)).toHaveLength(1);
    expect(busy).toMatch(/data-testid="question-submit" disabled=""/);
    expect(busy).toMatch(/data-testid="question-dismiss" disabled=""/);
    expect(busy).toMatch(/data-testid="question-back" disabled=""/);
  });

  it("honors questions without free text and renders agent content as text", () => {
    const html = renderToStaticMarkup(
      <QuestionGroup
        questions={[
          {
            ...questions[0],
            allow_free_text: false,
            question: "<script>unsafe</script>",
          },
        ]}
        busy={false}
        onRespond={vi.fn()}
      />,
    );
    expect(html).not.toContain('data-testid="question-free-text"');
    expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("keeps each resolved answer with its question and closes withdrawn requests", () => {
    const item = {
      kind: "question" as const,
      key: "question:r1",
      request: {
        request_id: "r1",
        prompt: { type: "questions" as const, message: "Clarify the report", questions },
      },
      resolution: null,
    };
    const resolved = renderToStaticMarkup(
      <QuestionCard
        item={{
          ...item,
          resolution: {
            by: "user",
            answer: {
              type: "questions",
              answers: [
                { question_id: "q1", selected: [0, 1], text: "Next steps too" },
                { question_id: "q0", selected: [1], text: null },
              ],
            },
          },
        }}
        request={undefined}
        onRespond={vi.fn()}
      />,
    );
    expect(resolved).toContain("Which sections should I include?: Tests, Risks, Next steps too");
    expect(resolved).toContain("How should I format the output?: Detailed");
    expect(resolved).not.toContain("<input");
    const gone = renderToStaticMarkup(
      <QuestionCard
        item={item}
        request={{ busy: false, gone: true, error: null }}
        onRespond={vi.fn()}
      />,
    );
    expect(gone).toContain("no longer waiting for an answer");
    expect(gone).not.toContain("<input");
  });
});
