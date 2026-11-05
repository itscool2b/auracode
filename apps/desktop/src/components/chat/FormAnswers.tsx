import { useId, useRef, useState } from "react";
import type { UiAnswer, UiField } from "../../bindings";
import {
  type FieldDraft,
  type FormDrafts,
  formAnswer,
  initialDrafts,
  pickChoice,
} from "../../lib/chat/forms";
import { safeHref } from "../../lib/markdown";

/** Says which MCP server asks, under the request's own heading. */
function Source({ source }: { readonly source: string | null }) {
  return source ? (
    <p className="ui-muted chat-question-hint" data-testid="form-source">
      From the {source} MCP server.
    </p>
  ) : null;
}

const INPUT_TYPE = {
  email: "email",
  uri: "url",
  date: "date",
  date_time: "datetime-local",
} as const;

/**
 * An MCP server's form: each field as its kind asks, Submit once every field fits (each mistake
 * shows at its field), Decline to refuse, and Dismiss to cancel. Never answered automatically.
 */
export function FormAnswers({
  source,
  fields,
  busy,
  onRespond,
}: {
  readonly source: string | null;
  readonly fields: readonly UiField[];
  readonly busy: boolean;
  readonly onRespond: (answer: UiAnswer | null) => void;
}) {
  const formId = useId();
  const [drafts, setDrafts] = useState<FormDrafts>(() => initialDrafts(fields));
  const [checked, setChecked] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const { answer, errors } = formAnswer(fields, drafts);
  const change = (id: string, draft: FieldDraft) =>
    setDrafts((current) => new Map(current).set(id, draft));
  return (
    <form
      ref={form}
      className="chat-questions chat-form"
      noValidate
      data-testid="question-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        if (answer !== null) {
          onRespond(answer);
          return;
        }
        // Show every mistake, then go to the first.
        setChecked(true);
        const first = fields.find((field) => errors.has(field.id));
        if (first)
          form.current
            ?.querySelector<HTMLElement>(
              `[data-field="${CSS.escape(first.id)}"] :is(input, select)`,
            )
            ?.focus();
      }}
    >
      <Source source={source} />
      {fields.map((field, index) => {
        const id = `${formId}-${index}`;
        const error = checked ? (errors.get(field.id) ?? null) : null;
        return (
          <Field
            key={field.id}
            id={id}
            field={field}
            draft={drafts.get(field.id)}
            error={error}
            busy={busy}
            onChange={(draft) => change(field.id, draft)}
          />
        );
      })}
      <div className="ui-row">
        <button
          type="submit"
          className="g-button g-button-primary"
          data-testid="question-submit"
          disabled={busy}
        >
          Submit
        </button>
        <button
          type="button"
          className="g-button"
          data-testid="question-decline"
          disabled={busy}
          onClick={() => onRespond({ type: "form", accept: false, values: [] })}
        >
          Decline
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

function Field({
  id,
  field,
  draft,
  error,
  busy,
  onChange,
}: {
  readonly id: string;
  readonly field: UiField;
  readonly draft: FieldDraft | undefined;
  readonly error: string | null;
  readonly busy: boolean;
  readonly onChange: (draft: FieldDraft) => void;
}) {
  const label = (
    <>
      {field.label}
      {field.required ? null : <span className="ui-muted"> (optional)</span>}
    </>
  );
  const notes = [field.description ? `${id}-note` : null, error ? `${id}-error` : null].filter(
    Boolean,
  );
  const describedBy = notes.length ? notes.join(" ") : undefined;
  const after = (
    <>
      {field.description ? (
        <p className="chat-form-note" id={`${id}-note`}>
          {field.description}
        </p>
      ) : null}
      {error ? (
        <p className="ui-error chat-form-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
  const kind = field.kind;
  switch (kind.type) {
    case "text":
    case "number":
      return (
        <div className="chat-form-field" data-field={field.id}>
          <label className="ui-field" htmlFor={id}>
            <span>{label}</span>
            <input
              id={id}
              className="g-input"
              type={
                kind.type === "number" ? "number" : kind.format ? INPUT_TYPE[kind.format] : "text"
              }
              step={kind.type === "number" ? (kind.integer ? 1 : "any") : undefined}
              min={kind.type === "number" ? (kind.minimum ?? undefined) : undefined}
              max={kind.type === "number" ? (kind.maximum ?? undefined) : undefined}
              maxLength={kind.type === "text" ? (kind.max_length ?? undefined) : undefined}
              value={draft?.kind === "text" ? draft.text : ""}
              required={field.required}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              disabled={busy}
              data-testid="form-input"
              data-test-field={field.id}
              onChange={(event) => onChange({ kind: "text", text: event.currentTarget.value })}
            />
          </label>
          {after}
        </div>
      );
    case "boolean":
      return (
        <div className="chat-form-field" data-field={field.id}>
          <label className="chat-question-option">
            <input
              type="checkbox"
              checked={draft?.kind === "flag" && draft.value === true}
              aria-describedby={describedBy}
              disabled={busy}
              data-testid="form-input"
              data-test-field={field.id}
              onChange={(event) => onChange({ kind: "flag", value: event.currentTarget.checked })}
            />
            {/* A checkbox can always be left unticked, so it says nothing of being optional. */}
            <span className="chat-question-option-copy">
              <span>{field.label}</span>
            </span>
          </label>
          {after}
        </div>
      );
    case "choice":
      return (
        <fieldset
          className="chat-question chat-form-field"
          data-field={field.id}
          aria-describedby={describedBy}
          disabled={busy}
        >
          <legend className="chat-form-label">{label}</legend>
          <div className="chat-question-options">
            {kind.options.map((option, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the answer is the option's position.
              <label className="chat-question-option" key={index}>
                <input
                  type={kind.multiple ? "checkbox" : "radio"}
                  name={id}
                  checked={draft?.kind === "choices" && draft.selected.includes(index)}
                  disabled={busy}
                  data-testid="form-choice"
                  data-test-field={field.id}
                  data-test-index={index}
                  onChange={() => onChange(pickChoice(field, draft, index))}
                />
                <span className="chat-question-option-copy">
                  <span>{option}</span>
                </span>
              </label>
            ))}
          </div>
          {after}
        </fieldset>
      );
  }
}

/**
 * An MCP server asks the person to finish something in the browser. Open in browser opens the
 * address (http or https only, through the opener as every link does) and accepts; Decline
 * refuses; Dismiss cancels. The host is set apart, so where it leads reads at a glance.
 */
export function LinkAnswers({
  source,
  url,
  busy,
  onRespond,
}: {
  readonly source: string | null;
  readonly url: string;
  readonly busy: boolean;
  readonly onRespond: (answer: UiAnswer | null) => void;
}) {
  const href = safeHref(url);
  const parsed = (() => {
    try {
      return href ? new URL(href) : null;
    } catch {
      return null;
    }
  })();
  return (
    <div className="chat-questions">
      <Source source={source} />
      <p className="chat-link-target" title={url} data-testid="link-target">
        {parsed ? (
          <>
            <strong>{parsed.host}</strong>
            <span>{`${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`}</span>
          </>
        ) : (
          url
        )}
      </p>
      <div className="ui-row">
        {href ? (
          <a
            className="g-button g-button-primary"
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            aria-disabled={busy ? true : undefined}
            data-testid="question-open"
            onClick={(event) => {
              if (busy) {
                event.preventDefault();
                return;
              }
              onRespond({ type: "confirm", yes: true });
            }}
          >
            Open in browser
          </a>
        ) : null}
        <button
          type="button"
          className="g-button"
          data-testid="question-decline"
          disabled={busy}
          onClick={() => onRespond({ type: "confirm", yes: false })}
        >
          Decline
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
    </div>
  );
}
