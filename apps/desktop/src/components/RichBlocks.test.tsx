import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { highlightCode, languageOf } from "../lib/highlight";
import { parseBlock, parseInline, plainText } from "../lib/markdown";
import { CodeBlock, highlightNodes, keepsHighlight, STREAMING_HIGHLIGHT_MS } from "./RichBlocks";

describe("math in answers", () => {
  it("reads $…$ and \\(…\\) as inline math, by Pandoc's rule for dollars", () => {
    expect(parseInline("The area is $\\pi r^2$ here.")).toEqual([
      { kind: "text", text: "The area is " },
      { kind: "math", tex: "\\pi r^2" },
      { kind: "text", text: " here." },
    ]);
    expect(parseInline("so \\( a+b \\) holds")).toEqual([
      { kind: "text", text: "so " },
      { kind: "math", tex: "a+b" },
      { kind: "text", text: " holds" },
    ]);
    // Money and shell variables stay text.
    for (const text of [
      "It costs $5 and $10.",
      "Set $HOME and $PATH first.",
      "From $ 5 to $ 9",
      "Pay \\$4 now and \\$5 later",
    ])
      expect(
        parseInline(text).every((node) => node.kind === "text"),
        text,
      ).toBe(true);
    expect(plainText(parseInline("x is $x^2$"))).toBe("x is x^2");
  });
  it("reads a paragraph that is only $$…$$ or \\[…\\] as display math", () => {
    expect(parseBlock("$$\n\\int_0^1 x\\,dx = \\tfrac12\n$$")).toEqual([
      { kind: "math", tex: "\\int_0^1 x\\,dx = \\tfrac12" },
    ]);
    expect(parseBlock("\\[ e^{i\\pi} + 1 = 0 \\]")).toEqual([
      { kind: "math", tex: "e^{i\\pi} + 1 = 0" },
    ]);
    expect(parseBlock("Before $$a$$ after")[0]?.kind).toBe("paragraph");
  });
});

describe("code colours", () => {
  it("knows the languages agents write by the names fences use", () => {
    for (const [fence, language] of [
      ["ts", "typescript"],
      ["TSX", "typescript"],
      ["rs", "rust"],
      ["sh", "bash"],
      ["toml", "ini"],
      ["html", "xml"],
      ["ps1", "powershell"],
      ["py", "python"],
    ] as const)
      expect(languageOf(fence), fence).toBe(language);
    expect(languageOf("brainfuck")).toBeNull();
    expect(highlightCode("whatever", "brainfuck")).toBeNull();
    expect(highlightCode("", "ts")).toBeNull();
  });
  it("rebuilds highlight.js's spans as elements, its text unescaped once", () => {
    const html = highlightCode('const a = "<b>&";', "ts") ?? "";
    expect(html).toContain('<span class="hljs-keyword">const</span>');
    const markup = renderToStaticMarkup(<code>{highlightNodes(html)}</code>);
    expect(markup).toContain('<span class="hljs-keyword">const</span>');
    expect(markup).toContain("&lt;b&gt;&amp;");
    expect(markup).not.toContain("<b>");
    // Anything highlight.js never writes stays text.
    expect(renderToStaticMarkup(<code>{highlightNodes('<img src=x onerror="1">')}</code>)).toBe(
      "<code>&lt;img src=x onerror=&quot;1&quot;&gt;</code>",
    );
  });
  it("colours a known language and leaves the rest as typed", () => {
    const rust = renderToStaticMarkup(<CodeBlock lang="rust" code="fn main() {}" closed />);
    expect(rust).toContain('class="hljs"');
    expect(rust).toContain("hljs-keyword");
    const plain = renderToStaticMarkup(<CodeBlock lang="" code="just text" closed />);
    expect(plain).not.toContain("hljs");
    expect(plain).toContain("just text");
  });
  it("colours a streaming block at most every 200 ms, and a closed one at once", () => {
    const last = { code: "fn main() {", lang: "rust", at: 1000 };
    const grown = "fn main() {\n    println!";
    // Still streaming, only grew, coloured a moment ago: the new text shows plain for now.
    expect(keepsHighlight(last, grown, "rust", false, 1000 + STREAMING_HIGHLIGHT_MS - 1)).toBe(
      true,
    );
    // Rested long enough, closed, another language, or rewritten: colour it again.
    expect(keepsHighlight(last, grown, "rust", false, 1000 + STREAMING_HIGHLIGHT_MS)).toBe(false);
    expect(keepsHighlight(last, grown, "rust", true, 1001)).toBe(false);
    expect(keepsHighlight(last, grown, "python", false, 1001)).toBe(false);
    expect(keepsHighlight(last, "fn other() {", "rust", false, 1001)).toBe(false);
    expect(keepsHighlight(null, grown, "rust", false, 1001)).toBe(false);
    // A first render colours everything, streaming or not.
    const open = renderToStaticMarkup(<CodeBlock lang="rust" code="fn main() {" closed={false} />);
    expect(open).toContain("hljs-keyword");
  });
});
