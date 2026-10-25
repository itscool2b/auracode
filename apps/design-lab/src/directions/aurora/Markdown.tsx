import { Check, Copy } from "lucide-react";
import { Fragment, memo, type ReactNode, useMemo, useRef, useState } from "react";
import {
  type Inline,
  type MarkdownBlockNode,
  parseInline,
  parseMarkdown,
  plainText,
} from "../../kit";
import { Glass } from "./Glass";
import { languageOf, tokenizeLine } from "./highlight";
import { closeOpenMarkers, type Ink, useInk } from "./ink";
import { cx, useBornLive } from "./ui";

/**
 * Agent markdown, rendered block by block. Finished blocks never change; the growing one inks in
 * delta by delta (see ink.ts), so earlier lines never move or re-render visibly.
 */
export const Markdown = memo(function Markdown({
  text,
  streaming,
  tone,
  caret = false,
}: {
  readonly text: string;
  readonly streaming: boolean;
  readonly tone?: "thought";
  /** Shows a glowing ember where the text is still arriving. */
  readonly caret?: boolean;
}) {
  const blocks = useMemo(() => parseMarkdown(text, streaming), [text, streaming]);
  return (
    <div className={cx("au-md", tone === "thought" && "au-md-thought")}>
      {blocks.map((entry) => (
        <BlockView
          key={entry.key}
          block={entry.block}
          growing={entry.growing}
          caret={caret && entry.growing}
        />
      ))}
    </div>
  );
});

const BlockView = memo(
  function BlockView({
    block,
    growing,
    caret,
  }: {
    readonly block: MarkdownBlockNode;
    readonly growing: boolean;
    readonly caret: boolean;
  }) {
    const ember = caret ? <span className="au-caret" aria-hidden="true" /> : null;
    const live = useBornLive();
    const settle = (text: string): string => (growing ? closeOpenMarkers(text) : text);
    const enter = live ? "au-block-enter" : undefined;
    switch (block.kind) {
      case "heading":
        return (
          <p className={cx("au-h", enter)} data-level={Math.min(block.level, 3)}>
            <InkInline text={settle(block.text)} />
            {ember}
          </p>
        );
      case "paragraph":
        return (
          <p className={cx("au-p", enter)}>
            <InkInline text={settle(block.text)} />
            {ember}
          </p>
        );
      case "quote":
        return (
          <blockquote className={cx("au-quote", enter)}>
            <InkInline text={settle(block.text)} />
          </blockquote>
        );
      case "list": {
        const Tag = block.ordered ? "ol" : "ul";
        const last = block.items.length - 1;
        return (
          <Tag className={cx("au-list", enter)} start={block.ordered ? block.start : undefined}>
            {block.items.map((item, index) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: items only ever append while streaming.
                key={index}
                className="au-li"
                data-depth={Math.min(item.depth, 3)}
                data-task={item.checked === null ? undefined : item.checked ? "done" : "open"}
              >
                {item.checked !== null ? (
                  <span className="au-task-box" aria-hidden="true">
                    {item.checked ? <Check size={10} strokeWidth={3} /> : null}
                  </span>
                ) : null}
                <span className="au-li-text">
                  <InkInline text={growing && index === last ? settle(item.text) : item.text} />
                  {index === last ? ember : null}
                </span>
              </li>
            ))}
          </Tag>
        );
      }
      case "code":
        return <CodeBlock lang={block.lang} code={block.code} closed={block.closed} />;
      case "table":
        return (
          <div className={cx("au-table-wrap", enter)}>
            <table className="au-table">
              <thead>
                <tr>
                  {block.header.map((cell, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
                    <th key={index} style={{ textAlign: block.align[index] ?? undefined }}>
                      <InlineStatic text={cell} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional.
                  <tr key={rowIndex}>
                    {row.map((cell, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
                      <td key={index} style={{ textAlign: block.align[index] ?? undefined }}>
                        <InlineStatic text={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "rule":
        return <hr className="au-rule" />;
    }
  },
  (a, b) =>
    a.growing === b.growing &&
    a.caret === b.caret &&
    blockSignature(a.block) === blockSignature(b.block),
);

function blockSignature(block: MarkdownBlockNode): string {
  switch (block.kind) {
    case "heading":
    case "paragraph":
    case "quote":
      return `${block.kind}:${block.text}`;
    case "list":
      return `list:${block.ordered}:${block.items.map((item) => item.text).join("\n")}`;
    case "code":
      return `code:${block.closed}:${block.code}`;
    case "table":
      return `table:${JSON.stringify(block.rows)}`;
    case "rule":
      return "rule";
  }
}

/** Inline markdown that inks in as it grows. */
function InkInline({ text }: { readonly text: string }) {
  const nodes = useMemo(() => parseInline(text), [text]);
  const length = useMemo(() => plainText(nodes).length, [nodes]);
  const ink = useInk(length);
  return <>{renderNodes(nodes, ink, { offset: 0 })}</>;
}

/** Inline markdown without the ink (table cells). */
function InlineStatic({ text }: { readonly text: string }) {
  const nodes = useMemo(() => parseInline(text), [text]);
  return <>{renderNodes(nodes, { oldEnd: Number.POSITIVE_INFINITY, starts: [] }, { offset: 0 })}</>;
}

function renderNodes(nodes: readonly Inline[], ink: Ink, cursor: { offset: number }): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "text":
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: inline nodes are positional and only append.
          <Fragment key={index}>{splitInk(node.text, ink, cursor)}</Fragment>
        );
      case "code":
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: as above.
          <code key={index} className="au-icode">
            {splitInk(node.text, ink, cursor)}
          </code>
        );
      case "strong":
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: as above.
          <strong key={index}>{renderNodes(node.children, ink, cursor)}</strong>
        );
      case "em":
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: as above.
          <em key={index}>{renderNodes(node.children, ink, cursor)}</em>
        );
      case "link":
        return (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: as above.
            key={index}
            className="au-link"
            href={node.href}
            target="_blank"
            rel="noreferrer"
          >
            {renderNodes(node.children, ink, cursor)}
          </a>
        );
      default:
        return null;
    }
  });
}

/** Text before `oldEnd` as is; each later delta in its own keyed span that inks in once. */
function splitInk(text: string, ink: Ink, cursor: { offset: number }): ReactNode[] {
  const start = cursor.offset;
  const end = start + text.length;
  cursor.offset = end;
  const out: ReactNode[] = [];
  const oldEnd = Math.min(ink.oldEnd, end);
  if (oldEnd > start) out.push(text.slice(0, oldEnd - start));
  for (let index = 0; index < ink.starts.length; index += 1) {
    const segmentStart = ink.starts[index] ?? 0;
    const segmentEnd = ink.starts[index + 1] ?? Number.POSITIVE_INFINITY;
    const from = Math.max(segmentStart, start, oldEnd);
    const to = Math.min(segmentEnd, end);
    if (from < to) {
      out.push(
        <span key={segmentStart} className="au-ink">
          {text.slice(from - start, to - start)}
        </span>,
      );
    }
  }
  return out;
}

/** Highlighted code lines; lines that arrive after mount ink in. */
export function CodeLines({
  code,
  lang,
  inkNew = true,
}: {
  readonly code: string;
  readonly lang: string;
  readonly inkNew?: boolean;
}) {
  const lines = code.split("\n");
  const live = useBornLive();
  const firstNew = useRef(live ? 0 : lines.length).current;
  const language = languageOf(lang);
  return (
    <>
      {lines.map((line, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: code lines only append while streaming.
          key={index}
          className={cx("au-code-line", inkNew && index >= firstNew && "au-ink-line")}
        >
          {line === "" ? " " : <Tokens line={line} language={language} />}
          {"\n"}
        </span>
      ))}
    </>
  );
}

export const Tokens = memo(function Tokens({
  line,
  language,
}: {
  readonly line: string;
  readonly language: ReturnType<typeof languageOf>;
}) {
  const tokens = useMemo(() => tokenizeLine(line, language), [line, language]);
  return (
    <>
      {tokens.map((token, index) =>
        token.kind === "text" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional.
          <Fragment key={index}>{token.text}</Fragment>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional.
          <span key={index} className={`au-tok-${token.kind}`}>
            {token.text}
          </span>
        ),
      )}
    </>
  );
});

function CodeBlock({
  lang,
  code,
  closed,
}: {
  readonly lang: string;
  readonly code: string;
  readonly closed: boolean;
}) {
  const live = useBornLive();
  return (
    <Glass level={0} radius={12} className={cx("au-codeblock", live && "au-block-enter")}>
      <div className="au-codeblock-head">
        <span className="au-codeblock-lang">{lang || "code"}</span>
        {closed ? <CopyButton text={code} /> : <span className="au-codeblock-live">Writing</span>}
      </div>
      <pre className="au-codeblock-body">
        <code>
          <CodeLines code={code} lang={lang} />
        </code>
      </pre>
    </Glass>
  );
}

export function CopyButton({
  text,
  label = "Copy",
}: {
  readonly text: string;
  readonly label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="au-copy"
      aria-label={copied ? "Copied" : label}
      data-tip={copied ? "Copied" : label}
      data-tip-side="left"
      onClick={() => {
        void navigator.clipboard?.writeText(text).catch(() => {});
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
    >
      {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={2} />}
    </button>
  );
}
