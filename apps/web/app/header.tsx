import { Wordmark } from "@auracode/ui/graphite";
import { type CSSProperties, useEffect, useRef, useState } from "react";

/**
 * A floating glass capsule: the wordmark at left, Changelog and Sign in, and the one primary
 * Download. A lit pill glides under whichever link the pointer rests on. Scrolling firms the glass
 * up. Under 768px the links fold into a menu built on <details>, so it opens without JavaScript
 * too; Download stays in the bar.
 */
export function SiteHeader() {
  const header = useRef<HTMLElement>(null);
  const links = useRef<HTMLElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  useEffect(() => {
    const node = header.current;
    if (!node) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      node.toggleAttribute("data-scrolled", window.scrollY > 8);
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

  // Over a night band the capsule turns to dark glass, so it never sits pale on black.
  useEffect(() => {
    const node = header.current;
    const nights = document.querySelectorAll(".night");
    if (!node || nights.length === 0 || typeof IntersectionObserver === "undefined") return;
    const under = new Set<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) under.add(entry.target);
          else under.delete(entry.target);
        }
        node.toggleAttribute("data-night", under.size > 0);
      },
      // A thin band where the capsule floats, near the top of the viewport.
      { rootMargin: "-24px 0px -93% 0px" },
    );
    for (const night of nights) observer.observe(night);
    return () => observer.disconnect();
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

  const point = (target: EventTarget | null) => {
    const nav = links.current;
    if (!nav || !(target instanceof HTMLElement)) return;
    setPill({ x: target.offsetLeft, w: target.offsetWidth });
  };

  return (
    <header className="site-nav" ref={header}>
      <div className="nav-capsule">
        <a className="nav-home" href="/" aria-label="auracode home">
          <Wordmark size={17} />
        </a>
        <nav
          className="nav-links"
          aria-label="Main"
          ref={links}
          data-pill={pill ? "" : undefined}
          style={
            pill
              ? ({ "--pill-x": `${pill.x}px`, "--pill-w": `${pill.w}px` } as CSSProperties)
              : undefined
          }
          onPointerLeave={() => setPill(null)}
          onBlur={() => setPill(null)}
        >
          <span className="nav-pill" aria-hidden="true" />
          <a
            href="/changelog"
            onPointerEnter={(e) => point(e.currentTarget)}
            onFocus={(e) => point(e.currentTarget)}
          >
            Changelog
          </a>
          <a
            href="/signin"
            onPointerEnter={(e) => point(e.currentTarget)}
            onFocus={(e) => point(e.currentTarget)}
          >
            Sign in
          </a>
        </nav>
        <a className="g-button g-button-primary nav-cta" href="/download" data-magnetic="">
          Download
        </a>
        <details className="nav-menu" ref={menu}>
          <summary className="nav-menu-button">
            <span className="sr-only">Menu</span>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path className="nav-menu-bar" d="M2 5.5h12" />
              <path className="nav-menu-bar" d="M2 10.5h12" />
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
    </header>
  );
}
