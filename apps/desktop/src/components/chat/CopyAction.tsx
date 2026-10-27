import { Check, Copy } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * An icon-only copy action for the quiet rows under messages (Grok's action row). Like Graphite's
 * CopyButton it says "Copied" (a check) only after the clipboard takes the text, and a refusal says
 * what to do instead.
 */
export function CopyAction({
  text,
  label,
  icon = <Copy size={14} />,
}: {
  readonly text: string;
  readonly label: string;
  readonly icon?: ReactNode;
}) {
  const [state, setState] = useState<"ready" | "copying" | "copied" | "failed">("ready");
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
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
    <>
      <button
        type="button"
        className="chat-action"
        aria-label={label}
        title={state === "copied" ? "Copied" : label}
        data-state={state}
        disabled={state === "copying"}
        onClick={() => void copy()}
      >
        {state === "copied" ? <Check size={14} /> : icon}
        <span className="sr-only" aria-live="polite">
          {state === "copied" ? "Copied" : ""}
        </span>
      </button>
      {state === "failed" ? (
        <span role="alert" className="chat-action-error">
          Could not copy. Select the text and copy it instead.
        </span>
      ) : null}
    </>
  );
}
