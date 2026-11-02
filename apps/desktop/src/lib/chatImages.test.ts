import { afterEach, describe, expect, it, vi } from "vitest";
import { type ChatImagesApi, ImagePreviews, localImagePath } from "./chatImages";
import { parseInline, plainText } from "./markdown";

afterEach(() => vi.restoreAllMocks());
const result = { png_base64: "aW1hZ2U=", width: 32, height: 20 };

describe("local image references", () => {
  it("reads local markdown images, file URLs, spaces and parentheses without making remote requests", () => {
    const nodes = parseInline("See ![Design](<file:///C:/work/a%20(1).png>) and `![code](x.png)`.");
    expect(nodes).toContainEqual({ kind: "image", alt: "Design", path: "C:/work/a (1).png" });
    expect(plainText(nodes)).toBe("See Design and ![code](x.png).");
    for (const path of [
      "https://example.com/track.png",
      "data:image/png;base64,aA==",
      "javascript:alert(1)",
      "file://server/share/a.png",
      "//server/a.png",
      "\\\\server\\a.png",
      "a\u0000b",
    ])
      expect(localImagePath(path)).toBeNull();
    expect(parseInline("![remote](https://example.com/track.png)")).toEqual([
      { kind: "text", text: "![remote](https://example.com/track.png)" },
    ]);
    expect(localImagePath("images/test.png")).toBe("images/test.png");
    expect(localImagePath("./images/test%20one.png")).toBe("./images/test one.png");
  });
});

describe("image preview lifetime", () => {
  function setup() {
    let sequence = 0;
    const create = vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${++sequence}`);
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const preview = vi.fn<ChatImagesApi["preview"]>().mockResolvedValue(result);
    const cache = new ImagePreviews({ preview, list: async () => [] }, "chat");
    return { create, revoke, preview, cache };
  }

  it("shares mounted thumbnails, bounds idle URLs and releases dialog images", async () => {
    const { cache, preview, revoke } = setup();
    const source = { type: "attachment" as const, id: "one" };
    const first = cache.acquire(source);
    const second = cache.acquire(source);
    expect(await first.promise).toEqual(await second.promise);
    expect(preview).toHaveBeenCalledTimes(1);
    first.release();
    second.release();
    for (let i = 0; i < 49; i += 1) {
      const handle = cache.acquire({ type: "attachment", id: String(i) });
      await handle.promise;
      handle.release();
    }
    expect(revoke).toHaveBeenCalledWith("blob:1");
    const full = cache.acquire(source, true);
    const image = await full.promise;
    full.release();
    full.release();
    expect(revoke).toHaveBeenCalledWith(image.url);
    cache.clear();
    expect(revoke.mock.calls.length).toBe(51);
  });

  it("discards late responses across chat unmount and retries failures", async () => {
    const { cache, create, preview } = setup();
    let resolve: (value: typeof result) => void = () => {};
    preview.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const stale = cache.acquire({ type: "attachment", id: "late" });
    const rejected = expect(stale.promise).rejects.toThrow("closed");
    stale.release();
    cache.clear();
    resolve(result);
    await rejected;
    expect(create).not.toHaveBeenCalled();
    preview.mockRejectedValueOnce(new Error("missing"));
    const failed = cache.acquire({ type: "attachment", id: "retry" });
    await expect(failed.promise).rejects.toThrow("missing");
    failed.release();
    const retry = cache.acquire({ type: "attachment", id: "retry" });
    await expect(retry.promise).resolves.toMatchObject({ width: 32 });
    retry.release();
    cache.clear();
  });
});
