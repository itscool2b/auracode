import type { DiscoveryEvent, DiscoveryTimeline, TimedDiscoveryEvent } from "./types";
import { AGENTS } from "./workspace";

/**
 * First-run discovery, the `onboarding` state: the app looks for every agent it knows on this Mac.
 * Five answer (Antigravity still needs a sign-in), Cursor and Grok Build are not installed. About
 * 2.6 s, then the lab holds the result and loops.
 *
 * Moments worth a screenshot: t=1.6 s four agents are in and Hermes is landing (its orbit draws
 * until 2.0 s) while Cursor and Grok Build are still being looked for.
 */

export const DISCOVERY_LOCATIONS: readonly string[] = ["PATH", "~/.local/bin", "/opt/homebrew/bin"];

function at(seconds: number, event: DiscoveryEvent): TimedDiscoveryEvent {
  return { at: Math.round(seconds * 1000), event };
}

const EVENTS: readonly TimedDiscoveryEvent[] = [
  at(0, { type: "scan_started", locations: DISCOVERY_LOCATIONS }),
  at(0.5, {
    type: "agent_found",
    agent: "claude-code",
    path: "~/.local/bin/claude",
    version: "2.1.310",
    signedIn: true,
  }),
  at(0.8, {
    type: "agent_found",
    agent: "codex",
    path: "/opt/homebrew/bin/codex",
    version: "0.164.0",
    signedIn: true,
  }),
  at(1.1, {
    type: "agent_found",
    agent: "pi",
    path: "~/.npm-global/bin/pi",
    version: "0.62.0",
    signedIn: true,
  }),
  at(1.3, {
    type: "agent_found",
    agent: "antigravity",
    path: "/usr/local/bin/agy",
    version: "1.4.7",
    signedIn: false,
  }),
  at(1.5, {
    type: "agent_found",
    agent: "hermes",
    path: "~/.local/bin/hermes",
    version: "0.22.5",
    signedIn: true,
  }),
  at(2.3, {
    type: "agent_missing",
    agent: "cursor",
    installCommand: "curl https://cursor.com/install -fsS | bash",
  }),
  at(2.4, { type: "agent_missing", agent: "grok", installCommand: "npm install -g grok-build" }),
  at(2.6, { type: "scan_finished" }),
];

/** How long a found agent's orbit takes to draw in on the globe, ms. */
export const ORBIT_DRAW_MS = 500;

export const DISCOVERY: DiscoveryTimeline = {
  candidates: AGENTS.map((agent) => agent.id),
  events: EVENTS,
  // The scan plays on until the last orbit has drawn in, so the held frame shows it whole.
  duration: (EVENTS[EVENTS.length - 1]?.at ?? 0) + ORBIT_DRAW_MS,
};
