import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AuthPrompt, ConfigOption, SlashCommand } from "../../bindings";
import { NewChatDraft } from "../../lib/chat/appStore";
import type { BlobState } from "../../lib/chat/chatStore";
import { ChatStore } from "../../lib/chat/chatStore";
import {
  attachResult,
  chatSummary,
  ev,
  FakeTransport,
  historyPage,
  items,
  lists,
  numbered,
  sessionInfo,
} from "../../lib/chat/testing";
import { applyEntries, emptyTranscript, renderTranscript } from "../../lib/chat/transcript";
import { Answer } from "../Markdown";
import { AuthCard } from "./AuthCard";
import { ChatList } from "./ChatList";
import { ChatView, StillWorking } from "./ChatView";
import { Composer, StopButton } from "./Composer";
import { ErrorCard } from "./ErrorCard";
import { Header } from "./Header";
import { NewChat } from "./NewChat";
import { decisionMark, PermissionCard } from "./PermissionCard";
import { Pickers } from "./Pickers";
import { answerMark, QuestionCard } from "./QuestionCard";
import { QueueList } from "./QueueList";
import { SlashMenu } from "./SlashMenu";
import { ToolBlock } from "./ToolBlock";
import { Transcript } from "./Transcript";
import { type TurnActions, TurnView } from "./TurnView";

/**
 * The contract between the chat screens and the smoke run (`lib/smokeChat.ts`, through
 * `lib/smokePage.ts`): every element the run finds carries its `data-testid`, and the state the
 * run reads is in its `data-test-*` attributes. Styles never select on these, so a restyle keeps
 * them; this test fails first when one goes missing.
 */

const noop = (): void => {};
const NO_BLOBS = new Map<string, BlobState>();

const ACTIONS: TurnActions = {
  blobs: NO_BLOBS,
  onLoadBlob: noop,
  requests: new Map(),
  onRespondPermission: noop,
  onRespondUi: noop,
  errorActions: () => ({ retry: true, startFresh: true }),
  onStart: noop,
  onShowLog: noop,
  canResume: true,
};

/** Every element in `html` whose `data-testid` is `testId`: its tag and its `data-test-*` values. */
function marked(html: string, testId: string): Record<string, string>[] {
  const found: Record<string, string>[] = [];
  for (const match of html.matchAll(/<([a-z]+)\b([^>]*)>/g)) {
    const attributes = match[2] ?? "";
    if (!attributes.includes(`data-testid="${testId}"`)) continue;
    const marks: Record<string, string> = { tag: match[1] ?? "" };
    for (const [, name, value] of attributes.matchAll(/data-test-([a-z-]+)="([^"]*)"/g)) {
      if (name !== undefined) marks[name] = value ?? "";
    }
    found.push(marks);
  }
  return found;
}

describe("the automation attributes of the chat screens", () => {
  it("mark New chat: the form, its agent picker, Refresh, the folder and Create", async () => {
    const draft = new NewChatDraft(
      new FakeTransport({ pickFolder: () => Promise.resolve("/work/app") }),
    );
    const html = (agents: Parameters<typeof NewChat>[0]["agents"]) =>
      renderToStaticMarkup(
        <NewChat
          agents={agents}
          refreshing={false}
          draft={draft}
          onRefreshAgents={noop}
          onCreated={noop}
        />,
      );
    const before = html(null);
    expect(marked(before, "new-chat")).toEqual([{ tag: "form" }]);
    expect(marked(before, "new-chat-agent")).toEqual([{ tag: "select" }]);
    expect(marked(before, "new-chat-refresh")).toEqual([{ tag: "button" }]);
    expect(marked(before, "new-chat-pick-folder")).toEqual([{ tag: "button" }]);
    expect(marked(before, "new-chat-folder")).toEqual([{ tag: "span", folder: "" }]);
    expect(marked(before, "new-chat-create")).toEqual([{ tag: "button" }]);

    draft.chooseAgent("mock");
    await draft.chooseFolder();
    const after = html([
      {
        id: "mock",
        name: "Demo agent",
        description: "",
        availability: { state: "ready", version: null, path: "built in" },
        launch: "built in",
        needs_download: false,
        last_verified: "",
        installation: null,
        latest_release: null,
      },
    ]);
    expect(marked(after, "new-chat-folder")).toEqual([{ tag: "span", folder: "/work/app" }]);
    // The run finds an agent by its option's value.
    expect(after).toContain('<option value="mock" selected="">Demo agent</option>');
  });

  it("mark the chat list: New chat and each chat's id, status, attention and folder state", () => {
    const html = renderToStaticMarkup(
      <ChatList
        chats={[
          chatSummary("a", { title: "Fix it", status: "running", needs_attention: true }),
          chatSummary("b", { folder: "/other", folder_state: "missing", status: "stopped" }),
        ]}
        error={null}
        selected="a"
        onSelect={noop}
        onNewChat={noop}
      />,
    );
    expect(marked(html, "chat-list")).toEqual([{ tag: "nav" }]);
    expect(marked(html, "new-chat-button")).toEqual([{ tag: "button" }]);
    expect(marked(html, "chat-row")).toEqual([
      { tag: "button", "chat-id": "a", status: "running", attention: "true", "folder-state": "ok" },
      {
        tag: "button",
        "chat-id": "b",
        status: "stopped",
        attention: "false",
        "folder-state": "missing",
      },
    ]);
    expect(marked(html, "chat-row-title")).toHaveLength(2);
  });

  it("mark the chat view with its chat and phase, and the still-working hint", () => {
    const view = renderToStaticMarkup(
      <ChatView
        chatId="c1"
        transport={new FakeTransport()}
        listed={null}
        storage={null}
        agents={null}
      />,
    );
    expect(marked(view, "chat-view")).toEqual([
      { tag: "div", "chat-id": "c1", phase: "attaching" },
    ]);
    expect(
      marked(renderToStaticMarkup(<StillWorking minutes={2} onStop={noop} />), "still-working"),
    ).toHaveLength(1);
  });

  it("mark the header: the status, the session controls and the usage", async () => {
    const fake = new FakeTransport();
    const store = new ChatStore("c1", fake);
    const opening = store.open();
    fake.lastAttach().resolve(
      attachResult("c1", 1, historyPage("c1", []), {
        session: sessionInfo({ status: "stopped" }),
        usage: { context_used: 1000, context_size: 2000, cost: null },
      }),
    );
    await opening;
    const header = (resumable: boolean) =>
      renderToStaticMarkup(
        <Header
          state={store.getSnapshot()}
          agent={null}
          resumable={resumable}
          onStart={noop}
          onStop={noop}
          onShowLog={noop}
        />,
      );
    expect(marked(header(true), "chat-status")).toEqual([{ tag: "span", status: "stopped" }]);
    expect(marked(header(true), "chat-start")).toEqual([{ tag: "button", resume: "true" }]);
    expect(marked(header(false), "chat-start")).toEqual([{ tag: "button", resume: "false" }]);
    expect(marked(header(true), "chat-start-fresh")).toHaveLength(1);
    expect(marked(header(true), "chat-show-log")).toHaveLength(1);
    expect(marked(header(true), "chat-usage")).toHaveLength(1);
  });

  it("mark the pickers: autonomy with what the agent applied, and each option by id", () => {
    const model: ConfigOption = {
      id: "model",
      name: "Model",
      description: null,
      category: "model",
      kind: {
        type: "select",
        current: "a",
        choices: [{ value: "a", name: "A", description: null, group: null }],
      },
      pending: null,
    };
    const fast: ConfigOption = {
      id: "fast",
      name: "Fast mode",
      description: null,
      category: "model_config",
      kind: { type: "toggle", current: false },
      pending: null,
    };
    const html = renderToStaticMarkup(
      <Pickers
        lists={lists(2, {
          options: [model, fast],
          autonomy: {
            requested: "ask",
            native_mode: "ask",
            auto_answer: { type: "never" },
            note: null,
          },
        })}
        autonomy="ask"
        status="ready"
        error={null}
        optionsSaving={new Map([["fast", { type: "toggle" as const, value: true }]])}
        onSetAutonomy={noop}
        onSetOption={noop}
      />,
    );
    expect(marked(html, "picker-autonomy")).toEqual([
      { tag: "select", requested: "ask", "native-mode": "ask", saving: "false" },
    ]);
    expect(marked(html, "picker-option")).toEqual([
      { tag: "div", "option-id": "model", saving: "false", value: "a" },
      { tag: "input", "option-id": "fast", saving: "true" },
    ]);
  });

  it("mark each segment and item of the transcript with the state the run compares", () => {
    const entries = numbered([
      ["t1", ev.turnStarted("t1", "p1")],
      ["t1", ev.user("t1.u", "Do it")],
      ["t1", ev.thought("th", "Hmm")],
      ["t1", ev.thoughtDone("th", 1200)],
      ["t1", ev.toolCall("read", { kind: "read" })],
      [
        "t1",
        ev.toolUpdate("read", {
          status: "completed",
          content: [{ type: "text", text: "fn main() {}", truncated: null }],
        }),
      ],
      ["t1", ev.permission("t1.p1")],
      ["t1", ev.permissionResolved("t1.p1", "allow", "auto")],
      ["t1", ev.question("t1.p2")],
      ["t1", ev.questionResolved("t1.p2", { type: "select", index: 1 })],
      ["t1", ev.message("t1.m1", "Done.")],
      ["t1", ev.messageDone("t1.m1")],
      ["t1", ev.error("agent_error", "It failed.")],
      ["t1", ev.plan("Read", "Edit")],
      ["t1", ev.turnEnded("t1", "interrupted", { recovered: true })],
      [null, ev.notice("Later.")],
    ]);
    const model = applyEntries(emptyTranscript(), entries);
    const segments = renderTranscript(model, false);
    const html = segments
      .map((segment) => renderToStaticMarkup(<TurnView segment={segment} actions={ACTIONS} />))
      .join("");
    expect(marked(html, "segment")).toEqual([
      {
        tag: "section",
        kind: "turn",
        "turn-id": "t1",
        "segment-key": "turn:t1",
        prompt: "Do it",
        "stop-reason": "interrupted",
        recovered: "true",
      },
      {
        tag: "section",
        kind: "outside",
        "turn-id": "",
        "segment-key": segments[1]?.key,
        prompt: "",
        "stop-reason": "",
        recovered: "false",
      },
    ]);
    expect(marked(html, "item")).toEqual([
      { tag: "div", kind: "user" },
      { tag: "details", kind: "thought", completed: "true", "duration-ms": "1200" },
      { tag: "div", kind: "tool", "tool-kind": "read", status: "completed" },
      {
        tag: "div",
        kind: "permission",
        "request-id": "t1.p1",
        "resolved-by": "auto",
        decision: "allow",
        gone: "false",
      },
      {
        tag: "div",
        kind: "question",
        "request-id": "t1.p2",
        "resolved-by": "user",
        answer: "select:1",
        gone: "false",
      },
      { tag: "div", kind: "message", completed: "true" },
      { tag: "div", kind: "error", "error-kind": "agent_error" },
      { tag: "p", kind: "notice", level: "info" },
    ]);
    expect(marked(html, "plan")).toHaveLength(1);
    expect(marked(html, "plan-entry")).toEqual([
      { tag: "li", status: "completed" },
      { tag: "li", status: "pending" },
    ]);
    expect(marked(html, "turn-footer")).toHaveLength(1);
    expect(marked(html, "turn-resume")).toHaveLength(1);
    expect(marked(html, "error-message")).toHaveLength(1);
    expect(marked(html, "question-prompt")).toHaveLength(1);
    expect(marked(html, "permission-title")).toHaveLength(1);
  });

  it("mark each markdown block of an answer with its kind", () => {
    const html = renderToStaticMarkup(
      <Answer
        text={
          "## Title\n\nSome text.\n\n- one\n- two\n\n1. first\n\n```rust\nfn main() {}\n```\n\n> quoted\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n"
        }
      />,
    );
    const kinds = [...html.matchAll(/data-test-block="([a-z]+)"/g)].map((match) => match[1]);
    expect(kinds).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "code",
      "quote",
      "table",
      "rule",
    ]);
  });

  it("mark the transcript and its Load earlier button", async () => {
    const fake = new FakeTransport();
    const store = new ChatStore("c1", fake);
    const opening = store.open();
    fake.lastAttach().resolve(
      attachResult(
        "c1",
        3,
        historyPage(
          "c1",
          items(
            numbered(
              [
                ["t1", ev.turnStarted("t1")],
                ["t1", ev.user("t1.u", "Hi")],
              ],
              1,
            ),
          ),
          { has_more: true, before_seq: 1 },
        ),
      ),
    );
    await opening;
    const html = renderToStaticMarkup(
      <Transcript state={store.getSnapshot()} live={true} actions={ACTIONS} onLoadEarlier={noop} />,
    );
    expect(marked(html, "transcript")).toEqual([{ tag: "div" }]);
    expect(marked(html, "load-earlier")).toEqual([{ tag: "button" }]);
    expect(marked(html, "segment")[0]).toMatchObject({ kind: "turn", "stop-reason": "" });
  });

  it("mark tool output: its type, whether it was cut, its text, diff lines and full-output buttons", () => {
    const html = renderToStaticMarkup(
      <ToolBlock
        tool={{
          kind: "tool",
          key: "tool:e",
          id: "e",
          toolKind: "edit",
          title: "Edit main.rs",
          status: "completed",
          locations: [{ path: "src/main.rs", line: 1 }],
          rawInput: null,
          toolName: null,
          content: [
            {
              type: "text",
              text: "cut",
              truncated: { total_bytes: 10, blob: "a".repeat(64) },
            },
            {
              type: "diff",
              path: "src/main.rs",
              old_text: "a\n",
              new_text: "b\n",
              truncated: null,
            },
          ],
          truncated: { total_bytes: 9000, blob: "b".repeat(64) },
        }}
        display="completed"
        blobs={NO_BLOBS}
        onLoadBlob={noop}
      />,
    );
    expect(marked(html, "item")).toEqual([
      { tag: "div", kind: "tool", "tool-kind": "edit", status: "completed" },
    ]);
    expect(marked(html, "tool-output")).toEqual([{ tag: "details" }]);
    expect(marked(html, "tool-locations")).toHaveLength(1);
    expect(marked(html, "tool-content")).toEqual([
      { tag: "div", type: "text", truncated: "true" },
      { tag: "div", type: "diff", truncated: "false" },
    ]);
    expect(marked(html, "tool-text")).toEqual([{ tag: "pre" }]);
    expect(html).toContain('data-test-op="add"');
    expect(html).toContain('data-test-op="remove"');
    expect(marked(html, "load-full-output")).toEqual([{ tag: "button" }]);
    expect(marked(html, "show-full-details")).toEqual([{ tag: "button" }]);
  });

  it("mark a waiting permission card's options and Dismiss, and say how cards were resolved", () => {
    const card = (options: { option_id: string; kind: "allow_once"; label: string }[]) =>
      renderToStaticMarkup(
        <PermissionCard
          item={{
            kind: "permission",
            key: "permission:r1",
            request: {
              request_id: "r1",
              tool_call_id: null,
              title: "Run ls",
              kind: "execute",
              raw_input: null,
              content: [],
              locations: [],
              options,
              truncated: null,
            },
            resolution: null,
          }}
          request={undefined}
          onRespond={noop}
          blobs={NO_BLOBS}
          onLoadBlob={noop}
        />,
      );
    const open = card([{ option_id: "allow", kind: "allow_once", label: "Allow once" }]);
    expect(marked(open, "item")[0]).toMatchObject({ "resolved-by": "", decision: "" });
    expect(marked(open, "permission-option")).toEqual([
      { tag: "button", "option-id": "allow", "option-kind": "allow_once" },
    ]);
    expect(marked(card([]), "permission-dismiss")).toEqual([{ tag: "button" }]);
    expect(decisionMark({ type: "selected", option_id: "reject" })).toBe("reject");
    expect(decisionMark({ type: "cancelled" })).toBe("cancelled");
  });

  it("mark a question's choices, Yes and No, its text answer and Dismiss", () => {
    const card = (prompt: Parameters<typeof QuestionCard>[0]["item"]["request"]["prompt"]) =>
      renderToStaticMarkup(
        <QuestionCard
          item={{
            kind: "question",
            key: "q",
            request: { request_id: "q1", prompt },
            resolution: null,
          }}
          request={undefined}
          onRespond={noop}
        />,
      );
    const select = card({ type: "select", message: "Which color?", options: ["Red", "Green"] });
    expect(marked(select, "question-choice")).toEqual([
      { tag: "button", index: "0" },
      { tag: "button", index: "1" },
    ]);
    expect(marked(select, "question-dismiss")).toHaveLength(1);
    const confirm = card({ type: "confirm", message: "Sure?" });
    expect(marked(confirm, "question-yes")).toHaveLength(1);
    expect(marked(confirm, "question-no")).toHaveLength(1);
    const input = card({ type: "input", message: "Name?", placeholder: null });
    expect(marked(input, "question-input")).toEqual([{ tag: "input" }]);
    expect(marked(input, "question-submit")).toEqual([{ tag: "button" }]);
    expect(answerMark(null)).toBe("dismissed");
    expect(answerMark({ type: "confirm", yes: true })).toBe("confirm:yes");
    expect(answerMark({ type: "confirm", yes: false })).toBe("confirm:no");
    expect(answerMark({ type: "select", index: 2 })).toBe("select:2");
    expect(answerMark({ type: "input", text: "Ada" })).toBe("input:Ada");
  });

  it("mark an error card's kind, message, detail and actions", () => {
    const html = renderToStaticMarkup(
      <ErrorCard
        item={{
          kind: "error",
          key: "error:1",
          errorKind: "agent_exited",
          message: "The agent stopped unexpectedly.",
          detail: "panicked",
          recoverable: true,
        }}
        actions={{ retry: true, startFresh: true }}
        onRetry={noop}
        onStartFresh={noop}
        onShowLog={noop}
      />,
    );
    expect(marked(html, "item")).toEqual([
      { tag: "div", kind: "error", "error-kind": "agent_exited" },
    ]);
    for (const id of ["error-message", "error-detail", "error-retry", "error-start-fresh"]) {
      expect(marked(html, id), id).toHaveLength(1);
    }
    expect(marked(html, "error-show-log")).toHaveLength(1);
  });

  it("mark the sign-in card, its commands and Retry", () => {
    const auth: AuthPrompt = {
      message: "Sign in.",
      commands: [{ label: "Sign in", argv: ["demo-agent", "login"], env: [] }],
    };
    const html = renderToStaticMarkup(<AuthCard auth={auth} onRetry={noop} />);
    expect(marked(html, "auth-card")).toEqual([{ tag: "div" }]);
    expect(marked(html, "auth-message")).toHaveLength(1);
    expect(html).toMatch(/data-testid="auth-command"[^>]*>demo-agent login</);
    expect(marked(html, "auth-copy")).toHaveLength(1);
    expect(marked(html, "auth-retry")).toHaveLength(1);
  });

  it("mark the queue's prompts with whether they are held, Remove and Send queued", () => {
    const html = renderToStaticMarkup(
      <QueueList
        queue={[
          { prompt_id: "p1", preview: "/echo one", held: true, created_at: 1 },
          { prompt_id: "p2", preview: "/echo two", held: false, created_at: 2 },
        ]}
        held={true}
        onRemove={noop}
        onSendQueued={noop}
      />,
    );
    expect(marked(html, "queue")).toEqual([{ tag: "section" }]);
    expect(marked(html, "queued-prompt")).toEqual([
      { tag: "li", "prompt-id": "p1", held: "true" },
      { tag: "li", "prompt-id": "p2", held: "false" },
    ]);
    expect(html).toMatch(/data-testid="queued-preview"[^>]*>\/echo one</);
    expect(marked(html, "queued-remove")).toHaveLength(2);
    expect(marked(html, "send-queued")).toEqual([{ tag: "button" }]);
  });

  it("mark the composer, Stop and Force stop, and the slash menu's commands", () => {
    const composer = renderToStaticMarkup(
      <Composer
        status="ready"
        commands={[]}
        error={null}
        onSend={() => Promise.resolve(true)}
        onStop={noop}
        onForceStop={noop}
      />,
    );
    expect(marked(composer, "composer-input")).toEqual([{ tag: "textarea" }]);
    expect(marked(composer, "composer-send")).toEqual([{ tag: "button" }]);
    const stop = (status: Parameters<typeof StopButton>[0]["status"]) =>
      renderToStaticMarkup(<StopButton status={status} onStop={noop} onForceStop={noop} />);
    expect(marked(stop("running"), "composer-stop")).toHaveLength(1);
    expect(marked(stop("cancelling"), "composer-force-stop")).toHaveLength(1);
    const commands: SlashCommand[] = [{ name: "echo", description: "Echo", input_hint: null }];
    const menu = renderToStaticMarkup(
      <SlashMenu id="menu" commands={commands} active={0} onChoose={noop} />,
    );
    expect(marked(menu, "slash-menu")).toEqual([{ tag: "ul" }]);
    expect(marked(menu, "slash-command")).toEqual([{ tag: "button", name: "echo" }]);
  });
});
