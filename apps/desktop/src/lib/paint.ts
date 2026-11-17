/**
 * Whether WebKitGTK paints this page on the CPU. Linux only: there the web process draws without
 * the GPU when its GPU renderer is switched off (the shell says so through `__AURA_PAINT__`,
 * `paints_on_cpu` in window.rs) or when the only OpenGL is a software one, as in a virtual machine.
 * On that path a pane's soft shadow is painted again with every change inside the pane: the stress
 * view drew 6 frames a second with it on a 4K screen at 2x, 30 to 50 without (16 November 2026).
 * With the GPU renderer the same shadow costs nothing measurable, so only this path drops it
 * (`data-paint="cpu"` in ui-tokens.css).
 */
export function paintsOnCpu(
  os: string,
  hint: string | undefined = (globalThis as { __AURA_PAINT__?: string }).__AURA_PAINT__,
  renderer: () => string | null = webglRenderer,
): boolean {
  if (os !== "linux") return false;
  return hint === "cpu" || isSoftwareRenderer(renderer());
}

/** Whether an OpenGL renderer name is a software one; no WebGL at all (`null`) counts as one. */
export function isSoftwareRenderer(renderer: string | null): boolean {
  return renderer === null || /llvmpipe|softpipe|swiftshader|swrast|software/i.test(renderer);
}

/** The OpenGL renderer WebGL runs on, or `null` without WebGL. The context is given back at once. */
function webglRenderer(): string | null {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return null;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(
      gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "",
    );
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return renderer;
  } catch {
    return null;
  }
}
