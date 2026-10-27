import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentEntry, ConfigOption } from "../../bindings";
import { NewChatDraft } from "../../lib/chat/appStore";
import { type ChatState, ChatStore } from "../../lib/chat/chatStore";
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
import { dockAgents, dockState } from "./AgentDock";
import { Banners, envBanner, RecoveryBannerView, storageBanner } from "./Banners";
import { ChatList, projectName, projectsOf } from "./ChatList";
import { StillWorking } from "./ChatView";
import { StopButton } from "./Composer";
import { Header } from "./Header";
import { downloadNote, InstallationStatus, NewChat } from "./NewChat";
import { Pickers } from "./Pickers";
import { initials } from "./ProfileStatus";
import { QueueEditor, QueueList } from "./QueueList";
import { Transcript } from "./Transcript";
import { type TurnActions, TurnView } from "./TurnView";

const noop = (): void => {};

function buttons(html: string): { label: string; disabled: boolean }[] {
  return [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map((match) => ({
    label: match[1]?.match(/aria-label="([^"]+)"/)?.[1] ?? (match[2] ?? "").replace(/<[^>]+>/g, ""),
    disabled: (match[1] ?? "").includes("disabled"),
  }));
}

function agent(
  id: string,
  availability: AgentEntry["availability"],
  extra: Partial<AgentEntry> = {},
): AgentEntry {
  return {
    id,
    name: id,
    description: `${id} agent`,
    availability,
    launch: id,
    needs_download: false,
    last_verified: "",
    installation: null,
    latest_release: null,
    ...extra,
  };
}

/** A chat view's state after attaching with `page`. */
async function stateWith(
  page = historyPage("c1", []),
  snapshot: Parameters<typeof attachResult>[3] = {},
): Promise<ChatState> {
  const fake = new FakeTransport();
  const store = new ChatStore("c1", fake);
  const opening = store.open();
  fake.lastAttach().resolve(attachResult("c1", 50, page, snapshot));
  await opening;
  return store.getSnapshot();
}

const ACTIONS: TurnActions = {
  blobs: new Map(),
  onLoadBlob: noop,
  requests: new Map(),
  onRespondPermission: noop,
  onRespondUi: noop,
  errorActions: () => ({ retry: false, startFresh: false }),
  onStart: noop,
  onShowLog: noop,
  canResume: true,
};

describe("New chat", () => {
  it("unavailable_agent_disabled: agents that can't run here are not offered and show their reason", () => {
    const agents = [
      agent("mock", { state: "ready", version: null, path: "built in" }),
      agent("claude-acp", {
        state: "missing",
        reason: "Node.js 22 or newer is required (found 20.11.0).",
      }),
      agent("hermes", { state: "broken", reason: "hermes --version failed." }),
    ];
    const html = renderToStaticMarkup(
      <NewChat
        agents={agents}
        refreshing={false}
        draft={new NewChatDraft(new FakeTransport())}
        onRefreshAgents={noop}
        onCreated={noop}
      />,
    );
    // Only agents that can run are offered as choices; the others wait under Other agents.
    expect(html).toMatch(
      /<input type="radio"(?=[^>]*value="mock")(?=[^>]*aria-label="mock, ready")/,
    );
    expect(html).not.toContain('value="claude-acp"');
    expect(html).not.toContain('value="hermes"');
    expect(html).toContain("Other agents");
    expect(html).toMatch(
      /data-test-unavailable="claude-acp".*Node\.js 22 or newer is required \(found 20\.11\.0\)\./,
    );
    expect(html).toMatch(/data-test-unavailable="hermes".*hermes --version failed\./);
    // Nothing chosen yet: Create waits for an agent and a folder.
    expect(buttons(html).find((b) => b.label === "Create")?.disabled).toBe(true);
    expect(buttons(html).find((b) => b.label === "Refresh agents")?.disabled).toBe(false);
  });

  it("states the one-time download before the chat that needs it is created", () => {
    const adapter = agent(
      "claude-acp",
      {
        state: "ready",
        version: "Claude Code 2.1.310 via claude-agent-acp 0.95.0",
        path: "/usr/local/bin/claude",
      },
      {
        needs_download: true,
        launch: "@agentclientprotocol/claude-agent-acp 0.95.0 with your claude",
      },
    );
    expect(downloadNote(adapter)).toBe(
      "Creating this chat downloads @agentclientprotocol/claude-agent-acp 0.95.0 from npm (one time).",
    );
    expect(downloadNote({ ...adapter, needs_download: false })).toBeNull();
    const draft = new NewChatDraft(new FakeTransport());
    draft.chooseAgent("claude-acp");
    const html = renderToStaticMarkup(
      <NewChat
        agents={[adapter]}
        refreshing={true}
        draft={draft}
        onRefreshAgents={noop}
        onCreated={noop}
      />,
    );
    expect(html).toContain(
      "Creating this chat downloads @agentclientprotocol/claude-agent-acp 0.95.0",
    );
    expect(html).toContain("Claude Code 2.1.310 via claude-agent-acp 0.95.0");
    expect(buttons(html).find((b) => b.label === "Refreshing…")?.disabled).toBe(true);
  });

  it("shows untested version and bundle ownership without claiming compatibility", () => {
    const html = renderToStaticMarkup(
      <InstallationStatus
        installation={{
          agent_id: "codex",
          provider: "codex",
          host: { type: "wsl", distro: "Ubuntu" },
          launch_path: "/bin/codex",
          resolved_path: null,
          version: "0.170.0",
          channel: { type: "bundled", application: "Editor" },
          verification: { state: "untested", last_verified: "0.162.1" },
        }}
      />,
    );
    expect(html).toContain("Managed by Editor");
    expect(html).toContain("WSL Ubuntu");
    expect(html).toContain("Untested version");
    expect(html).toContain("Last verified: 0.162.1");
  });
});

describe("the chat list", () => {
  it("groups chats into projects by folder, with titles, status, folder state and attention", () => {
    const chats = [
      chatSummary("a", {
        folder: "/code/app",
        title: "Fix the test",
        status: "running",
        needs_attention: true,
      }),
      chatSummary("b", { folder: "/code/site", title: null, folder_state: "missing" }),
      chatSummary("c", { folder: "/code/app", title: "Older", folder_state: "not_allowed" }),
    ];
    expect(projectsOf(chats).map((p) => [p.folder, p.chats.map((c) => c.id)])).toEqual([
      ["/code/app", ["a", "c"]],
      ["/code/site", ["b"]],
    ]);
    expect(projectName("/Users/me/code/app/")).toBe("app");
    expect(projectName("C:\\code\\site")).toBe("site");
    const html = renderToStaticMarkup(
      <ChatList chats={chats} error={null} selected="a" onSelect={noop} onNewChat={noop} />,
    );
    expect(html).toContain("Fix the test");
    expect(html).toContain("New chat</span>");
    expect(html).toContain("Demo agent · Waiting for your answer");
    expect(html).toContain("folder missing");
    expect(html).toContain("folder not allowed");
    expect(html).toContain('aria-label="Waiting for your answer"');
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });
});

describe("the agent dock", () => {
  const ready = { state: "ready", version: "1.0.0", path: "/bin/agent" } as const;
  const missing = { state: "missing", reason: "Not installed." } as const;

  it("shows one tile per usable product, native first, and keeps the rest behind +N", () => {
    const catalog = [
      agent("claude", ready),
      agent("claude-acp", ready),
      agent("codex", missing),
      agent("codex-acp", ready),
      agent("pi", { state: "checking" }),
      agent("cursor", missing),
      agent("mock", ready),
    ];
    const { shown, rest } = dockAgents(catalog);
    expect(shown.map((entry) => entry.id)).toEqual(["claude", "codex-acp", "pi"]);
    expect(rest.map((entry) => entry.id)).toEqual(["claude-acp", "codex", "cursor", "mock"]);
    // With no real agent usable, the scripted demo is the one tile.
    expect(dockAgents([agent("claude", missing), agent("mock", ready)]).shown).toHaveLength(1);
  });

  it("gives each tile its state: needs you over working over sign-in over ready", () => {
    const claude = agent("claude", ready);
    const chat = (extra: Parameters<typeof chatSummary>[1]) =>
      chatSummary("c", { agent_id: "claude", ...extra });
    expect(dockState(claude, [])).toBe("ready");
    expect(dockState(agent("pi", { state: "checking" }), [])).toBe("checking");
    expect(dockState(claude, [chat({ status: "auth_required" })])).toBe("sign-in");
    expect(dockState(claude, [chat({ status: "running" })])).toBe("running");
    expect(dockState(claude, [chat({ status: "running" }), chat({ needs_attention: true })])).toBe(
      "waiting",
    );
  });

  it("names the profile by its initials", () => {
    expect(initials("Local")).toBe("L");
    expect(initials("Work account")).toBe("WA");
    expect(initials("  ")).toBe("?");
  });
});

describe("the header", () => {
  it("offers Start or Resume, and Start fresh, while nothing runs; Stop session while it runs", async () => {
    const stopped = await stateWith(historyPage("c1", []), {
      session: sessionInfo({ status: "stopped" }),
    });
    const fresh = renderToStaticMarkup(
      <Header
        state={stopped}
        agent={null}
        resumable={false}
        onStart={noop}
        onStop={noop}
        onShowLog={noop}
      />,
    );
    // The menu ends on the session's lifecycle, after the quieter actions.
    expect(buttons(fresh).map((b) => b.label)).toEqual(["Show log", "Start session"]);
    const resumable = renderToStaticMarkup(
      <Header
        state={stopped}
        agent={null}
        resumable={true}
        onStart={noop}
        onStop={noop}
        onShowLog={noop}
      />,
    );
    expect(buttons(resumable).map((b) => b.label)).toEqual([
      "Show log",
      "Resume session",
      "Start fresh",
    ]);
    // The list has the newer folder state (it reloads after a failed start); the snapshot is from
    // the join.
    expect(fresh).not.toContain("folder missing");
    const missing = renderToStaticMarkup(
      <Header
        state={stopped}
        listed={chatSummary("c1", { folder_state: "missing", status: "failed" })}
        agent={null}
        resumable={false}
        onStart={noop}
        onStop={noop}
        onShowLog={noop}
      />,
    );
    expect(missing).toContain("folder missing");

    const running = await stateWith(historyPage("c1", []), {
      session: sessionInfo({
        status: "running",
        detail: "Applying your settings",
        agent_version: "0.22.5",
      }),
      usage: {
        context_used: 12_000,
        context_size: 200_000,
        cost: { amount: 0.02, currency: "USD" },
      },
    });
    const html = renderToStaticMarkup(
      <Header
        state={running}
        agent={null}
        resumable={true}
        onStart={noop}
        onStop={noop}
        onShowLog={noop}
      />,
    );
    expect(buttons(html).map((b) => b.label)).toEqual(["Show log", "Stop session"]);
    expect(html).toContain("Working");
    expect(html).toContain("Applying your settings");
    expect(html).toContain("0.22.5");
    // With detection's answer, the binary that runs is what the header names.
    const detected = renderToStaticMarkup(
      <Header
        state={running}
        agent={agent("mock", {
          state: "ready",
          version: "Claude Code 2.1.310 via claude-agent-acp 0.95.0",
          path: "/bin/claude",
        })}
        resumable={true}
        onStart={noop}
        onStop={noop}
        onShowLog={noop}
      />,
    );
    expect(detected).toContain("Claude Code 2.1.310 via claude-agent-acp 0.95.0");
    expect(detected).toContain('class="ui-mono">/bin/claude</span>');
    expect(html).toContain("Context 12k of 200k · $0.0200");
    expect(html).toContain("/Users/me/code/app");
  });
});

describe("the pickers", () => {
  const model: ConfigOption = {
    id: "model",
    name: "Model",
    description: null,
    category: "model",
    kind: {
      type: "select",
      current: "fast",
      choices: [
        { value: "fast", name: "Fast", description: null, group: null },
        { value: "smart", name: "Smart", description: null, group: null },
      ],
    },
    pending: { type: "choice", value: "smart" },
  };
  const toggle: ConfigOption = {
    id: "fast",
    name: "Fast mode",
    description: null,
    category: "other",
    kind: { type: "toggle", current: true },
    pending: null,
  };

  it("enable options only while the agent is ready or working; autonomy always", () => {
    const render = (status: Parameters<typeof Pickers>[0]["status"]) =>
      renderToStaticMarkup(
        <Pickers
          lists={lists(1, { options: [toggle, model] })}
          autonomy="full_auto"
          status={status}
          error={null}
          onSetAutonomy={noop}
          onSetOption={noop}
        />,
      );
    const stopped = render("stopped");
    expect(stopped.match(/<button[^>]*data-picker-value[^>]*disabled/g)).toHaveLength(2);
    expect(stopped).toMatch(/<input[^>]*type="checkbox"[^>]*disabled/);
    expect(stopped).toContain("A local checkpoint is saved before each turn.");
    expect(stopped).toContain("(pending: Smart)");
    expect(stopped.indexOf("Model")).toBeLessThan(stopped.indexOf("Fast mode"));
    const ready = render("ready");
    expect(ready).not.toMatch(/disabled/);
  });

  it("show the value a change on its way asked for, marked, instead of the old one", () => {
    const html = renderToStaticMarkup(
      <Pickers
        lists={lists(1, { options: [toggle, { ...model, pending: null }] })}
        autonomy="full_auto"
        status="ready"
        error={null}
        optionsSaving={
          new Map([
            ["model", { type: "choice" as const, value: "smart" }],
            ["fast", { type: "toggle" as const, value: false }],
          ])
        }
        autonomySaving="ask"
        onSetAutonomy={noop}
        onSetOption={noop}
      />,
    );
    expect(html).toContain('<option value="ask" selected="">Ask</option>');
    expect(html).toMatch(/data-picker-value="smart" aria-pressed="true"/);
    expect(html).not.toMatch(/<input[^>]*checked/);
    expect(html.match(/\(saving…\)/g)).toHaveLength(3);
    // Nothing on its way: the lists' own values.
    const settledHtml = renderToStaticMarkup(
      <Pickers
        lists={lists(1, { options: [toggle, { ...model, pending: null }] })}
        autonomy="full_auto"
        status="ready"
        error={null}
        onSetAutonomy={noop}
        onSetOption={noop}
      />,
    );
    expect(settledHtml).toMatch(/data-picker-value="fast" aria-pressed="true"/);
    expect(settledHtml).toMatch(/<input[^>]*checked/);
    expect(settledHtml).not.toContain("(saving…)");
  });

  it("show the autonomy note and the agent mode in effect", () => {
    const html = renderToStaticMarkup(
      <Pickers
        lists={lists(2, {
          autonomy: {
            requested: "ask",
            native_mode: "acceptEdits",
            auto_answer: { type: "never" },
            note: "Applies when the agent starts.",
          },
        })}
        autonomy="full_auto"
        status="stopped"
        error="The agent refused that model."
        onSetAutonomy={noop}
        onSetOption={noop}
      />,
    );
    expect(html).toContain('<option value="ask" selected="">Ask</option>');
    expect(html).not.toContain("changes are not checkpointed yet");
    expect(html).toContain("Applies when the agent starts.");
    expect(html).toContain("Agent mode: acceptEdits");
    expect(html).toContain("The agent refused that model.");
  });
});

describe("the queue and the composer's stop button", () => {
  it("marks held prompts and offers Send queued for them", () => {
    const html = renderToStaticMarkup(
      <QueueList
        queue={[
          { prompt_id: "p1", preview: "first", held: true, created_at: 1 },
          { prompt_id: "p2", preview: "second", held: false, created_at: 2 },
        ]}
        held={true}
        onRemove={noop}
        onSendQueued={noop}
      />,
    );
    expect(html.match(/>held</g)).toHaveLength(1);
    expect(buttons(html).map((b) => b.label)).toEqual([
      "Send queued",
      "Remove from the queue",
      "Remove from the queue",
    ]);
    expect(
      renderToStaticMarkup(
        <QueueList queue={[]} held={false} onRemove={noop} onSendQueued={noop} />,
      ),
    ).toBe("");
  });

  it("offers Send queued whenever the session says prompts are held, marked or not", () => {
    const unmarked = [{ prompt_id: "p1", preview: "first", held: false, created_at: 1 }];
    const held = renderToStaticMarkup(
      <QueueList queue={unmarked} held={true} onRemove={noop} onSendQueued={noop} />,
    );
    expect(buttons(held).map((b) => b.label)).toEqual(["Send queued", "Remove from the queue"]);
    const none = renderToStaticMarkup(
      <QueueList queue={unmarked} held={false} onRemove={noop} onSendQueued={noop} />,
    );
    expect(buttons(none).map((b) => b.label)).toEqual(["Remove from the queue"]);
    // A held prompt the list does not know yet (its join is on its way) still gets the button.
    const unknown = renderToStaticMarkup(
      <QueueList queue={[]} held={true} onRemove={noop} onSendQueued={noop} />,
    );
    expect(buttons(unknown).map((b) => b.label)).toEqual(["Send queued"]);
  });

  it("edits and reorders queued messages with buttons, never by dragging alone", () => {
    const html = renderToStaticMarkup(
      <QueueList
        queue={[
          { prompt_id: "p1", preview: "first", held: false, created_at: 1 },
          { prompt_id: "p2", preview: "second", held: false, created_at: 2 },
        ]}
        held={false}
        onRemove={noop}
        onSendQueued={noop}
        onLoadText={async () => "first"}
        onEdit={async () => null}
        onMove={async () => {}}
      />,
    );
    expect(buttons(html)).toEqual([
      { label: "Edit queued message", disabled: false },
      { label: "Move up in the queue", disabled: true },
      { label: "Move down in the queue", disabled: false },
      { label: "Remove from the queue", disabled: false },
      { label: "Edit queued message", disabled: false },
      { label: "Move up in the queue", disabled: false },
      { label: "Move down in the queue", disabled: true },
      { label: "Remove from the queue", disabled: false },
    ]);
    expect(html).not.toContain("draggable");
  });

  it("opens a queued message's words in a labelled field with Cancel and Save", () => {
    const html = renderToStaticMarkup(
      <QueueEditor initial="first draft" onSave={async () => null} onCancel={noop} />,
    );
    expect(html).toContain('aria-label="Queued message"');
    expect(html).toContain(">first draft</textarea>");
    expect(buttons(html).map((b) => b.label)).toEqual(["Cancel", "Save"]);
  });

  it("escape_twice: Stop while a turn runs or starts, Force stop while it cancels", () => {
    const label = (status: Parameters<typeof StopButton>[0]["status"]) =>
      buttons(
        renderToStaticMarkup(<StopButton status={status} onStop={noop} onForceStop={noop} />),
      ).map((b) => b.label);
    expect(label("running")).toEqual(["Stop"]);
    expect(label("starting")).toEqual(["Stop"]);
    expect(label("cancelling")).toEqual(["Force stop"]);
    expect(label("ready")).toEqual([]);
    expect(label("stopped")).toEqual([]);
  });

  it("still_working_indicator: counts the minutes and offers Stop", () => {
    expect(renderToStaticMarkup(<StillWorking minutes={1} onStop={noop} />)).toContain(
      "Still working (no output for 1 minute)",
    );
    const two = renderToStaticMarkup(<StillWorking minutes={2} onStop={noop} />);
    expect(two).toContain("Still working (no output for 2 minutes)");
    expect(buttons(two).map((b) => b.label)).toEqual(["Stop"]);
  });
});

describe("turns and the transcript", () => {
  it("ends a turn with its stop reason, tokens with their scope, duration and cost", () => {
    const model = applyEntries(
      emptyTranscript(),
      numbered([
        ["t1", ev.turnStarted("t1")],
        ["t1", ev.usage(0.0123)],
        [
          "t1",
          {
            type: "turn_ended",
            turn_id: "t1",
            stop_reason: "max_tokens",
            usage: {
              input_tokens: 1200,
              output_tokens: 300,
              cache_read_tokens: null,
              cache_write_tokens: null,
              reasoning_tokens: null,
              scope: "turn",
            },
            duration_ms: 8200,
            recovered: false,
          },
        ],
        ["t2", ev.turnStarted("t2")],
        ["t2", ev.turnEnded("t2", "interrupted", { recovered: true })],
      ]),
    );
    const [first, second] = renderTranscript(model, false);
    if (!first || !second) throw new Error("two turns");
    const html = renderToStaticMarkup(<TurnView segment={first} actions={ACTIONS} />);
    expect(html).toContain("Stopped at the output limit");
    expect(html).toContain("1.2k in · 300 out (this turn)");
    expect(html).toContain("8.2 s");
    expect(html).toContain("$0.0123");
    const recovered = renderToStaticMarkup(<TurnView segment={second} actions={ACTIONS} />);
    expect(recovered).toContain("Interrupted when auracode closed");
    expect(buttons(recovered).map((b) => b.label)).toEqual(["Copy turn receipt", "Resume session"]);
    const live = renderToStaticMarkup(
      <TurnView segment={second} actions={{ ...ACTIONS, canResume: false }} />,
    );
    expect(buttons(live)).toEqual([{ label: "Copy turn receipt", disabled: false }]);
  });

  it("partial_turn_page: Load earlier, and the marker of a turn the page cut", async () => {
    const page = historyPage(
      "c1",
      items(
        numbered(
          [
            ["t1", ev.message("t1.m1", "the end of a long turn")],
            ["t1", ev.turnEnded("t1")],
          ],
          40,
        ),
      ),
      { has_more: true, before_seq: 40, cut_turn_id: "t1" },
    );
    const state = await stateWith(page);
    const html = renderToStaticMarkup(
      <Transcript state={state} live={true} actions={ACTIONS} onLoadEarlier={noop} />,
    );
    expect(buttons(html).map((b) => b.label)).toContain("Load earlier");
    expect(html).toContain("Earlier part of this turn not loaded");
    expect(html).toContain("the end of a long turn");
    expect(html.indexOf("Load earlier")).toBeLessThan(html.indexOf("Earlier part of this turn"));
  });

  it("unsaved_marker_and_reattach: marks the unsaved rows where they are missing", async () => {
    const page = historyPage("c1", items(numbered([[null, ev.notice("saved before the pause")]])), {
      unsaved_from: 1,
    });
    const state = await stateWith(page);
    const html = renderToStaticMarkup(
      <Transcript state={state} live={true} actions={ACTIONS} onLoadEarlier={noop} />,
    );
    expect(html).toContain(
      "Recent output isn&#x27;t saved yet; it appears here when saving resumes.",
    );
    expect(html.indexOf("saved before the pause")).toBeLessThan(html.indexOf("Recent output"));
  });
});

describe("the banners", () => {
  it("show the database repair notice until the shell confirms its dismissal", () => {
    const message = "Your database was damaged, so auracode rebuilt it.";
    const shown = renderToStaticMarkup(
      <RecoveryBannerView
        message={message}
        state={{ status: "shown", problem: null }}
        onDismiss={noop}
      />,
    );
    expect(shown).toContain(message);
    expect(buttons(shown)).toEqual([{ label: "Dismiss", disabled: false }]);
    const busy = renderToStaticMarkup(
      <RecoveryBannerView message={message} state={{ status: "dismissing" }} onDismiss={noop} />,
    );
    expect(buttons(busy)).toEqual([{ label: "Dismissing…", disabled: true }]);
    const failed = renderToStaticMarkup(
      <RecoveryBannerView
        message={message}
        state={{
          status: "shown",
          problem: "Could not dismiss the notice: the database is closed.",
        }}
        onDismiss={noop}
      />,
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("the database is closed.");
    expect(
      renderToStaticMarkup(
        <RecoveryBannerView message={message} state={{ status: "dismissed" }} onDismiss={noop} />,
      ),
    ).toBe("");
  });

  it("show paused or failed saving, the env fallback with Retry, and notices", () => {
    expect(storageBanner(null)).toBeNull();
    expect(storageBanner({ state: { state: "ok" }, unsaved_bytes: 0 })).toBeNull();
    expect(
      storageBanner({
        state: { state: "paused", reason: "disk_full", since: 1 },
        unsaved_bytes: 9,
      }),
    ).toBe(
      "The disk is full. auracode paused saving and the agents are waiting. Free some space; nothing is lost unless you quit now.",
    );
    expect(
      storageBanner({ state: { state: "failed", message: "damaged" }, unsaved_bytes: 0 }),
    ).toBe("damaged");
    expect(envBanner({ state: { state: "resolving" }, removed: [] })).toBeNull();
    expect(
      envBanner({ state: { state: "fallback", reason: "the shell timed out" }, removed: [] }),
    ).toContain("(the shell timed out)");
    const html = renderToStaticMarkup(
      <Banners
        storage={{ state: { state: "paused", reason: "busy", since: 1 }, unsaved_bytes: 9 }}
        env={{ state: { state: "fallback", reason: "no PATH" }, removed: [] }}
        onRetryEnv={noop}
        recoveryNotice={null}
        onRecoveryDismissed={noop}
        notices={[
          "auracode stopped 1 agent process left running by an earlier session that ended unexpectedly.",
        ]}
      />,
    );
    expect(html).toContain("database is busy");
    expect(html).toContain("(no PATH)");
    expect(html).toContain("auracode stopped 1 agent process");
    expect(buttons(html).map((b) => b.label)).toEqual(["Retry", "Dismiss"]);
    expect(
      renderToStaticMarkup(
        <Banners
          storage={null}
          env={null}
          onRetryEnv={noop}
          recoveryNotice={null}
          onRecoveryDismissed={noop}
          notices={[]}
        />,
      ),
    ).toBe("");
  });
});
