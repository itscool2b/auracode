import type { DirectionCard } from "../types";

/** Orbit's name card in the gallery: every lab state, both themes, on a neutral desk. */
export const meta: DirectionCard = {
  name: "Orbit",
  tagline:
    "Mission control for your agents: black and white, sentences and numbers, a line-drawn orbit for every agent, and one orange for look here.",
  states: ["streaming", "settled", "empty", "permission", "picker", "changes", "onboarding"],
  themes: ["dark", "light"],
  // No decorative gradient behind the app (section 7): the window sits on a plain neutral desk.
  wallpaper: "satin",
};
