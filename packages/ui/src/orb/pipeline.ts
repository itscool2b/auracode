import { type OGLRenderingContext, Program, Renderer, Triangle } from "ogl";
import {
  ORB_FRAGMENT_SHADER,
  ORB_UNIFORMS,
  ORB_VERTEX_SHADER,
  type OrbUniformName,
} from "./shader";

/**
 * The GPU side of the orb renderer: one WebGL2 context, created through OGL, that draws every orb.
 *
 * Why one shared context with a canvas per orb (instead of a canvas and context per orb, or one
 * full-window canvas): browsers cap live WebGL contexts at a handful, and an overlay canvas would
 * sit above or below the whole UI. Drawing each orb into the shared canvas and handing the frame to
 * the orb's own canvas keeps normal DOM stacking, so orbs sit inside glass panels and under popovers.
 *
 * The shared canvas keeps one size (the largest orb's) and each orb draws into its bottom-left
 * corner through the viewport. Resizing a WebGL drawing buffer reallocates it: measured in Chromium
 * at about 8ms per resize, so resizing per orb per frame cost 21ms a frame with three orb sizes on
 * screen. The orb's canvas then shows just that corner (see createCanvasSurface).
 *
 * Setup goes through OGL (context state, program compile with line-numbered errors, the fullscreen
 * triangle and its VAO). The per-frame path is raw WebGL on cached uniform locations, because OGL's
 * render and draw calls allocate render lists, closures, and strings on every call.
 */

/** One orb's draw inputs. The renderer keeps one of these per orb and mutates it in place. */
export interface OrbUniformValues {
  /** Phase, already integrated with speed. */
  time: number;
  /** The orb's size in device pixels: the viewport it draws into. */
  width: number;
  height: number;
  /** Four RGB stops as 12 floats; the renderer glides it in place. */
  palette: Float32Array;
  energy: number;
  speed: number;
  turbulence: number;
  ringFrequency: number;
  /** Accumulated drift offset, x and y. */
  driftX: number;
  driftY: number;
  seed: number;
}

/**
 * The visible canvas an orb's frames land on. Every frame is the whole shared canvas; the orb is
 * its bottom-left `width` x `height` device pixels.
 */
export interface OrbSurface {
  /** The orb's size changed, in device pixels. */
  resize(width: number, height: number): void;
  /** Shows the orb's corner of `bitmap` and takes ownership of the bitmap. */
  presentBitmap(bitmap: ImageBitmap, width: number, height: number): void;
  /** Copies the orb's corner of `source`, the shared WebGL canvas. */
  presentCanvas(source: HTMLCanvasElement, width: number, height: number): void;
}

/**
 * How frames leave the pipeline: "bitmap" when the shared canvas is an OffscreenCanvas (frames are
 * transferred as ImageBitmaps, no copy), "canvas" for the HTMLCanvasElement fallback (frames are
 * copied with drawImage).
 */
export type OrbOutput = "bitmap" | "canvas";

export interface OrbPipeline {
  readonly output: OrbOutput;
  /**
   * Sizes the shared canvas (square, device pixels). This reallocates GPU memory, so the renderer
   * calls it only when the largest orb changes size, never per frame.
   */
  resize(size: number): void;
  /**
   * Draws one orb into the bottom-left of the shared canvas. False when the context is lost or not
   * built. An orb larger than the canvas grows it first (a safety net; the renderer sizes ahead).
   */
  draw(values: OrbUniformValues): boolean;
  /** Hands the frame just drawn to `surface`, which shows its bottom-left `width` x `height`. */
  present(surface: OrbSurface, width: number, height: number): void;
  /** Re-creates program and geometry after `webglcontextrestored`. False if that failed. */
  rebuild(): boolean;
  /** Frees GPU objects and the context itself. The pipeline is unusable afterwards. */
  release(): void;
}

export interface OrbPipelineEvents {
  onContextLost(): void;
  onContextRestored(): void;
}

/** Creates a pipeline, or returns null when WebGL2 is unavailable. */
export type OrbPipelineFactory = (events: OrbPipelineEvents) => OrbPipeline | null;

/*
 * `failIfMajorPerformanceCaveat`: a software-rendered context would burn CPU on every frame, so the
 * CSS poster is the better fallback. `low-power` keeps dual-GPU Macs on the integrated GPU, which is
 * plenty for these orbs. No depth, stencil, or MSAA: one fullscreen triangle needs none of them.
 */
const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  powerPreference: "low-power",
  failIfMajorPerformanceCaveat: true,
};

type SharedCanvas =
  | {
      readonly output: "bitmap";
      readonly canvas: OffscreenCanvas;
      readonly gl: WebGL2RenderingContext;
    }
  | {
      readonly output: "canvas";
      readonly canvas: HTMLCanvasElement;
      readonly gl: WebGL2RenderingContext;
    };

/** Prefers an OffscreenCanvas; falls back to a detached canvas element; null without WebGL2. */
function openSharedCanvas(): SharedCanvas | null {
  if (
    typeof OffscreenCanvas === "function" &&
    typeof OffscreenCanvas.prototype.transferToImageBitmap === "function"
  ) {
    try {
      const canvas = new OffscreenCanvas(1, 1);
      const gl = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
      if (gl) return { output: "bitmap", canvas, gl };
    } catch {
      // Some engines throw instead of returning null; the element fallback below still applies.
    }
  }
  if (typeof document !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const gl = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
      if (gl) return { output: "canvas", canvas, gl };
    } catch {
      // No WebGL2 at all: orbs render as CSS posters.
    }
  }
  return null;
}

/*
 * OGL asks the canvas for a context again; the canvas hands back the one opened above, so the
 * attributes chosen there win. OGL's types predate OffscreenCanvas, but its setSize skips `style`
 * when the canvas has none, which is the only DOM-specific thing it touches. OGL's constructor
 * also sizes the canvas, so it is given the current size: a rebuild after context loss must not
 * shrink a canvas the renderer already sized for its largest orb.
 */
function createOglRenderer(shared: SharedCanvas): Renderer {
  return new Renderer({
    canvas: shared.canvas as unknown as HTMLCanvasElement,
    webgl: 2,
    width: Math.max(1, shared.canvas.width),
    height: Math.max(1, shared.canvas.height),
    dpr: 1,
    alpha: true,
    premultipliedAlpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
    autoClear: false,
  });
}

interface GpuObjects {
  readonly program: Program;
  readonly geometry: Triangle;
  readonly vao: WebGLVertexArrayObject;
  readonly locations: Readonly<Record<OrbUniformName, WebGLUniformLocation | null>>;
}

function buildGpuObjects(
  oglGl: OGLRenderingContext,
  gl: WebGL2RenderingContext,
): GpuObjects | null {
  const program = new Program(oglGl, {
    vertex: ORB_VERTEX_SHADER,
    fragment: ORB_FRAGMENT_SHADER,
    depthTest: false,
    depthWrite: false,
    cullFace: false,
  });
  // Shaders are only needed until link; flagging them now lets the driver free them with the program.
  gl.deleteShader(program.vertexShader);
  gl.deleteShader(program.fragmentShader);
  // OGL logs compile errors (with line numbers) but does not throw, so check the link here.
  if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
    program.remove();
    return null;
  }

  const geometry = new Triangle(oglGl);
  geometry.createVAO(program);
  const vao = geometry.VAOs[program.attributeOrder];
  gl.bindVertexArray(null);
  if (!vao) {
    geometry.remove();
    program.remove();
    return null;
  }

  const locations = {} as Record<OrbUniformName, WebGLUniformLocation | null>;
  for (const name of ORB_UNIFORMS) locations[name] = gl.getUniformLocation(program.program, name);

  // Opaque overwrite of every pixel: no blending, depth, or culling.
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  return { program, geometry, vao, locations };
}

/** The production pipeline: OGL on an OffscreenCanvas (or a detached canvas element). */
export const createOglPipeline: OrbPipelineFactory = (events) => {
  const shared = openSharedCanvas();
  if (!shared) return null;
  const { gl } = shared;
  if (gl.isContextLost()) return null;

  let renderer = createOglRenderer(shared);
  let gpu = buildGpuObjects(renderer.gl, gl);
  if (!gpu) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }

  let bound = false;
  let viewportWidth = -1;
  let viewportHeight = -1;
  let released = false;

  // Assigning a canvas dimension reallocates the drawing buffer even when the value is unchanged.
  const setCanvasSize = (width: number, height: number): void => {
    if (shared.canvas.width !== width) shared.canvas.width = width;
    if (shared.canvas.height !== height) shared.canvas.height = height;
  };

  const handleLost = (event: Event): void => {
    // Without preventDefault the browser never restores the context.
    event.preventDefault();
    gpu = null;
    bound = false;
    events.onContextLost();
  };
  const handleRestored = (): void => {
    events.onContextRestored();
  };
  shared.canvas.addEventListener("webglcontextlost", handleLost);
  shared.canvas.addEventListener("webglcontextrestored", handleRestored);

  return {
    output: shared.output,

    resize(size) {
      if (released || !(size > 0)) return;
      setCanvasSize(size, size);
    },

    draw(values) {
      const objects = gpu;
      if (objects === null || released || gl.isContextLost()) return false;
      const { width, height } = values;
      if (width <= 0 || height <= 0) return false;

      const canvas = shared.canvas;
      if (width > canvas.width || height > canvas.height) {
        setCanvasSize(Math.max(width, canvas.width), Math.max(height, canvas.height));
      }
      // The viewport confines the fullscreen triangle to the orb's bottom-left corner.
      if (viewportWidth !== width || viewportHeight !== height) {
        gl.viewport(0, 0, width, height);
        viewportWidth = width;
        viewportHeight = height;
      }
      if (!bound) {
        // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook.
        gl.useProgram(objects.program.program);
        gl.bindVertexArray(objects.vao);
        bound = true;
      }

      const at = objects.locations;
      gl.uniform1f(at.uTime, values.time);
      gl.uniform2f(at.uResolution, width, height);
      gl.uniform3fv(at.uPalette, values.palette);
      gl.uniform1f(at.uEnergy, values.energy);
      gl.uniform1f(at.uSpeed, values.speed);
      gl.uniform1f(at.uTurbulence, values.turbulence);
      gl.uniform1f(at.uRingFrequency, values.ringFrequency);
      gl.uniform2f(at.uDrift, values.driftX, values.driftY);
      gl.uniform1f(at.uSeed, values.seed);
      // The triangle covers the whole viewport and blending is off, so no clear is needed; pixels
      // outside the viewport are never shown.
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    },

    present(surface, width, height) {
      if (shared.output === "bitmap") {
        surface.presentBitmap(shared.canvas.transferToImageBitmap(), width, height);
      } else {
        surface.presentCanvas(shared.canvas, width, height);
      }
    },

    rebuild() {
      if (released || gl.isContextLost()) return false;
      // Old handles died with the old context; a fresh OGL renderer resets its cached GL state.
      renderer = createOglRenderer(shared);
      gpu = buildGpuObjects(renderer.gl, gl);
      bound = false;
      viewportWidth = -1;
      viewportHeight = -1;
      return gpu !== null;
    },

    release() {
      if (released) return;
      released = true;
      shared.canvas.removeEventListener("webglcontextlost", handleLost);
      shared.canvas.removeEventListener("webglcontextrestored", handleRestored);
      if (gpu && !gl.isContextLost()) {
        gpu.geometry.remove();
        gpu.program.remove();
      }
      gpu = null;
      // Frees the GPU context now instead of whenever the canvas is garbage collected.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      shared.canvas.width = 1;
      shared.canvas.height = 1;
    },
  };
};

/**
 * Wraps an orb's visible canvas, which must sit at the bottom-left of a box that clips overflow
 * (the Orb component's root). A canvas keeps whichever context it gets first, so the choice is
 * made once here:
 *
 * - 'bitmaprenderer' (OffscreenCanvas output): the canvas takes the whole shared frame without a
 *   copy, and is sized in CSS so that the orb's corner exactly covers the box; the clip hides the
 *   rest. Zero-copy is chosen for WebKit, which has historically kept small 2D canvases
 *   unaccelerated, where copying a GPU frame in would mean a readback per orb per frame (not yet
 *   measured on Safari 26; Chromium measured the same for both paths). The cost is memory: each
 *   orb's canvas holds a frame the size of the largest orb.
 * - '2d' (no bitmaprenderer, or the canvas-element fallback): the orb's corner is copied with
 *   drawImage into a canvas exactly the orb's size.
 */
export function createCanvasSurface(canvas: HTMLCanvasElement, output: OrbOutput): OrbSurface {
  const bitmapContext = output === "bitmap" ? canvas.getContext("bitmaprenderer") : null;
  const context2d = bitmapContext ? null : canvas.getContext("2d");
  let scaleX = -1;
  let scaleY = -1;

  // CSS size as a multiple of the box, so `width` x `height` device pixels of the frame fill it.
  const fitFrame = (
    frameWidth: number,
    frameHeight: number,
    width: number,
    height: number,
  ): void => {
    const x = frameWidth / width;
    const y = frameHeight / height;
    if (x === scaleX && y === scaleY) return;
    scaleX = x;
    scaleY = y;
    canvas.style.width = `${x * 100}%`;
    canvas.style.height = `${y * 100}%`;
  };

  return {
    resize(width, height) {
      if (!context2d) return;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      fitFrame(width, height, width, height);
    },
    presentBitmap(bitmap, width, height) {
      if (bitmapContext) {
        if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
        if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
        fitFrame(bitmap.width, bitmap.height, width, height);
        bitmapContext.transferFromImageBitmap(bitmap);
        return;
      }
      if (context2d) {
        context2d.clearRect(0, 0, width, height);
        context2d.drawImage(bitmap, 0, bitmap.height - height, width, height, 0, 0, width, height);
      }
      bitmap.close();
    },
    presentCanvas(source, width, height) {
      if (!context2d) return;
      context2d.clearRect(0, 0, width, height);
      context2d.drawImage(source, 0, source.height - height, width, height, 0, 0, width, height);
    },
  };
}
