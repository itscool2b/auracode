import { FolderOpen, Plus } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import type { AgentEntry, ProjectSummary } from "../../bindings";
import type { Transport } from "../../lib/chat/transport";
import { errorMessage } from "../../lib/errors";
import { inTauri } from "../../lib/ipc";
import type { WorkspaceStore } from "../../lib/workspace";
import { FolderResolver } from "../setup/FolderResolver";
import { projectName } from "./ChatList";
import { Modal } from "./Modal";

const COLORS = ["#8a98a6", "#a59e92", "#8c9c88", "#a88e80"];
export function ProjectDialog({
  project,
  store,
  transport,
  agents,
  onClose,
  profileId,
  onLocated,
}: {
  readonly project: ProjectSummary | null;
  readonly store: WorkspaceStore;
  readonly transport: Transport;
  readonly agents: readonly AgentEntry[] | null;
  readonly onClose: () => void;
  readonly profileId?: string;
  readonly onLocated?: () => Promise<void>;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const current = state.data?.projects.find((item) => item.id === project?.id) ?? project;
  const [name, setName] = useState(project?.name ?? "");
  const [folder, setFolder] = useState<string | null>(null);
  const [color, setColor] = useState(project?.color ?? COLORS[0]);
  const [agent, setAgent] = useState(project?.default_agent ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const chooseFolder = async () => {
    setPicking(true);
    setLocalError(null);
    try {
      const path = await transport.pickFolder();
      if (!path) return;
      if (current) await store.perform(() => store.api.addFolder(current.id, path));
      else {
        setFolder(path);
        if (!name.trim()) setName(projectName(path));
      }
    } catch (error) {
      setLocalError(errorMessage(error));
    } finally {
      setPicking(false);
    }
  };
  if (resolving && current) {
    return (
      <Modal title="Folder on this device" onClose={() => setResolving(null)}>
        <FolderResolver
          key={`${profileId}:${resolving}`}
          folderId={resolving}
          pickFolder={() => transport.pickFolder()}
          onLocated={async () => {
            await store.refresh();
            await onLocated?.();
          }}
        />
        <button className="ui-button" type="button" onClick={() => setResolving(null)}>
          Back to project
        </button>
      </Modal>
    );
  }
  return (
    <Modal title={project ? "Project settings" : "New project"} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const input = {
            name: name.trim(),
            color: color ?? null,
            default_agent: agent || null,
            default_model: project?.default_model ?? null,
          };
          void store
            .perform(() =>
              project
                ? store.api.updateProject(project.id, input)
                : store.api.createProject({ project: input, folder: folder ?? "" }),
            )
            .then((result) => {
              if (result) onClose();
            });
        }}
      >
        <label className="ui-field">
          Project name
          <input
            className="ui-input"
            value={name}
            maxLength={128}
            required
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <fieldset className="chat-color-choices">
          <legend>Project color</legend>
          {COLORS.map((value) => (
            <label key={value} style={{ color: value }}>
              <input
                type="radio"
                name="project-color"
                aria-label={value}
                checked={color === value}
                onChange={() => setColor(value)}
              />
              <span />
            </label>
          ))}
        </fieldset>
        <section className="chat-project-folders" aria-label="Project folders">
          <h3>Folders</h3>
          {current?.folders.map((item) => (
            <div key={item.id}>
              <FolderOpen size={16} />
              <span>
                <strong>{item.display_name}</strong>
                <small>{item.path ?? "Not mapped on this device"}</small>
                {item.unavailable_reason ? (
                  <small className="ui-error">{item.unavailable_reason}</small>
                ) : null}
              </span>
              {inTauri() ? (
                <button type="button" className="ui-button" onClick={() => setResolving(item.id)}>
                  {item.path && !item.unavailable_reason
                    ? "Change location"
                    : "Find on this device"}
                </button>
              ) : null}
            </div>
          ))}
          {folder ? <p className="ui-mono">{folder}</p> : null}
          <button
            type="button"
            className="ui-button"
            disabled={picking || state.busy}
            onClick={() => void chooseFolder()}
          >
            <Plus size={14} />
            {picking
              ? "Choosing…"
              : current
                ? "Add folder"
                : folder
                  ? "Change folder"
                  : "Choose folder"}
          </button>
        </section>
        <label className="ui-field">
          Default agent
          <select
            className="ui-select"
            value={agent}
            onChange={(event) => setAgent(event.currentTarget.value)}
          >
            <option value="">Choose when starting a chat</option>
            {(agents ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {(localError ?? state.error) ? (
          <p role="alert" className="ui-error">
            {localError ?? state.error}
          </p>
        ) : null}
        <footer>
          <button type="button" className="ui-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="ui-button"
            data-kind="primary"
            disabled={state.busy || picking || !name.trim() || (!project && !folder)}
          >
            {state.busy ? "Saving…" : project ? "Save project" : "Create project"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
