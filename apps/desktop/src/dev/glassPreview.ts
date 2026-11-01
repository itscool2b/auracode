/**
 * Development previews only: a stand-in for the window's material, which only the native window
 * has. `?glass=acrylic` (or mica, vibrancy, liquid_glass) marks the page as glass the way the app
 * does from app_info, and paints a desktop behind it. `&backdrop=worst` paints the worst plausible
 * material instead (light Acrylic over a black desktop, dark over a white one), so the layout
 * probe checks text contrast on glass at its limit.
 */
import "./glass-preview.css";

const MATERIALS = new Set(["acrylic", "mica", "vibrancy", "liquid_glass"]);

export function emulateGlass(): void {
  const params = new URLSearchParams(location.search);
  const glass = params.get("glass");
  if (!glass || !MATERIALS.has(glass)) return;
  const root = document.documentElement;
  root.dataset.glass = glass;
  root.dataset.glassEmulated = params.get("backdrop") === "worst" ? "worst" : "desktop";
  // The app sets data-glass from app_info once it boots; previews keep the emulated material.
  new MutationObserver(() => {
    if (root.dataset.glass !== glass) root.dataset.glass = glass;
  }).observe(root, { attributes: true, attributeFilter: ["data-glass"] });
}
