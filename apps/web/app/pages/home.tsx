import accentFont from "@fontsource-variable/fraunces/files/fraunces-latin-opsz-italic.woff2?url";
import { Capabilities } from "../home/Capabilities";
import { Faq } from "../home/Faq";
import { Features } from "../home/Features";
import { Finale } from "../home/Finale";
import { Hero } from "../home/Hero";
import { Product } from "../home/Product";
import { AgentSprite } from "../home/Sprite";
import { Statement } from "../home/Statement";

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
      "Run the coding agents you already use through one local-first desktop app for Windows, macOS and Linux. No account needed for local work.",
  },
];

/**
 * The product in motion, what it is in one statement and three drawings, the real app, what it does
 * on the night band, the terminal and the canvas, answers, and the night finale that runs into the
 * footer.
 */
export default function Home() {
  return (
    <main id="main" className="home">
      <AgentSprite />
      <Hero />
      <Statement />
      <Product />
      <Capabilities />
      <Features />
      <Faq />
      <Finale />
    </main>
  );
}
