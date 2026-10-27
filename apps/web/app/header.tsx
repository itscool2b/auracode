import { Wordmark } from "@auracode/ui/graphite";
import { useEffect, useRef } from "react";

/**
 * 64px sticky nav: transparent at the top of the page, solid black with a hairline once the page
 * scrolls. Hovering one link dims its siblings (Harvey). Under 768px the links fold into a menu
 * built on <details>, so it opens without JavaScript too.
 */
export function SiteHeader() {
  const header = useRef<HTMLElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const node = header.current;
    if (!node) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      node.toggleAttribute("data-scrolled", window.scrollY > 2);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    node.toggleAttribute("data-live", true);
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const details = menu.current;
    if (!details) return;
    const close = (restoreFocus: boolean) => {
      if (!details.open) return;
      details.open = false;
      if (restoreFocus) details.querySelector("summary")?.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !details.contains(event.target)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  return (
    <header className="site-nav" ref={header}>
      <div className="nav-inner">
        <a className="nav-home" href="/" aria-label="auracode home">
          <Wordmark size={16} />
        </a>
        <nav className="nav-links g-dim-text" aria-label="Main">
          <a href="/download">Download</a>
          <a href="/changelog">Changelog</a>
        </nav>
        <div className="nav-actions">
          <a className="nav-signin" href="/signin">
            Sign in
          </a>
          <a className="g-button g-button-primary nav-cta" href="/download">
            Download
          </a>
          <details className="nav-menu" ref={menu}>
            <summary className="nav-menu-button">
              <span className="sr-only">Menu</span>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path className="nav-menu-bar" d="M2 5h12" />
                <path className="nav-menu-bar" d="M2 11h12" />
              </svg>
            </summary>
            <nav className="nav-sheet" aria-label="Menu">
              <a href="/download">Download</a>
              <a href="/changelog">Changelog</a>
              <a href="/signin">Sign in</a>
              <a href="/account">Account</a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
