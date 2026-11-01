import { Capabilities } from "../home/Capabilities";
import { Faq } from "../home/Faq";
import { Finale } from "../home/Finale";
import { Hero } from "../home/Hero";
import { Numbers } from "../home/Numbers";
import { Product } from "../home/Product";
import { AgentSprite } from "../home/Sprite";
import { Wheel } from "../home/Wheel";

export const meta = () => [
  { title: "auracode · One window for your coding agents" },
  {
    name: "description",
    content:
      "Run the coding agents you already use through one local-first desktop app for Windows and macOS. No account needed for local work.",
  },
];

/**
 * The product in motion, the real app, what it does on the night band, three numbers, what stays
 * yours, answers, and the night finale that runs into the footer.
 */
export default function Home() {
  return (
    <main id="main" className="home">
      <AgentSprite />
      <Hero />
      <Product />
      <Capabilities />
      <Numbers />
      <Wheel />
      <Faq />
      <Finale />
    </main>
  );
}
