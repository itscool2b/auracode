import { Logo } from "@auracode/ui/graphite";
import type { ReactNode } from "react";

/**
 * An inner page: a two-tone title (the first clause in ink, the rest in grey on its own line)
 * inside the framed content column. No eyebrow above it; an optional picture stands beside it.
 */
export function Page({
  title,
  tone,
  lead,
  art,
  wide = false,
  children,
}: {
  title: string;
  tone?: string;
  lead?: ReactNode;
  /** Decorative, beside the title on wide screens. */
  art?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <main id="main" className="page">
      <div className="frame page-frame">
        <div className={wide ? "page-column page-column-wide" : "page-column"}>
          <header className={art ? "page-head page-head-art" : "page-head"} data-reveal="">
            <div className="page-head-text">
              <h1 className="page-title">
                {title}
                {tone ? (
                  <>
                    {" "}
                    <span>{tone}</span>
                  </>
                ) : null}
              </h1>
              {lead ? <p className="page-lead">{lead}</p> : null}
            </div>
            {art ? (
              <div className="page-art" aria-hidden="true">
                {art}
              </div>
            ) : null}
          </header>
          {children}
        </div>
      </div>
    </main>
  );
}

/**
 * The app as an object: the auracode logo on a raised white tile with a hairline rim, the way the
 * desktop app's icon sits on a dock. Decorative; the page around it names the app.
 */
export function AppTile({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? "app-tile app-tile-small" : "app-tile"}>
      <Logo size={small ? 36 : 56} />
    </span>
  );
}

/** A status or alert row: a square in the row's tone, then the sentence. */
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <p className={error ? "notice notice-error" : "notice"} role={error ? "alert" : "status"}>
      <span className="notice-mark" aria-hidden="true" />
      <span className="notice-text">{children}</span>
    </p>
  );
}

export const formatBytes = (bytes: number) =>
  `${(bytes / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`;

/** A small arrow drawn on whole pixels, for links that move you somewhere. */
export function Arrow({ direction = "right" }: { direction?: "right" | "up-right" | "down" }) {
  const path =
    direction === "up-right"
      ? "M4 3h5v5M9 3 3 9"
      : direction === "down"
        ? "M6 2v8M2.5 6.5 6 10l3.5-3.5"
        : "M2 6h8M6.5 2.5 10 6l-3.5 3.5";
  return (
    <svg
      className="arrow"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}
