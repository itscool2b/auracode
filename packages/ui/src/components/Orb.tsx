import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { type AgentBrand, getBrand } from "../brand";
import { orbPosterBackground } from "../orb/poster";
import {
  getOrbSupport,
  type OrbHandle,
  type OrbSupport,
  registerOrb,
  subscribeOrbSupport,
} from "../orb/renderer";
import { ORB_STATE_LABELS, type OrbState } from "../orb/states";

export interface OrbProps {
  /** A brand id ("codex", unknown ids fall back to generic) or a full brand. */
  readonly brand: string | AgentBrand;
  readonly state?: OrbState;
  /** Diameter in CSS px. */
  readonly size?: number;
  /** Accessible name, e.g. "Codex is thinking". Defaults to the brand name and state. */
  readonly label?: string;
  /** 0..1: varies the pattern between orbs of one brand. Read once, when the orb first renders live. */
  readonly seed?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/* Servers cannot render WebGL; the poster is the server markup and hydration upgrades it. */
const serverSupport = (): OrbSupport => "poster";

function sanitizeSize(size: number): number {
  return Number.isFinite(size) && size > 0 ? size : 0;
}

/**
 * A live agent orb. Every orb on the page shares one WebGL2 context, but each keeps its own canvas,
 * so it stacks like any element (inside glass, under popovers).
 *
 * A CSS poster in the brand's colours sits underneath: it is what servers render, what shows before
 * the first frame and while a lost GPU context recovers, and the permanent fallback without WebGL2.
 */
export function Orb({ brand, state = "idle", size = 96, label, seed, className, style }: OrbProps) {
  const resolved = typeof brand === "string" ? getBrand(brand) : brand;
  const cssSize = sanitizeSize(size);
  const support = useSyncExternalStore(subscribeOrbSupport, getOrbSupport, serverSupport);
  const [registrationFailed, setRegistrationFailed] = useState(false);
  const [live, setLive] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<OrbHandle | null>(null);

  // Latest props for the registration effect, which must not re-run (re-register) when they change.
  const brandRef = useRef(resolved);
  const stateRef = useRef(state);
  const sizeRef = useRef(cssSize);
  const seedRef = useRef(seed);

  // These run before the registration effect in the same commit, so its refs are always current.
  useEffect(() => {
    brandRef.current = resolved;
    handleRef.current?.setBrand(resolved);
  }, [resolved]);
  useEffect(() => {
    stateRef.current = state;
    handleRef.current?.setState(state);
  }, [state]);
  useEffect(() => {
    sizeRef.current = cssSize;
    handleRef.current?.setSize(cssSize);
  }, [cssSize]);
  useEffect(() => {
    seedRef.current = seed;
  }, [seed]);

  const showCanvas = support === "webgl" && !registrationFailed;

  useEffect(() => {
    if (!showCanvas) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handle = registerOrb({
      canvas,
      brand: brandRef.current,
      state: stateRef.current,
      size: sizeRef.current,
      seed: seedRef.current,
      onLiveChange: setLive,
    });
    if (!handle) {
      setRegistrationFailed(true);
      return;
    }
    handleRef.current = handle;
    return () => {
      handleRef.current = null;
      handle.unregister();
      setLive(false);
    };
  }, [showCanvas]);

  const poster = useMemo(() => orbPosterBackground(resolved, state), [resolved, state]);
  const fade = "opacity var(--aura-duration-slow) var(--aura-ease-standard)";

  return (
    <div
      role="img"
      aria-label={label ?? `${resolved.name}, ${ORB_STATE_LABELS[state] ?? state}`}
      className={className}
      data-aura-orb=""
      data-orb-brand={resolved.id}
      data-orb-state={state}
      style={{
        position: "relative",
        display: "inline-block",
        flex: "none",
        verticalAlign: "middle",
        width: cssSize,
        height: cssSize,
        // The canvas can be larger than the orb (it may show a whole shared frame, of which this
        // orb is the bottom-left corner); the clip keeps only the orb.
        overflow: "hidden",
        ...style,
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: poster,
          opacity: live ? 0 : 1,
          transition: fade,
        }}
      />
      {showCanvas ? (
        // Anchored bottom-left; the renderer owns its size, both the drawing buffer and the CSS box.
        // Like the poster, it needs no aria-hidden: children of role="img" are presentational.
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            opacity: live ? 1 : 0,
            transition: fade,
          }}
        />
      ) : null}
    </div>
  );
}
