import { Globe, Play } from "lucide-react";
import { useEffect, useState } from "react";
import type { HistoryEntry } from "../../bindings";
import { type BrowserStore, shownAddress, siteOf } from "../../lib/browser";

/**
 * A new tab: the chat's own app (its Run address) when it has one, and the pages visited last,
 * one per site. The address bar above takes anything else.
 */
export function StartPage({
  store,
  runUrl,
  onOpen,
}: {
  readonly store: BrowserStore;
  /** The chat's Run address (`http://localhost:3104`), when its worktree saved a Run command. */
  readonly runUrl: string | null;
  readonly onOpen: (url: string) => void;
}) {
  const [recent, setRecent] = useState<readonly HistoryEntry[] | null>(null);
  useEffect(() => {
    let current = true;
    store.api.history("", 60, null).then(
      (entries) => {
        if (!current) return;
        const seen = new Set<string>();
        const sites: HistoryEntry[] = [];
        for (const entry of entries) {
          const site = siteOf(entry.url);
          if (seen.has(site)) continue;
          seen.add(site);
          sites.push(entry);
          if (sites.length === 8) break;
        }
        setRecent(sites);
      },
      () => {
        if (current) setRecent([]);
      },
    );
    return () => {
      current = false;
    };
  }, [store]);

  return (
    <div className="browser-start" data-testid="browser-start">
      <div className="browser-start-inner">
        <h2 className="browser-start-title">New tab</h2>
        <p className="browser-start-lead">
          Type an address or a search above. Pages open here, beside the chat, where the agent can
          see them too.
        </p>
        {runUrl ? (
          <button type="button" className="browser-start-run" onClick={() => onOpen(runUrl)}>
            <span className="browser-start-run-mark" aria-hidden="true">
              <Play size={14} />
            </span>
            <span className="browser-start-run-text">
              <span>This chat's app</span>
              <span className="browser-start-run-address">{shownAddress(runUrl)}</span>
            </span>
          </button>
        ) : null}
        {recent && recent.length > 0 ? (
          <section className="browser-start-recent" aria-label="Recent pages">
            <h3 className="browser-start-heading">Recent</h3>
            <ul>
              {recent.map((entry) => (
                <li key={entry.url}>
                  <button
                    type="button"
                    className="browser-start-page"
                    title={entry.url}
                    onClick={() => onOpen(entry.url)}
                  >
                    <span className="browser-start-page-mark" aria-hidden="true">
                      <Globe size={14} />
                    </span>
                    <span className="browser-start-page-title">
                      {entry.title || siteOf(entry.url)}
                    </span>
                    <span className="browser-start-page-site">{siteOf(entry.url)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
