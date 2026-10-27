import { Closing } from "../home/Closing";
import { Faq } from "../home/Faq";
import { Film } from "../home/Film";
import { Numerals } from "../home/Numerals";
import { Stage } from "../home/Stage";
import { Strip } from "../home/Strip";
import { Tiles } from "../home/Tiles";
import { Triptych } from "../home/Triptych";

export const meta = () => [
  { title: "auracode · One window for your coding agents" },
  {
    name: "description",
    content:
      "Run the coding agents you already use through one local-first desktop app for Windows and macOS. No account needed for local work.",
  },
];

export default function Home() {
  return (
    <main id="main" className="home">
      <Stage />
      <Triptych />
      <Film />
      <Tiles />
      <Strip />
      <Numerals />
      <Faq />
      <Closing />
    </main>
  );
}
