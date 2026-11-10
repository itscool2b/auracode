import type { ReactNode } from "react";

/**
 * An agent's answer as the remote page shows it: headings, lists, quotes, code and the usual
 * inline marks. It builds elements and never HTML, so nothing an agent writes can run here, and a
 * link opens only when it is http or https. Anything it does not know stays as the text it was.
 */
export function Markdown({ text }: { readonly text: string }) {
  return <div className="remote-markdown">{blocks(text)}</div>;
}

const FENCE = /^ {0,3}(```|~~~)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const NUMBER = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let index = 0;
  const key = () => `b${out.length}`;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const code: string[] = [];
      index += 1;
      // An unclosed fence runs to the end, as an answer still arriving has not closed it yet.
      while (index < lines.length && !(lines[index] ?? "").trimStart().startsWith(fence[1] ?? "")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      out.push(
        <pre key={key()}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(6, (heading[1] ?? "").length + 1);
      const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5" | "h6";
      out.push(<Tag key={key()}>{inline(heading[2] ?? "")}</Tag>);
      index += 1;
      continue;
    }
    if (RULE.test(line)) {
      out.push(<hr key={key()} />);
      index += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index] ?? "")) {
        quoted.push(QUOTE.exec(lines[index] ?? "")?.[1] ?? "");
        index += 1;
      }
      out.push(<blockquote key={key()}>{blocks(quoted.join("\n"))}</blockquote>);
      continue;
    }
    const ordered = NUMBER.test(line);
    if (ordered || BULLET.test(line)) {
      const marker = ordered ? NUMBER : BULLET;
      const items: string[][] = [];
      while (index < lines.length) {
        const current = lines[index] ?? "";
        const item = marker.exec(current);
        if (item && (item[1] ?? "").length < 2) {
          items.push([item[3] ?? ""]);
        } else if (items.length > 0 && current.trim() !== "" && /^\s{2,}/.test(current)) {
          // An indented line continues the item above it: more words, or a list inside it.
          items[items.length - 1]?.push(current.replace(/^\s{2,4}/, ""));
        } else {
          break;
        }
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      out.push(
        <List key={key()}>
          {items.map((item, at) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: list items never reorder.
            <li key={at}>{item.length === 1 ? inline(item[0] ?? "") : blocks(item.join("\n"))}</li>
          ))}
        </List>,
      );
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (
        current.trim() === "" ||
        FENCE.test(current) ||
        HEADING.test(current) ||
        QUOTE.test(current) ||
        RULE.test(current) ||
        (paragraph.length > 0 && (BULLET.test(current) || NUMBER.test(current)))
      )
        break;
      paragraph.push(current);
      index += 1;
    }
    out.push(<p key={key()}>{inline(paragraph.join("\n"))}</p>);
  }
  return out;
}

/** Code spans, then links, bold, italic and struck text, in that order of precedence. */
const INLINE =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|(?<![*\w])\*([^*\s][^*\n]*?)\*(?![*\w])|(?<![_\w])_([^_\s][^_\n]*?)_(?![_\w])|~~([^~\n]+?)~~/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index;
    if (at > last) out.push(text.slice(last, at));
    const key = `i${at}`;
    if (match[2] !== undefined) out.push(<code key={key}>{match[2]}</code>);
    else if (match[3] !== undefined) {
      const href = match[4] ?? "";
      out.push(
        /^https?:\/\//i.test(href) ? (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {inline(match[3])}
          </a>
        ) : (
          // A link that is not to the web stays words: a file path opens nothing here.
          <span key={key}>{inline(match[3])}</span>
        ),
      );
    } else if (match[5] !== undefined || match[6] !== undefined)
      out.push(<strong key={key}>{inline(match[5] ?? match[6] ?? "")}</strong>);
    else if (match[7] !== undefined || match[8] !== undefined)
      out.push(<em key={key}>{inline(match[7] ?? match[8] ?? "")}</em>);
    else if (match[9] !== undefined) out.push(<s key={key}>{inline(match[9])}</s>);
    last = at + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
