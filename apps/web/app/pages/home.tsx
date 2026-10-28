import { Capabilities } from "../home/Capabilities";
import { Closing } from "../home/Closing";
import { Faq } from "../home/Faq";
import { Hero } from "../home/Hero";

export const meta = () => [
  { title: "auracode · One window for your coding agents" },
  {
    name: "description",
    content:
      "Run the coding agents you already use through one local-first desktop app for Windows and macOS. No account needed for local work.",
  },
];

/**
 * Shallows (docs/design/visual-language.md 5): the hero in lit water with the real app below it,
 * one capabilities panel, the FAQ and a closing panel. Few sections, one idea each, a lot of black.
 */
export default function Home() {
  return (
    <main id="main" className="home">
      <Hero />
      <Capabilities />
      <Faq />
      <Closing />
    </main>
  );
}
