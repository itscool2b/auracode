import { useEffect, useRef, useState } from "react";
import type { McpActionResult, McpDefinition, McpSessionAction, McpSnapshot } from "../../bindings";
import { errorMessage } from "../../lib/errors";
import { type SharedMcpApi, sharedMcpApi } from "../../lib/sharedMcp";
import { Modal } from "../chat/Modal";
import "./shared-mcp.css";

export interface McpProject {
  readonly id: string;
  readonly name: string;
}
export function SharedMcpPanel({
  projects = [],
  initialProjectId = null,
  api = sharedMcpApi,
  activeChatId,
}: {
  readonly projects?: readonly McpProject[];
  readonly initialProjectId?: string | null;
  readonly api?: SharedMcpApi;
  readonly activeChatId?: string | null;
}) {
  const [snapshot, setSnapshot] = useState<McpSnapshot | null>(null);
  const [explicitScope, setExplicitScope] = useState<string | null>(null);
  const scope = explicitScope ?? initialProjectId ?? projects[0]?.id ?? "";
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [sessionResult, setSessionResult] = useState<McpActionResult | null>(null);
  const [nativeImport, setNativeImport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<McpDefinition | null>(null);
  const [credentials, setCredentials] = useState<McpDefinition | null>(null);
  const [document, setDocument] = useState<{ mode: "import" | "export"; text: string } | null>(
    null,
  );
  const alive = useRef(true);
  function openEditor(definition: McpDefinition) {
    setExplicitScope(scope);
    setEditing(definition);
  }
  useEffect(() => {
    alive.current = true;
    void api
      .snapshot()
      .then((v) => {
        if (alive.current) setSnapshot(v);
      })
      .catch((e) => {
        if (alive.current) setError(errorMessage(e));
      });
    return () => {
      alive.current = false;
    };
  }, [api]);
  async function run(work: () => Promise<McpSnapshot | undefined>) {
    setBusy(true);
    setError("");
    try {
      const value = await work();
      if (alive.current && value) setSnapshot(value);
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const visible =
    snapshot?.servers.filter((s) => s.definition.project_id === (scope || null)) ?? [];
  const sessionAction = (definition: McpDefinition, action: McpSessionAction) =>
    void run(async () => {
      if (!activeChatId) return;
      const result = await api.sessionAction(activeChatId, definition.name, action);
      if (alive.current) setSessionResult(result);
    });
  return (
    <div className="plugins-agent shared-mcp-panel">
      <header className="plugins-agent-head">
        <div className="plugins-agent-title">
          <h2>Shared MCP</h2>
          <p>One definition, compatible agents</p>
        </div>
        <button
          className="g-button g-button-primary g-button-28"
          type="button"
          disabled={busy || !snapshot}
          onClick={() =>
            openEditor({
              id: crypto.randomUUID(),
              name: "",
              project_id: scope || null,
              enabled: true,
              transport: { type: "stdio", command: "", args: [] },
              env_keys: [],
              header_keys: [],
            })
          }
        >
          Add server
        </button>
      </header>
      <p className="plugins-summary">
        Shared MCP connects compatible agents to the same tools. Plugins, packages, hooks and
        commands belong to each agent. Definitions sync with your Aura account; authentication stays
        on this device.
      </p>
      <p className="plugins-note">
        Project definitions apply to all its folders and worktrees. A project override replaces the
        all-projects definition with the same Aura ID. Native configuration stays in place. Matching
        native server names require review. Changes apply after an idle chat restarts.
      </p>
      <div className="shared-mcp-toolbar">
        <label>
          Scope{" "}
          <select
            className="g-input"
            value={scope}
            aria-label="MCP scope"
            onChange={(e) => setExplicitScope(e.currentTarget.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="">All projects</option>
          </select>
        </label>
        <div>
          <button
            className="g-button g-button-outline g-button-28"
            type="button"
            disabled={busy || !snapshot}
            onClick={() => {
              setExplicitScope(scope);
              setDocument({ mode: "import", text: "" });
            }}
          >
            Import
          </button>
          <button
            className="g-button g-button-outline g-button-28"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const text = await api.export();
                if (alive.current) setDocument({ mode: "export", text });
              })
            }
          >
            Export
          </button>
          <button
            className="g-button g-button-ghost g-button-28"
            type="button"
            disabled={busy}
            onClick={() => void run(() => api.snapshot())}
          >
            Refresh
          </button>
        </div>
      </div>
      {error ? (
        <p className="library-feedback" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="library-feedback" role="status">
          {status}
        </p>
      ) : null}
      {sessionResult ? (
        <div className="library-feedback" role="status">
          <p>{sessionResult.message}</p>
          {sessionResult.servers.map((server) => (
            <p key={server.name}>
              {server.name}: {server.state}, {server.authentication}, {server.tool_count} tools
            </p>
          ))}
          {sessionResult.authorization_url ? (
            <button
              type="button"
              className="g-button g-button-outline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(sessionResult.authorization_url ?? "")
                  .catch((e) => setError(errorMessage(e)))
              }
            >
              Copy sign-in link
            </button>
          ) : null}
        </div>
      ) : null}
      {!snapshot ? (
        <p role="status">Reading shared MCP…</p>
      ) : !visible.length ? (
        <p className="plugins-none">
          No shared servers in this scope. Add a server or import an Aura definition.
        </p>
      ) : (
        <ul className="plugins-rows">
          {visible.map((record) => (
            <li className="plugins-row shared-mcp-row" key={record.definition.id}>
              <div className="plugins-row-text">
                <strong>{record.definition.name}</strong>
                <small>
                  {record.definition.transport.type} · Revision {record.revision} ·{" "}
                  {record.definition.enabled
                    ? record.missing_credentials.length
                      ? "Needs local authentication"
                      : "Configured, session connection unverified"
                    : "Disabled"}
                </small>
                {record.missing_credentials.length ? (
                  <small>Required on this device: {record.missing_credentials.join(", ")}</small>
                ) : null}
              </div>
              <div className="shared-mcp-actions">
                <button
                  type="button"
                  className="g-button g-button-ghost g-button-28"
                  disabled={busy}
                  onClick={() => openEditor(record.definition)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="g-button g-button-ghost g-button-28"
                  disabled={busy}
                  onClick={() => setCredentials(record.definition)}
                >
                  Authentication
                </button>
                <button
                  type="button"
                  className="g-button g-button-ghost g-button-28"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await api.test(
                        snapshot.revision,
                        record.definition,
                        activeChatId,
                      );
                      if (alive.current) setStatus(`${record.definition.name}: ${result.message}`);
                    })
                  }
                >
                  Test connection
                </button>
                {activeChatId ? (
                  <>
                    <button
                      type="button"
                      className="g-button g-button-ghost g-button-28"
                      disabled={busy}
                      onClick={() => sessionAction(record.definition, "status")}
                    >
                      Session status
                    </button>
                    <button
                      type="button"
                      className="g-button g-button-ghost g-button-28"
                      disabled={busy}
                      onClick={() => sessionAction(record.definition, "login")}
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      className="g-button g-button-ghost g-button-28"
                      disabled={busy}
                      onClick={() => sessionAction(record.definition, "restart")}
                    >
                      Restart active chat
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="g-button g-button-ghost g-button-28"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      api.save(snapshot.revision, {
                        ...record.definition,
                        enabled: !record.definition.enabled,
                      }),
                    )
                  }
                >
                  {record.definition.enabled ? "Disable" : "Enable"}
                </button>
                {scope === "" && projects.length ? (
                  <button
                    type="button"
                    className="g-button g-button-ghost g-button-28"
                    disabled={busy}
                    onClick={() =>
                      openEditor({
                        ...record.definition,
                        project_id: initialProjectId ?? projects[0]?.id ?? null,
                      })
                    }
                  >
                    Create project override
                  </button>
                ) : null}
                <button
                  type="button"
                  className="g-button g-button-ghost g-button-28"
                  disabled={busy}
                  onClick={() => void run(() => api.remove(snapshot.revision, record.definition))}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {snapshot?.conflicts.map((conflict) => (
        <section className="shared-mcp-conflict" key={conflict.revision}>
          <h3>Definition conflict</h3>
          <p>
            {conflict.incoming?.name ?? conflict.id} changed on another device. Review the complete
            incoming definition before replacing your current definition.
          </p>
          <pre>{JSON.stringify(conflict.incoming, null, 2)}</pre>
          <button
            type="button"
            className="g-button g-button-outline"
            disabled={busy}
            onClick={() => void run(() => api.conflict(snapshot.revision, conflict.revision, true))}
          >
            Accept incoming
          </button>
          <button
            type="button"
            className="g-button g-button-ghost"
            disabled={busy}
            onClick={() =>
              void run(() => api.conflict(snapshot.revision, conflict.revision, false))
            }
          >
            Keep current
          </button>
        </section>
      ))}
      <section className="plugins-feature">
        <h3>Session support</h3>
        <p className="plugins-note">
          Codex supports stdio and HTTP through thread configuration. Claude uses a session
          descriptor alongside its native configuration. Pi verifies its session extension before
          accepting prompts. ACP connects stdio and transports advertised by that agent. Restricted
          fallback connections and remote hosts cannot load Aura shared MCP.
        </p>
        <p className="plugins-note">
          A successful direct connection test confirms server initialization. Agent-specific tool
          availability and OAuth state must be inspected in that agent's running session.
        </p>
      </section>
      {editing && snapshot ? (
        <McpEditor
          definition={editing}
          projects={projects}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(definition) =>
            void run(async () => {
              const result = await api.save(snapshot.revision, definition);
              if (alive.current) setEditing(null);
              setStatus("Definition saved. Restart compatible idle chats to apply this revision.");
              return result;
            })
          }
        />
      ) : null}
      {credentials && snapshot ? (
        <CredentialEditor
          definition={credentials}
          busy={busy}
          onClose={() => setCredentials(null)}
          onSave={(values) =>
            void run(async () => {
              const result = await api.credentials(snapshot.revision, credentials, values);
              if (alive.current) setCredentials(null);
              return result;
            })
          }
        />
      ) : null}
      {document && snapshot ? (
        <Modal
          title={
            document.mode === "import"
              ? "Import shared MCP definitions"
              : "Export shared MCP definitions"
          }
          size="lg"
          onClose={() => setDocument(null)}
        >
          <p>
            Portable definitions include credential names only. Authentication values stay on this
            device. Imported definitions retain their Aura IDs and scopes.
          </p>
          {document.mode === "import" ? (
            <label className="shared-mcp-field">
              Import format
              <select
                className="g-input"
                value={nativeImport ? "native" : "aura"}
                aria-label="Import format"
                onChange={(e) => setNativeImport(e.currentTarget.value === "native")}
              >
                <option value="aura">Aura portable definitions</option>
                <option value="native">Native mcpServers JSON</option>
              </select>
            </label>
          ) : null}
          <label className="shared-mcp-field">
            Definition JSON
            <textarea
              className="g-input"
              aria-label="Definition JSON"
              rows={16}
              readOnly={document.mode === "export"}
              value={document.text}
              onChange={(e) => setDocument({ ...document, text: e.currentTarget.value })}
            />
          </label>
          {document.mode === "import" ? (
            <button
              type="button"
              className="g-button g-button-primary"
              disabled={busy || !document.text.trim()}
              onClick={() =>
                void run(async () => {
                  const result = nativeImport
                    ? await api.importNative(snapshot.revision, scope || null, document.text)
                    : await api.import(snapshot.revision, document.text);
                  if (alive.current) setDocument(null);
                  return result;
                })
              }
            >
              Import definitions
            </button>
          ) : (
            <button
              type="button"
              className="g-button g-button-outline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(document.text)
                  .catch((e) => setError(errorMessage(e)))
              }
            >
              Copy export
            </button>
          )}
        </Modal>
      ) : null}
    </div>
  );
}
function McpEditor({
  definition,
  projects,
  busy,
  onClose,
  onSave,
}: {
  readonly definition: McpDefinition;
  readonly projects: readonly McpProject[];
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSave: (definition: McpDefinition) => void;
}) {
  const [value, setValue] = useState(definition);
  const [args, setArgs] = useState(
    definition.transport.type === "stdio" ? definition.transport.args.join("\n") : "",
  );
  const [keys, setKeys] = useState(
    (definition.transport.type === "stdio" ? definition.env_keys : definition.header_keys).join(
      "\n",
    ),
  );
  return (
    <Modal
      title={definition.name ? "Edit shared MCP server" : "Add shared MCP server"}
      size="lg"
      onClose={onClose}
    >
      <form
        className="shared-mcp-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            ...value,
            transport:
              value.transport.type === "stdio"
                ? { ...value.transport, args: args.split("\n").filter(Boolean) }
                : value.transport,
            env_keys: value.transport.type === "stdio" ? keys.split("\n").filter(Boolean) : [],
            header_keys: value.transport.type !== "stdio" ? keys.split("\n").filter(Boolean) : [],
          });
        }}
      >
        <label className="shared-mcp-field">
          Name
          <input
            className="g-input"
            required
            value={value.name}
            pattern="[A-Za-z0-9_.-]+"
            onChange={(e) => setValue({ ...value, name: e.currentTarget.value })}
          />
        </label>
        <label className="shared-mcp-field">
          Scope
          <select
            className="g-input"
            value={value.project_id ?? ""}
            aria-label="Scope"
            onChange={(e) => setValue({ ...value, project_id: e.currentTarget.value || null })}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="">All projects</option>
          </select>
        </label>
        <label className="shared-mcp-field">
          Transport
          <select
            className="g-input"
            value={value.transport.type}
            aria-label="Transport"
            onChange={(e) => {
              const type = e.currentTarget.value;
              setValue({
                ...value,
                transport:
                  type === "stdio"
                    ? { type, command: "", args: [] }
                    : { type: type === "sse" ? "sse" : "http", url: "" },
              });
              setKeys("");
            }}
          >
            <option value="stdio">Stdio</option>
            <option value="http">Streamable HTTP</option>
            <option value="sse">Legacy SSE</option>
          </select>
        </label>
        {value.transport.type === "stdio" ? (
          <>
            <label className="shared-mcp-field">
              Executable
              <input
                className="g-input"
                required
                value={value.transport.command}
                onChange={(e) =>
                  setValue({
                    ...value,
                    transport: { type: "stdio", command: e.currentTarget.value, args: [] },
                  })
                }
              />
            </label>
            <label className="shared-mcp-field">
              Arguments, one per line
              <textarea
                className="g-input"
                rows={4}
                value={args}
                onChange={(e) => setArgs(e.currentTarget.value)}
              />
            </label>
          </>
        ) : (
          <label className="shared-mcp-field">
            Endpoint URL
            <input
              className="g-input"
              type="url"
              required
              value={value.transport.url}
              onChange={(e) =>
                setValue({
                  ...value,
                  transport: {
                    ...(value.transport as { type: "http" | "sse"; url: string }),
                    url: e.currentTarget.value,
                  },
                })
              }
            />
          </label>
        )}
        <label className="shared-mcp-field">
          {value.transport.type === "stdio"
            ? "Local environment credential names"
            : "Local header credential names"}
          , one per line
          <textarea
            className="g-input"
            rows={3}
            value={keys}
            onChange={(e) => setKeys(e.currentTarget.value)}
          />
        </label>
        <p className="plugins-note">
          Store secrets using Authentication after saving. Portable commands, arguments and URLs
          must contain no secret values. Changing the executable, endpoint or credential names
          clears previous local authentication.
        </p>
        <button type="submit" className="g-button g-button-primary" disabled={busy}>
          Save definition
        </button>
      </form>
    </Modal>
  );
}
function CredentialEditor({
  definition,
  busy,
  onClose,
  onSave,
}: {
  readonly definition: McpDefinition;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSave: (values: {
    env: Record<string, string>;
    headers: Record<string, string>;
  }) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const group = definition.transport.type === "stdio" ? "env" : "headers";
  const keys = group === "env" ? definition.env_keys : definition.header_keys;
  return (
    <Modal title={`Authentication: ${definition.name}`} onClose={onClose}>
      <p>
        Saved values are never displayed, exported or synced. Supply all required values when
        replacing authentication. OAuth is controlled by each agent's native MCP session.
      </p>
      <form
        className="shared-mcp-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            env: group === "env" ? values : {},
            headers: group === "headers" ? values : {},
          });
        }}
      >
        {keys.map((key) => (
          <label key={key} className="shared-mcp-field">
            {key}
            <input
              className="g-input"
              type="password"
              autoComplete="off"
              value={values[key] ?? ""}
              required
              onChange={(e) => setValues({ ...values, [key]: e.currentTarget.value })}
            />
          </label>
        ))}
        {keys.length ? (
          <button type="submit" className="g-button g-button-primary" disabled={busy}>
            Save local authentication
          </button>
        ) : (
          <p>
            No local credential fields are declared. Add required environment or header names to the
            definition, or sign in through a compatible agent's native OAuth flow.
          </p>
        )}
        <button
          type="button"
          className="g-button g-button-ghost"
          disabled={busy}
          onClick={() => onSave({ env: {}, headers: {} })}
        >
          Clear local authentication
        </button>
      </form>
    </Modal>
  );
}
