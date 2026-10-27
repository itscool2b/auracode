import { LOGO_PATH, LOGO_SMALL_MAX, LOGO_SMALL_PATH, LOGO_VIEWBOX } from "./logoPaths";

export interface LogoProps {
  /** Width and height of the square box in px. Default 20. */
  readonly size?: number;
  readonly className?: string;
  /** Accessible name; without one the logo is decorative. */
  readonly label?: string;
}

/**
 * The auracode logo (a sea lion and a sea turtle) in `currentColor`. At 24px and below it draws
 * the small variant, whose wider gaps stay open at that size.
 */
export function Logo({ size = 20, className, label }: LogoProps) {
  const box = Number.isFinite(size) ? Math.max(8, Math.min(1024, Math.round(size))) : 20;
  const [width, height] = LOGO_VIEWBOX;
  return (
    <svg
      className={className ? `g-logo ${className}` : "g-logo"}
      width={box}
      height={box}
      viewBox={`0 0 ${width} ${height}`}
      fill="currentColor"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path fillRule="evenodd" d={box <= LOGO_SMALL_MAX ? LOGO_SMALL_PATH : LOGO_PATH} />
    </svg>
  );
}

export interface WordmarkProps {
  /** Font size of "auracode" in px. Default 16. */
  readonly size?: number;
  /** Show the logo before the word. Default true. */
  readonly mark?: boolean;
  readonly className?: string;
}

/**
 * "auracode" in Geist 600 with tight tracking, after the logo. The word is real text, so a
 * wordmark inside a link names the link. The logo is a quarter taller than the type and centred
 * on it, so the animals sit level with the letters.
 */
export function Wordmark({ size = 16, mark = true, className }: WordmarkProps) {
  const fontSize = Number.isFinite(size) ? Math.max(10, Math.min(320, size)) : 16;
  return (
    <span
      className={className ? `g-wordmark ${className}` : "g-wordmark"}
      style={{ fontSize: `${fontSize}px` }}
    >
      {mark ? <Logo size={Math.round(fontSize * 1.25)} /> : null}
      <span className="g-wordmark-text">auracode</span>
    </span>
  );
}
