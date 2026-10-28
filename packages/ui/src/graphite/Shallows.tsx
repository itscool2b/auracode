import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export interface ShallowsProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** The element to render. Default "div". */
  readonly as?: "div" | "section" | "aside" | "header" | "footer" | "main";
  /**
   * A slow caustic shimmer near the surface: two soft light layers drifting on the compositor,
   * transform only. Still under reduced motion. Default false.
   */
  readonly shimmer?: boolean;
  /**
   * How far down the light falls off, as a CSS length (default 100%, the panel's height). A tall
   * panel such as a hero with the product inside it sets this so the water reaches its deep grey
   * where the content begins.
   */
  readonly depth?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly children?: ReactNode;
}

/**
 * Shallows (visual language 4.16): one rounded panel lit from the top like the sea's surface seen
 * from below. A single vertical falloff from `--g-water-surface` to `--g-water-deep`, a soft light
 * at the top centre, an optional slow shimmer; no texture, no noise, no lines. Put `Swimmers` and
 * the content inside it; the light sits behind both.
 */
export function Shallows({
  as: Tag = "div",
  shimmer = false,
  depth,
  className,
  style,
  children,
  ...rest
}: ShallowsProps) {
  const merged = depth ? ({ ...style, "--g-shallows-depth": depth } as CSSProperties) : style;
  return (
    <Tag
      {...rest}
      className={className ? `g-shallows ${className}` : "g-shallows"}
      data-shimmer={shimmer ? "" : undefined}
      style={merged}
    >
      <span className="g-shallows-light" aria-hidden="true" />
      {children}
    </Tag>
  );
}
