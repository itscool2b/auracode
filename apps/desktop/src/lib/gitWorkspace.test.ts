import { describe, expect, it } from "vitest";
import { sameFolder } from "./gitWorkspace";

describe("sameFolder", () => {
  it("matches a Windows folder with and without the verbatim prefix", () => {
    expect(sameFolder(String.raw`\\?\C:\Users\me\work`, String.raw`C:\Users\me\work`)).toBe(true);
    expect(sameFolder("c:\\users\\me\\work\\", String.raw`\\?\C:\Users\me\work`)).toBe(true);
    expect(sameFolder(String.raw`\\?\UNC\server\share\repo`, String.raw`\\server\share\repo`)).toBe(
      true,
    );
    expect(sameFolder(String.raw`\\server\share\repo`, String.raw`\\?\unc\SERVER\share\repo`)).toBe(
      true,
    );
  });

  it("keeps different folders apart", () => {
    expect(sameFolder(String.raw`\\?\C:\work`, String.raw`D:\work`)).toBe(false);
    expect(sameFolder(String.raw`\\?\C:\work`, String.raw`C:\work\inner`)).toBe(false);
    expect(sameFolder(String.raw`\\?\UNC\server\share`, String.raw`\\other\share`)).toBe(false);
  });

  it("compares macOS folders with case", () => {
    expect(sameFolder("/Users/me/work/", "/Users/me/work")).toBe(true);
    expect(sameFolder("/Users/me/Work", "/Users/me/work")).toBe(false);
  });
});
