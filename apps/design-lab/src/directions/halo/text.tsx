import { Check, Copy } from "lucide-react";
import {
  type CSSProperties,
  Fragment,
  memo,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Inline,
  type ListItem,
  type MarkdownBlockNode,
  parseInline,
  parseMarkdown,
  plainText,
} from "../../kit";
import { cx, useEntrance } from "./primitives";
import { highlight } from "./syntax";

/*
 * Streaming text, the Halo way: text already on screen never moves or flickers, and each delta
 * that arrives "inks in" with a short fade. The last few deltas of a block are kept as their own
 * spans (each fading from when it arrived); older ones merge back into plain text once they are
 * fully opaque, so a long message stays a handful of DOM nodes.
 */

/** How many recent deltas keep their own fading span. */
const FRESH_DELTAS = 4;

interface InkPlan {
  /** Plain-text offset before which everything is at rest. */
  readonly settledEnd: number;
  /** Recent deltas as [start, end) offsets, oldest first. */
  readonly fresh: readonly (readonly [number, number])[];
}

const NO_INK: InkPlan = { settledEnd: Number.POSITIVE_INFINITY, fresh: [] };

/** Tracks a block's plain-text length across renders and plans which parts are still inking in. */
function useInk(length: number): InkPlan {
  const marks = useRef<number[] | null>(null);
  if (marks.current === null) marks.current = [length];
  const list = marks.current;
  const last = list[list.length - 1] ?? 0;

  useLayoutEffect(() => {
    const current = marks.current;
    if (!current) return;
    const previous = current[current.length - 1] ?? 0;
    if (length > previous) {
      current.push(length);
      if (current.length > FRESH_DELTAS + 1) current.splice(0, current.length - FRESH_DELTAS - 1);
    } else if (length < previous) {
      // The text was replaced (a replay started over): everything on screen is at rest.
      marks.current = [length];
    }
  }, [length]);

  if (length < last) return NO_INK;
  const fresh: [number, number][] = [];
  for (let index = 0; index < list.length; index += 1) {
    const start = list[index] ?? 0;
    const end = index + 1 < list.length ? (list[index + 1] ?? length) : length;
    if (end > start) fresh.push([start, end]);
  }
  return { settledEnd: list[0] ?? length, fresh };
}

/** Writes text leaves in order, wrapping the parts of fresh deltas in fading spans. */
class InkWriter {
  #offset: number;
  readonly #plan: InkPlan;

  constructor(plan: InkPlan, start = 0) {
    this.#plan = plan;
    this.#offset = start;
  }

  text(value: string, key: string): ReactNode {
    const start = this.#offset;
    const end = start + value.length;
    this.#offset = end;
    const { settledEnd, fresh } = this.#plan;
    if (end <= settledEnd || fresh.length === 0) return value;
    const parts: ReactNode[] = [];
    if (start < settledEnd) parts.push(value.slice(0, settledEnd - start));
    for (const [from, to] of fresh) {
      const a = Math.max(from, start);
      const b = Math.min(to, end);
      if (b > a) {
        parts.push(
          <span key={`${key}@${from}`} className="halo-ink">
            {value.slice(a - start, b - start)}
          </span>,
        );
      }
    }
    return parts;
  }
}

function renderInlines(nodes: readonly Inline[], ink: InkWriter, prefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${prefix}.${index}`;
    switch (node.kind) {
      case "text":
        return <Fragment key={key}>{ink.text(node.text, key)}</Fragment>;
      case "code":
        return (
          <code key={key} className="halo-code">
            {ink.text(node.text, key)}
          </code>
        );
      case "strong":
        return <strong key={key}>{renderInlines(node.children, ink, key)}</strong>;
      case "em":
        return <em key={key}>{renderInlines(node.children, ink, key)}</em>;
      case "link":
        return (
          <a key={key} href={node.href} target="_blank" rel="noreferrer">
            {renderInlines(node.children, ink, key)}
          </a>
        );
      default:
        return null;
    }
  });
}

/**
 * Closes inline markers a streaming block has opened but not closed yet, so a half-arrived
 * `**bold` or `` `code `` renders styled at once instead of flashing raw asterisks and backticks.
 * A marker with nothing after it yet is dropped until its text arrives.
 */
export function heal(text: string): string {
  let healed = text.replace(/(\*\*|`)$/, "");
  const ticks = (healed.match(/`/g) ?? []).length;
  if (ticks % 2 === 1) healed += "`";
  const outsideCode = healed.replace(/`[^`]*`/g, "");
  const bold = (outsideCode.match(/\*\*/g) ?? []).length;
  if (bold % 2 === 1) healed += "**";
  return healed;
}

function inlinesOf(text: string, growing: boolean): Inline[] {
  return parseInline(growing ? heal(text) : text);
}

/** Message or thought text as blocks. Finished blocks never re-render while the last one grows. */
export const Markdown = memo(function Markdown({
  text,
  streaming,
  variant = "body",
}: {
  readonly text: string;
  readonly streaming: boolean;
  readonly variant?: "body" | "thought";
}) {
  const blocks = useMemo(() => parseMarkdown(text, streaming), [text, streaming]);
  return (
    <div className="halo-md" data-variant={variant}>
      {blocks.map((entry) => (
        <BlockView key={entry.key} block={entry.block} growing={entry.growing} />
      ))}
    </div>
  );
});

function sameBlock(a: MarkdownBlockNode, b: MarkdownBlockNode): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

const BlockView = memo(
  function BlockView({
    block,
    growing,
  }: {
    readonly block: MarkdownBlockNode;
    readonly growing: boolean;
  }) {
    switch (block.kind) {
      case "paragraph":
        return <TextBlock tag="p" className="halo-p" text={block.text} growing={growing} />;
      case "heading":
        return (
          <TextBlock
            tag={block.level <= 2 ? "h3" : "h4"}
            className="halo-h"
            level={block.level}
            text={block.text}
            growing={growing}
          />
        );
      case "quote":
        return (
          <TextBlock tag="blockquote" className="halo-quote" text={block.text} growing={growing} />
        );
      case "list":
        return <ListBlock block={block} growing={growing} />;
      case "code":
        return <CodeBlock lang={block.lang} code={block.code} />;
      case "table":
        return <TableBlock block={block} />;
      case "rule":
        return <hr className="halo-rule" />;
    }
  },
  (previous, next) => previous.growing === next.growing && sameBlock(previous.block, next.block),
);

function TextBlock({
  tag: Tag,
  className,
  level,
  text,
  growing,
}: {
  readonly tag: "p" | "h3" | "h4" | "blockquote";
  readonly className: string;
  readonly level?: number;
  readonly text: string;
  readonly growing: boolean;
}) {
  const enter = useEntrance();
  const nodes = useMemo(() => inlinesOf(text, growing), [text, growing]);
  const length = useMemo(() => plainText(nodes).length, [nodes]);
  const plan = useInk(length);
  return (
    <Tag className={cx(className, enter && "halo-enter")} data-level={level}>
      {renderInlines(nodes, new InkWriter(plan), "n")}
    </Tag>
  );
}

type ListBlockNode = Extract<MarkdownBlockNode, { kind: "list" }>;

function ListBlock({
  block,
  growing,
}: {
  readonly block: ListBlockNode;
  readonly growing: boolean;
}) {
  const enter = useEntrance();
  const items = useMemo(
    () =>
      block.items.map((item, index) =>
        inlinesOf(item.text, growing && index === block.items.length - 1),
      ),
    [block.items, growing],
  );
  const lengths = useMemo(() => items.map((nodes) => plainText(nodes).length), [items]);
  const plan = useInk(lengths.reduce((sum, length) => sum + length, 0));
  const Tag = block.ordered ? "ol" : "ul";
  let base = 0;
  return (
    <Tag
      className={cx("halo-list", enter && "halo-enter")}
      start={block.ordered ? block.start : undefined}
    >
      {block.items.map((item, index) => {
        const nodes = items[index] ?? [];
        const start = base;
        base += lengths[index] ?? 0;
        return (
          <ListItemView
            // biome-ignore lint/suspicious/noArrayIndexKey: items only ever append while streaming.
            key={index}
            item={item}
            nodes={nodes}
            plan={plan}
            start={start}
            prefix={`i${index}`}
          />
        );
      })}
    </Tag>
  );
}

function ListItemView({
  item,
  nodes,
  plan,
  start,
  prefix,
}: {
  readonly item: ListItem;
  readonly nodes: readonly Inline[];
  readonly plan: InkPlan;
  /** Where this item's text starts in the list's plain text. */
  readonly start: number;
  readonly prefix: string;
}) {
  const enter = useEntrance();
  return (
    <li
      className={cx("halo-li", enter && "halo-enter")}
      data-depth={item.depth > 0 ? item.depth : undefined}
      data-task={item.checked === null ? undefined : item.checked ? "done" : "open"}
    >
      {/* The writer is made here, not passed in: rendering stays pure if React renders twice. */}
      {renderInlines(nodes, new InkWriter(plan, start), prefix)}
    </li>
  );
}

type TableBlockNode = Extract<MarkdownBlockNode, { kind: "table" }>;

function TableBlock({ block }: { readonly block: TableBlockNode }) {
  const enter = useEntrance();
  return (
    <div className={cx("halo-table-wrap", enter && "halo-enter")}>
      <table className="halo-table">
        <thead>
          <tr>
            {block.header.map((cell, index) => (
              <th
                // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
                key={index}
                style={{ textAlign: block.align[index] ?? undefined }}
              >
                {renderInlines(parseInline(cell), new InkWriter(NO_INK), `h${index}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows only ever append while streaming.
            <tr key={rowIndex}>
              {row.map((cell, index) => (
                <td
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
                  key={index}
                  style={{ textAlign: block.align[index] ?? undefined }}
                >
                  {renderInlines(parseInline(cell), new InkWriter(NO_INK), `c${rowIndex}.${index}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  typescript: "TypeScript",
  js: "JavaScript",
  javascript: "JavaScript",
  rs: "Rust",
  rust: "Rust",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  json: "JSON",
  css: "CSS",
  md: "Markdown",
};

/**
 * The hanging indent for a line that may wrap, as a CSS length: two characters past the line's own
 * indentation (a tab counts as two), so a wrapped line reads as the continuation of its first.
 */
export function hangOf(text: string): string {
  let width = 0;
  for (const character of text) {
    if (character === " ") width += 1;
    else if (character === "\t") width += 2;
    else break;
  }
  return `${Math.min(width, 24) + 2}ch`;
}

/** One highlighted line of code. New lines (streamed in after mount) ink in. */
export const CodeLine = memo(function CodeLine({ text }: { readonly text: string }) {
  const enter = useEntrance();
  const tokens = useMemo(() => highlight(text), [text]);
  return (
    <span
      className={cx("halo-code-line", enter && "halo-ink-line")}
      style={{ "--hang": hangOf(text) } as CSSProperties}
    >
      {tokens.length === 0
        ? "​"
        : tokens.map((token, index) =>
            token.kind === "plain" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional.
              <Fragment key={index}>{token.text}</Fragment>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional.
              <span key={index} className={`halo-tok-${token.kind}`}>
                {token.text}
              </span>
            ),
          )}
    </span>
  );
});

/**
 * Marks a horizontal scroller whose content runs past its right edge (and has not been scrolled
 * to the end), so the edge can fade out as a cue that there is more. Written to the DOM directly.
 */
function useOverflowCue<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const mark = (): void => {
      const rest = element.scrollWidth - element.clientWidth - element.scrollLeft;
      element.toggleAttribute("data-more", rest > 1);
    };
    mark();
    element.addEventListener("scroll", mark, { passive: true });
    // The content is a block as wide as its longest line (see .halo-pre > code), so it resizes too.
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(mark) : null;
    observer?.observe(element);
    if (element.firstElementChild) observer?.observe(element.firstElementChild);
    return () => {
      element.removeEventListener("scroll", mark);
      observer?.disconnect();
    };
  }, []);
  return ref;
}

function CodeBlock({ lang, code }: { readonly lang: string; readonly code: string }) {
  const enter = useEntrance();
  const lines = code.split("\n");
  const preRef = useOverflowCue<HTMLPreElement>();
  return (
    <figure className={cx("halo-codeblock", enter && "halo-enter")}>
      <figcaption className="halo-codeblock-head">
        <span className="halo-codeblock-lang">{LANGUAGE_NAMES[lang] ?? (lang || "Code")}</span>
        <CopyButton text={code} />
      </figcaption>
      <pre ref={preRef} className="halo-pre">
        <code>
          {lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines only ever append while streaming.
            <CodeLine key={index} text={line} />
          ))}
        </code>
      </pre>
    </figure>
  );
}

/** Copies text, then shows a check for a moment. */
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
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="halo-copy"
      data-copied={copied ? "" : undefined}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).catch(() => {});
        setCopied(true);
      }}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
}
