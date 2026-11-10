import { Agents } from "../home/Agents";
import { Capabilities } from "../home/Capabilities";
import { Faq } from "../home/Faq";
import { Features } from "../home/Features";
import { Finale } from "../home/Finale";
import { Hero } from "../home/Hero";
import { Product } from "../home/Product";
import { AgentSprite } from "../home/Sprite";
import { Statement } from "../home/Statement";

export const meta = () => [
  { title: "auracode · One window for every coding agent" },
  {
    name: "description",
    content:
      "Run the coding agents you already use through one local-first desktop app for Windows, macOS and Linux. No account needed for local work.",
  },
];

/**
 * The product in motion, the agents it runs, what it is in one statement and three drawings, what
 * it does, the real app, the terminal and the canvas with the rest of the workspace, answers, and
 * the last call before the footer.
 */
export default function Home() {
  return (
    <main id="main" className="home">
      <AgentSprite />
      <Hero />
      <Agents />
      <Statement />
      <Capabilities />
      <Product />
      <Features />
      <Faq />
      <Finale />
    </main>
  );
}
