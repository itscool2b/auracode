import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LaunchArt } from "./LaunchArt";
import { LAUNCH_ART, pickLaunchPicture } from "./launchPictures";

const folder = fileURLToPath(new URL("./launch-art", import.meta.url));

/** Remembers like localStorage, in memory. */
function memory(saved: string | null = null) {
  let value = saved;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    get saved() {
      return value;
    },
  };
}

describe("the start screen's aircraft", () => {
  it("has a picture for every file, each shown as stored", () => {
    const files = readdirSync(folder)
      .filter((file) => file.endsWith(".txt"))
      .map((file) => file.replace(/\.txt$/, ""))
      .sort();
    expect(LAUNCH_ART.map((picture) => picture.id).sort()).toEqual(files);
    for (const picture of LAUNCH_ART) {
      const stored = readFileSync(`${folder}/${picture.id}.txt`, "utf8");
      expect(picture.art, picture.id).toBe(stored.replace(/\r\n?/g, "\n").replace(/\n+$/, ""));
    }
  });

  it("is fifteen different aircraft, the owner's named ones among them", () => {
    const names = LAUNCH_ART.map((picture) => picture.name);
    expect(new Set(names).size).toBe(15);
    for (const name of [
      "B-2 Spirit",
      "SR-71 Blackbird",
      "F-22 Raptor",
      "F-35 Lightning II",
      "F-14 Tomcat",
    ])
      expect(names).toContain(name);
  });

  it("draws every piece in printable ASCII, without trailing space", () => {
    for (const picture of LAUNCH_ART) {
      const lines = picture.art.split("\n");
      expect(lines.length, picture.id).toBeGreaterThan(5);
      for (const line of lines) {
        expect(line, picture.id).toBe(line.trimEnd());
        expect(line, picture.id).toMatch(/^[ -~]*$/);
      }
    }
  });

  it("names a different picture than the last launch's, and remembers it", () => {
    for (const last of LAUNCH_ART) {
      for (const random of [0, 0.25, 0.5, 0.75, 0.999]) {
        const storage = memory(last.id);
        const picture = pickLaunchPicture(() => random, storage);
        expect(picture.id).not.toBe(last.id);
        expect(storage.saved).toBe(picture.id);
      }
    }
  });

  it("reaches every picture, and survives storage that throws or is missing", () => {
    const seen = new Set(
      LAUNCH_ART.map((_, index) => pickLaunchPicture(() => index / LAUNCH_ART.length, memory()).id),
    );
    expect(seen.size).toBe(LAUNCH_ART.length);
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(LAUNCH_ART).toContain(pickLaunchPicture(() => 0.5, broken));
    expect(LAUNCH_ART).toContain(pickLaunchPicture(() => 0.5, null));
  });

  it("shows the piece as one image with its name under it, and no heading above", () => {
    const raptor = LAUNCH_ART.find((picture) => picture.id === "f-22-raptor");
    if (!raptor) throw new Error("the F-22 is missing");
    const html = renderToStaticMarkup(<LaunchArt picture={raptor} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="F-22 Raptor, drawn in text"');
    expect(html).toMatch(/<figcaption[^>]*>F-22 Raptor<\/figcaption>/);
    expect(html).not.toMatch(/<h[1-6]/);
  });
});
