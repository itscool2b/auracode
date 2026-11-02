import { expect, it } from "vitest";
import { EMPTY_SPLIT, splitIncremental } from "./markdown";
import { EMPTY_IMAGE_PATHS, imagePathsIncremental } from "./markdownImages";

it("keeps image context stable while text streams and caps previews across blocks", () => {
  let split = splitIncremental(EMPTY_SPLIT, "![First](one.png)\n\nText");
  let paths = imagePathsIncremental(EMPTY_IMAGE_PATHS, split);
  const initial = paths.visible;
  split = splitIncremental(split, `${split.source} keeps streaming`);
  paths = imagePathsIncremental(paths, split);
  expect(paths.visible).toBe(initial);
  split = splitIncremental(
    split,
    `${split.source}\n\n${Array.from({ length: 15 }, (_, i) => `![Image ${i}](image-${i}.png)`).join("\n\n")}`,
  );
  paths = imagePathsIncremental(paths, split);
  expect([...paths.visible]).toEqual([
    "one.png",
    ...Array.from({ length: 7 }, (_, i) => `image-${i}.png`),
  ]);
  split = splitIncremental(
    split,
    "```markdown\n![Code](ignored.png)\n```\n\n![Changed](changed.png)",
  );
  paths = imagePathsIncremental(paths, split);
  expect([...paths.visible]).toEqual(["changed.png"]);
});
