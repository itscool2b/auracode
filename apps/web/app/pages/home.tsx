import { Closing } from "../home/Closing";
import { Faq } from "../home/Faq";
import { Film } from "../home/Film";
import { Stage } from "../home/Stage";
import { Tiles } from "../home/Tiles";

export const meta = () => [
  { title: "auracode · One window for your coding agents" },
  {
    name: "description",
    content:
      "Run the coding agents you already use through one local-first desktop app for Windows and macOS. No account needed for local work.",
  },
];

/**
 * Five sections, each copied from a named section of a reference landing page
 * (docs/design/visual-language.md 5): x.ai's hero, x.ai's film card, X Money's staggered tiles,
 * X Money's FAQ and Aside's closing panel. The footer follows x.ai's.
 */
export default function Home() {
  return (
    <main id="main" className="home">
      <Stage />
      <Film />
      <Tiles />
      <Faq />
      <Closing />
    </main>
  );
}
