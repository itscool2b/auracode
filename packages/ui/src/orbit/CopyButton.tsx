import { useEffect, useRef, useState } from "react";

/** Clipboard success is announced only after the platform accepts the write. */
export function CopyButton({
  text,
  label = "Copy",
  caption = "Copy",
}: {
  readonly text: string;
  readonly label?: string;
  readonly caption?: string;
}) {
  const [state, setState] = useState<"ready" | "copying" | "copied" | "failed">("ready");
  const mounted = useRef(true);
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (reset.current !== null) clearTimeout(reset.current);
    };
  }, []);
  const copy = async () => {
    if (reset.current !== null) clearTimeout(reset.current);
    setState("copying");
    try {
      await navigator.clipboard.writeText(text);
      if (!mounted.current) return;
      setState("copied");
      reset.current = setTimeout(() => setState("ready"), 1200);
    } catch {
      if (mounted.current) setState("failed");
    }
  };
  return (
    <span className="o-copy-control">
      <button
        type="button"
        className="o-copy"
        aria-label={label}
        disabled={state === "copying"}
        onClick={() => void copy()}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
        >
          {state === "copied" ? (
            <path d="m2 6 2.5 2.5L10 3" />
          ) : (
            <>
              <rect x="4" y="4" width="6" height="6" rx="1" />
              <path d="M2 8V3a1 1 0 0 1 1-1h5" />
            </>
          )}
        </svg>
        <span aria-live="polite">{state === "copied" ? "Copied" : caption}</span>
      </button>
      {state === "failed" ? (
        <span role="alert" className="o-copy-error">
          Could not copy. Select the text and copy it instead.
        </span>
      ) : null}
    </span>
  );
}
