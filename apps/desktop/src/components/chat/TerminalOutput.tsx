import { type ReactNode, useLayoutEffect, useRef } from "react";
import { useDisclosure } from "./DisclosureMemory";

/** Keep the end of a command visible while preserving the complete loaded output for expansion. */
export function TerminalOutput({
  text,
  running,
  disclosureKey,
  children,
}: {
  readonly text: string;
  readonly running: boolean;
  readonly disclosureKey: string;
  readonly children: ReactNode;
}) {
  const [expanded, setExpanded] = useDisclosure(`${disclosureKey}:terminal`, "output", false);
  const body = useRef<HTMLElement>(null);
  const lines = text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;
  const folded = lines > (running ? 6 : 12) && !expanded;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Output text can grow without changing the constrained body's height.
  useLayoutEffect(() => {
    const node = body.current;
    if (!folded || !node) return;
    const follow = () => {
      node.scrollTop = node.scrollHeight;
    };
    follow();
    const observer = new ResizeObserver(follow);
    observer.observe(node);
    return () => observer.disconnect();
  }, [folded, text]);
  return (
    <div className="chat-terminal" data-running={running} data-folded={folded}>
      <section
        ref={body}
        className="chat-terminal-body"
        data-testid="terminal-output"
        aria-label="Command output"
        tabIndex={folded ? -1 : 0}
      >
        {children}
      </section>
      {lines > (running ? 6 : 12) ? (
        <button
          type="button"
          className="chat-terminal-expand"
          aria-expanded={expanded}
          onClick={() => {
            if (body.current && !expanded) body.current.scrollTop = 0;
            setExpanded(!expanded);
          }}
        >
          {expanded ? "Show recent lines" : `Show all ${lines} loaded lines`}
        </button>
      ) : null}
    </div>
  );
}
