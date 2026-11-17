import { AgentPicker } from "../home/AgentPicker";
import { Faq } from "../home/Faq";
import { Finale } from "../home/Finale";
import { GetIt } from "../home/GetIt";
import { Hero } from "../home/Hero";
import { News } from "../home/News";
import { Showcase } from "../home/Showcase";
import { AgentSprite } from "../home/Sprite";
import { Statement } from "../home/Statement";
import { Work } from "../home/Work";

export const meta = () => [
  { title: "auracode · One window for every coding agent" },
  {
    name: "description",
    content:
      "Run the coding agents you already use through one local desktop app for Windows, macOS and Linux. No account needed.",
  },
];

/**
 * The page in dot.com's order: the name over the live app, what it is with every agent's mark, the
 * real app in one frame, what it does in a grid of cards, the agents as chips, where to get it,
 * what shipped, answers, and the last call over the mark drawn large.
 */
export default function Home() {
  return (
    <main id="main" className="home">
      <AgentSprite />
      <Hero />
      <Statement />
      <Showcase />
      <Work />
      <AgentPicker />
      <GetIt />
      <News />
      <Faq />
      <Finale />
    </main>
  );
}
