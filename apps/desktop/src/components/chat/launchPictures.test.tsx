import { createHash } from "node:crypto";
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

/** A JPEG's frame header: its size and how many colour channels it stores. */
function frame(file: Buffer) {
  expect(file.readUInt16BE(0)).toBe(0xffd8);
  let at = 2;
  while (at < file.length) {
    const marker = file.readUInt16BE(at);
    const length = file.readUInt16BE(at + 2);
    // SOF0 to SOF15 carry the frame, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker))
      return {
        height: file.readUInt16BE(at + 5),
        width: file.readUInt16BE(at + 7),
        channels: file.readUInt8(at + 9),
      };
    at += 2 + length;
  }
  throw new Error("no frame header");
}

describe("the start screen's aircraft", () => {
  it("has a picture for every file and nothing left of the text drawings", () => {
    const files = readdirSync(folder).sort();
    expect(files).toEqual(LAUNCH_ART.map((picture) => `${picture.id}.jpg`).sort());
  });

  it("is the owner's ten aircraft, each named once", () => {
    expect(LAUNCH_ART.map((picture) => picture.name).sort()).toEqual([
      "B-2 Spirit",
      "B-29 Superfortress",
      "Boeing 747-400",
      "Boeing 787 Dreamliner",
      "F-22 Raptor",
      "F-35 Lightning II",
      "P-51 Mustang",
      "SR-71 Blackbird",
      "Space Shuttle",
      "Wright Flyer",
    ]);
  });

  it("stores each picture as a grey image of the size it says", () => {
    for (const picture of LAUNCH_ART) {
      const stored = frame(readFileSync(`${folder}/${picture.id}.jpg`));
      expect(stored, picture.id).toEqual({
        width: picture.width,
        height: picture.height,
        channels: 1,
      });
      expect(picture.src, picture.id).toContain(picture.id);
    }
  });

  it("is listed in third-party/ascii-art.md, file by file, with the stored file's checksum", () => {
    const notes = readFileSync(
      fileURLToPath(new URL("../../../../../third-party/ascii-art.md", import.meta.url)),
      "utf8",
    );
    for (const picture of LAUNCH_ART) {
      const sum = createHash("sha256")
        .update(readFileSync(`${folder}/${picture.id}.jpg`))
        .digest("hex");
      const row = notes.split("\n").find((line) => line.startsWith(`| \`${picture.id}.jpg\` |`));
      expect(row, picture.id).toContain(`| ${picture.name} |`);
      expect(row, picture.id).toMatch(new RegExp(`\\| \`${sum}\` \\|$`));
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

  it("shows the picture as one image in the theme's ink with its name under it, and no heading above", () => {
    const raptor = LAUNCH_ART.find((picture) => picture.id === "f-22-raptor");
    if (!raptor) throw new Error("the F-22 is missing");
    const html = renderToStaticMarkup(<LaunchArt picture={raptor} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="F-22 Raptor"');
    expect(html).toContain('viewBox="0 0 1168 784"');
    // The image is only ever a mask; what is painted is the text colour.
    expect(html).toMatch(/<mask id="launch-art-ink-f-22-raptor"[^>]*><image [^>]*href="[^"]+"/);
    expect(html).toMatch(
      /<rect [^>]*fill="currentColor"[^>]*mask="url\(#launch-art-ink-f-22-raptor\)"/,
    );
    expect(html).not.toMatch(/<img/);
    expect(html).toMatch(/<figcaption[^>]*>F-22 Raptor<\/figcaption>/);
    expect(html).not.toMatch(/<h[1-6]/);
  });
});
