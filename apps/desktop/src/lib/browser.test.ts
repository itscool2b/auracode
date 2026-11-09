import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BrowserTab } from "../bindings";
import {
  BrowserPanels,
  clampShare,
  DEFAULT_SHARE,
  dayLabel,
  GENERIC_TLDS,
  isLocal,
  knownTld,
  MAX_SHARE,
  MIN_SHARE,
  type PanelStorage,
  sameRect,
  secureAddress,
  shownAddress,
  siteOf,
  tabName,
} from "./browser";
import { covered, overlaps } from "./browserOcclusion";

function memory(): PanelStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

const tab = (change: Partial<BrowserTab>): BrowserTab => ({
  id: "t1",
  url: null,
  title: "",
  loading: false,
  can_go_back: false,
  can_go_forward: false,
  crashed: false,
  error: null,
  zoom: 1,
  asleep: false,
  annotating: false,
  ...change,
});

describe("the address bar's words", () => {
  it("shows an address without its secure scheme or a lone slash", () => {
    expect(shownAddress("https://github.com/")).toBe("github.com");
    expect(shownAddress("https://github.com/acme/web?tab=1#readme")).toBe(
      "github.com/acme/web?tab=1#readme",
    );
    expect(shownAddress("http://localhost:5173/")).toBe("localhost:5173");
    // A plain-HTTP site keeps its scheme, so it is never mistaken for a secure one.
    expect(shownAddress("http://example.com/x")).toBe("http://example.com/x");
    expect(shownAddress("file:///C:/site/index%20page.html")).toBe("C:/site/index page.html");
    expect(shownAddress(null)).toBe("");
    expect(shownAddress("not a url")).toBe("not a url");
  });

  it("names sites as people know them", () => {
    expect(siteOf("https://www.github.com/acme")).toBe("github.com");
    expect(siteOf("http://localhost:3000/app")).toBe("localhost:3000");
    expect(siteOf("file:///C:/site/index.html")).toBe("index.html");
    expect(siteOf(null)).toBe("");
  });

  it("knows this computer's hosts, and which pages are private", () => {
    for (const host of ["localhost", "app.localhost", "127.0.0.1", "[::1]", "box.local", "my.test"])
      expect(isLocal(host), host).toBe(true);
    for (const host of ["example.com", "localhost.example.com", "10.0.0.2"])
      expect(isLocal(host), host).toBe(false);
    expect(secureAddress("https://example.com")).toBe(true);
    expect(secureAddress("http://localhost:5173")).toBe(true);
    expect(secureAddress("file:///C:/a.html")).toBe(true);
    expect(secureAddress("http://example.com")).toBe(false);
    expect(secureAddress(null)).toBe(true);
    expect(secureAddress("::")).toBe(false);
  });

  it("names a tab by its title, else its site, else New tab", () => {
    expect(tabName(tab({ title: "  Acme · Pricing ", url: "https://acme.test/" }))).toBe(
      "Acme · Pricing",
    );
    expect(tabName(tab({ url: "https://www.acme.com/pricing" }))).toBe("acme.com");
    expect(tabName(tab({}))).toBe("New tab");
  });
});

describe("domain endings", () => {
  it("are the ones the browser itself opens as addresses", () => {
    const rust = readFileSync(
      new URL("../../src-tauri/src/browser/address.rs", import.meta.url),
      "utf8",
    );
    const list = rust.slice(
      rust.indexOf("const GENERIC_TLDS"),
      rust.indexOf("];", rust.indexOf("const GENERIC_TLDS")),
    );
    expect([...list.matchAll(/"([a-z]+)"/g)].map((match) => match[1])).toEqual([...GENERIC_TLDS]);
    for (const tld of ["uk", "com", "dev", "localhost", "test", "xn--p1ai"])
      expect(knownTld(tld), tld).toBe(true);
    for (const tld of ["txt", "md" + "x", "json", "2"]) expect(knownTld(tld), tld).toBe(false);
  });
});

describe("the panel beside the chat", () => {
  it("keeps its share of the width between the limits", () => {
    expect(clampShare(0.1)).toBe(MIN_SHARE);
    expect(clampShare(0.95)).toBe(MAX_SHARE);
    expect(clampShare(0.6)).toBe(0.6);
    expect(clampShare(Number.NaN)).toBe(DEFAULT_SHARE);
  });

  it("remembers each chat's panel, and the last width for new ones", () => {
    const storage = memory();
    const panels = new BrowserPanels(storage);
    let changes = 0;
    panels.subscribe(() => {
      changes += 1;
    });
    expect(panels.of("a")).toEqual({ open: false, share: DEFAULT_SHARE, full: false });
    panels.set("a", { open: true, share: 0.4 });
    expect(panels.of("a")).toEqual({ open: true, share: 0.4, full: false });
    // A chat opened later starts at the width last chosen, closed.
    expect(panels.of("b")).toEqual({ open: false, share: 0.4, full: false });
    panels.set("a", { full: true });
    expect(panels.of("a").full).toBe(true);
    expect(changes).toBe(2);
    expect(panels.getVersion()).toBe(2);
  });

  it("stays closed when storage is broken or holds nonsense", () => {
    const storage = memory();
    storage.values.set("auracode.browser-panel.a", "{not json");
    expect(new BrowserPanels(storage).of("a").open).toBe(false);
    const broken = new BrowserPanels({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {},
    });
    expect(broken.of("a")).toEqual({ open: false, share: DEFAULT_SHARE, full: false });
    expect(() => broken.set("a", { open: true })).not.toThrow();
    expect(new BrowserPanels(null).of("a").open).toBe(false);
  });

  it("moves the page only when a whole pixel changes", () => {
    const rect = { x: 10.2, y: 20.4, width: 300.1, height: 200.4 };
    expect(sameRect(rect, { x: 10.4, y: 20.1, width: 299.9, height: 200 })).toBe(true);
    expect(sameRect(rect, { ...rect, width: 301 })).toBe(false);
    expect(sameRect(null, null)).toBe(true);
    expect(sameRect(rect, null)).toBe(false);
  });

  it("dates history by day", () => {
    const now = new Date(2026, 10, 9, 15).getTime();
    expect(dayLabel(new Date(2026, 10, 9, 0, 5).getTime(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 8, 23, 59).getTime(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 10, 2).getTime(), now)).not.toMatch(/Today|Yesterday|2026/);
    expect(dayLabel(new Date(2025, 10, 2).getTime(), now)).toMatch(/2025/);
  });
});

describe("what covers the page", () => {
  const page = { left: 600, top: 100, right: 1200, bottom: 800 };

  it("compares boxes", () => {
    expect(overlaps(page, { left: 1100, top: 50, right: 1300, bottom: 120 })).toBe(true);
    expect(overlaps(page, { left: 0, top: 0, right: 600, bottom: 900 })).toBe(false);
  });

  it("counts open floating layers that meet the page, never its own stand-ins", () => {
    const element = (box: Partial<DOMRect>) =>
      ({
        getBoundingClientRect: () => ({ width: 100, height: 100, ...box }),
      }) as unknown as HTMLElement;
    const root = (elements: HTMLElement[]) =>
      ({ querySelectorAll: () => elements }) as unknown as ParentNode;
    const menu = element({ left: 1100, top: 120, right: 1260, bottom: 400 });
    const aside = element({ left: 10, top: 10, right: 200, bottom: 200 });
    const empty = element({ left: 700, top: 200, right: 700, bottom: 200, width: 0, height: 0 });
    expect(covered(page, root([aside, empty]))).toBe(false);
    expect(covered(page, root([aside, menu]))).toBe(true);
    const ownNote = { contains: (node: unknown) => node === menu } as unknown as Element;
    expect(covered(page, root([menu]), ownNote)).toBe(false);
  });
});
