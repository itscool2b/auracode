import type { ReactNode } from "react";

/**
 * An inner page: a two-tone title (the first clause in ink, the rest in grey) inside the
 * framed content column. No eyebrow above it.
 */
export function Page({
  title,
  tone,
  lead,
  wide = false,
  children,
}: {
  title: string;
  tone?: string;
  lead?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <main id="main" className="page">
      <div className="frame page-frame">
        <div className={wide ? "page-column page-column-wide" : "page-column"}>
          <header className="page-head" data-reveal="">
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
          </header>
          {children}
        </div>
      </div>
    </main>
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
