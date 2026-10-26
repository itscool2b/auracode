import type { ReactNode } from "react";
export function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <ellipse
        cx="16"
        cy="16"
        rx="14"
        ry="5.5"
        transform="rotate(-30 16 16)"
        stroke="currentColor"
      />
      <circle cx="16" cy="16" r="3" fill="currentColor" />
      <path d="M24 5h4v4h-4z" fill="currentColor" />
    </svg>
  );
}
export function Page({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <main id="main" className="page">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {children}
    </main>
  );
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <p className={`notice ${error ? "error" : ""}`} role={error ? "alert" : "status"}>
      {children}
    </p>
  );
}
export const formatBytes = (bytes: number) =>
  `${(bytes / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`;
export function Globe() {
  return (
    <svg
      className="globe"
      viewBox="0 0 600 400"
      role="img"
      aria-label="Coding agents around one local workspace"
    >
      <defs>
        <clipPath id="sphere">
          <circle cx="300" cy="200" r="145" />
        </clipPath>
      </defs>
      <g stroke="currentColor" fill="none" opacity=".25">
        <circle cx="300" cy="200" r="145" />
        <g clipPath="url(#sphere)">
          {[35, 80, 120].map((r) => (
            <ellipse key={r} cx="300" cy="200" rx={r} ry="145" />
          ))}
          {[110, 155, 200, 245, 290].map((y) => (
            <ellipse key={y} cx="300" cy={y} rx="145" ry="25" />
          ))}
        </g>
        <ellipse
          cx="300"
          cy="200"
          rx="220"
          ry="65"
          transform="rotate(-24 300 200)"
          strokeDasharray="3 5"
        />
      </g>
      <g fill="currentColor" fontSize="11" fontFamily="Geist Mono Variable, monospace">
        <rect x="109" y="260" width="6" height="6" />
        <text x="51" y="289">
          CLAUDE CODE
        </text>
        <rect x="445" y="106" width="6" height="6" />
        <text x="461" y="111">
          CODEX
        </text>
        <rect x="250" y="53" width="6" height="6" />
        <text x="211" y="35">
          PI
        </text>
        <rect x="399" y="307" width="6" height="6" />
        <text x="411" y="332">
          OPENCODE
        </text>
      </g>
      <rect x="297" y="197" width="6" height="6" fill="#ff6308" />
    </svg>
  );
}
