import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AgentBrand, brandsEqual, getBrand } from "../brand";
import { durations, prefersReducedMotion, usePrefersReducedMotion } from "../motion";
import { ALERT_BLOBS, type AuraBlob, type AuraIntensity, auraBlobs, auraLevel } from "./auraBlobs";

export interface AuraFieldProps {
  /** A brand id or a full brand. Changing it cross-fades the field. */
  readonly brand: string | AgentBrand;
  readonly intensity?: AuraIntensity;
  /** Freezes the drift in place, e.g. to save power while the app is idle. */
  readonly paused?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * The active agent's colour as a slow light field behind the glass: three or four large blurred
 * radial blobs drifting on 20-40s loops. Thinking intensifies it ("active"), waiting for approval
 * turns it amber ("alert"), and switching agents cross-fades it.
 *
 * Performance rules: the blur radius is constant and only transform and opacity ever change, so
 * every frame is compositor-only work: no layout, no paint, and no blur re-rasterised at a new
 * radius. Under reduced motion nothing drifts or scales; intensity and agent changes become short
 * opacity fades.
 *
 * Positioned absolutely to fill its nearest positioned ancestor; it ignores pointer events.
 */
export function AuraField({
  brand,
  intensity = "calm",
  paused = false,
  className,
  style,
}: AuraFieldProps) {
  const resolved = typeof brand === "string" ? getBrand(brand) : brand;
  const reduced = usePrefersReducedMotion();
  const [layers, removeLayer] = useCrossfadeLayers(resolved);
  const level = auraLevel(intensity);

  const fadeTransition = reduced
    ? "opacity var(--aura-duration-fade) var(--aura-ease-standard)"
    : "opacity var(--aura-duration-ambient) var(--aura-ease-standard)";
  const intensityStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    opacity: level.opacity,
    transform: reduced ? "none" : `scale(${level.scale})`,
    transition: reduced
      ? fadeTransition
      : `${fadeTransition}, transform var(--aura-duration-ambient) var(--aura-ease-standard)`,
  };

  return (
    <div
      aria-hidden="true"
      className={className}
      data-aura-field=""
      data-intensity={intensity}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        contain: "strict",
        zIndex: "var(--aura-z-field)",
        ...style,
      }}
    >
      {layers.map((layer) => (
        <AuraLayer
          key={layer.key}
          layerKey={layer.key}
          brand={layer.brand}
          leaving={layer.leaving}
          fadeIn={layer.key !== 0}
          onLeft={removeLayer}
          intensityStyle={intensityStyle}
          reduced={reduced}
          paused={paused}
        />
      ))}
      <div
        style={{ position: "absolute", inset: 0, opacity: level.alert, transition: fadeTransition }}
      >
        {ALERT_BLOBS.map((blob) => (
          <AuraBlobView
            key={blob.key}
            blob={blob}
            reduced={reduced}
            // Invisible blobs need not drift.
            paused={paused || level.alert === 0}
          />
        ))}
      </div>
    </div>
  );
}

interface Layer {
  readonly key: number;
  readonly brand: AgentBrand;
  readonly leaving: boolean;
}

/** At most this many brand layers exist at once; rapid switching drops the oldest outright. */
const MAX_LAYERS = 3;

/**
 * One layer per brand: a brand change adds a layer that fades in while the previous ones fade out
 * and remove themselves. Compared by content rather than identity, so an equal brand object
 * rebuilt on every render does not restart the fade.
 */
function useCrossfadeLayers(brand: AgentBrand): [readonly Layer[], (key: number) => void] {
  const [layers, setLayers] = useState<readonly Layer[]>(() => [{ key: 0, brand, leaving: false }]);
  const current = layers[layers.length - 1];
  if (!current || !brandsEqual(current.brand, brand)) {
    // React's pattern for responding to a prop change: state set during render re-renders before
    // commit, so the incoming layer mounts in the same commit the prop changed.
    setLayers((previous) => {
      const kept = previous
        .slice(-(MAX_LAYERS - 1))
        .map((layer) => (layer.leaving ? layer : { ...layer, leaving: true }));
      const nextKey = (previous[previous.length - 1]?.key ?? 0) + 1;
      return [...kept, { key: nextKey, brand, leaving: false }];
    });
  }
  const remove = useCallback((layerKey: number) => {
    setLayers((previous) => previous.filter((layer) => layer.key !== layerKey));
  }, []);
  return [layers, remove];
}

/** Agent switches cross-fade a little faster than intensity changes breathe. */
function crossfadeMs(): number {
  return prefersReducedMotion() ? durations.fade : durations.slower;
}

interface AuraLayerProps {
  readonly layerKey: number;
  readonly brand: AgentBrand;
  readonly leaving: boolean;
  /** False for the first layer: it may have been server-rendered and is already on screen. */
  readonly fadeIn: boolean;
  readonly onLeft: (layerKey: number) => void;
  readonly intensityStyle: CSSProperties;
  readonly reduced: boolean;
  readonly paused: boolean;
}

function AuraLayer({
  layerKey,
  brand,
  leaving,
  fadeIn,
  onLeft,
  intensityStyle,
  reduced,
  paused,
}: AuraLayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const blobs = useMemo(() => auraBlobs(brand), [brand]);
  const fadeInOnMount = useRef(fadeIn);

  // Fades run on the Web Animations API: compositor-driven, and they need no extra React commit.
  useEffect(() => {
    const element = ref.current;
    if (!fadeInOnMount.current || !element || typeof element.animate !== "function") return;
    const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: crossfadeMs(),
      easing: "ease-out",
      fill: "backwards",
    });
    return () => animation.cancel();
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const element = ref.current;
    if (!element || typeof element.animate !== "function") {
      onLeft(layerKey);
      return;
    }
    // Start from wherever a still-running fade-in got to, so a quick switch never flashes.
    const from = Number.parseFloat(getComputedStyle(element).opacity);
    const animation = element.animate(
      [{ opacity: Number.isFinite(from) ? from : 1 }, { opacity: 0 }],
      {
        duration: crossfadeMs(),
        easing: "ease-in",
        fill: "forwards",
      },
    );
    animation.onfinish = () => onLeft(layerKey);
    return () => {
      animation.onfinish = null;
      animation.cancel();
    };
  }, [leaving, layerKey, onLeft]);

  return (
    <div ref={ref} style={{ position: "absolute", inset: 0 }}>
      <div style={intensityStyle}>
        {blobs.map((blob) => (
          <AuraBlobView key={blob.key} blob={blob} reduced={reduced} paused={paused || leaving} />
        ))}
      </div>
    </div>
  );
}

interface AuraBlobViewProps {
  readonly blob: AuraBlob;
  readonly reduced: boolean;
  readonly paused: boolean;
}

function AuraBlobView({ blob, reduced, paused }: AuraBlobViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const pausedRef = useRef(paused);

  // Declared before the drift effect, so a commit that changes both updates the ref first.
  useEffect(() => {
    pausedRef.current = paused;
    const animation = animationRef.current;
    if (!animation) return;
    if (paused) animation.pause();
    else animation.play();
  }, [paused]);

  useEffect(() => {
    const element = ref.current;
    if (reduced || !element || typeof element.animate !== "function") return;
    const animation = element.animate([...blob.keyframes], {
      duration: blob.durationMs,
      iterations: Number.POSITIVE_INFINITY,
      // A negative delay starts the loop partway through.
      delay: -blob.phaseMs,
    });
    if (pausedRef.current) animation.pause();
    animationRef.current = animation;
    return () => {
      animation.cancel();
      animationRef.current = null;
    };
  }, [blob, reduced]);

  const half = blob.size / 2;
  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        left: `${blob.x}%`,
        top: `${blob.y}%`,
        width: `${blob.size}vmax`,
        height: `${blob.size}vmax`,
        // Centred with margins: transform belongs to the drift animation.
        marginLeft: `-${half}vmax`,
        marginTop: `-${half}vmax`,
        borderRadius: "50%",
        background: `radial-gradient(closest-side, ${blob.color} 0%, transparent 100%)`,
        opacity: blob.opacity,
        // Constant by rule: never animate this.
        filter: "blur(var(--aura-blur-field))",
        willChange: reduced ? undefined : "transform",
      }}
    />
  );
}
