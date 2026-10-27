import { useEffect, useId, useRef, useState } from "react";
import type { RepositoryPublicationResult, RepositoryPublicationReview } from "../../bindings";
import {
  type RepositoryPublicationApi,
  repositoryPublicationApi,
} from "../../lib/repositoryPublication";
import "./repository-publisher.css";

/** All GitHub reads start with the explicit review button. No automatic auth or remote writes. */
export function RepositoryPublisher({
  folderId,
  onPublished,
  api = repositoryPublicationApi,
}: {
  readonly folderId: string;
  readonly onPublished: () => Promise<void>;
  readonly api?: RepositoryPublicationApi;
}) {
  const title = useId();
  const generation = useRef(0);
  const currentFolder = useRef(folderId);
  const pending = useRef(false);
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("");
  const [review, setReview] = useState<RepositoryPublicationReview | null>(null);
  const [result, setResult] = useState<RepositoryPublicationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [savedTarget, setSavedTarget] = useState(false);
  useEffect(() => {
    currentFolder.current = folderId;
    generation.current++;
    pending.current = false;
    setOpen(false);
    setReview(null);
    setResult(null);
    setBusy(false);
    setError("");
    setOwner("");
    setName("");
    setDraftReady(false);
    setSavedTarget(false);
    return () => {
      generation.current++;
    };
  }, [folderId]);
  const run = async (operation: (current: () => boolean) => Promise<void>) => {
    if (pending.current) return;
    const token = generation.current;
    const current = () => generation.current === token && currentFolder.current === folderId;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await operation(current);
    } catch (reason) {
      if (current())
        setError(
          reason instanceof Error
            ? reason.message
            : "Publication could not be confirmed. Review its saved state before trying again.",
        );
    } finally {
      if (current()) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  const prepare = () =>
    void run(async (current) => {
      const next = await api.review(folderId, { owner: owner.trim(), name: name.trim() });
      if (current()) {
        setReview(next);
        setResult(null);
      }
    });
  const show = () => {
    setOpen(true);
    setDraftReady(false);
    void run(async (current) => {
      const draft = await api.draft(folderId);
      if (!current()) return;
      if (draft) {
        setOwner(draft.input.owner);
        setName(draft.input.name);
      }
      setSavedTarget(draft !== null);
      setDraftReady(true);
    });
  };
  const apply = () =>
    void run(async (current) => {
      if (!review) return;
      const token = review.token;
      // Tokens are one use. Any uncertain transport outcome requires a fresh native review.
      setReview(null);
      const next = await api.apply(folderId, token);
      if (!current()) return;
      setResult(next);
      if (next.state === "complete") {
        try {
          await onPublished();
        } catch {
          if (current())
            setError(
              "The repository is published. Refresh the workspace to show its portable identity.",
            );
        }
      }
    });
  if (!open)
    return (
      <button type="button" className="g-button g-button-ghost g-button-28" onClick={show}>
        Publish to GitHub
      </button>
    );
  return (
    <section className="repository-publisher" aria-labelledby={title}>
      <h3 id={title}>Publish a private repository</h3>
      <p className="setup-footnote">
        Uses GitHub CLI's existing sign-in. Review contacts GitHub; only confirmation creates a
        repository and publishes committed history. Uncommitted files stay on this device.
      </p>
      {!review && result?.state !== "complete" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            prepare();
          }}
        >
          <label className="setup-field">
            GitHub owner
            <input
              className="g-input"
              maxLength={39}
              disabled={busy || savedTarget || !draftReady}
              value={owner}
              placeholder="Your signed-in account, or organization"
              onChange={(event) => setOwner(event.currentTarget.value)}
            />
          </label>
          <label className="setup-field">
            Repository name
            <input
              className="g-input"
              maxLength={100}
              required
              disabled={busy || savedTarget || !draftReady}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <p>Visibility: Private</p>
          <button
            type="submit"
            className="g-button g-button-outline"
            disabled={busy || !name.trim() || !draftReady}
          >
            {result || savedTarget ? "Review saved publication" : "Review publication"}
          </button>
        </form>
      )}
      {review && (
        <>
          <dl>
            <dt>Repository</dt>
            <dd>{review.repository}</dd>
            <dt>Visibility</dt>
            <dd>Private</dd>
            <dt>Working folder</dt>
            <dd className="setup-path">{review.path}</dd>
            <dt>Branch</dt>
            <dd>{review.branch}</dd>
            <dt>Commit</dt>
            <dd className="setup-path">{review.head_commit}</dd>
          </dl>
          <ul>
            {review.notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
          <footer>
            <button
              type="button"
              className="g-button g-button-ghost"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Back
            </button>
            <button
              type="button"
              className="g-button g-button-primary"
              disabled={busy || !review.private}
              onClick={apply}
            >
              {review.recovering ? "Finish reviewed publication" : "Create private repository"}
            </button>
          </footer>
        </>
      )}
      {busy && (
        <p role="status" className="setup-footnote">
          Waiting for the owned GitHub operation…
        </p>
      )}
      {result && (
        <p role="status" className="repository-publisher-result">
          {result.detail} {result.url}
        </p>
      )}
      {error && (
        <p role="alert" className="setup-alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="g-button g-button-ghost g-button-28 repository-publisher-close"
        disabled={busy}
        onClick={() => {
          setOpen(false);
          setReview(null);
        }}
      >
        Close publication
      </button>
    </section>
  );
}
