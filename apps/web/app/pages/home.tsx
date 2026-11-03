import accentFont from "@fontsource-variable/fraunces/files/fraunces-latin-opsz-italic.woff2?url";
import { Capabilities } from "../home/Capabilities";
import { Faq } from "../home/Faq";
import { Finale } from "../home/Finale";
import { Hero } from "../home/Hero";
import { Numbers } from "../home/Numbers";
import { Product } from "../home/Product";
import { AgentSprite } from "../home/Sprite";
import { Wheel } from "../home/Wheel";

/**
 * The hero sets the agent's name in the accent italic above the fold, so the home page fetches its
 * one file with the stylesheet instead of after it (the same hashed file the CSS points at).
 */
export const links = () => [
  { rel: "preload", href: accentFont, as: "font", type: "font/woff2", crossOrigin: "anonymous" },
];

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
