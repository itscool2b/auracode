import { describe, expect, it } from "vitest";
import { codeFileRef, hrefFileRef, proseFileRefs } from "./fileRefs";

const at = (path: string, line: number | null = null, column: number | null = null) => ({
  path,
  line,
  column,
});

describe("file names in inline code", () => {
  it("reads a path with its line and column, in the forms agents write", () => {
    expect(codeFileRef("src/app.ts")).toEqual(at("src/app.ts"));
    expect(codeFileRef("src/app.ts:42")).toEqual(at("src/app.ts", 42));
    expect(codeFileRef("src/app.ts:42:7")).toEqual(at("src/app.ts", 42, 7));
    expect(codeFileRef("src/app.ts:42-50")).toEqual(at("src/app.ts", 42));
    expect(codeFileRef("src/app.ts#L42")).toEqual(at("src/app.ts", 42));
    expect(codeFileRef("src/app.ts#L42C7")).toEqual(at("src/app.ts", 42, 7));
    expect(codeFileRef("src/app.ts#L42-L50")).toEqual(at("src/app.ts", 42));
    expect(codeFileRef("b/server/index.js#L10")).toEqual(at("b/server/index.js", 10));
    expect(codeFileRef("C:\\repo\\project\\main.rs:12:5")).toEqual(
      at("C:\\repo\\project\\main.rs", 12, 5),
    );
    // A line of 0 is no place.
    expect(codeFileRef("src/app.ts:0")).toEqual(at("src/app.ts"));
  });

  it("takes a bare name only with a common file type or a line", () => {
    for (const name of ["package.json", "index.d.ts", "main.rs", "README.md", "Makefile", ".env"])
      expect(codeFileRef(name)?.path, name).toBe(name);
    expect(codeFileRef("ChatView.tsx:120")).toEqual(at("ChatView.tsx", 120));
    for (const code of ["console.log", "os.path", "self.value", "this.state"])
      expect(codeFileRef(code), code).toBeNull();
  });

  it("leaves code, packages, versions, links and folders alone", () => {
    for (const code of [
      "std::fs::read",
      "@types/node",
      "~/notes.md",
      "https://example.dev/app.ts",
      "1.2.3",
      "v1.2.3",
      "a/b",
      "src/",
      "src//app.ts",
      "my file.ts",
      "useState",
      "items.map(render)",
      "--line",
      "",
    ])
      expect(codeFileRef(code), code).toBeNull();
  });
});

describe("file links in Markdown", () => {
  it("reads a link's target as a path with its place", () => {
    expect(hrefFileRef("src/components/ChatView.tsx#L120")).toEqual(
      at("src/components/ChatView.tsx", 120),
    );
    expect(hrefFileRef("src/app.ts#L42-L51")).toEqual(at("src/app.ts", 42));
    expect(hrefFileRef("./docs/guide.md")).toEqual(at("./docs/guide.md"));
    expect(hrefFileRef("C:/repo/a.ts:3")).toEqual(at("C:/repo/a.ts", 3));
    expect(hrefFileRef("<src/a b.ts>")).toEqual(at("src/a b.ts"));
    expect(hrefFileRef("src/my%20file.ts")).toEqual(at("src/my file.ts"));
  });

  it("reads a file URL as its path, and refuses every other scheme", () => {
    expect(hrefFileRef("file:///C:/repo/a.ts")).toEqual(at("C:/repo/a.ts"));
    expect(hrefFileRef("file:///home/me/a.ts#L3")).toEqual(at("/home/me/a.ts", 3));
    for (const href of [
      "https://example.dev",
      "mailto:me@example.dev",
      "javascript:alert(1)",
      "vscode://file/c:/a.ts",
      "#heading",
      "docs/",
      "src/%E0%A4%A.ts",
    ])
      expect(hrefFileRef(href), href).toBeNull();
  });
});

describe("file names in prose", () => {
  const found = (text: string) =>
    proseFileRefs(text).map(({ start, end, ref }) => [text.slice(start, end), ref]);

  it("finds paths with a folder or a line, without a sentence's punctuation", () => {
    expect(found("See src/app.ts:42 for details.")).toEqual([
      ["src/app.ts:42", at("src/app.ts", 42)],
    ]);
    expect(found("In ChatView.tsx:120, the list renders.")).toEqual([
      ["ChatView.tsx:120", at("ChatView.tsx", 120)],
    ]);
    expect(found("The fix is in src/styles.css.")).toEqual([
      ["src/styles.css", at("src/styles.css")],
    ]);
    expect(found("(src/a.ts) and C:\\repo\\b.rs:3")).toEqual([
      ["src/a.ts", at("src/a.ts")],
      ["C:\\repo\\b.rs:3", at("C:\\repo\\b.rs", 3)],
    ]);
  });

  it("leaves words, versions and web addresses alone", () => {
    for (const text of [
      "Use Node.js, e.g. today.",
      "Version 1.2.3 and v2.0.1 shipped.",
      "Read https://example.com/docs/a.ts first.",
      "Both and/or TCP/IP work.",
      "package.json lists it.",
      "at 10:30 or 3.5:1",
    ])
      expect(found(text), text).toEqual([]);
  });
});
