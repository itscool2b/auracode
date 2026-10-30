/**
 * New chat in the development harness: agents arrive the way detection reports them. The list is
 * looked for first, then Codex is still being checked, then it is found and settles in. The query
 * `agents=loading` holds the search and `agents=one` shows only the demo agent. Codex reports a
 * missing sign-in when its sign-in is checked. No process, network or native call runs.
 */
import { useEffect, useMemo, useState } from "react";
import type { AgentEntry, AgentInstallation } from "../bindings";
import { NewChat } from "../components/chat/NewChat";
import { NewChatDraft } from "../lib/chat/appStore";
import { FakeTransport } from "../lib/chat/testing";
import { worktreeRecoveryApi } from "../lib/worktreeRecovery";
import { FIXTURE_FOLDER, type NewChatScenario, newChatFixture } from "./newChatWorktreeFixture";

const mode = new URLSearchParams(location.search).get("agents");

function installation(
  id: string,
  version: string,
  channel: AgentInstallation["channel"],
): AgentInstallation {
  return {
    agent_id: id,
    provider: id,
    host: { type: "native" },
    launch_path: `/usr/local/bin/${id}`,
    resolved_path: null,
    version,
    channel,
    verification: { state: "verified", version, scope: "Verified with auracode" },
  };
}

function agents(base: AgentEntry, stage: number): readonly AgentEntry[] | null {
  if (mode === "one") return [base];
  if (mode === "loading" || stage === 0) return null;
  return [
    {
      ...base,
      availability: { state: "ready", version: "2.1.310", path: "/usr/local/bin/claude" },
      latest_release: { version: "2.1.312", source: "npm", checked_at: null, stale: false },
      installation: installation("claude", "2.1.310", {
        type: "npm",
        package: "@anthropic-ai/claude-code",
      }),
    },
    {
      ...base,
      id: "codex",
      name: "Codex",
      description: "Your installed Codex CLI",
      availability:
        stage === 1
          ? { state: "checking" }
          : { state: "ready", version: "0.170.0", path: "/opt/homebrew/bin/codex" },
      installation:
        stage === 1
          ? null
          : installation("codex", "0.170.0", { type: "homebrew", formula: "codex" }),
    },
    {
      ...base,
      id: "opencode",
      name: "OpenCode",
      description: "Your installed OpenCode CLI",
      availability: { state: "ready", version: "1.4.2", path: "/usr/local/bin/opencode" },
    },
    {
      ...base,
      id: "cursor",
      name: "Cursor",
      availability: { state: "missing", reason: "cursor-agent is not on your PATH." },
    },
    {
      ...base,
      id: "hermes",
      name: "Hermes",
      availability: { state: "broken", reason: "hermes --version exited with code 1." },
    },
  ];
}

export function NewChatPreview({
  base,
  onCreated,
  scenario = null,
}: {
  readonly base: AgentEntry;
  readonly onCreated: () => void;
  /** A project folder already chosen, with Rust's worktree review imitated (newChatWorktreeFixture). */
  readonly scenario?: NewChatScenario | null;
}) {
  const [stage, setStage] = useState(scenario ? 2 : 0);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    if (mode !== null || scenario) return;
    const timers = [setTimeout(() => setStage(1), 900), setTimeout(() => setStage(2), 2400)];
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [scenario]);
  const draft = useMemo(
    () =>
      new NewChatDraft(
        new FakeTransport({
          pickFolder: async () => FIXTURE_FOLDER,
          agentMaintenance: async (id) => ({
            auth_status: true,
            login_available: false,
            update_unavailable: id === "claude" ? null : "Updates come from Homebrew.",
          }),
          agentAuthStatus: async (id) =>
            id === "codex" ? { state: "sign_in_required" } : { state: "credentials_present" },
        }),
      ),
    [],
  );
  const fixture = useMemo(() => (scenario ? newChatFixture(scenario) : null), [scenario]);
  const recoveryApi = useMemo(() => ({ ...worktreeRecoveryApi, list: async () => [] }), []);
  useEffect(() => {
    if (!fixture) return;
    Object.assign(window, { newChatFixture: { calls: () => [...fixture.calls] } });
    void fixture.workspace.refresh();
    draft.chooseAgent(base.id);
    void draft.chooseFolder();
  }, [fixture, draft, base.id]);
  return (
    <NewChat
      agents={agents(base, stage)}
      refreshing={refreshing}
      draft={draft}
      onRefreshAgents={() => {
        setRefreshing(true);
        setTimeout(() => setRefreshing(false), 1200);
      }}
      onCreated={onCreated}
      workspace={fixture?.workspace}
      worktreeApi={fixture?.api}
      recoveryApi={recoveryApi}
    />
  );
}
