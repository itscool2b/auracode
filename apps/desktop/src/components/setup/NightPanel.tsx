import { getBrand, usePrefersReducedMotion } from "@auracode/ui";
import { Globe, type GlobeDiscovery, type GlobeProject } from "@auracode/ui/orbit";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentEntry } from "../../bindings";

/** Transport aliases stay visible on Agents; the globe shows one primary mark per harness. */
export function primaryAgents(agents: readonly AgentEntry[]): readonly AgentEntry[] {
  return agents.filter(
    (agent) =>
      !agent.id.endsWith("-acp") &&
      !agent.id.endsWith("-stream") &&
      agent.id !== "mock" &&
      agent.id !== "opencode-v2",
  );
}

export function NightPanel({
  agents,
  project = null,
  cinematic = false,
}: {
  readonly agents: readonly AgentEntry[];
  readonly project?: GlobeProject | null;
  readonly cinematic?: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 700, height: 800 });
  const [t, setT] = useState(reduced ? 1800 : 0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (reduced) {
      setT(1800);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = () => {
      const elapsed = performance.now() - start;
      setT(Math.min(elapsed, 1800));
      if (elapsed < 1800 && !document.hidden) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced]);
  const discovery: GlobeDiscovery = {
    status: "done",
    finishedAt: 1800,
    agents: primaryAgents(agents).map((agent) => ({
      id: getBrand(agent.id).id,
      name: agent.name,
      status:
        agent.availability.state === "checking"
          ? "looking"
          : agent.availability.state === "ready"
            ? "found"
            : "missing",
      path: null,
      version: agent.availability.state === "ready" ? agent.availability.version : null,
      signedIn: null,
      at: 0,
    })),
  };
  return (
    <div className="setup-night" ref={ref} data-cinematic={cinematic || undefined}>
      <span className="setup-night-label">ONE WORKSPACE. YOUR AGENTS.</span>
      <Globe
        discovery={discovery}
        t={t}
        {...size}
        reduced={reduced}
        project={size.width >= 500 ? project : null}
        showLabels={size.width >= 500}
      />
      <div className="setup-night-caption">
        <strong>A place for the work ahead.</strong>
        <p>
          Your agents run on this device.
          <br />
          Your projects stay yours.
        </p>
      </div>
    </div>
  );
}
