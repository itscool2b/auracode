/**
 * The moments every direction renders. Each is a URL (`#/<direction>/<state>`), so a screenshot or
 * a link always shows the same thing.
 */
export type LabState = "streaming" | "settled" | "empty" | "permission" | "picker";

export const LAB_STATES: readonly LabState[] = [
  "streaming",
  "settled",
  "empty",
  "permission",
  "picker",
];

export const STATE_INFO: Readonly<Record<LabState, { label: string; description: string }>> = {
  streaming: {
    label: "Streaming",
    description:
      "The golden turn playing in real time, looping after a pause (or frozen with ?t=).",
  },
  settled: { label: "Settled", description: "The golden turn finished: answer, plan, footer." },
  empty: { label: "Empty", description: "A new chat with no messages: the hero moment." },
  permission: {
    label: "Permission",
    description: "The Codex chat waiting on a permission card.",
  },
  picker: {
    label: "Picker",
    description: "The composer's agent, model and effort picker open over the settled chat.",
  },
};

export function isLabState(value: string): value is LabState {
  return (LAB_STATES as readonly string[]).includes(value);
}
