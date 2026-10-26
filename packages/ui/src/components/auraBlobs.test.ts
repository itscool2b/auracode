import { describe, expect, it } from "vitest";
import { AGENT_BRAND_IDS, AGENT_BRANDS } from "../brand";
import { ALERT_BLOBS, AURA_INTENSITY, type AuraIntensity, auraBlobs, auraLevel } from "./auraBlobs";

const everyBlob = () => [
  ...AGENT_BRAND_IDS.flatMap((id) => auraBlobs(AGENT_BRANDS[id])),
  ...ALERT_BLOBS,
];

describe("aura blobs", () => {
  it("uses three or four blobs per brand, in the brand's colours", () => {
    for (const id of AGENT_BRAND_IDS) {
      const brand = AGENT_BRANDS[id];
      const blobs = auraBlobs(brand);
      expect(blobs.length).toBeGreaterThanOrEqual(3);
      expect(blobs.length).toBeLessThanOrEqual(4);
      const allowed = new Set<string>([...brand.palette, brand.glow]);
      for (const blob of blobs) expect(allowed.has(blob.color), `${id} ${blob.color}`).toBe(true);
    }
  });

  it("drifts on 20 to 40 second loops", () => {
    for (const blob of everyBlob()) {
      expect(blob.durationMs).toBeGreaterThanOrEqual(20_000);
      expect(blob.durationMs).toBeLessThanOrEqual(40_000);
      expect(blob.phaseMs).toBeGreaterThanOrEqual(0);
      expect(blob.phaseMs).toBeLessThan(blob.durationMs);
    }
  });

  it("only ever animates transform, never filter, blur, or layout", () => {
    for (const blob of everyBlob()) {
      for (const frame of blob.keyframes) {
        const animated = Object.keys(frame).filter((key) => key !== "easing" && key !== "offset");
        expect(animated).toEqual(["transform"]);
        expect(frame.transform).not.toMatch(/blur|filter/);
      }
    }
  });

  it("returns home at the end of every loop, so iterations join seamlessly", () => {
    for (const blob of everyBlob()) {
      expect(blob.keyframes[0]?.transform).toBe(
        blob.keyframes[blob.keyframes.length - 1]?.transform,
      );
    }
  });

  it("leans each loop toward the brand's drift", () => {
    // Antigravity drifts up: its waypoints sit higher (negative CSS y) than a driftless brand's.
    const waypointY = (id: "antigravity" | "codex") => {
      const transform = auraBlobs(AGENT_BRANDS[id])[0]?.keyframes[1]?.transform ?? "";
      return Number.parseFloat(/translate3d\([^,]+,\s*(-?[\d.]+)%/.exec(transform)?.[1] ?? "0");
    };
    expect(waypointY("antigravity")).toBeLessThan(waypointY("codex"));
  });

  it("does not move blobs in lockstep", () => {
    const phases = auraBlobs(AGENT_BRANDS.codex).map((blob) => blob.durationMs);
    expect(new Set(phases).size).toBe(phases.length);
  });
});

describe("aura intensity", () => {
  it("brightens when active and turns amber only on alert", () => {
    expect(AURA_INTENSITY.active.opacity).toBeGreaterThan(AURA_INTENSITY.calm.opacity);
    expect(AURA_INTENSITY.active.scale).toBeGreaterThan(AURA_INTENSITY.calm.scale);
    expect(AURA_INTENSITY.calm.alert).toBe(0);
    expect(AURA_INTENSITY.active.alert).toBe(0);
    expect(AURA_INTENSITY.alert.alert).toBeGreaterThan(0.5);
  });

  it("treats unknown intensities as calm", () => {
    expect(auraLevel("loud" as AuraIntensity)).toBe(AURA_INTENSITY.calm);
    expect(auraLevel("constructor" as AuraIntensity)).toBe(AURA_INTENSITY.calm);
  });

  it("keeps every opacity and scale in range", () => {
    for (const level of Object.values(AURA_INTENSITY)) {
      for (const value of [level.opacity, level.alert]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(level.scale).toBeGreaterThanOrEqual(1);
      expect(level.scale).toBeLessThan(1.2);
    }
  });
});
