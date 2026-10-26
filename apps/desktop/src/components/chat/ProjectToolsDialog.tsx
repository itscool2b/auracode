import { useEffect, useRef, useState } from "react";
import type { ProjectEditor, ProjectShellChoice, ProjectToolsReview } from "../../bindings";
import { errorMessage } from "../../lib/errors";
import { editorName, type ProjectToolsApi, projectToolsApi } from "../../lib/projectTools";
import type { TerminalTransport } from "../../lib/terminal";
import { TerminalSheet } from "../TerminalSheet";
import { Modal } from "./Modal";
import "./project-tools.css";

export function ProjectToolsDialog({
  chatId,
  onClose,
  api = projectToolsApi,
}: {
  readonly chatId: string;
  readonly onClose: () => void;
  readonly api?: ProjectToolsApi;
}) {
  const [review, setReview] = useState<ProjectToolsReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [terminal, setTerminal] = useState<{
    shell: ProjectShellChoice;
    folder: string;
    transport: TerminalTransport;
  } | null>(null);
  const alive = useRef(false);
  const acting = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    void revision;
    let current = true;
    setReview(null);
    setBusy(true);
    void api
      .review(chatId)
      .then(
        (value) => {
          if (current) setReview(value);
        },
        (failure) => {
          if (current) setError(errorMessage(failure));
        },
      )
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [chatId, api, revision]);

  const openEditor = async (editor: ProjectEditor) => {
    if (!review || acting.current) return;
    acting.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const token = review.token;
    setReview(null);
    try {
      await api.openEditor(chatId, token, editor);
      if (alive.current)
        setNotice(`The operating system accepted the request for ${editorName[editor]}.`);
    } catch (failure) {
      if (alive.current) setError(errorMessage(failure));
    } finally {
      acting.current = false;
      if (alive.current) setBusy(false);
    }
  };
  if (terminal)
    return (
      <TerminalSheet
        agentId="project"
        agentName={terminal.shell.label}
        purpose="project"
        transport={terminal.transport}
        onClose={onClose}
        review={
          <div className="project-terminal-review">
            <p>{terminal.folder}</p>
            <code>
              {terminal.shell.program} {terminal.shell.args.join(" ")}
            </code>
            <p>
              Agents can keep working here. Worktree changes wait until this terminal closes and its
              processes finish.
            </p>
          </div>
        }
      />
    );
  return (
    <Modal
      title="Project tools"
      onClose={onClose}
      className="project-tools-dialog"
      closeDisabled={busy && acting.current}
    >
      <div className="project-tools-body">
        {error ? (
          <p role="alert" className="ui-error">
            {error}
          </p>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
        {busy ? <p role="status">Checking project tools…</p> : null}
        {review ? (
          <>
            <p className="project-tools-path">{review.folder}</p>
            <section aria-label="Project terminal">
              <h3>Terminal</h3>
              <p>
                Choose a shell, review its folder and command, then start it. Agents can keep
                running.
              </p>
              <div className="project-tools-options">
                {review.shells.map((shell) => (
                  <button
                    key={shell.id}
                    type="button"
                    className="ui-button"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setNotice(null);
                      setTerminal({
                        shell,
                        folder: review.folder,
                        transport: api.terminal(chatId, review.token, shell.id),
                      });
                      setReview(null);
                    }}
                  >
                    Review {shell.label} terminal
                  </button>
                ))}
              </div>
              {review.shells.length === 0 ? <p>No supported native shell was found.</p> : null}
            </section>
            <section aria-label="Project editor">
              <h3>Open in editor</h3>
              <p>
                Open this folder in a detected editor through its operating system link handler.
              </p>
              <div className="project-tools-options">
                {review.editors.map((editor) => (
                  <button
                    key={editor}
                    type="button"
                    className="ui-button"
                    disabled={busy}
                    onClick={() => {
                      void openEditor(editor);
                    }}
                  >
                    Open in {editorName[editor]}
                  </button>
                ))}
              </div>
              {review.editors.length === 0 ? (
                <p>
                  No supported editor was found in the standard application locations. Open custom
                  installations manually.
                </p>
              ) : null}
            </section>
            <p className="ui-muted">
              This review expires in ten minutes. A moved folder requires a new review.
            </p>
          </>
        ) : null}
        {!busy && !review ? (
          <button
            type="button"
            className="ui-button"
            onClick={() => {
              setError(null);
              setNotice(null);
              setRevision((value) => value + 1);
            }}
          >
            Review project tools again
          </button>
        ) : null}
      </div>
    </Modal>
  );
}
