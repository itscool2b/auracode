/**
 * Telling the shell the page has painted, so it can show the (hidden) window.
 *
 * Two animation frames after a commit means the frame with that content has been produced. A
 * hidden window may never run animation frames, though (WebKit pauses them while a view is not
 * visible), so a timer stands in after `fallbackMs`: by then the content is laid out and the
 * compositor shows it on the first visible frame.
 */

export function afterPaint(fallbackMs = 250): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, fallbackMs);
    requestAnimationFrame(() => requestAnimationFrame(finish));
  });
}

/** Waits for the bundled fonts, at most `maxMs`, so the window never opens on a font swap. */
export function fontsSettled(maxMs = 400): Promise<void> {
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  if (!fonts) return Promise.resolve();
  return Promise.race([
    fonts.ready.then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, maxMs)),
  ]);
}

/** Fonts, then a painted frame, then `notify` (the `window_ready` command). Runs `notify` once. */
export async function whenPainted(notify: () => Promise<void>): Promise<void> {
  await fontsSettled();
  await afterPaint();
  await notify();
}
