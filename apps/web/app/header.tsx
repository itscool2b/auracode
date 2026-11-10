import { Wordmark } from "@auracode/ui/graphite";
import { useEffect, useRef } from "react";

const SECTIONS = [
  { href: "/#features", text: "Features" },
  { href: "/#agents", text: "Agents" },
  { href: "/#faq", text: "FAQ" },
  { href: "/changelog", text: "Changelog" },
] as const;

/**
 * A plain bar: the wordmark at left, the page's sections in the middle, Sign in and the one
 * Download at right. Clear at the top of a page; scrolling gives it the paper's tone and a
 * hairline. Under 768px the links fold into a menu built on <details>, so it opens without
 * JavaScript too; Download stays in the bar.
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
      node.toggleAttribute("data-scrolled", window.scrollY > 8);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
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
    // A link to a section of this page leaves the menu open otherwise.
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a")) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    details.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      details.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <header className="site-nav" ref={header}>
      <div className="wrap nav-bar">
        <a className="nav-home" href="/" aria-label="auracode home">
          <Wordmark size={17} />
        </a>
        <nav className="nav-links" aria-label="Main">
          {SECTIONS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.text}
            </a>
          ))}
        </nav>
        <div className="nav-end">
          <a className="nav-signin" href="/signin">
            Sign in
          </a>
          <a className="btn btn-ink btn-sm" href="/download">
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
              {SECTIONS.map((link) => (
                <a key={link.href} href={link.href}>
                  {link.text}
                </a>
              ))}
              <a href="/signin">Sign in</a>
              <a href="/account">Account</a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
