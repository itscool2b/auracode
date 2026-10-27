import { Check, Copy, FolderOpen, GitBranch } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DISCOVERY } from "../../fixture/discovery";
import {
  basename,
  type DiscoveredAgent,
  type DiscoveryModel,
  discoveryCounts,
  type LabTheme,
  type Player,
  usePlayhead,
} from "../../kit";
import { Globe, type GlobeProject } from "./Globe";
import { openState, setLabParam } from "./nav";
import { FRAME_MS, OrbitMark } from "./OrbitMark";
import { DotLoader, Keycap, useReduced } from "./ui";

/*
 * Onboarding and agent discovery (visual-language.md 4.14): Grok Console's mission checklist beside
 * a black night panel, SpaceXAI's globe as the hero. The roster holds a row for every agent from the
 * first frame and each row resolves in place as detection streams (Linear's coding tools list), so
 * nothing below it moves. Every step can be continued with Enter or skipped, and a finished step
 * folds to one line of numbers.
 */

const STEPS = ["Agents", "Account", "Make it yours", "First project"] as const;

/** The project the lab pretends you picked in the last step. */
const LAB_PROJECT: GlobeProject = { name: "auracode", path: "~/Desktop/auracode" };

type Motion = "full" | "reduced" | "off";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A step's headline: two tones, word by word (X Money's flip-up). */
function Headline({ first, second }: { readonly first: string; readonly second: string }) {
  const words = (text: string, offset: number, tone: "o-c1" | "o-c3") =>
    text.split(" ").map((word, index) => (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: words are positional.
        key={`${text}-${index}`}
        className={`o-flip ${tone}`}
        style={{ animationDelay: `${(offset + index) * 40}ms` }}
      >
        {word}{" "}
      </span>
    ));
  return (
    <h2 className="o-onb-headline o-t-display">
      <span className="o-onb-line">{words(first, 0, "o-c1")}</span>
      <span className="o-onb-line">{words(second, first.split(" ").length, "o-c3")}</span>
    </h2>
  );
}

/** A command to copy (an install or a sign-in), as a mono chip that says Copied for a beat. */
function CommandChip({ command }: { readonly command: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="o-install-chip o-t-mono o-mono-11"
      title={`Copy ${command}`}
      onClick={() => {
        void navigator.clipboard?.writeText(command).catch(() => {});
        setCopied(true);
      }}
    >
      <span className="o-install-cmd">{command}</span>
      {copied ? (
        <Check className="o-add" size={12} strokeWidth={2} aria-label="Copied" />
      ) : (
        <Copy size={12} strokeWidth={1.5} aria-hidden="true" />
      )}
    </button>
  );
}

function Status({ agent }: { readonly agent: DiscoveredAgent }) {
  const [revealed, setRevealed] = useState(false);
  if (agent.status === "missing") {
    if (revealed && agent.installCommand) return <CommandChip command={agent.installCommand} />;
    return (
      <button
        type="button"
        className="o-btn o-btn-outline o-btn-xs"
        onClick={() => setRevealed(true)}
      >
        Install
      </button>
    );
  }
  if (agent.signedIn === false) {
    // Signing in happens in the agent's own CLI: the step hands over its command.
    if (revealed && agent.path) return <CommandChip command={`${basename(agent.path)} login`} />;
    return (
      <button
        type="button"
        className="o-text-btn o-t-meta o-signal-text o-w-strong"
        onClick={() => setRevealed(true)}
      >
        Sign in
      </button>
    );
  }
  return (
    <span className="o-ready o-t-meta o-c2">
      <span className="o-ready-square" aria-hidden="true" />
      Ready
    </span>
  );
}

/** One roster slot: there from the first frame, it resolves in place when the agent is found. */
function RosterRow({ agent }: { readonly agent: DiscoveredAgent }) {
  if (agent.status === "looking") {
    return (
      <li className="o-roster-row" data-status="looking">
        <span className="o-roster-loader">
          <DotLoader label="Looking" />
        </span>
        <span className="o-roster-text">
          <span className="o-roster-line o-t-ui o-c3">Looking for {agent.name}</span>
        </span>
        <span />
      </li>
    );
  }
  return (
    <li className="o-roster-row" data-status={agent.status}>
      <span className="o-roster-in">
        <OrbitMark
          agent={agent.id}
          size={20}
          ghost={agent.status === "missing"}
          state={agent.signedIn === false ? "waiting" : "idle"}
          label={agent.name}
        />
      </span>
      <span className="o-roster-text o-roster-in">
        <span className="o-roster-line o-t-ui o-w-strong o-c1">{agent.name}</span>
        <span className="o-roster-line o-t-mono o-mono-11 o-c3">
          {agent.status === "missing" ? "Not installed" : `${agent.path} · ${agent.version}`}
        </span>
      </span>
      <span className="o-roster-in o-roster-status">
        <Status agent={agent} />
      </span>
    </li>
  );
}

/** The night panel's size, measured, so the globe lays out for the room it has. */
function usePanelSize(ref: { readonly current: HTMLElement | null }) {
  const [size, setSize] = useState({ width: 864, height: 884 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (): void => {
      const width = Math.round(element.clientWidth);
      const height = Math.round(element.clientHeight);
      if (width > 0 && height > 0) {
        setSize((current) =>
          current.width === width && current.height === height ? current : { width, height },
        );
      }
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function Onboarding({
  discovery,
  player,
}: {
  readonly discovery: DiscoveryModel;
  readonly player: Player;
  readonly theme: LabTheme;
}) {
  const reduced = useReduced();
  const t = usePlayhead(player, FRAME_MS);
  const nightRef = useRef<HTMLDivElement>(null);
  const size = usePanelSize(nightRef);
  const [step, setStep] = useState(0);
  const [motionChoice, setMotionChoice] = useState<Motion>(reduced ? "reduced" : "full");
  const [project, setProject] = useState<GlobeProject | null>(null);
  const counts = discoveryCounts(discovery);
  const signIn = discovery.agents.filter(
    (agent) => agent.status === "found" && agent.signedIn === false,
  ).length;
  const elapsed =
    discovery.finishedAt !== null && discovery.startedAt !== null
      ? ((discovery.finishedAt - discovery.startedAt) / 1000).toFixed(1)
      : null;
  const where = discovery.locations;
  const whereText =
    where.length <= 1
      ? (where[0] ?? "")
      : `${where.slice(0, -1).join(", ")} and ${where[where.length - 1]}`;

  const finish = (): void => openState("empty");
  const advance = (): void => {
    if (step === 0) {
      // The scan is done once you move on: hold it finished instead of letting it loop.
      player.seek(DISCOVERY.duration);
      player.pause();
    }
    if (step >= STEPS.length - 1) finish();
    else setStep(step + 1);
  };
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  // Enter continues, wherever focus is, except on a button (which Enter presses).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (
        event.target instanceof Element &&
        event.target.closest("button, input, select, textarea, a")
      )
        return;
      event.preventDefault();
      advanceRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const agentsLine =
    counts.found === 0
      ? "Looking for agents."
      : `Found ${plural(counts.found, "agent", "agents")}.`;
  const agentsSecond =
    discovery.status !== "done"
      ? counts.looking > 0
        ? `Still looking for ${counts.looking}.`
        : "Checking sign-ins."
      : counts.missing > 0
        ? `${counts.missing} more can be installed.`
        : "Every agent is ready.";

  const summary = (index: number): string => {
    if (index === 0) {
      const parts = [`${counts.found - signIn} ready`];
      if (signIn > 0) parts.push(`${signIn} to sign in`);
      if (counts.missing > 0) parts.push(`${counts.missing} to install`);
      return parts.join(", ");
    }
    if (index === 1) return "Local only, no account";
    const motionName =
      motionChoice === "full"
        ? "full motion"
        : motionChoice === "reduced"
          ? "reduced motion"
          : "no motion";
    return `Dark appearance · ${motionName}`;
  };

  const actions = (primary: string, skip: ReactNode) => (
    <div className="o-onb-actions">
      <button
        type="button"
        className="o-btn o-btn-ink"
        disabled={step === 0 && counts.found === 0}
        onClick={advance}
      >
        {primary}
        <Keycap onInk label="Enter">
          {"↵"}
        </Keycap>
      </button>
      {skip}
    </div>
  );

  const content = (index: number): ReactNode => {
    switch (index) {
      case 0:
        return (
          <>
            <Headline first={agentsLine} second={agentsSecond} />
            <ul className="o-roster" aria-live="polite">
              {discovery.agents.map((agent) => (
                <RosterRow key={agent.id} agent={agent} />
              ))}
            </ul>
            <p className="o-t-mono o-mono-11 o-c3 o-scan-note">
              {discovery.status === "done" && elapsed
                ? `Scanned ${whereText} in ${elapsed}s`
                : `Scanning ${whereText}`}
            </p>
            {actions(
              "Continue",
              <button type="button" className="o-btn o-btn-ghost" onClick={advance}>
                Skip
              </button>,
            )}
          </>
        );
      case 1:
        return (
          <>
            <Headline first="Sync across your machines." second="Or keep auracode local." />
            <p className="o-t-ui o-c2">
              Your projects and chats work offline. Account sign-in is unavailable in this design
              preview.
            </p>
            {actions("Continue locally", null)}
          </>
        );
      case 2:
        return (
          <>
            <Headline first="Make it yours." second="Change it later in Settings." />
            <p className="o-onb-label o-t-caps o-c3">Motion</p>
            <div className="o-seg-strong">
              {(
                [
                  ["full", "Full"],
                  ["reduced", "Reduced"],
                  ["off", "Off"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={motionChoice === value}
                  className="o-seg-item o-t-meta"
                  data-active={motionChoice === value ? "" : undefined}
                  onClick={() => {
                    setMotionChoice(value);
                    setLabParam("motion", value === "full" ? null : "reduce");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {actions(
              "Continue",
              <button type="button" className="o-btn o-btn-ghost" onClick={() => setStep(step + 1)}>
                Skip
              </button>,
            )}
          </>
        );
      default:
        return (
          <>
            <Headline first="Add a first project." second="Any folder works." />
            <div className="o-drop" data-chosen={project ? "" : undefined}>
              {project ? (
                <>
                  <span className="o-drop-square" aria-hidden="true" />
                  <span className="o-drop-text">
                    <span className="o-t-ui o-w-strong o-c1">{project.name}</span>
                    <span className="o-t-mono o-mono-11 o-c3">{project.path}</span>
                  </span>
                  <button
                    type="button"
                    className="o-text-btn o-t-meta"
                    onClick={() => setProject(null)}
                  >
                    Change
                  </button>
                </>
              ) : (
                <>
                  <span className="o-t-ui o-c2">Drop a folder</span>
                  <span className="o-drop-actions">
                    <button
                      type="button"
                      className="o-btn o-btn-outline o-btn-sm"
                      onClick={() => setProject(LAB_PROJECT)}
                    >
                      <FolderOpen size={14} strokeWidth={1.5} aria-hidden="true" />
                      Choose folder
                      <span className="o-keys">
                        <Keycap label="Command">{"⌘"}</Keycap>
                        <Keycap>O</Keycap>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="o-btn o-btn-ghost o-btn-sm"
                      onClick={() => setProject(LAB_PROJECT)}
                    >
                      <GitBranch size={14} strokeWidth={1.5} aria-hidden="true" />
                      Clone from GitHub
                    </button>
                  </span>
                </>
              )}
            </div>
            {actions(
              "Open auracode",
              <button type="button" className="o-btn o-btn-ghost" onClick={finish}>
                Skip
              </button>,
            )}
          </>
        );
    }
  };

  return (
    <div className="o-onboarding orbit-theme" data-theme="dark">
      <div className="o-onb-column">
        <div className="o-onb-top">
          <span className="o-wordmark">auracode</span>
          <button type="button" className="o-btn o-btn-ghost o-btn-sm" onClick={finish}>
            Skip setup
          </button>
        </div>
        <ol className="o-checklist">
          {STEPS.map((title, index) => {
            const state = index < step ? "done" : index === step ? "active" : "pending";
            return (
              <li key={title} className="o-check-step" data-state={state}>
                <span className="o-numeral-ring o-t-mono" aria-hidden="true">
                  {state === "done" ? <Check size={10} strokeWidth={2.5} /> : index + 1}
                </span>
                <div className="o-check-body">
                  {state === "done" ? (
                    <button
                      type="button"
                      className="o-check-title o-check-again o-t-heading"
                      onClick={() => setStep(index)}
                    >
                      {title}
                      <span className="o-t-meta o-c3 o-check-summary">{summary(index)}</span>
                    </button>
                  ) : (
                    <p
                      className="o-t-heading o-check-title"
                      data-muted={state === "pending" ? "" : undefined}
                    >
                      {title}
                    </p>
                  )}
                  <AnimatePresence initial={false}>
                    {state === "active" ? (
                      <motion.div
                        key={title}
                        className="o-check-content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: reduced ? 0.12 : 0.26, ease: [0.23, 1, 0.32, 1] }}
                      >
                        {content(index)}
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="o-night">
        <p className="o-night-caps o-t-caps">
          Agents {counts.found}/{discovery.agents.length}
          {discovery.status === "done" ? (
            <span className="o-night-done">
              {" "}
              · <Check size={10} strokeWidth={2.5} aria-hidden="true" /> Done
            </span>
          ) : (
            " · Live"
          )}
        </p>
        <div className="o-night-globe" ref={nightRef}>
          <Globe
            discovery={discovery}
            t={t}
            width={size.width}
            height={size.height}
            reduced={reduced}
            project={step === STEPS.length - 1 ? project : null}
          />
        </div>
        <p className="o-night-caption o-t-title">
          <span className="o-night-c1">Agents run on this device.</span>
          <span className="o-night-c2">auracode never sees their keys.</span>
        </p>
      </div>
    </div>
  );
}
