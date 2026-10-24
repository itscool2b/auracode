import type { AgentBrand } from "../brand";
import { hexToRgb, mixHex, rgbToHex } from "../color";
import { type OrbState, orbStateTarget, TINT_RAMPS } from "./states";

/**
 * A static CSS stand-in for the orb, built from radial gradients in the brand's colours. Shown
 * when WebGL2 is unavailable, before the first WebGL frame lands, and while a lost context is
 * being restored. It also suits places too small for a live orb, like sidebar rows.
 *
 * Tinted states lean toward the same amber and red ramps as the shader, so a waiting orb reads as
 * waiting with or without WebGL. Apply it as `background` on a square element with
 * `border-radius: 50%`.
 */
export function orbPosterBackground(brand: AgentBrand, state: OrbState = "idle"): string {
  const target = orbStateTarget(state);
  const ramp = target.tint === "none" ? null : TINT_RAMPS[target.tint];
  const stop = (index: 0 | 1 | 2 | 3): string => {
    const color = brand.palette[index];
    return ramp ? mixHex(color, ramp[index], target.tintAmount) : rgbToHex(hexToRgb(color));
  };
  const deep = stop(0);
  const mid = stop(1);
  const bright = stop(2);
  const highlight = stop(3);

  // Like the live orb, the disc glows from within rather than reading as a glossy ball: a bright
  // centre falling through mid to deep at the rim, one broad bright lobe, and a soft translucent
  // highlight. Lobe sizes keep each inside the body's soft edge (47% of the box); a lobe reaching
  // further would show as a hard crescent against the element's round clip.
  return [
    `radial-gradient(26% 24% at 40% 37%, ${highlight}b3 0%, transparent 100%)`,
    `radial-gradient(34% 30% at 58% 60%, ${bright} 0%, transparent 100%)`,
    `radial-gradient(closest-side, ${bright} 0%, ${mid} 58%, ${deep} 86%, transparent 94%)`,
  ].join(", ");
}
