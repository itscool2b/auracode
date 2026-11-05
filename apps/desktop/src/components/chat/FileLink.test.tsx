import { File, FileCode, FileCog, FileImage, FileJson, FileTerminal, FileText } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileLinkContext, type FileLinks, FileResolver } from "../../lib/chat/fileLinks";
import { parseInline } from "../../lib/markdown";
import { Answer } from "../Markdown";
import { fileIcon } from "./FileLink";
import { Locations } from "./ToolBlock";
import { ChangedFiles } from "./WorkedFor";

const FILES: Record<string, string> = {
  "src/app.ts": "src/app.ts",
  "src/styles.css": "src/styles.css",
  "Sidebar.tsx": "src/components/Sidebar.tsx",
  "src/components/ChatView.tsx": "src/components/ChatView.tsx",
  "C:/repo/src/app.ts": "src/app.ts",
};

/** A chat whose resolver already knows `names`, as server rendering runs no effects. */
async function linked(names: readonly string[]): Promise<FileLinks> {
  const resolver = new FileResolver("chat", {
    check: async (_chat, references) => references.map((reference) => FILES[reference] ?? null),
  });
  for (const name of names) resolver.request(name);
  await new Promise((resolve) => setTimeout(resolve, 40));
  return { resolver, editorName: "Cursor", open: () => {} };
}

describe("file names as links", () => {
  it("reads a link to a path as a file, and leaves other schemes as text", () => {
    expect(parseInline("[ChatView.tsx:120](src/components/ChatView.tsx#L120)")).toEqual([
      {
        kind: "file",
        ref: { path: "src/components/ChatView.tsx", line: 120, column: null },
        children: [{ kind: "text", text: "ChatView.tsx:120" }],
      },
    ]);
    expect(parseInline("[docs](https://example.dev)")[0]?.kind).toBe("link");
    expect(parseInline("[run](javascript:alert(1))").every((node) => node.kind === "text")).toBe(
      true,
    );
  });

  it("links names that are the chat's files, in code, links and prose, and leaves the rest", async () => {
    const text =
      "See `src/app.ts:4`, then src/styles.css:2 and [the view](src/components/ChatView.tsx#L9). `Sidebar.tsx` too; not `console.log` or `src/missing.ts`, nor [gone](src/gone.ts).";
    const links = await linked([
      "src/app.ts",
      "src/styles.css",
      "src/components/ChatView.tsx",
      "Sidebar.tsx",
      "src/missing.ts",
      "src/gone.ts",
    ]);
    const html = renderToStaticMarkup(
      <FileLinkContext.Provider value={links}>
        <Answer text={text} />
      </FileLinkContext.Provider>,
    );
    const files = [...html.matchAll(/data-file="([^"]+)"/g)].map((match) => match[1]);
    expect(files).toEqual([
      "src/app.ts",
      "src/styles.css",
      "src/components/ChatView.tsx",
      "src/components/Sidebar.tsx",
    ]);
    expect(html).toContain('title="Open src/app.ts, line 4, in Cursor"');
    expect(html).toContain('title="Open src/components/Sidebar.tsx in Cursor"');
    // The code keeps its look inside the link; a name that is no file stays code or text.
    expect(html).toContain("<code>src/app.ts:4</code></button>");
    expect(html).toContain("<code>console.log</code>");
    expect(html).toContain("<code>src/missing.ts</code>");
    expect(html).toContain("nor gone.");
    // Outside a chat nothing is a link, and prose is not even searched.
    const plain = renderToStaticMarkup(<Answer text={text} />);
    expect(plain).not.toContain("<button");
    expect(plain).toContain("<code>src/app.ts:4</code>");
  });

  it("never puts a link inside a link", async () => {
    const links = await linked(["src/components/ChatView.tsx", "src/app.ts"]);
    const html = renderToStaticMarkup(
      <FileLinkContext.Provider value={links}>
        <Answer text="[src/app.ts:3](src/components/ChatView.tsx#L120) and [see src/app.ts](https://example.dev)" />
      </FileLinkContext.Provider>,
    );
    expect(html.match(/<button/g)?.length).toBe(1);
    expect(html).toContain('data-file="src/components/ChatView.tsx"');
    expect(html).toContain(">see src/app.ts</a>");
  });

  it("links a tool's locations and a turn's changed files", async () => {
    const links = await linked(["C:/repo/src/app.ts", "src/styles.css"]);
    const html = renderToStaticMarkup(
      <FileLinkContext.Provider value={links}>
        <Locations
          locations={[
            { path: "C:/repo/src/app.ts", line: 12 },
            { path: "C:/elsewhere/b.ts", line: null },
          ]}
        />
        <ChangedFiles files={["src/styles.css"]} />
      </FileLinkContext.Provider>,
    );
    expect(html).toContain('title="Open src/app.ts, line 12, in Cursor"');
    expect(html).toContain(">C:/repo/src/app.ts:12</button>");
    expect(html).toContain("<li>C:/elsewhere/b.ts</li>");
    expect(html).toContain('data-file="src/styles.css"');
    expect(html).toContain(">styles.css</button>");
  });

  it("gives each file type its icon", () => {
    expect(fileIcon("src/app.tsx")).toBe(FileCode);
    expect(fileIcon("package.json")).toBe(FileJson);
    expect(fileIcon("Cargo.toml")).toBe(FileCog);
    expect(fileIcon("README.md")).toBe(FileText);
    expect(fileIcon("logo.svg")).toBe(FileImage);
    expect(fileIcon("scripts/build.ps1")).toBe(FileTerminal);
    expect(fileIcon("LICENSE")).toBe(File);
  });
});
