import { AgentPicker } from "../home/AgentPicker";
import { Faq } from "../home/Faq";
import { Finale } from "../home/Finale";
import { GetIt } from "../home/GetIt";
import { Hero } from "../home/Hero";
import { Intro } from "../home/Intro";
import { News } from "../home/News";
import { Showcase } from "../home/Showcase";
import { AgentSprite } from "../home/Sprite";
import { Work } from "../home/Work";

export const meta = () => [
  { title: "auracode · One window for every coding agent" },
  {
    name: "description",
    content:
      "Run the coding agents you already use through one local-first desktop app for Windows, macOS and Linux. No account needed for local work.",
  },
];

/**
 * The page in dot.com's order: the name over the live app, what it is on one wide card, what it
 * does in a grid of cards, the agents as chips, the real app in one frame, where to get it, the
 * changelog, answers, and the last call over the mark drawn large.
 */
export default function Home() {
  return (
    <main id="main" className="home">
      <AgentSprite />
      <Hero />
      <Intro />
      <Work />
      <AgentPicker />
      <Showcase />
      <GetIt />
      <News />
      <Faq />
      <Finale />
    </main>
  );
}
