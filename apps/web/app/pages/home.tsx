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

/** The product, its capabilities, answers and a final download action. */
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
