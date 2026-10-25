import { Check, Copy } from "lucide-react";
import {
  type CSSProperties,
  Fragment,
  memo,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { type Inline, type MarkdownBlockNode, parseInline, parseMarkdown } from "../../kit";
import { tokenizeLine } from "./syntax";
import { closeOpenInline, splitWords } from "./text";

/**
 * Agent markdown, Noir style: Geist body on a 24 px rhythm and an 80-character measure, headings
 * and bold lead-ins in Instrument Serif, code in Geist Mono with monochrome highlighting. While a
 * message streams, each new word fades in where it will stay (nothing reflows), and a thin caret
 * in the agent's colour marks the end of the text.
 */

export type MarkdownVariant = "answer" | "thought";

interface MarkdownProps {
  readonly text: string;
  readonly streaming: boolean;
  readonly variant?: MarkdownVariant;
  /** Fade words in as they arrive. Off for finished text and under reduced motion. */
  readonly animate: boolean;
}

export const Markdown = memo(function Markdown({
  text,
  streaming,
  variant = "answer",
  animate,
}: MarkdownProps) {
  const blocks = parseMarkdown(text, streaming);
  // Text that was already whole when it appeared may wrap "pretty": it can never reflow. Text that
  // streamed in keeps plain wrapping for good, or WebKit would re-break its lines on every word.
  const [settled] = useState(!streaming);
  return (
    <div className="n-md" data-variant={variant} data-settled={settled ? "" : undefined}>
      {blocks.map((entry) => (
        <BlockView
          key={entry.key}
          block={entry.block}
          growing={entry.growing}
          variant={variant}
          animate={animate}
        />
      ))}
    </div>
  );
});

interface BlockViewProps {
  readonly block: MarkdownBlockNode;
  readonly growing: boolean;
  readonly variant: MarkdownVariant;
  readonly animate: boolean;
}

/* Blocks compare by content: parseMarkdown builds new objects each time, finished ones are equal. */
function sameBlock(a: BlockViewProps, b: BlockViewProps): boolean {
  return (
    a.growing === b.growing &&
    a.variant === b.variant &&
    a.animate === b.animate &&
    JSON.stringify(a.block) === JSON.stringify(b.block)
  );
}

/** Per block: the delay each word got when it first appeared, so a re-render never retimes it. */
class WordClock {
  readonly #delays = new Map<number, number>();
  #fresh = 0;

  begin(): void {
    this.#fresh = 0;
  }

  delay(key: number): number {
    const known = this.#delays.get(key);
    if (known !== undefined) return known;
    // Words that arrive together ripple in, 14 ms apart, never more than 84 ms behind.
    const delay = Math.min(this.#fresh * 14, 84);
    this.#fresh += 1;
    this.#delays.set(key, delay);
    return delay;
  }
}

interface InlineContext {
  readonly animate: boolean;
  readonly clock: WordClock;
  /** Characters rendered so far in this block: keys words by where they start. */
  offset: number;
}

function renderText(text: string, ctx: InlineContext): ReactNode {
  const start = ctx.offset;
  ctx.offset += text.length;
  if (!ctx.animate) return text;
  return splitWords(text, start).map((word) => (
    <span
      key={word.key}
      className="n-w"
      style={{ animationDelay: `${ctx.clock.delay(word.key)}ms` } as CSSProperties}
    >
      {word.text}
    </span>
  ));
}

function renderInline(nodes: readonly Inline[], ctx: InlineContext, runIn = false): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${node.kind}-${ctx.offset}`;
    switch (node.kind) {
      case "text":
        return <Fragment key={key}>{renderText(node.text, ctx)}</Fragment>;
      case "code": {
        const start = ctx.offset;
        ctx.offset += node.text.length + 2;
        return (
          <code
            key={key}
            className={ctx.animate ? "n-code n-w" : "n-code"}
            style={ctx.animate ? { animationDelay: `${ctx.clock.delay(start)}ms` } : undefined}
          >
            {node.text}
          </code>
        );
      }
      case "strong":
        return (
          <strong key={key} className={runIn && index === 0 ? "n-runin" : undefined}>
            {renderInline(node.children, ctx)}
          </strong>
        );
      case "em":
        return <em key={key}>{renderInline(node.children, ctx)}</em>;
      case "link":
        return (
          <a key={key} href={node.href} target="_blank" rel="noreferrer" className="n-link">
            {renderInline(node.children, ctx)}
          </a>
        );
      default:
        return null;
    }
  });
}

/** The inline content of one block, repaired while it streams, with the caret at its end. */
function InlineText({
  text,
  growing,
  ctx,
  runIn,
}: {
  readonly text: string;
  readonly growing: boolean;
  readonly ctx: InlineContext;
  readonly runIn: boolean;
}) {
  const nodes = parseInline(growing ? closeOpenInline(text) : text);
  return (
    <>
      {renderInline(nodes, ctx, runIn)}
      {growing ? <Caret /> : null}
    </>
  );
}

export function Caret() {
  return <span className="n-caret" aria-hidden="true" />;
}

/** True when a paragraph is nothing but one bold run: an agent's way of writing a heading. */
function isBoldHeading(text: string): boolean {
  const nodes = parseInline(text.trim());
  return nodes.length === 1 && nodes[0]?.kind === "strong" && !text.includes("\n");
}

const HEADING_TAGS = ["h3", "h4", "h5", "h6"] as const;

const BlockView = memo(function BlockView({ block, growing, variant, animate }: BlockViewProps) {
  const [clock] = useState(() => new WordClock());
  clock.begin();
  const ctx: InlineContext = { animate, clock, offset: 0 };
  const display = variant === "answer";

  switch (block.kind) {
    case "heading": {
      const level = Math.min(Math.max(block.level, 1), 4);
      const Tag = HEADING_TAGS[level - 1] ?? "h6";
      return (
        <Tag className="n-h" data-level={level} data-display={display ? "" : undefined}>
          <InlineText text={block.text} growing={growing} ctx={ctx} runIn={false} />
        </Tag>
      );
    }
    case "paragraph": {
      if (display && !growing && isBoldHeading(block.text)) {
        const inner = parseInline(block.text.trim());
        const strong = inner[0];
        return (
          <h5 className="n-h" data-level={3} data-display="">
            {strong && strong.kind === "strong" ? renderInline(strong.children, ctx) : block.text}
          </h5>
        );
      }
      return (
        <p className="n-p">
          <InlineText text={block.text} growing={growing} ctx={ctx} runIn={display} />
        </p>
      );
    }
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      const last = block.items.length - 1;
      return (
        <Tag className="n-list" data-ordered={block.ordered ? "" : undefined}>
          {block.items.map((item, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: items only ever append while streaming.
              key={index}
              className="n-li"
              style={{ "--n-depth": item.depth } as CSSProperties}
              data-checked={item.checked === null ? undefined : String(item.checked)}
            >
              <span className="n-li-mark" aria-hidden="true">
                {block.ordered ? `${block.start + index}.` : null}
              </span>
              <span className="n-li-body">
                <InlineText
                  text={item.text}
                  growing={growing && index === last}
                  ctx={ctx}
                  runIn={display}
                />
              </span>
            </li>
          ))}
        </Tag>
      );
    }
    case "code":
      return <CodeBlock lang={block.lang} code={block.code} growing={growing && !block.closed} />;
    case "quote":
      return (
        <blockquote className="n-quote">
          <InlineText text={block.text} growing={growing} ctx={ctx} runIn={false} />
        </blockquote>
      );
    case "table":
      return (
        <div className="n-table-wrap">
          <table className="n-table">
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
                  <th key={index} style={{ textAlign: block.align[index] ?? undefined }}>
                    {renderInline(parseInline(cell), { animate: false, clock, offset: 0 })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows only ever append.
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
                    <td key={index} style={{ textAlign: block.align[index] ?? undefined }}>
                      {renderInline(parseInline(cell), { animate: false, clock, offset: 0 })}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rule":
      return <hr className="n-rule" />;
    default:
      return null;
  }
}, sameBlock);

const LANG_NAMES: Readonly<Record<string, string>> = {
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
  toml: "TOML",
  css: "CSS",
  html: "HTML",
  md: "Markdown",
};

/** A fenced code block: a quiet header with the language and a copy button, then the code. */
export function CodeBlock({
  lang,
  code,
  growing,
}: {
  readonly lang: string;
  readonly code: string;
  readonly growing: boolean;
}) {
  const lines = code.split("\n");
  const name = LANG_NAMES[lang.toLowerCase()] ?? (lang === "" ? "Code" : lang);
  return (
    <figure className="n-codeblock">
      <figcaption className="n-codeblock-head">
        <span className="n-codeblock-lang">{name}</span>
        <CopyButton text={code} label="Copy code" />
      </figcaption>
      <pre className="n-codeblock-body">
        <code>
          {lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional and only append.
            <span key={index} className="n-code-line">
              <CodeLine text={line} lang={lang} />
              {growing && index === lines.length - 1 ? <Caret /> : null}
              {index < lines.length - 1 ? "\n" : null}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}

/** One line of code in monochrome syntax. */
export const CodeLine = memo(function CodeLine({
  text,
  lang,
}: {
  readonly text: string;
  readonly lang: string;
}) {
  if (text === "") return null;
  return (
    <>
      {tokenizeLine(text, lang.toLowerCase()).map((token, index) =>
        token.kind === "plain" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional.
          <Fragment key={index}>{token.text}</Fragment>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional.
          <span key={index} className={`n-tok-${token.kind}`}>
            {token.text}
          </span>
        ),
      )}
    </>
  );
});

/** Copies `text`, then shows a check for a moment. */
export function CopyButton({
  text,
  label,
  className,
}: {
  readonly text: string;
  readonly label: string;
  readonly className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      className={className ? `n-icon-btn ${className}` : "n-icon-btn"}
      data-size="sm"
      data-done={copied ? "" : undefined}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).catch(() => {});
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1400);
      }}
    >
      <Icon size={14} strokeWidth={1.6} aria-hidden="true" />
    </button>
  );
}
