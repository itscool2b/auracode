import { useEffect, useId, useRef, useState } from "react";
import type { FolderLocationReview, FolderResolution, ProjectFolder } from "../../bindings";
import { type FolderResolutionApi, folderResolutionApi } from "../../lib/folderResolution";
import { CloneProject } from "./CloneProject";
import "./folder-resolver.css";
import { RepositoryPublisher } from "./RepositoryPublisher";

/** Mount under the active profile and key by profile ID. Only explicit Search reads code roots. */
export function FolderResolver({
  folderId,
  pickFolder,
  onLocated,
  api = folderResolutionApi,
}: {
  readonly folderId: string;
  readonly pickFolder: () => Promise<string | null>;
  readonly onLocated: (folder: ProjectFolder) => Promise<void>;
  readonly api?: FolderResolutionApi;
}) {
  const title = useId();
  const generation = useRef(0);
  const pending = useRef(false);
  const [value, setValue] = useState<FolderResolution | null>(null);
  const [review, setReview] = useState<FolderLocationReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [searched, setSearched] = useState(false);
  useEffect(() => {
    const token = ++generation.current;
    setValue(null);
    setReview(null);
    setError("");
    setSaved(false);
    setSearched(false);
    setBusy(false);
    pending.current = false;
    void api
      .resolution(folderId, false)
      .then((next) => {
        if (generation.current === token) setValue(next);
      })
      .catch((reason) => {
        if (generation.current === token) setError(message(reason));
      });
    return () => {
      generation.current++;
    };
  }, [api, folderId]);
  const run = async (operation: (current: () => boolean) => Promise<void>) => {
    if (pending.current) return;
    const token = generation.current;
    const current = () => generation.current === token;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await operation(current);
    } catch (reason) {
      if (current()) setError(message(reason));
    } finally {
      if (current()) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  const locate = (path?: string) =>
    void run(async (current) => {
      const selected = path ?? (await pickFolder());
      if (!selected || !current()) return;
      const next = await api.review(folderId, selected);
      if (current()) {
        setReview(next);
        setSaved(false);
      }
    });
  const roots = (next: string[]) =>
    void run(async (current) => {
      const saved = await api.setRoots(next);
      if (current()) {
        setValue((prior) => (prior ? { ...prior, roots: saved, matches: [] } : null));
        setSearched(false);
      }
    });
  const addRoot = () =>
    void run(async (current) => {
      const path = await pickFolder();
      if (!path || !current() || !value) return;
      const saved = await api.setRoots([...value.roots, path]);
      if (current()) {
        setValue({ ...value, roots: saved, matches: [] });
        setSearched(false);
      }
    });
  const search = () =>
    void run(async (current) => {
      const next = await api.resolution(folderId, true);
      if (current()) {
        setValue(next);
        setReview(null);
        setSearched(true);
      }
    });
  const apply = () =>
    void run(async (current) => {
      if (!review) return;
      const folder = await api.apply(review);
      if (!current()) return;
      setReview(null);
      setSaved(true);
      setValue((prior) => (prior ? { ...prior, folder } : null));
      try {
        await onLocated(folder);
      } catch {
        if (current()) setError("The location was saved. Refresh the workspace to show it.");
      }
    });
  const remote = value?.folder.git_remote_url;
  const canClone =
    remote?.startsWith("https://github.com/") || remote?.startsWith("ssh://git@github.com/");
  return (
    <section className="folder-resolver" aria-labelledby={title}>
      <p id={title} className="folder-resolver-lead">
        Find <strong>{value?.folder.display_name ?? "the project folder"}</strong> on this device.
        Its path stays here; agent history needs its own Continue here review.
      </p>
      {value?.notices.map((notice) => (
        <p className="setup-footnote" key={notice}>
          {notice}
        </p>
      ))}
      {value?.folder.kind === "local" && value.folder.path && (
        <RepositoryPublisher
          folderId={folderId}
          onPublished={async () => {
            const token = generation.current;
            const next = await api.resolution(folderId, false);
            if (generation.current !== token) return;
            setValue(next);
            await onLocated(next.folder);
          }}
        />
      )}
      {value?.folder.kind === "git" && (
        <>
          <dl className="setup-rows folder-resolver-remote">
            <dt>Repository</dt>
            <dd>{remote}</dd>
          </dl>
          <h3>
            Code roots
            <small>Searched up to three levels below each root.</small>
          </h3>
          {value.roots.length ? (
            <ul className="folder-resolver-roots">
              {value.roots.map((root) => (
                <li key={root}>
                  <span className="setup-path">{root}</span>{" "}
                  <button
                    type="button"
                    className="g-button g-button-ghost g-button-28"
                    disabled={busy}
                    aria-label={`Remove code root ${root}`}
                    onClick={() => roots(value.roots.filter((path) => path !== root))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="setup-footnote">No code roots selected.</p>
          )}
          <footer className="folder-resolver-search">
            <button
              type="button"
              className="g-button g-button-ghost g-button-28"
              disabled={busy || value.roots.length >= 16}
              onClick={addRoot}
            >
              Add code root
            </button>
            <button
              type="button"
              className="g-button g-button-outline g-button-28"
              disabled={busy || !value.roots.length}
              onClick={search}
            >
              Search for repository
            </button>
          </footer>
          {value.matches.length > 0 && (
            <ul>
              {value.matches.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    className="setup-folder"
                    disabled={busy}
                    onClick={() => locate(path)}
                  >
                    {path}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searched && !value.matches.length && (
            <p role="status" className="setup-footnote">
              No matching repository found in the checked folders. Locate it directly or clone it.
            </p>
          )}
        </>
      )}
      <footer className="folder-resolver-other">
        <button
          type="button"
          className="g-button g-button-ghost g-button-28"
          disabled={busy || !value}
          onClick={() => locate()}
        >
          Locate folder
        </button>
        {canClone && remote && (
          <CloneProject
            key={remote}
            remote={remote}
            label="Clone this repository"
            pickParent={pickFolder}
            onFolder={(path) => locate(path)}
            disabled={busy}
          />
        )}
      </footer>
      {review && (
        <section aria-label="Review folder location">
          <h3>Use this folder</h3>
          <p className="setup-path">{review.path}</p>
          <ul>
            {review.notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
          <footer>
            <button
              type="button"
              className="g-button g-button-ghost g-button-28"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="g-button g-button-primary g-button-28"
              disabled={busy}
              onClick={apply}
            >
              Use on this device
            </button>
          </footer>
        </section>
      )}
      {busy && (
        <p role="status" className="setup-footnote">
          Checking folder…
        </p>
      )}
      {saved && (
        <p role="status" className="folder-resolver-saved">
          Folder location saved for this device.
        </p>
      )}
      {error && (
        <p role="alert" className="setup-alert">
          {error}
        </p>
      )}
    </section>
  );
}
function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : "The folder could not be checked. Try again.";
}
