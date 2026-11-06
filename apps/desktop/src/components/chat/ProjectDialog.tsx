import { FolderOpen, Plus } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type {
  AgentEntry,
  ManagedWorktree,
  ProjectSummary,
  WorkspaceRemovalTarget,
} from "../../bindings";
import type { Transport } from "../../lib/chat/transport";
import { errorMessage } from "../../lib/errors";
import { inTauri } from "../../lib/ipc";
import type { CloneApi } from "../../lib/setup-actions/api";
import type { WorkspaceStore } from "../../lib/workspace";
import { type WorktreeRecoveryApi, worktreeRecoveryApi } from "../../lib/worktreeRecovery";
import { CloneProject } from "../setup/CloneProject";
import { FolderResolver } from "../setup/FolderResolver";
import { projectName } from "./ChatList";
import { Modal } from "./Modal";
import { WorkspaceRemovalDialog } from "./WorkspaceRemovalDialog";
import { WorktreeRecoveryList, worktreesToReview } from "./WorktreeRecoveryList";

/**
 * The colours a project can carry, as stored with the project, each drawn by its Graphite tone
 * (--g-project-*). The stored values are data and must not change.
 */
const COLORS = [
  { value: "#8a98a6", tone: "slate" },
  { value: "#a59e92", tone: "sand" },
  { value: "#8c9c88", tone: "sage" },
  { value: "#a88e80", tone: "clay" },
] as const;
export function ProjectDialog({
  project,
  store,
  transport,
  agents,
  onClose,
  profileId,
  onLocated,
  onInstructions,
  cloneApi,
  recoveryApi = worktreeRecoveryApi,
}: {
  /** The clone's commands; previews pass a synthetic service. */
  readonly cloneApi?: CloneApi;
  readonly recoveryApi?: WorktreeRecoveryApi;
  readonly project: ProjectSummary | null;
  readonly store: WorkspaceStore;
  readonly transport: Transport;
  readonly agents: readonly AgentEntry[] | null;
  readonly onClose: () => void;
  readonly profileId?: string;
  readonly onLocated?: () => Promise<void>;
  /** Opens this folder's agent instructions (AGENTS.md, CLAUDE.md) in Settings. */
  readonly onInstructions?: (folderId: string) => void;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const current = state.data?.projects.find((item) => item.id === project?.id) ?? project;
  const [removal, setRemoval] = useState<{ target: WorkspaceRemovalTarget | null } | null>(null);
  const [name, setName] = useState(project?.name ?? "");
  const [folder, setFolder] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(project?.color ?? COLORS[0].value);
  const [agent, setAgent] = useState(project?.default_agent ?? "");
  const [model, setModel] = useState(project?.default_model ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [worktrees, setWorktrees] = useState<ManagedWorktree[]>([]);
  const [recoveryRevision, setRecoveryRevision] = useState(0);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  useEffect(() => {
    void recoveryRevision;
    if (!project) return;
    let current = true;
    void recoveryApi.list(project.id).then(
      (records) => {
        if (current) {
          setWorktrees(records);
          setRecoveryError(null);
        }
      },
      (error) => {
        if (current) setRecoveryError(errorMessage(error));
      },
    );
    return () => {
      current = false;
    };
  }, [project, recoveryApi, recoveryRevision]);
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
  if (removal)
    return (
      <WorkspaceRemovalDialog
        target={removal.target}
        onClose={onClose}
        onChanged={async () => {
          await store.refresh();
          await onLocated?.();
        }}
      />
    );
  if (resolving && current) {
    return (
      <Modal title="Folder on this device" size="md" onClose={() => setResolving(null)}>
        <FolderResolver
          key={`${profileId}:${resolving}`}
          folderId={resolving}
          pickFolder={() => transport.pickFolder()}
          onLocated={async () => {
            await store.refresh();
            await onLocated?.();
          }}
        />
        <button className="g-button" type="button" onClick={() => setResolving(null)}>
          Back to project
        </button>
      </Modal>
    );
  }
  return (
    <Modal title={project ? "Project settings" : "New project"} size="md" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const input = {
            name: name.trim(),
            color: color ?? null,
            default_agent: agent || null,
            default_model: agent && model.trim() ? model.trim() : null,
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
            className="g-input"
            value={name}
            maxLength={128}
            required
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <fieldset className="chat-color-choices">
          <legend>Project color</legend>
          {COLORS.map(({ value, tone }) => (
            <label key={value} data-tone={tone}>
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
              <button
                type="button"
                className="g-button"
                onClick={() => setRemoval({ target: { kind: "folder", id: item.id } })}
              >
                Remove…
              </button>
              {inTauri() ? (
                <button type="button" className="g-button" onClick={() => setResolving(item.id)}>
                  {item.path && !item.unavailable_reason
                    ? "Change location"
                    : "Find on this device"}
                </button>
              ) : null}
              {onInstructions && item.path && !item.unavailable_reason ? (
                <button
                  type="button"
                  className="g-button"
                  aria-label={`Instructions for ${item.display_name}`}
                  onClick={() => onInstructions(item.id)}
                >
                  Instructions
                </button>
              ) : null}
            </div>
          ))}
          {folder ? <p className="ui-mono">{folder}</p> : null}
          <button
            type="button"
            className="g-button"
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
          {current ? null : (
            // A new project can start from a repository: Git clones it into a new folder,
            // which becomes this project's folder.
            <CloneProject
              className="g-button chat-project-clone"
              api={cloneApi}
              disabled={picking || state.busy}
              pickParent={() => transport.pickFolder()}
              onFolder={(path, cloned) => {
                setFolder(path);
                if (!name.trim()) setName(cloned);
              }}
            />
          )}
        </section>
        <label className="ui-field">
          Default agent
          <select
            className="g-select"
            value={agent}
            onChange={(event) => {
              setAgent(event.currentTarget.value);
              setModel("");
            }}
          >
            <option value="">Choose when starting a chat</option>
            {(agents ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ui-field">
          Default model ID
          <input
            className="g-input"
            value={model}
            disabled={!agent}
            maxLength={256}
            spellCheck={false}
            onChange={(event) => setModel(event.currentTarget.value)}
            aria-describedby="project-default-model-help"
          />
          <small id="project-default-model-help" className="ui-muted">
            Leave blank for the agent's default. A specific model ID is checked when a new chat
            starts.
          </small>
        </label>
        {(localError ?? state.error) ? (
          <p role="alert" className="ui-error">
            {localError ?? state.error}
          </p>
        ) : null}
        <section aria-label="Workspace removal">
          {recoveryError ? (
            <p role="alert" className="ui-error">
              Could not load retained worktrees: {recoveryError}
            </p>
          ) : null}
          <WorktreeRecoveryList
            records={worktreesToReview(
              worktrees,
              state.data ? new Set(state.data.chats.map((entry) => entry.chat.id)) : null,
            )}
            api={recoveryApi}
            onChanged={() => setRecoveryRevision((value) => value + 1)}
          />
          {project ? (
            <button
              className="g-button"
              type="button"
              onClick={() => setRemoval({ target: { kind: "project", id: project.id } })}
            >
              Remove project…
            </button>
          ) : null}
          <button className="g-button" type="button" onClick={() => setRemoval({ target: null })}>
            Removed projects and folders
          </button>
        </section>
        <footer>
          <button type="button" className="g-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="g-button g-button-primary"
            disabled={state.busy || picking || !name.trim() || (!project && !folder)}
          >
            {state.busy ? "Saving…" : project ? "Save project" : "Create project"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
