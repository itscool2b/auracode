import { easings } from "@auracode/ui";
import { motion } from "motion/react";
import { Fragment, memo, type ReactNode, useMemo, useRef } from "react";
import {
  type Block,
  EMPTY_SPLIT,
  type Inline,
  parseBlock,
  parseInline,
  type SplitCache,
  splitIncremental,
} from "../lib/markdown";

/**
 * Streamed markdown, rendered block by block. Each block fades and rises in once when it first
 * appears (never per character); finished blocks are memoized, so a new frame only re-renders the
 * block that is still growing. Everything is React elements: agent text cannot inject HTML.
 */
export function Answer({ text }: { readonly text: string }) {
  const cache = useRef<SplitCache>(EMPTY_SPLIT);
  const split = useMemo(() => {
    cache.current = splitIncremental(cache.current, text);
    return cache.current;
  }, [text]);

  return (
    <div className="answer" data-answer="">
      {split.stable.map((source, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks only ever append, so an index names the same block for its whole life.
        <MarkdownBlock key={index} source={source} />
      ))}
      {split.tail !== null ? <MarkdownBlock key={split.stable.length} source={split.tail} /> : null}
    </div>
  );
}

const ENTER = { opacity: 0, y: 6 } as const;
const SHOWN = { opacity: 1, y: 0 } as const;
const ENTER_TRANSITION = { duration: 0.38, ease: easings.out } as const;

const MarkdownBlock = memo(function MarkdownBlock({ source }: { readonly source: string }) {
  const blocks = useMemo(() => parseBlock(source), [source]);
  return (
    <motion.div className="md-block" initial={ENTER} animate={SHOWN} transition={ENTER_TRANSITION}>
      {blocks.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a block's parts are positional and re-derived from its text.
        <BlockView key={index} block={block} />
      ))}
    </motion.div>
  );
});

function BlockView({ block }: { readonly block: Block }) {
  switch (block.kind) {
    case "heading": {
      const content = <InlineText text={block.text} />;
      return block.level <= 2 ? <h3>{content}</h3> : <h4>{content}</h4>;
    }
    case "paragraph":
      return (
        <p>
          <InlineText text={block.text} />
        </p>
      );
    case "code":
      return (
        <pre aria-busy={!block.closed}>
          {block.lang !== "" ? <span className="code-lang">{block.lang}</span> : null}
          <code>{block.code}</code>
        </pre>
      );
    case "list": {
      const items = block.items.map((item, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: list items are positional within their block.
          key={index}
          className={item.checked === null ? undefined : "task"}
          style={item.depth > 0 ? { marginLeft: item.depth * 18 } : undefined}
        >
          {item.checked === null ? null : <TaskBox checked={item.checked} />}
          <InlineText text={item.text} />
        </li>
      ));
      return block.ordered ? <ol start={block.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case "quote":
      return (
        <blockquote>
          <InlineText text={block.text} />
        </blockquote>
      );
    case "table":
      return (
        <table>
          <thead>
            <tr>
              {block.header.map((cell, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
                <th key={index} style={{ textAlign: block.align[index] ?? undefined }}>
                  <InlineText text={cell} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and append-only.
              <tr key={rowIndex}>
                {row.map((cell, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
                  <td key={index} style={{ textAlign: block.align[index] ?? undefined }}>
                    <InlineText text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "rule":
      return <hr />;
  }
}

function TaskBox({ checked }: { readonly checked: boolean }) {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 13 13"
      role="img"
      aria-label={checked ? "Done" : "Not done"}
      style={{ display: "inline-block", marginRight: 8, verticalAlign: -1 }}
    >
      <rect
        x={0.5}
        y={0.5}
        width={12}
        height={12}
        rx={3}
        fill={checked ? "var(--aura-accent)" : "none"}
        stroke={checked ? "var(--aura-accent)" : "var(--aura-border-3)"}
      />
      {checked ? (
        <path
          d="m3.4 6.7 2 2 4.2-4.4"
          fill="none"
          stroke="var(--aura-text-on-accent)"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}

/** One line of inline markdown (code, bold, italics, links) as elements. */
export function InlineText({ text }: { readonly text: string }) {
  const nodes = useMemo(() => parseInline(text), [text]);
  return <InlineNodes nodes={nodes} />;
}

function InlineNodes({ nodes }: { readonly nodes: readonly Inline[] }) {
  return nodes.map((node, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: inline runs are positional and re-derived from their text.
    <Fragment key={index}>{inlineNode(node)}</Fragment>
  ));
}

function inlineNode(node: Inline): ReactNode {
  switch (node.kind) {
    case "text":
      return node.text;
    case "code":
      return <code>{node.text}</code>;
    case "strong":
      return (
        <strong>
          <InlineNodes nodes={node.children} />
        </strong>
      );
    case "em":
      return (
        <em>
          <InlineNodes nodes={node.children} />
        </em>
      );
    case "link":
      // Opens in the browser, never in this window. The Rust opener plugin injects a script into
      // every page that catches left clicks on a target=_blank link (unless Cmd/Meta or Alt is
      // held), cancels the navigation and calls the plugin's open_url command, which the
      // capability's opener:allow-open-url grant allows for http and https only (safeHref makes
      // every link one of those). No JS package is involved. Other clicks are left to the
      // webview, which opens no new windows (none is allowed without an on_new_window handler).
      return (
        <a href={node.href} target="_blank" rel="noreferrer noopener">
          <InlineNodes nodes={node.children} />
        </a>
      );
  }
}
