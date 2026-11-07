import { useLayoutEffect, useRef } from "react";
import { type LaunchPicture, launchPicture } from "./launchPictures";
import "./launch-art.css";

/** The most a small piece grows past its set size, so a short sketch stays a sketch. */
const MOST = 2;
/** The share of the pane a piece may fill, leaving it room to sit in. */
const FILL = 0.84;

/**
 * The start screen: this launch's aircraft in ASCII, alone in the pane with its name under it
 * (owner, 7 November 2026: "i dont want that thing showing on startup. just the art on startup").
 * New chat, a project's New chat and Ctrl+N open the composer as before. The piece is sized to the
 * pane: a large one shrinks to fit, a small one grows up to twice its set size.
 */
export function LaunchArt({ picture = launchPicture() }: { readonly picture?: LaunchPicture }) {
  const room = useRef<HTMLElement>(null);
  const art = useRef<HTMLPreElement>(null);
  const caption = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Another piece has another size, so a new picture sizes again.
  useLayoutEffect(() => {
    const figure = room.current;
    const piece = art.current;
    const name = caption.current;
    if (!figure || !piece || !name) return;
    const size = () => {
      piece.style.setProperty("--launch-art-scale", "1");
      const natural = piece.getBoundingClientRect();
      const style = getComputedStyle(figure);
      const px = (value: string) => Number.parseFloat(value) || 0;
      const width = figure.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
      const height =
        figure.clientHeight -
        px(style.paddingTop) -
        px(style.paddingBottom) -
        name.getBoundingClientRect().height -
        px(style.rowGap);
      if (!natural.width || !natural.height || width <= 0 || height <= 0) return;
      const scale = Math.min(
        MOST,
        (width * FILL) / natural.width,
        (height * FILL) / natural.height,
      );
      piece.style.setProperty("--launch-art-scale", scale.toFixed(4));
    };
    size();
    // Geist Mono can arrive after the first layout; measure again once it has.
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) size();
    });
    if (typeof ResizeObserver === "undefined") {
      return () => {
        live = false;
      };
    }
    const observer = new ResizeObserver(size);
    observer.observe(figure);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [picture]);
  return (
    <figure ref={room} className="launch-art" data-testid="launch-art" data-art={picture.id}>
      <pre
        ref={art}
        className="launch-art-picture"
        role="img"
        aria-label={`${picture.name}, drawn in text`}
      >
        {picture.art}
      </pre>
      <figcaption ref={caption} className="launch-art-caption">
        {picture.name}
      </figcaption>
    </figure>
  );
}
