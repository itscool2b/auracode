import { type CSSProperties, useEffect, useState } from "react";
import { type LaunchPicture, launchPicture } from "./launchPictures";
import "./launch-art.css";

/** The picture's corner, in its own pixels: a picture that fills its frame reads as a plate. */
const CORNER = 12;

/**
 * The start screen: this launch's aircraft, alone in the pane with its name under it (owner,
 * 7 November 2026: "i dont want that thing showing on startup. just the art on startup"; 17 November
 * 2026: the owner's ten images in place of the text drawings). New chat, a project's New chat and
 * Ctrl+N open the composer as before.
 *
 * The picture is an ink map (launchPictures.ts) used as a mask over one rectangle of the theme's
 * ink, so it is light on a dark theme and dark on a light one and its empty parts are the pane
 * itself: no image shows as a black or white box in a theme of the other kind. An SVG mask reads a
 * grey image as coverage in every WebView the app runs in. The stylesheet fits it to the pane and
 * never draws it larger than its own pixels. The picture and its name wait for the image, then
 * arrive together.
 */
export function LaunchArt({ picture = launchPicture() }: { readonly picture?: LaunchPicture }) {
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const image = new Image();
    // A picture that cannot load still shows its name.
    const done = () => {
      if (live) setLoaded(picture.id);
    };
    image.onload = done;
    image.onerror = done;
    image.src = picture.src;
    return () => {
      live = false;
    };
  }, [picture]);
  const mask = `launch-art-ink-${picture.id}`;
  const { width, height } = picture;
  return (
    <figure
      className="launch-art"
      data-testid="launch-art"
      data-art={picture.id}
      data-loaded={loaded === picture.id ? "" : undefined}
    >
      <svg
        className="launch-art-picture"
        role="img"
        aria-label={picture.name}
        viewBox={`0 0 ${width} ${height}`}
        style={{ "--launch-art-width": width, "--launch-art-height": height } as CSSProperties}
      >
        <mask
          id={mask}
          maskUnits="userSpaceOnUse"
          x={0}
          y={0}
          width={width}
          height={height}
          style={{ maskType: "luminance" }}
        >
          <image href={picture.src} width={width} height={height} preserveAspectRatio="none" />
        </mask>
        <rect
          width={width}
          height={height}
          rx={CORNER}
          fill="currentColor"
          mask={`url(#${mask})`}
        />
      </svg>
      <figcaption className="launch-art-caption">{picture.name}</figcaption>
    </figure>
  );
}
