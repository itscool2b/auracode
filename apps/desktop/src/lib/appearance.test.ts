import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppearanceController, isAppearance } from "./appearance";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function system(dark: boolean) {
  const target = Object.assign(new EventTarget(), { matches: dark });
  return {
    media: target as unknown as MediaQueryList,
    change: (next: boolean) => {
      target.matches = next;
      target.dispatchEvent(new Event("change"));
    },
  };
}

describe("appearance preferences", () => {
  it("uses preview overrides before rendering, persists an explicit preview change and rejects stale snapshots", async () => {
    vi.resetModules();
    vi.stubEnv("DEV", true);
    const os = system(false);
    const localStorage = { getItem: vi.fn(() => "light"), setItem: vi.fn() };
    const root = { dataset: {}, style: {} };
    vi.stubGlobal("window", {
      location: { search: "?preview=settings&theme=dark" },
      localStorage,
      matchMedia: () => os.media,
    });
    vi.stubGlobal("document", { documentElement: root });
    const appearance = await import("./appearance");
    appearance.initializeAppearance();
    expect(root).toEqual({ dataset: { theme: "dark" }, style: { colorScheme: "dark" } });
    appearance.applySetupAppearance({ revision: 4, appearance: "light" });
    appearance.applySetupAppearance({ revision: 3, appearance: "dark" });
    expect(appearance.getAppearancePreference()).toBe("light");
    expect(localStorage.setItem).toHaveBeenCalledWith("auracode.preview.appearance", "light");
  });

  it("never restores or persists another profile's appearance through browser storage", async () => {
    vi.resetModules();
    const os = system(false);
    const localStorage = { getItem: vi.fn(() => "dark"), setItem: vi.fn() };
    const root = { dataset: {}, style: {} };
    vi.stubGlobal("window", { location: { search: "" }, localStorage, matchMedia: () => os.media });
    vi.stubGlobal("document", { documentElement: root });
    const appearance = await import("./appearance");
    appearance.initializeAppearance();
    expect(appearance.getAppearancePreference()).toBe("system");
    expect(root.dataset).toEqual({ theme: "light" });
    appearance.applySetupAppearance({ revision: 0, appearance: "dark" });
    expect(root.dataset).toEqual({ theme: "dark" });
    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
  it("follows OS changes only while System is selected, including returning to System", () => {
    const os = system(false);
    const apply = vi.fn();
    const persist = vi.fn();
    const appearance = createAppearanceController(os.media, "system", apply, persist);
    expect(apply).toHaveBeenLastCalledWith("light");
    os.change(true);
    expect(apply).toHaveBeenLastCalledWith("dark");
    appearance.set("light");
    os.change(false);
    os.change(true);
    expect(apply).toHaveBeenCalledTimes(3);
    expect(appearance.resolved()).toBe("light");
    appearance.set("system");
    expect(apply).toHaveBeenLastCalledWith("dark");
    expect(persist.mock.calls).toEqual([["light"], ["system"]]);
    appearance.dispose();
  });

  it("notifies live views after the root theme changes and releases listeners", () => {
    const os = system(true);
    let rootTheme = "";
    const appearance = createAppearanceController(os.media, "dark", (value) => {
      rootTheme = value;
    });
    const observed: string[] = [];
    const unsubscribe = appearance.subscribe(() => observed.push(rootTheme));
    appearance.set("light");
    expect(observed).toEqual(["light"]);
    unsubscribe();
    appearance.set("system");
    expect(observed).toEqual(["light"]);
    appearance.dispose();
    os.change(false);
    expect(rootTheme).toBe("dark");
  });

  it("resolves a newly opened profile independently from the previous profile", () => {
    const os = system(false);
    const previous = createAppearanceController(os.media, "dark", () => {});
    previous.dispose();
    const apply = vi.fn();
    const next = createAppearanceController(os.media, "system", apply);
    expect(next.preference()).toBe("system");
    expect(apply).toHaveBeenLastCalledWith("light");
    next.dispose();
    for (const invalid of [null, "", "auto", "DARK", {}, 1])
      expect(isAppearance(invalid)).toBe(false);
  });
});
