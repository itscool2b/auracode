import a10 from "./launch-art/a-10-thunderbolt-ii.txt?raw";
import b1 from "./launch-art/b-1b-lancer.txt?raw";
import b2 from "./launch-art/b-2-spirit.txt?raw";
import f4 from "./launch-art/f-4-phantom-ii.txt?raw";
import f14 from "./launch-art/f-14-tomcat.txt?raw";
import f15 from "./launch-art/f-15-eagle.txt?raw";
import f16 from "./launch-art/f-16-fighting-falcon.txt?raw";
import f22 from "./launch-art/f-22-raptor.txt?raw";
import f35 from "./launch-art/f-35-lightning-ii.txt?raw";
import f117 from "./launch-art/f-117-nighthawk.txt?raw";
import f4u from "./launch-art/f4u-corsair.txt?raw";
import fa18 from "./launch-art/fa-18-super-hornet.txt?raw";
import p51 from "./launch-art/p-51-mustang.txt?raw";
import sr71 from "./launch-art/sr-71-blackbird.txt?raw";
import x29 from "./launch-art/x-29.txt?raw";

/**
 * One picture for the start screen: an American military aircraft in ASCII, made from a real
 * photograph of it (owner, 7 November 2026: "It needs to look like the exact thing", then "just
 * actually put in images from the internet"). Each piece is a public-domain or CC0 photograph from
 * Wikimedia Commons with the aircraft cut out of its sky and drawn in Geist Mono's own glyphs;
 * third-party/ascii-art.md lists every photograph and how it was converted.
 */
export interface LaunchPicture {
  /** The file under `launch-art/`, and the key the last launch's choice is remembered by. */
  readonly id: string;
  /** The aircraft. */
  readonly name: string;
  readonly art: string;
}

/** As stored, with Windows line endings (a checkout's) and the final newline taken off. */
const text = (raw: string) => raw.replace(/\r\n?/g, "\n").replace(/\n+$/, "");

export const LAUNCH_ART: readonly LaunchPicture[] = [
  { id: "b-2-spirit", name: "B-2 Spirit", art: text(b2) },
  { id: "sr-71-blackbird", name: "SR-71 Blackbird", art: text(sr71) },
  { id: "f-22-raptor", name: "F-22 Raptor", art: text(f22) },
  { id: "f-35-lightning-ii", name: "F-35 Lightning II", art: text(f35) },
  { id: "f-14-tomcat", name: "F-14 Tomcat", art: text(f14) },
  { id: "f-15-eagle", name: "F-15 Eagle", art: text(f15) },
  { id: "f-16-fighting-falcon", name: "F-16 Fighting Falcon", art: text(f16) },
  { id: "f-117-nighthawk", name: "F-117 Nighthawk", art: text(f117) },
  { id: "a-10-thunderbolt-ii", name: "A-10 Thunderbolt II", art: text(a10) },
  { id: "fa-18-super-hornet", name: "F/A-18 Super Hornet", art: text(fa18) },
  { id: "f-4-phantom-ii", name: "F-4 Phantom II", art: text(f4) },
  { id: "b-1b-lancer", name: "B-1B Lancer", art: text(b1) },
  { id: "p-51-mustang", name: "P-51 Mustang", art: text(p51) },
  { id: "f4u-corsair", name: "F4U Corsair", art: text(f4u) },
  { id: "x-29", name: "Grumman X-29", art: text(x29) },
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
