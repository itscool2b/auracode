import { Globe, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryEntry } from "../../bindings";
import { type BrowserApi, dayLabel, shownAddress, siteOf } from "../../lib/browser";
import { errorMessage } from "../../lib/errors";

const PAGE = 100;

/**
 * The browser's history, newest first by day, searchable, each page removable. Opening one loads
 * it (in the panel, or in a new tab from Settings). Clear browsing data is the caller's button.
 */
export function HistoryView({
  api,
  onOpen,
  actions,
  now = Date.now,
  level = 2,
}: {
  readonly api: BrowserApi;
  readonly onOpen?: (url: string) => void;
  /** Shown beside the search field (Clear browsing data, Close). */
  readonly actions?: React.ReactNode;
  readonly now?: () => number;
  /** The days' heading level: 2 in the panel, 3 under a dialog's title. */
  readonly level?: 2 | 3;
}) {
  const Day = level === 3 ? "h3" : "h2";
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<readonly HistoryEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const loading = useRef(false);

  // Read again when the query changes (a moment after typing stops) or after a removal.
  useEffect(() => {
    void revision;
    let current = true;
    const timer = window.setTimeout(
      () => {
        api.history(query.trim(), PAGE, null).then(
          (found) => {
            if (!current) return;
            setEntries(found);
            setMore(found.length === PAGE);
            setError(null);
          },
          (failure) => {
            if (current) setError(errorMessage(failure));
          },
        );
      },
      query ? 120 : 0,
    );
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [api, query, revision]);

  const loadMore = useCallback(() => {
    if (loading.current || !entries?.length) return;
    loading.current = true;
    const before = entries[entries.length - 1]?.last_visit ?? null;
    api.history(query.trim(), PAGE, before).then(
      (found) => {
        loading.current = false;
        setEntries((current) => [...(current ?? []), ...found]);
        setMore(found.length === PAGE);
      },
      (failure) => {
        loading.current = false;
        setError(errorMessage(failure));
      },
    );
  }, [api, entries, query]);

  const remove = (url: string) => {
    setEntries((current) => current?.filter((entry) => entry.url !== url) ?? null);
    api.removeHistory([url]).catch((failure) => {
      setError(errorMessage(failure));
      setRevision((value) => value + 1);
    });
  };

  const groups: { day: string; entries: HistoryEntry[] }[] = [];
  const today = now();
  for (const entry of entries ?? []) {
    const day = dayLabel(entry.last_visit ?? 0, today);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  }

  return (
    <section className="browser-history" aria-label="History" data-testid="browser-history">
      <div className="browser-history-bar">
        <label className="browser-history-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            className="browser-history-field"
            aria-label="Search history"
            placeholder="Search history"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {actions}
      </div>
      {error ? (
        <p className="ui-error browser-history-note" role="alert">
          {error}
        </p>
      ) : null}
      <div
        className="browser-history-scroll"
        onScroll={(event) => {
          const node = event.currentTarget;
          if (more && node.scrollTop + node.clientHeight > node.scrollHeight - 200) loadMore();
        }}
      >
        {entries === null ? null : entries.length === 0 ? (
          <p className="browser-history-note">
            {query.trim() ? "No pages match." : "Pages you open in the browser show here."}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.day} className="browser-history-day" aria-label={group.day}>
              <Day className="browser-history-heading">{group.day}</Day>
              <ul>
                {group.entries.map((entry) => (
                  <li key={entry.url} className="browser-history-row">
                    <button
                      type="button"
                      className="browser-history-open"
                      title={entry.url}
                      disabled={!onOpen}
                      onClick={() => onOpen?.(entry.url)}
                    >
                      <span className="browser-history-mark" aria-hidden="true">
                        <Globe size={14} />
                      </span>
                      <span className="browser-history-title">
                        {entry.title || siteOf(entry.url)}
                      </span>
                      <span className="browser-history-site">{shownAddress(entry.url)}</span>
                      <span className="browser-history-time">
                        {new Date(entry.last_visit ?? 0).toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="g-button g-button-ghost g-button-icon g-button-24 browser-history-remove"
                      aria-label={`Remove ${entry.title || siteOf(entry.url)} from history`}
                      title="Remove from history"
                      onClick={() => remove(entry.url)}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </section>
  );
}
