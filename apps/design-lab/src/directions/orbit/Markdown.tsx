import { ArrowUpRight, Check, Copy } from "lucide-react";
import { Fragment, memo, type ReactNode, useEffect, useRef, useState } from "react";
import {
  type Inline,
  type ListItem,
  type MarkdownBlock,
  type MarkdownBlockNode,
  parseInline,
  parseMarkdown,
} from "../../kit";
import { type Token, tokenizeLine } from "./syntax";
import { closeOpenInline, languageLabel, splitWords } from "./text";
import { useReduced } from "./ui";

/*
 * Agent prose, bare on the pane (visual-language.md 4.4): paragraphs at 14/22, square bullets,
 * bold lead-ins with the rest of the item muted (Grok), ink links, inline code on a faint fill,
 * file references as chips, code blocks in a well with a header. No italics anywhere: emphasis is
 * weight. While a message streams, each new word fades in over 300ms; nothing already on screen
 * moves or re-wraps.
 */

const FILE_REF = /^[\w@.-]+(?:\/[\w@.-]+)*\.(?:ts|tsx|js|mjs|rs|json|md|css|toml|sh)(?::\d+)?$/;

/** Renders inline nodes; inside a growing block, text arrives word by word. */
function renderInline(
  nodes: readonly Inline[],
  words: WordState | null,
  keyPrefix: string,
): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}${index}`;
    switch (node.kind) {
      case "text":
        return words ? <Fragment key={key}>{renderWords(node.text, words)}</Fragment> : node.text;
      case "code": {
        if (words) words.offset += node.text.length;
        if (FILE_REF.test(node.text)) {
          return (
            <span key={key} className="o-file-ref" title={`Open ${node.text}`}>
              {node.text}
              <ArrowUpRight size={10} strokeWidth={1.75} aria-hidden="true" />
            </span>
          );
        }
        return (
          <code key={key} className="o-inline-code">
            {node.text}
          </code>
        );
      }
      case "strong":
        return (
          <strong key={key} className="o-strong">
            {renderInline(node.children, words, `${key}.`)}
          </strong>
        );
      case "em":
        // Orbit has no italics: emphasis is weight.
        return (
          <span key={key} className="o-em">
            {renderInline(node.children, words, `${key}.`)}
          </span>
        );
      case "link":
        return (
          <a key={key} className="o-link" href={node.href} target="_blank" rel="noreferrer">
            {renderInline(node.children, words, `${key}.`)}
          </a>
        );
      default:
        return null;
    }
  });
}

/** Tracks where in a growing block the words are, and which ones are new since the last render. */
interface WordState {
  offset: number;
  /** Characters already shown before this render: words past this fade in. */
  readonly shown: number;
  newIndex: number;
  readonly reduced: boolean;
}

/** Splits text into word spans; words past what was already shown fade in, staggered 8ms. */
function renderWords(text: string, state: WordState): ReactNode[] {
  const base = state.offset;
  state.offset += text.length;
  return splitWords(text, base).map((word) => {
    const fresh = !state.reduced && word.key >= state.shown;
    const delay = fresh ? Math.min(120, state.newIndex++ * 8) : 0;
    return (
      <span
        key={word.key}
        className={fresh ? "o-word" : undefined}
        style={fresh && delay > 0 ? { animationDelay: `${delay}ms` } : undefined}
      >
        {word.text}
      </span>
    );
  });
}

/** A list item: a bold lead-in stays bright, the rest of the item is muted. */
function itemContent(item: ListItem, words: WordState | null): ReactNode {
  const nodes = parseInline(item.text);
  const [first, ...rest] = nodes;
  if (first?.kind === "strong" && rest.length > 0) {
    return (
      <>
        {renderInline([first], words, "lead")}
        <span className="o-li-rest">{renderInline(rest, words, "rest")}</span>
      </>
    );
  }
  return <>{renderInline(nodes, words, "i")}</>;
}

function CodeLine({ tokens }: { readonly tokens: readonly Token[] }) {
  if (tokens.length === 0) return <>{"\n"}</>;
  return (
    <>
      {tokens.map((token, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional within a line.
        <span key={index} className="o-tok" data-kind={token.kind}>
          {token.text}
        </span>
      ))}
      {"\n"}
    </>
  );
}

/** A copy button that says "Copied" with a check for 1.2s. */
export function CopyButton({
  text,
  label = "Copy",
}: {
  readonly text: string;
  readonly label?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="o-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).catch(() => {});
        setCopied(true);
      }}
    >
      {copied ? (
        <Check size={12} strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <Copy size={12} strokeWidth={1.5} aria-hidden="true" />
      )}
      {copied ? "Copied" : label}
    </button>
  );
}

/** A fenced code block: language and Copy in a 30px header, then the code in the palette. */
export function CodeBlock({ code, lang }: { readonly code: string; readonly lang: string }) {
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <div className="o-codeblock">
      <div className="o-codeblock-head">
        <span className="o-t-caps o-c3">{languageLabel(lang) || "Code"}</span>
        <CopyButton text={code} />
      </div>
      <pre className="o-codeblock-body o-scroll">
        <code>
          {lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional.
            <CodeLine key={index} tokens={tokenizeLine(line, lang)} />
          ))}
        </code>
      </pre>
    </div>
  );
}

/** One block; `words` is set for the growing block, whose text arrives word by word. */
function renderBlock(block: MarkdownBlockNode, words: WordState | null): ReactNode {
  switch (block.kind) {
    case "heading": {
      const content = renderInline(parseInline(block.text), words, "h");
      return block.level <= 2 ? (
        <h3 className="o-md-h">{content}</h3>
      ) : (
        <h4 className="o-md-h3">{content}</h4>
      );
    }
    case "paragraph":
      return <p className="o-md-p">{renderInline(parseInline(block.text), words, "p")}</p>;
    case "code":
      return <CodeBlock code={block.code} lang={block.lang} />;
    case "list": {
      const items = block.items.map((item, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: items only append while streaming.
          key={index}
          className="o-md-li"
          style={item.depth > 0 ? { marginLeft: item.depth * 18 } : undefined}
        >
          {itemContent(item, words)}
        </li>
      ));
      return block.ordered ? (
        <ol className="o-md-ol" start={block.start}>
          {items}
        </ol>
      ) : (
        <ul className="o-md-ul">{items}</ul>
      );
    }
    case "quote":
      return (
        <blockquote className="o-md-quote">
          {renderInline(parseInline(block.text), words, "q")}
        </blockquote>
      );
    case "table":
      return (
        <div className="o-md-table-wrap o-scroll">
          <table className="o-md-table">
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th
                    // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
                    key={index}
                    style={{ textAlign: block.align[index] ?? undefined }}
                  >
                    {renderInline(parseInline(cell), null, `th${index}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional.
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td
                      // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
                      key={index}
                      style={{ textAlign: block.align[index] ?? undefined }}
                    >
                      {renderInline(parseInline(cell), null, `td${index}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rule":
      return <div className="o-tear o-md-rule" aria-hidden="true" />;
    default:
      return null;
  }
}

const FinishedBlock = memo(function FinishedBlock({ block }: { readonly block: MarkdownBlock }) {
  return <>{renderBlock(block.block, null)}</>;
});

/** The growing last block: remembers how much it had shown, so only new words fade in. */
function GrowingBlock({ block }: { readonly block: MarkdownBlock }) {
  const reduced = useReduced();
  const shown = useRef(0);
  const words: WordState = { offset: 0, shown: shown.current, newIndex: 0, reduced };
  const content = renderBlock(block.block, words);
  const total = words.offset;
  useEffect(() => {
    shown.current = total;
  }, [total]);
  return <>{content}</>;
}

/** A message's markdown; `streaming` repairs open inline markers and fades new words in. */
export const Markdown = memo(function Markdown({
  text,
  streaming = false,
}: {
  readonly text: string;
  readonly streaming?: boolean;
}) {
  const blocks = parseMarkdown(streaming ? closeOpenInline(text) : text, streaming);
  return (
    <div className="o-md">
      {blocks.map((block) =>
        block.growing ? (
          <GrowingBlock key={block.key} block={block} />
        ) : (
          <FinishedBlock key={block.key} block={block} />
        ),
      )}
    </div>
  );
});
