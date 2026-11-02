import { AgentMark } from "@auracode/ui/graphite";
import { useEffect, useRef, useState } from "react";
import type {
  AgentEntry,
  AppInfo,
  Autonomy,
  ConfigChoice,
  GeneralPreferences,
  SetupAction,
  SetupSnapshot,
} from "../../bindings";
import { applySetupAppearance } from "../../lib/appearance";
import { AUTONOMIES, autonomyLabel, levelName } from "../../lib/chat/present";
import { errorMessage } from "../../lib/errors";
import {
  DEFAULT_GENERAL,
  type GeneralApi,
  type SetupApi,
  setMotionPreference,
} from "../../lib/setup";
import { Row, Switch } from "./SettingsRow";

/** One line under Autonomy for the level chosen. */
export function autonomyDetail(autonomy: Autonomy): string {
  switch (autonomy) {
    case "full_auto":
      return "Agents work without asking, within their own rules.";
    case "auto_edit":
      return "Each agent applies it within its own rules and asks for the rest.";
    case "ask":
      return "Agents check with you before they act.";
  }
}

/**
 * The agents Settings offers as the default: those that can run here, and the saved one even when
 * it is not found now, so the choice never silently changes.
 */
export function defaultAgentChoices(
  agents: readonly AgentEntry[],
  saved: string | null,
): { id: string; name: string }[] {
  const usable = agents
    .filter((agent) => agent.availability.state === "ready" || agent.id === saved)
    .map((agent) => ({
      id: agent.id,
      name: agent.availability.state === "ready" ? agent.name : `${agent.name} (not found)`,
    }));
  if (saved && !usable.some((agent) => agent.id === saved))
    usable.push({ id: saved, name: `${saved} (not found)` });
  return usable;
}

/** The models offered for the default agent: what it reported, and the saved one if it is not. */
export function defaultModelChoices(
  reported: readonly ConfigChoice[],
  saved: string | null,
): { value: string; name: string }[] {
  const choices = reported.map((choice) => ({ value: choice.value, name: choice.name }));
  if (saved && !choices.some((choice) => choice.value === saved))
    choices.push({ value: saved, name: saved });
  return choices;
}

/**
 * The thinking levels offered for the default model: what it offered (its own "default" is the
 * select's first entry already), and the saved one if it is not among them.
 */
export function defaultLevelChoices(
  reported: readonly ConfigChoice[],
  saved: string | null,
): { value: string; name: string }[] {
  const choices = reported
    .filter((choice) => choice.value !== "default")
    .map((choice) => ({ value: choice.value, name: levelName(choice) }));
  if (saved && !choices.some((choice) => choice.value === saved))
    choices.push({ value: saved, name: levelName({ value: saved, name: saved }) });
  return choices;
}

/**
 * Settings' General page: what new chats start with, what auracode does while agents work in the
 * background, and the app's own preferences. One control per row; each change saves at once.
 */
export function GeneralPanel({
  info,
  api,
  general: lists,
  onSetup,
  reveal,
}: {
  readonly info: AppInfo;
  readonly api: SetupApi;
  readonly general: GeneralApi;
  readonly onSetup: () => void;
  readonly reveal: () => Promise<void>;
}) {
  const [saved, setSaved] = useState<SetupSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [agents, setAgents] = useState<readonly AgentEntry[]>([]);
  const [models, setModels] = useState<readonly ConfigChoice[]>([]);
  const mounted = useRef(false);
  const saving = useRef(false);
  useEffect(() => {
    void reload;
    mounted.current = true;
    let live = true;
    api.snapshot().then(
      (next) => {
        if (live) {
          setSaved(next);
          setError(null);
        }
      },
      (failure) => {
        if (live) setError(errorMessage(failure));
      },
    );
    return () => {
      live = false;
      mounted.current = false;
    };
  }, [api, reload]);
  useEffect(() => {
    let live = true;
    lists.agents().then(
      (value) => {
        if (live) setAgents(value);
      },
      () => {
        // The agent list is a convenience here; without it the saved choice still shows.
      },
    );
    return () => {
      live = false;
    };
  }, [lists]);
  const general: GeneralPreferences = saved?.preferences.general ?? DEFAULT_GENERAL;
  const agentId = general.default_agent;
  useEffect(() => {
    let live = true;
    setModels([]);
    if (agentId)
      lists.models(agentId).then(
        (value) => {
          if (live) setModels(value);
        },
        () => {
          // No running chat of this agent yet: it has not listed its models.
        },
      );
    return () => {
      live = false;
    };
  }, [lists, agentId]);
  const defaultModel = general.default_model;
  const [levels, setLevels] = useState<readonly ConfigChoice[]>([]);
  useEffect(() => {
    let live = true;
    setLevels([]);
    if (agentId)
      lists.thinking(agentId, defaultModel).then(
        (value) => {
          if (live) setLevels(value);
        },
        () => {
          // Not known until the agent has run that model.
        },
      );
    return () => {
      live = false;
    };
  }, [lists, agentId, defaultModel]);
  const change = async (action: SetupAction) => {
    if (!saved || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await api.apply(saved.preferences.revision, action);
      setMotionPreference(next.preferences.motion);
      applySetupAppearance(next.preferences);
      if (mounted.current) setSaved(next);
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const disabled = !saved || busy;
  const agentChoices = defaultAgentChoices(agents, agentId);
  const agentName = agentChoices.find((agent) => agent.id === agentId)?.name ?? agentId ?? "";
  const modelChoices = defaultModelChoices(models, general.default_model);
  const levelChoices = defaultLevelChoices(levels, general.default_effort);
  const tray = info.os === "macos" ? "menu bar" : "tray";
  return (
    <>
      <section className="settings-section" aria-labelledby="settings-new-chats">
        <h2 id="settings-new-chats">New chats</h2>
        <div className="settings-group">
          <Row title="Agent" detail="New chat starts with this agent selected.">
            <span className="settings-control settings-agent-choice">
              {/* The chosen agent's mark; the select's own text names it. */}
              {agentId ? (
                <span className="settings-agent-mark" aria-hidden="true">
                  <AgentMark agent={agentId} size={16} />
                </span>
              ) : null}
              <select
                className="g-select settings-select"
                aria-label="Default agent"
                data-testid="settings-default-agent"
                value={agentId ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  void change({
                    type: "default_agent",
                    agent_id: event.currentTarget.value || null,
                  })
                }
              >
                <option value="">Choose each time</option>
                {agentChoices.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </span>
          </Row>
          {agentId ? (
            <Row
              title="Model"
              detail={
                modelChoices.length > 0
                  ? `New ${agentName} chats start on this model.`
                  : `${agentName} lists its models once one of its chats starts.`
              }
            >
              {modelChoices.length > 0 ? (
                <select
                  className="g-select settings-control settings-select"
                  aria-label="Default model"
                  data-testid="settings-default-model"
                  value={general.default_model ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    void change({ type: "default_model", model: event.currentTarget.value || null })
                  }
                >
                  <option value="">The agent's default</option>
                  {modelChoices.map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </Row>
          ) : null}
          {agentId && (levelChoices.length > 0 || modelChoices.length > 0) ? (
            <Row
              title="Thinking"
              detail={
                levelChoices.length > 0
                  ? `New ${agentName} chats start at this thinking level.`
                  : `${agentName} lists this model's thinking levels once it has run it.`
              }
            >
              {levelChoices.length > 0 ? (
                <select
                  className="g-select settings-control settings-select"
                  aria-label="Default thinking level"
                  data-testid="settings-default-thinking"
                  value={general.default_effort ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    void change({
                      type: "default_effort",
                      effort: event.currentTarget.value || null,
                    })
                  }
                >
                  <option value="">The model's default</option>
                  {levelChoices.map((level) => (
                    <option key={level.value} value={level.value}>
                      {level.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </Row>
          ) : null}
          <Row title="Autonomy" detail={autonomyDetail(general.default_autonomy)}>
            <fieldset className="settings-segmented settings-control" disabled={disabled}>
              <legend className="sr-only">Autonomy</legend>
              {[...AUTONOMIES].reverse().map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="settings-autonomy"
                    value={value}
                    checked={general.default_autonomy === value}
                    onChange={() => void change({ type: "default_autonomy", value })}
                  />
                  <span>{autonomyLabel(value)}</span>
                </label>
              ))}
            </fieldset>
          </Row>
        </div>
        <p className="settings-footnote">
          Applies to new chats. A project's own model comes first.
        </p>
      </section>
      <section className="settings-section" aria-labelledby="settings-checkpoints">
        <h2 id="settings-checkpoints">Checkpoints</h2>
        <div className="settings-group">
          <Row
            title="Automatic checkpoints"
            detail={
              general.automatic_checkpoints
                ? "Save workspace files before each message for per-turn file undo in Changes. Saving delays sending."
                : "Send without saving a checkpoint first. Aura's per-turn file undo is unavailable for new messages."
            }
          >
            <Switch
              label="Automatic checkpoints"
              testId="settings-automatic-checkpoints"
              checked={general.automatic_checkpoints}
              disabled={disabled}
              onChange={(enabled) => void change({ type: "automatic_checkpoints", enabled })}
            />
          </Row>
        </div>
        <p className="settings-footnote">
          Applies to the next message in this profile. Saved checkpoints remain available in
          Changes.
        </p>
      </section>
      <section className="settings-section" aria-labelledby="settings-background">
        <h2 id="settings-background">While agents work</h2>
        <div className="settings-group">
          <Row
            title="Notifications"
            detail="When a chat you are not looking at finishes, fails or needs you."
          >
            <Switch
              label="Notifications"
              testId="settings-notifications"
              checked={general.notifications}
              disabled={disabled}
              onChange={(enabled) => void change({ type: "notifications", enabled })}
            />
          </Row>
          <Row
            title="Keep awake"
            detail="No idle sleep while an agent works. The screen can still turn off."
          >
            <Switch
              label="Keep awake"
              testId="settings-keep-awake"
              checked={general.keep_awake}
              disabled={disabled}
              onChange={(enabled) => void change({ type: "keep_awake", enabled })}
            />
          </Row>
          <Row
            title={`Keep running in the ${tray}`}
            detail="Closing the window leaves agents working. Off, closing quits."
          >
            <Switch
              label={`Keep running in the ${tray}`}
              testId="settings-close-to-tray"
              checked={general.close_to_tray}
              disabled={disabled}
              onChange={(enabled) => void change({ type: "close_to_tray", enabled })}
            />
          </Row>
        </div>
      </section>
      <section className="settings-section" aria-labelledby="settings-app">
        <h2 id="settings-app">App</h2>
        <div className="settings-group">
          <Row title="Appearance" detail="System follows your device's light or dark appearance.">
            <fieldset className="settings-segmented settings-control" disabled={disabled}>
              <legend className="sr-only">Appearance</legend>
              {(["system", "light", "dark"] as const).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="settings-appearance"
                    value={value}
                    checked={(saved?.preferences.appearance ?? "system") === value}
                    onChange={() => void change({ type: "appearance", value })}
                  />
                  <span>
                    {value === "system" ? "System" : value === "light" ? "Light" : "Dark"}
                  </span>
                </label>
              ))}
            </fieldset>
          </Row>
          <Row title="Motion" detail="Full still follows your system's reduced motion setting.">
            <fieldset className="settings-segmented settings-control" disabled={disabled}>
              <legend className="sr-only">Motion</legend>
              {(["full", "reduced", "off"] as const).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="settings-motion"
                    value={value}
                    checked={saved?.preferences.motion === value}
                    onChange={() => void change({ type: "motion", value })}
                  />
                  <span>{value === "full" ? "Full" : value === "reduced" ? "Reduced" : "Off"}</span>
                </label>
              ))}
            </fieldset>
          </Row>
          <Row
            title="Welcome and setup"
            detail="Review your agents and pick a first project again."
          >
            <button
              className="g-button g-button-outline g-button-28"
              type="button"
              onClick={onSetup}
            >
              Run setup
            </button>
          </Row>
          <Row
            title="Data folder"
            detail={
              info.data_dir ? (
                <span className="settings-mono">{info.data_dir}</span>
              ) : (
                "Chats stay on this device."
              )
            }
          >
            <button
              className="g-button g-button-outline g-button-28"
              type="button"
              disabled={!info.data_dir}
              onClick={() => void reveal().catch((failure) => setError(errorMessage(failure)))}
            >
              Open folder
            </button>
          </Row>
        </div>
      </section>
      {saved?.notice ? <p className="settings-footnote">{saved.notice}</p> : null}
      {error ? (
        <div className="settings-error" role="alert">
          <p>{error}</p>
          <button
            className="g-button g-button-28"
            type="button"
            disabled={busy}
            onClick={() => setReload((value) => value + 1)}
          >
            Reload preferences
          </button>
        </div>
      ) : null}
    </>
  );
}
