import { useState } from "react";
import type { LocalImportPreview, LocalImportResult } from "../../bindings";
import { errorMessage } from "../../lib/errors";
import { type LocalImportApi, localImportApi } from "../../lib/localImport";
import { Modal } from "../chat/Modal";
import "./local-import.css";
import "./settings.css";

/** Mount only for the unlocked active Account. Reading Local starts with the review button. */
export function LocalImportPanel({
  api = localImportApi,
  onImported,
}: {
  readonly api?: LocalImportApi;
  readonly onImported: (result: LocalImportResult) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<LocalImportPreview | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LocalImportResult | null>(null);
  const [needsReview, setNeedsReview] = useState(false);

  const preview = async () => {
    if (busy) return;
    setOpen(true);
    setBusy(true);
    setError(null);
    setReview(null);
    setSelected(new Set());
    try {
      setReview(await api.preview());
      setNeedsReview(false);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (busy || needsReview || !review || selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.apply(
        review.projects
          .filter((project) => !project.already_imported && selected.has(project.project_id))
          .map(({ project_id, revision }) => ({ project_id, revision })),
      );
      setResult(result);
      setOpen(false);
      try {
        await onImported(result);
      } catch {
        setError("The projects were imported. Refresh the workspace to display them.");
      }
    } catch (error) {
      setError(errorMessage(error));
      setNeedsReview(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-section local-import-panel" aria-labelledby="local-import-title">
      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-text">
            <div>
              <h3 id="local-import-title" className="settings-row-label">
                Your Local projects
              </h3>
              <p>Bring chosen projects and chats into this Account. Local keeps its copy.</p>
            </div>
          </div>
          <button
            type="button"
            className="g-button g-button-outline g-button-28"
            disabled={busy}
            onClick={() => void preview()}
          >
            Review Local projects
          </button>
          {result && (
            <p className="settings-note settings-span" role="status">
              {result.project_ids.length === 0
                ? "These projects are already in this Account."
                : `Imported ${result.project_ids.length} project(s) and ${result.chats} chat(s).`}
              {result.missing_attachments > 0 &&
                ` ${result.missing_attachments} saved attachment(s) were already missing from Local.`}
            </p>
          )}
          {!open && error && (
            <p role="alert" className="settings-alert settings-span">
              {error}
            </p>
          )}
        </div>
      </div>
      {open && (
        <Modal
          title="Bring Local projects into this Account"
          size="md"
          className="local-import-dialog"
          onClose={() => setOpen(false)}
          closeDisabled={busy}
        >
          {busy && (
            <p role="status" className="settings-note">
              {review ? "Copying selected projects…" : "Reading Local projects…"}
            </p>
          )}
          {error && (
            <p role="alert" className="settings-alert">
              {error}
            </p>
          )}
          {review && (
            <>
              {review.notices.length ? (
                <ul className="local-import-notices">
                  {review.notices.map((notice) => (
                    <li key={notice}>{notice}</li>
                  ))}
                </ul>
              ) : null}
              {review.projects.length === 0 ? (
                <p className="local-import-count">No Local projects are available to import.</p>
              ) : (
                <fieldset disabled={busy || needsReview} className="local-import-projects">
                  <legend>Choose projects</legend>
                  {review.projects.map((project) => (
                    <label key={project.project_id}>
                      <input
                        type="checkbox"
                        checked={selected.has(project.project_id)}
                        disabled={
                          project.already_imported ||
                          (!selected.has(project.project_id) && selected.size >= 64)
                        }
                        onChange={(event) => {
                          const next = new Set(selected);
                          if (event.target.checked) next.add(project.project_id);
                          else next.delete(project.project_id);
                          setSelected(next);
                        }}
                      />
                      <span>
                        <strong>{project.name}</strong>
                        <small>
                          {project.already_imported
                            ? "Already imported"
                            : `${project.chats} chat(s), ${project.turns} turn(s)`}
                        </small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              {selected.size >= 64 && (
                <p className="settings-note">Import up to 64 projects at a time.</p>
              )}
            </>
          )}
          <footer className="g-dialog-actions local-import-actions">
            <button
              type="button"
              className="g-button"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            {needsReview || !review ? (
              <button
                type="button"
                className="g-button"
                disabled={busy}
                onClick={() => void preview()}
              >
                Review again
              </button>
            ) : (
              <button
                type="button"
                className="g-button g-button-primary"
                disabled={busy || selected.size === 0}
                onClick={() => void apply()}
              >
                Import selected projects
              </button>
            )}
          </footer>
        </Modal>
      )}
    </section>
  );
}
