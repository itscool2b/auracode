import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AuthPrompt } from "../../bindings";
import type { BlobState, RequestState } from "../../lib/chat/chatStore";
import type { ErrorItem, PermissionItem, QuestionItem, ToolItem } from "../../lib/chat/transcript";
import { AuthCard } from "./AuthCard";
import { ErrorCard } from "./ErrorCard";
import { PermissionCard, rawInputSummary } from "./PermissionCard";
import { QuestionCard } from "./QuestionCard";
import { EventDetails, FullOutput, ToolBlock, ToolContentView } from "./ToolBlock";

const NO_BLOBS = new Map<string, BlobState>();
const noop = (): void => {};

function permission(overrides: Partial<PermissionItem["request"]> = {}): PermissionItem {
  return {
    kind: "permission",
    key: "permission:r1",
    request: {
      request_id: "r1",
      tool_call_id: null,
      title: "Run npm test",
      kind: "execute",
      raw_input: { command: "npm test" },
      content: [],
      locations: [{ path: "package.json", line: 3 }],
      options: [
        { option_id: "allow", kind: "allow_once", label: "Allow once" },
        { option_id: "reject", kind: "reject_once", label: "Reject" },
      ],
      truncated: null,
      ...overrides,
    },
    resolution: null,
  };
}

function permissionCard(item: PermissionItem, request?: RequestState): string {
  return renderToStaticMarkup(
    <PermissionCard
      item={item}
      request={request}
      onRespond={noop}
      blobs={NO_BLOBS}
      onLoadBlob={noop}
    />,
  );
}

/** Every `<button ...>label</button>` in `html`, with whether it is disabled. */
function buttons(html: string): { label: string; disabled: boolean }[] {
  return [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map((match) => ({
    label: (match[2] ?? "").replace(/<[^>]+>/g, ""),
    disabled: (match[1] ?? "").includes("disabled"),
  }));
}

describe("the permission card", () => {
  it("permission_card_flow: one button per option, all disabled while the answer is on its way", () => {
    const open = permissionCard(permission());
    expect(open).toContain("Run npm test");
    expect(open).toContain("&quot;command&quot;: &quot;npm test&quot;");
    expect(open).toContain("package.json:3");
    expect(buttons(open)).toEqual([
      { label: "Allow once", disabled: false },
      { label: "Reject", disabled: false },
    ]);
    const busy = permissionCard(permission(), { busy: true, gone: false, error: null });
    expect(buttons(busy).every((button) => button.disabled)).toBe(true);
  });

  it("permission_card_flow: a resolution or request_not_pending closes the card", () => {
    const resolved = permissionCard({
      ...permission(),
      resolution: { decision: { type: "selected", option_id: "allow" }, by: "auto" },
    });
    expect(buttons(resolved)).toEqual([]);
    expect(resolved).toContain("Auto-approved");
    expect(resolved).toContain('data-resolved="true"');
    const withdrawn = permissionCard({
      ...permission(),
      resolution: { decision: { type: "cancelled" }, by: "agent" },
    });
    expect(withdrawn).toContain("Withdrawn by the agent");
    const turn = permissionCard({
      ...permission(),
      resolution: { decision: { type: "cancelled" }, by: "turn" },
    });
    expect(turn).toContain("Closed when the turn ended");

    const gone = permissionCard(permission(), { busy: false, gone: true, error: null });
    expect(buttons(gone)).toEqual([]);
    expect(gone).toContain("no longer waiting for an answer");
    const failed = permissionCard(permission(), {
      busy: false,
      gone: false,
      error: "That option is not offered.",
    });
    expect(buttons(failed).every((button) => !button.disabled)).toBe(true);
    expect(failed).toContain('role="alert"');
  });

  it("permission_without_options: a card with no options offers Dismiss", () => {
    expect(buttons(permissionCard(permission({ options: [] })))).toEqual([
      { label: "Dismiss", disabled: false },
    ]);
    expect(buttons(permissionCard(permission())).map((button) => button.label)).not.toContain(
      "Dismiss",
    );
  });

  it("summarizes long raw input", () => {
    expect(rawInputSummary(null)).toBeNull();
    expect(rawInputSummary("ls -la")).toBe("ls -la");
    const long = rawInputSummary({ text: "x".repeat(5000) }) ?? "";
    expect(long.length).toBe(2001);
    expect(long.endsWith("…")).toBe(true);
  });
});

function question(prompt: QuestionItem["request"]["prompt"]): QuestionItem {
  return {
    kind: "question",
    key: "question:q1",
    request: { request_id: "q1", prompt },
    resolution: null,
  };
}

function questionCard(item: QuestionItem, request?: RequestState): string {
  return renderToStaticMarkup(<QuestionCard item={item} request={request} onRespond={noop} />);
}

describe("the question card", () => {
  it("question_card_flow: Yes and No, the choices, or a field and Submit, each with Dismiss", () => {
    expect(
      buttons(questionCard(question({ type: "confirm", message: "Proceed?" }))).map((b) => b.label),
    ).toEqual(["Yes", "No", "Dismiss"]);
    const select = questionCard(
      question({ type: "select", message: "Which color?", options: ["Red", "Green", "Blue"] }),
    );
    expect(select).toContain("Which color?");
    expect(buttons(select).map((b) => b.label)).toEqual(["Red", "Green", "Blue", "Dismiss"]);
    const input = questionCard(
      question({ type: "input", message: "Name?", placeholder: "my-app" }),
    );
    expect(input).toContain('placeholder="my-app"');
    expect(buttons(input).map((b) => b.label)).toEqual(["Submit", "Dismiss"]);
    expect(buttons(questionCard(question({ type: "notify", message: "FYI" })))).toEqual([]);
  });

  it("question_card_flow: disabled while answering; the answer or request_not_pending closes it", () => {
    const item = question({ type: "select", message: "Which color?", options: ["Red", "Green"] });
    const busy = questionCard(item, { busy: true, gone: false, error: null });
    expect(buttons(busy).every((button) => button.disabled)).toBe(true);
    const answered = questionCard({
      ...item,
      resolution: { answer: { type: "select", index: 1 }, by: "user" },
    });
    expect(buttons(answered)).toEqual([]);
    expect(answered).toContain("Green");
    const dismissed = questionCard({ ...item, resolution: { answer: null, by: "user" } });
    expect(dismissed).toContain("Dismissed");
    const gone = questionCard(item, { busy: false, gone: true, error: null });
    expect(buttons(gone)).toEqual([]);
    expect(gone).toContain("no longer waiting for an answer");
  });
});

describe("the error card", () => {
  const error: ErrorItem = {
    kind: "error",
    key: "error:4",
    errorKind: "spawn_failed",
    message: "Could not start hermes.",
    detail: "hermes: permission denied",
    recoverable: false,
  };

  it("shows the message, the redacted detail, the actions it has, and Show log", () => {
    const render = (retry: boolean, startFresh: boolean) =>
      renderToStaticMarkup(
        <ErrorCard
          item={error}
          actions={{ retry, startFresh }}
          onRetry={noop}
          onStartFresh={noop}
          onShowLog={noop}
        />,
      );
    const full = render(true, true);
    expect(full).toContain("Could not start hermes.");
    expect(full).toContain("<pre");
    expect(full).toContain("hermes: permission denied");
    expect(buttons(full).map((b) => b.label)).toEqual(["Retry", "Start fresh", "Show log"]);
    expect(buttons(render(false, false)).map((b) => b.label)).toEqual(["Show log"]);
  });
});

describe("the auth card", () => {
  it("auth_card_lists_commands: each sign-in command with its variables and Copy, then Retry", () => {
    const auth: AuthPrompt = {
      message: "Codex needs you to sign in.",
      commands: [
        {
          label: "Sign in with ChatGPT",
          argv: ["codex", "login"],
          env: [["CODEX_HOME", "/tmp/codex"]],
        },
        { label: "Use an API key", argv: ["codex", "login", "--api-key"], env: [] },
      ],
    };
    const html = renderToStaticMarkup(
      <AuthCard auth={auth} onRetry={noop} copy={() => Promise.resolve()} />,
    );
    expect(html).toContain("Codex needs you to sign in.");
    expect(html).toContain("Sign in with ChatGPT");
    expect(html).toContain("CODEX_HOME=/tmp/codex codex login");
    expect(html).toContain("Sets CODEX_HOME");
    expect(html).toContain("codex login --api-key");
    expect(buttons(html).map((b) => b.label)).toEqual(["Copy", "Copy", "Retry"]);
  });
});

describe("tool blocks and full outputs", () => {
  const tool: ToolItem = {
    kind: "tool",
    key: "tool:t1",
    id: "t1",
    toolKind: "execute",
    title: "Run cargo test",
    status: "in_progress",
    locations: [{ path: "src/lib.rs", line: null }],
    rawInput: null,
    toolName: null,
    content: [{ type: "terminal", output: "running 3 tests", exit_code: 0, truncated: null }],
    truncated: null,
  };

  it("shows the title, kind, the status its mark shows, locations and output", () => {
    const html = renderToStaticMarkup(
      <ToolBlock tool={tool} display="stopped" blobs={NO_BLOBS} onLoadBlob={noop} />,
    );
    expect(html).toContain("Run cargo test");
    expect(html).toContain("execute");
    expect(html).toContain('data-status="stopped"');
    expect(html).toContain(">Stopped<");
    expect(html).toContain("src/lib.rs");
    expect(html).toContain("running 3 tests");
    expect(html).toContain("exit 0");
    // A tool never announced shows its tool name, or a plain word.
    const unnamed = renderToStaticMarkup(
      <ToolBlock
        tool={{ ...tool, title: "" }}
        display="pending"
        blobs={NO_BLOBS}
        onLoadBlob={noop}
      />,
    );
    expect(unnamed).toContain(">Tool<");
  });

  it("load_full_output: offers the whole output, then the rest, then shows it all", () => {
    const sha = "c".repeat(64);
    const truncation = { total_bytes: 300_000, blob: sha };
    const offer = renderToStaticMarkup(
      <FullOutput truncation={truncation} blob={undefined} onLoadBlob={noop} />,
    );
    expect(buttons(offer)).toEqual([{ label: "Load full output (300k bytes)", disabled: false }]);
    const partial: BlobState = {
      text: "head ",
      nextOffset: 262_144,
      total: 300_000,
      eof: false,
      loading: false,
      error: null,
    };
    const more = renderToStaticMarkup(
      <FullOutput truncation={truncation} blob={partial} onLoadBlob={noop} />,
    );
    expect(buttons(more)).toEqual([{ label: "Load more (262.1k of 300k bytes)", disabled: false }]);
    const loading = renderToStaticMarkup(
      <FullOutput truncation={truncation} blob={{ ...partial, loading: true }} onLoadBlob={noop} />,
    );
    expect(buttons(loading)).toEqual([{ label: "Loading…", disabled: true }]);
    expect(
      renderToStaticMarkup(
        <FullOutput truncation={truncation} blob={{ ...partial, eof: true }} onLoadBlob={noop} />,
      ),
    ).toBe("");
    // Without a blob there is nothing to load: the card says the output was cut.
    expect(
      renderToStaticMarkup(
        <FullOutput
          truncation={{ total_bytes: 9000, blob: null }}
          blob={undefined}
          onLoadBlob={noop}
        />,
      ),
    ).toContain("Cut to fit");

    // Loaded text replaces the inline head.
    const blobs = new Map([[sha, { ...partial, text: "the whole output", eof: true }]]);
    const content = renderToStaticMarkup(
      <ToolContentView
        content={{ type: "text", text: "the who", truncated: truncation }}
        blobs={blobs}
        onLoadBlob={noop}
      />,
    );
    expect(content).toContain("the whole output");
  });

  it("load_full_output: a terminal output keeps its end while its full text pages in", () => {
    const sha = "f".repeat(64);
    // The full output is 30 bytes: 23 of start, then the end kept inline ("the end", 7 bytes).
    const full = "0123456789abcdefghijklmthe end";
    const content = {
      type: "terminal" as const,
      output: "the end",
      exit_code: 1,
      truncated: { total_bytes: 30, blob: sha },
    };
    const page = (loaded: number, eof = false): BlobState => ({
      text: full.slice(0, loaded),
      nextOffset: loaded,
      total: 30,
      eof,
      loading: false,
      error: null,
    });
    const render = (blob: BlobState | undefined, card = false) => {
      const blobs = new Map(blob ? [[sha, blob]] : []);
      return card
        ? renderToStaticMarkup(
            <PermissionCard
              item={permission({ content: [content] })}
              request={undefined}
              onRespond={noop}
              blobs={blobs}
              onLoadBlob={noop}
            />,
          )
        : renderToStaticMarkup(
            <ToolContentView content={content} blobs={blobs} onLoadBlob={noop} />,
          );
    };
    const pres = (html: string) =>
      [...html.matchAll(/<pre class="ui-pre">(.*?)<\/pre>/g)].map((match) => match[1]);

    expect(pres(render(undefined))).toEqual(["the end"]);
    // The first page stops short of the end: the start, what lies between, then the end.
    const partial = render(page(20));
    expect(pres(partial)).toEqual(["0123456789abcdefghij", "the end"]);
    expect(partial).toContain("3 bytes not loaded yet. The end of the output:");
    expect(partial).toContain("exit 1");
    expect(buttons(partial)).toEqual([{ label: "Load more (20 of 30 bytes)", disabled: false }]);
    // A permission card shows its content the same way.
    expect(pres(render(page(20), true))).toEqual(["0123456789abcdefghij", "the end"]);
    // Pages that reach into the end show it once, joined.
    expect(pres(render(page(25)))).toEqual([full]);
    const done = render(page(30, true));
    expect(pres(done)).toEqual([full]);
    expect(buttons(done)).toEqual([]);
  });

  it("load_full_output: the end joins the pages at a byte offset, across multibyte characters", () => {
    const sha = "9".repeat(64);
    // 14 bytes of start, then the end "é end" (6 bytes: "é" takes two).
    const full = "0123456789abcdé end";
    const blob: BlobState = {
      text: "0123456789abcdé",
      nextOffset: 16,
      total: 20,
      eof: false,
      loading: false,
      error: null,
    };
    const html = renderToStaticMarkup(
      <ToolContentView
        content={{
          type: "terminal",
          output: "é end",
          exit_code: null,
          truncated: { total_bytes: 20, blob: sha },
        }}
        blobs={new Map([[sha, blob]])}
        onLoadBlob={noop}
      />,
    );
    expect(html).toContain(`<pre class="ui-pre">${full}</pre>`);
  });

  it("load_full_output: says what an output longer than its kept 64 MiB lacks", () => {
    const sha = "8".repeat(64);
    // A blob keeps the first bytes of a longer output (here 20 of 100).
    const kept: BlobState = {
      text: "x".repeat(20),
      nextOffset: 20,
      total: 20,
      eof: true,
      loading: false,
      error: null,
    };
    const blobs = new Map([[sha, kept]]);
    const terminal = renderToStaticMarkup(
      <ToolContentView
        content={{
          type: "terminal",
          output: "the end",
          exit_code: null,
          truncated: { total_bytes: 100, blob: sha },
        }}
        blobs={blobs}
        onLoadBlob={noop}
      />,
    );
    expect(terminal).toContain("73 bytes in between weren&#x27;t kept");
    expect(terminal).toContain(">the end</pre>");
    const text = renderToStaticMarkup(
      <ToolContentView
        content={{ type: "text", text: "xxxx", truncated: { total_bytes: 100, blob: sha } }}
        blobs={blobs}
        onLoadBlob={noop}
      />,
    );
    expect(text).toContain("The remaining 80 bytes weren&#x27;t kept");
  });

  it("load_full_output: a diff that did not fit renders from its blob", () => {
    const sha = "d".repeat(64);
    const blobs = new Map([
      [
        sha,
        {
          text: JSON.stringify({ old_text: "a\n", new_text: "b\n" }),
          nextOffset: 30,
          total: 30,
          eof: true,
          loading: false,
          error: null,
        },
      ],
    ]);
    const html = renderToStaticMarkup(
      <ToolContentView
        content={{
          type: "diff",
          path: "x.rs",
          old_text: "",
          new_text: "",
          truncated: { total_bytes: 30, blob: sha },
        }}
        blobs={blobs}
        onLoadBlob={noop}
      />,
    );
    expect(html).toContain('data-op="remove"');
    expect(html).toContain('data-op="add"');
  });

  it("load_full_output: Show full details pages the event's own blob", () => {
    const sha = "e".repeat(64);
    const offer = renderToStaticMarkup(
      <EventDetails
        truncation={{ total_bytes: 20_000, blob: sha }}
        blobs={NO_BLOBS}
        onLoadBlob={noop}
      />,
    );
    expect(buttons(offer)).toEqual([{ label: "Show full details", disabled: false }]);
    const loaded = new Map([
      [
        sha,
        {
          text: '{"title":"Run"}',
          nextOffset: 15,
          total: 15,
          eof: true,
          loading: false,
          error: null,
        },
      ],
    ]);
    const shown = renderToStaticMarkup(
      <EventDetails truncation={{ total_bytes: 15, blob: sha }} blobs={loaded} onLoadBlob={noop} />,
    );
    expect(shown).toContain("&quot;title&quot;: &quot;Run&quot;");
  });
});
