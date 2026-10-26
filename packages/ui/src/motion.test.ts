import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  durations,
  easings,
  prefersReducedMotion,
  setMotionPreference,
  springs,
  subscribeReducedMotion,
  usePrefersReducedMotion,
} from "./motion";

function ReducedMotionProbe() {
  return createElement("span", null, usePrefersReducedMotion() ? "reduced" : "full");
}

function dampingRatio(spring: { stiffness: number; damping: number; mass: number }): number {
  return spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass));
}

describe("springs", () => {
  it("are Motion-shaped spring transitions", () => {
    for (const spring of Object.values(springs)) {
      expect(spring.type).toBe("spring");
      expect(spring.mass).toBeGreaterThan(0);
    }
  });

  it("stay near critical damping: a touch of life, never wobbly", () => {
    for (const spring of Object.values(springs)) {
      const zeta = dampingRatio(spring);
      expect(zeta).toBeGreaterThan(0.75);
      expect(zeta).toBeLessThanOrEqual(1);
    }
  });

  it("get slower from snappy to smooth to gentle", () => {
    const settle = (s: { stiffness: number; damping: number; mass: number }) =>
      4 / (dampingRatio(s) * Math.sqrt(s.stiffness / s.mass));
    expect(settle(springs.snappy)).toBeLessThan(settle(springs.smooth));
    expect(settle(springs.smooth)).toBeLessThan(settle(springs.gentle));
  });
});

describe("durations and easings", () => {
  it("orders durations from instant to ambient", () => {
    const order = [
      durations.instant,
      durations.fast,
      durations.base,
      durations.slow,
      durations.slower,
      durations.ambient,
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("uses valid cubic-bezier control points and cannot be mutated", () => {
    for (const curve of Object.values(easings)) {
      expect(curve).toHaveLength(4);
      expect(curve[0]).toBeGreaterThanOrEqual(0);
      expect(curve[0]).toBeLessThanOrEqual(1);
      expect(curve[2]).toBeGreaterThanOrEqual(0);
      expect(curve[2]).toBeLessThanOrEqual(1);
      expect(Object.isFrozen(curve)).toBe(true);
    }
  });
});

describe("reduced motion", () => {
  it("applies the saved app preference and notifies mounted marks without an OS event", () => {
    let changes = 0;
    const stop = subscribeReducedMotion(() => {
      changes++;
    });
    setMotionPreference("off");
    expect(prefersReducedMotion()).toBe(true);
    setMotionPreference("off");
    expect(changes).toBe(1);
    setMotionPreference("full");
    expect(prefersReducedMotion()).toBe(false);
    expect(changes).toBe(2);
    stop();
  });
  it("reads as false where there is no window", () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it("subscribes safely where there is no window", () => {
    const unsubscribe = subscribeReducedMotion(() => {});
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
  });

  it("renders the full-motion value on the server", () => {
    expect(renderToString(createElement(ReducedMotionProbe))).toBe("<span>full</span>");
  });
});
