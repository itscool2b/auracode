import { useEffect, useState } from "react";
import { usePageVisible, useReducedMotion } from "../motion";

export function RotatingAgent({ names }: { names: readonly string[] }) {
  const [index, setIndex] = useState(0);
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  useEffect(() => {
    if (reduced || !visible || names.length < 2) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % names.length), 3000);
    return () => window.clearInterval(timer);
  }, [names, reduced, visible]);
  return (
    <span className="agent-slot">
      <span className="agent-word" key={index}>
        {names[index] ?? ""}.
      </span>
      <span className="agent-measure">
        {names.reduce((longest, name) => (name.length > longest.length ? name : longest), "")}.
      </span>
    </span>
  );
}
