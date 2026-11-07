import a10 from "./launch-art/a-10-thunderbolt-ii.txt?raw";
import b2 from "./launch-art/b-2-spirit.txt?raw";
import f14 from "./launch-art/f-14-tomcat.txt?raw";
import f14Front from "./launch-art/f-14-tomcat-front.txt?raw";
import f15 from "./launch-art/f-15-eagle.txt?raw";
import f16 from "./launch-art/f-16-fighting-falcon.txt?raw";
import f22 from "./launch-art/f-22-raptor.txt?raw";
import f35 from "./launch-art/f-35-lightning-ii.txt?raw";
import f117 from "./launch-art/f-117-nighthawk.txt?raw";
import f117Front from "./launch-art/f-117-nighthawk-front.txt?raw";
import f4u from "./launch-art/f4u-corsair.txt?raw";
import p51 from "./launch-art/p-51-mustang.txt?raw";
import sr71Front from "./launch-art/sr-71-blackbird-front.txt?raw";
import sr71Top from "./launch-art/sr-71-blackbird-top.txt?raw";
import x29 from "./launch-art/x-29.txt?raw";

/**
 * One picture for the start screen: an American military aircraft as someone drew it in text.
 * Every piece is published art, kept as its artist made it (owner, 7 November 2026: "not make your
 * own, but pull up some. It needs to look like the exact thing"); third-party/ascii-art.md says
 * where each came from. Only the archive's credit lines beside a piece were left out, and their
 * names show under it instead.
 */
export interface LaunchPicture {
  /** The file under `launch-art/`, and the key the last launch's choice is remembered by. */
  readonly id: string;
  /** The aircraft. */
  readonly name: string;
  /** Who drew it, when the piece is signed or credited. */
  readonly artist: string | null;
  /** Braille dot art, set in a face that draws every dot pattern at one width (`--g-dots`). */
  readonly dots: boolean;
  readonly art: string;
}

/** As published, with Windows line endings (a checkout's) and the final newline taken off. */
const text = (raw: string) => raw.replace(/\r\n?/g, "\n").replace(/\n+$/, "");

export const LAUNCH_ART: readonly LaunchPicture[] = [
  { id: "b-2-spirit", name: "B-2 Spirit", artist: null, dots: true, art: text(b2) },
  {
    id: "sr-71-blackbird-front",
    name: "SR-71 Blackbird",
    artist: "Sean Riesch",
    dots: false,
    art: text(sr71Front),
  },
  {
    id: "sr-71-blackbird-top",
    name: "SR-71 Blackbird",
    artist: null,
    dots: false,
    art: text(sr71Top),
  },
  { id: "f-22-raptor", name: "F-22 Raptor", artist: null, dots: true, art: text(f22) },
  { id: "f-35-lightning-ii", name: "F-35 Lightning II", artist: null, dots: true, art: text(f35) },
  { id: "f-14-tomcat-front", name: "F-14 Tomcat", artist: null, dots: false, art: text(f14Front) },
  { id: "f-14-tomcat", name: "F-14 Tomcat", artist: null, dots: false, art: text(f14) },
  { id: "f-15-eagle", name: "F-15 Eagle", artist: "Radeon350", dots: false, art: text(f15) },
  {
    id: "f-16-fighting-falcon",
    name: "F-16 Fighting Falcon",
    artist: "dew",
    dots: false,
    art: text(f16),
  },
  {
    id: "f-117-nighthawk-front",
    name: "F-117 Nighthawk",
    artist: null,
    dots: false,
    art: text(f117Front),
  },
  {
    id: "f-117-nighthawk",
    name: "F-117 Nighthawk",
    artist: "Joshua Bell",
    dots: false,
    art: text(f117),
  },
  {
    id: "a-10-thunderbolt-ii",
    name: "A-10 Thunderbolt II",
    artist: "Mike Whaley",
    dots: false,
    art: text(a10),
  },
  { id: "x-29", name: "Grumman X-29", artist: "Billcow168", dots: false, art: text(x29) },
  {
    id: "p-51-mustang",
    name: "P-51 Mustang",
    artist: "Larry E. Cunningham",
    dots: false,
    art: text(p51),
  },
  {
    id: "f4u-corsair",
    name: "F4U Corsair",
    artist: "Andrew S. Townley",
    dots: false,
    art: text(f4u),
  },
];

/** The picture the last launch showed, so the next one shows another. */
const LAST_KEY = "auracode.launchArt.last";

type PictureStorage = Pick<Storage, "getItem" | "setItem">;

function deviceStorage(): PictureStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * A picture other than the one `storage` says the last launch showed, remembered for the next.
 * Storage that cannot be read or written only loses the "never twice in a row" promise.
 */
export function pickLaunchPicture(
  random: () => number = Math.random,
  storage: PictureStorage | null = deviceStorage(),
): LaunchPicture {
  let last: string | null = null;
  try {
    last = storage?.getItem(LAST_KEY) ?? null;
  } catch {}
  const choices = LAUNCH_ART.filter((picture) => picture.id !== last);
  const picture = choices[
    Math.min(choices.length - 1, Math.floor(random() * choices.length))
  ] as LaunchPicture;
  try {
    storage?.setItem(LAST_KEY, picture.id);
  } catch {}
  return picture;
}

let thisLaunch: LaunchPicture | null = null;

/** This launch's picture: chosen once, so the start screen keeps it until auracode starts again. */
export function launchPicture(): LaunchPicture {
  thisLaunch ??= pickLaunchPicture();
  return thisLaunch;
}
