import { createContext, Fragment, memo, type ReactNode, useContext, useMemo, useRef } from "react";
import { FileLinkContext } from "../lib/chat/fileLinks";
import { imageSource } from "../lib/chatImages";
import { codeFileRef, proseFileRefs } from "../lib/fileRefs";
import {
  type Block,
  EMPTY_SPLIT,
  type Inline,
  parseBlock,
  parseInline,
  type SplitCache,
  splitIncremental,
} from "../lib/markdown";
import { EMPTY_IMAGE_PATHS, imagePathsIncremental } from "../lib/markdownImages";
import { ChatImageTile } from "./chat/ChatImages";
import { FileLink } from "./chat/FileLink";
import { CodeBlock, MathView, MermaidBlock } from "./RichBlocks";

/**
 * Streamed markdown, rendered block by block. Text only ever appends: a block appears where it will
 * stay, with no entrance, so lines already read never move while the answer streams. Finished
 * blocks are memoized, so a new frame only re-renders the block that is still growing. Agent text
 * cannot inject HTML: everything is React elements, code colours included, and math and diagrams
 * are built by KaTeX and Mermaid from parsed nodes, never from markup (RichBlocks.tsx).
 */
const ImageLimit = createContext<ReadonlySet<string> | null>(null);

export function Answer({ text }: { readonly text: string }) {
  const cache = useRef<SplitCache>(EMPTY_SPLIT);
  const imageCache = useRef(EMPTY_IMAGE_PATHS);
  const split = useMemo(() => {
    cache.current = splitIncremental(cache.current, text);
    return cache.current;
  }, [text]);
  const imagePaths = useMemo(() => {
    imageCache.current = imagePathsIncremental(imageCache.current, split);
    return imageCache.current.visible;
  }, [split]);

  return (
    <ImageLimit.Provider value={imagePaths}>
      <div className="answer" data-answer="">
        {split.stable.map((source, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks only ever append, so an index names the same block for its whole life.
          <MarkdownBlock key={index} source={source} />
        ))}
        {split.tail !== null ? (
          <MarkdownBlock key={split.stable.length} source={split.tail} />
        ) : null}
      </div>
    </ImageLimit.Provider>
  );
}

const MarkdownBlock = memo(function MarkdownBlock({ source }: { readonly source: string }) {
  const blocks = useMemo(() => parseBlock(source), [source]);
  return (
    <div className="md-block">
      {blocks.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a block's parts are positional and re-derived from its text.
        <BlockView key={index} block={block} />
      ))}
    </div>
  );
});

/**
 * One markdown block. Its root carries `data-test-block` with the block's kind, so automation (the
 * chat smoke run) can tell a heading, a list or a code block apart whatever elements and styles
 * render them.
 */
function BlockView({ block }: { readonly block: Block }) {
  const mark = { "data-test-block": block.kind };
  switch (block.kind) {
    case "heading": {
      const content = <InlineText text={block.text} />;
      return block.level <= 2 ? <h3 {...mark}>{content}</h3> : <h4 {...mark}>{content}</h4>;
    }
    case "paragraph":
      return (
        <p {...mark}>
          <InlineText text={block.text} />
        </p>
      );
    case "code": {
      const lang = block.lang.toLowerCase();
      if (lang === "mermaid") return <MermaidBlock code={block.code} closed={block.closed} />;
      // A math fence is display math once it closes.
      if (lang === "math" && block.closed && block.code.trim())
        return <MathView tex={block.code.trim()} display />;
      return <CodeBlock lang={block.lang} code={block.code} closed={block.closed} />;
    }
    case "math":
      return <MathView tex={block.tex} display />;
    case "list": {
      const items = block.items.map((item, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: list items are positional within their block.
          key={index}
          className={item.checked === null ? undefined : "task"}
          data-depth={item.depth > 0 ? Math.min(item.depth, 4) : undefined}
        >
          {item.checked === null ? null : <TaskBox checked={item.checked} />}
          <InlineText text={item.text} />
        </li>
      ));
      return block.ordered ? (
        <ol {...mark} start={block.start}>
          {items}
        </ol>
      ) : (
        <ul {...mark}>{items}</ul>
      );
    }
    case "quote":
      return (
        <blockquote {...mark}>
          <InlineText text={block.text} />
        </blockquote>
      );
    case "table":
      return (
        <table {...mark}>
          <thead>
            <tr>
              {block.header.map((cell, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
                <th key={index} data-align={block.align[index] ?? undefined}>
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
                  <td key={index} data-align={block.align[index] ?? undefined}>
                    <InlineText text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "rule":
      return <hr {...mark} />;
  }
}

/** A task's box, as Graphite draws a check: white with a black check when done, an outline when not. */
function TaskBox({ checked }: { readonly checked: boolean }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      role="img"
      aria-label={checked ? "Done" : "Not done"}
      className="md-task-box"
    >
      <rect
        x={0.5}
        y={0.5}
        width={13}
        height={13}
        rx={3.5}
        fill={checked ? "var(--g-primary)" : "none"}
        stroke={checked ? "var(--g-primary)" : "var(--g-line-strong)"}
      />
      {checked ? (
        <path
          d="m3.75 7.25 2.25 2.25 4.25-4.75"
          fill="none"
          stroke="var(--g-on-light)"
          strokeWidth={1.75}
          strokeLinecap="square"
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
      return <Prose text={node.text} />;
    case "code": {
      const ref = codeFileRef(node.text);
      const code = <code>{node.text}</code>;
      return ref ? (
        <FileLink reference={ref.path} line={ref.line} column={ref.column}>
          {code}
        </FileLink>
      ) : (
        code
      );
    }
    case "file":
      return (
        <FileLink reference={node.ref.path} line={node.ref.line} column={node.ref.column}>
          <InlineNodes nodes={node.children} />
        </FileLink>
      );
    case "math":
      return <MathView tex={node.tex} display={false} />;
    case "image":
      return <InlineImage node={node} />;
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
          {/* A link holds no file link: a control inside a control is neither. */}
          <FileLinkContext.Provider value={null}>
            <InlineNodes nodes={node.children} />
          </FileLinkContext.Provider>
        </a>
      );
  }
}

/**
 * Prose, with the file paths it names (`src/app.ts`, `app.ts:42`) as links in a chat. Outside a chat
 * the text is not even searched for them.
 */
function Prose({ text }: { readonly text: string }) {
  const linking = useContext(FileLinkContext) !== null;
  const refs = useMemo(() => (linking ? proseFileRefs(text) : []), [linking, text]);
  if (refs.length === 0) return text;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const { start, end, ref } of refs) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <FileLink key={start} reference={ref.path} line={ref.line} column={ref.column} icon={false}>
        {text.slice(start, end)}
      </FileLink>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

function InlineImage({ node }: { readonly node: Extract<Inline, { kind: "image" }> }) {
  const allowed = useContext(ImageLimit);
  if (allowed && !allowed.has(node.path))
    return <span>{node.alt || "Image"} (preview limit reached)</span>;
  return (
    <ChatImageTile image={{ name: node.alt || "Agent image", source: imageSource(node.path) }} />
  );
}
