import { AgentMark } from "@o7/ui/graphite";
import { useEffect, useState } from "react";
import type { AgentEntry, ConfigChoice, ModelRole, RoleModel } from "../../bindings";
import { NO_ROLES, ROLES } from "../../lib/roles";
import { DEFAULT_GENERAL, type GeneralApi } from "../../lib/setup";
import { Select } from "../Select";
import { defaultAgentChoices, defaultLevelChoices, defaultModelChoices } from "./GeneralPanel";
import type { Preferences } from "./preferences";
import { Row } from "./SettingsRow";

/**
 * Settings > General > Models by role (owner, 19 November 2026: "fable for planning, gpt 6 astra
 * for implementation or mixing and matching"). One row a kind of work: the agent, then its model
 * and thinking level once an agent is chosen. A row left on its first entry changes nothing.
 */
export function RolesSection({
  prefs,
  lists,
  agents,
}: {
  readonly prefs: Preferences;
  readonly lists: GeneralApi;
  readonly agents: readonly AgentEntry[];
}) {
  const roles = (prefs.shown?.general ?? DEFAULT_GENERAL).roles ?? NO_ROLES;
  return (
    <section className="settings-section" aria-labelledby="settings-roles">
      <h2 id="settings-roles">Models by role</h2>
      <p className="settings-lead">
        Use one model to plan and another to build. Each row is a kind of work; one you leave alone
        changes nothing.
      </p>
      <div className="settings-group">
        {ROLES.map((entry) => (
          <RoleRow
            key={entry.role}
            role={entry.role}
            title={entry.title}
            detail={entry.detail}
            none={entry.none}
            choice={roles[entry.role] ?? null}
            agents={agents}
            lists={lists}
            disabled={!prefs.saved}
            onChange={(choice) => prefs.change({ type: "role_model", role: entry.role, choice })}
          />
        ))}
      </div>
    </section>
  );
}

function RoleRow({
  role,
  title,
  detail,
  none,
  choice,
  agents,
  lists,
  disabled,
  onChange,
}: {
  readonly role: ModelRole;
  readonly title: string;
  readonly detail: string;
  readonly none: string;
  readonly choice: RoleModel | null;
  readonly agents: readonly AgentEntry[];
  readonly lists: GeneralApi;
  readonly disabled: boolean;
  readonly onChange: (choice: RoleModel | null) => void;
}) {
  const [models, setModels] = useState<readonly ConfigChoice[]>([]);
  const [levels, setLevels] = useState<readonly ConfigChoice[]>([]);
  const agentId = choice?.agent ?? null;
  const model = choice?.model ?? null;
  useEffect(() => {
    let live = true;
    setModels([]);
    if (agentId)
      lists.models(agentId).then(
        (value) => {
          if (live) setModels(value);
        },
        () => {
          // No chat of this agent has run yet: it has not listed its models.
        },
      );
    return () => {
      live = false;
    };
  }, [lists, agentId]);
  useEffect(() => {
    let live = true;
    setLevels([]);
    if (agentId)
      lists.thinking(agentId, model).then(
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
  }, [lists, agentId, model]);
  const agentChoices = defaultAgentChoices(agents, agentId);
  const agentName = agentChoices.find((agent) => agent.id === agentId)?.name ?? agentId ?? "";
  const modelChoices = defaultModelChoices(models, model);
  const levelChoices = defaultLevelChoices(levels, choice?.effort ?? null);
  return (
    <Row
      title={title}
      detail={
        choice && modelChoices.length === 0
          ? `${detail} ${agentName} lists its models once one of its chats starts.`
          : detail
      }
    >
      <span className="settings-control settings-role" data-testid={`settings-role-${role}`}>
        <span className="settings-agent-choice">
          {agentId ? (
            <span className="settings-agent-mark" aria-hidden="true">
              <AgentMark agent={agentId} size={16} />
            </span>
          ) : null}
          <Select
            className="g-select settings-select"
            aria-label={`${title}: agent`}
            data-testid={`settings-role-${role}-agent`}
            value={agentId ?? ""}
            disabled={disabled}
            onChange={(event) => {
              const agent = event.currentTarget.value;
              onChange(agent ? { agent, model: null, effort: null } : null);
            }}
          >
            <option value="">{none}</option>
            {agentChoices.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </Select>
        </span>
        {choice && modelChoices.length > 0 ? (
          <Select
            className="g-select settings-select"
            aria-label={`${title}: model`}
            data-testid={`settings-role-${role}-model`}
            value={model ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                agent: choice.agent,
                model: event.currentTarget.value || null,
                effort: null,
              })
            }
          >
            <option value="">The agent's default</option>
            {modelChoices.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.name}
              </option>
            ))}
          </Select>
        ) : null}
        {choice && levelChoices.length > 0 ? (
          <Select
            className="g-select settings-select"
            aria-label={`${title}: thinking`}
            data-testid={`settings-role-${role}-thinking`}
            value={choice.effort ?? ""}
            disabled={disabled}
            onChange={(event) => onChange({ ...choice, effort: event.currentTarget.value || null })}
          >
            <option value="">The model's default</option>
            {levelChoices.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.name}
              </option>
            ))}
          </Select>
        ) : null}
      </span>
    </Row>
  );
}
