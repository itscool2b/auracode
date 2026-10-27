import { DitherField, type DitherTarget, Wordmark } from "@auracode/ui/graphite";
import { useRef } from "react";
import { useReducedMotion, useScrollValue } from "./motion";

const WORDMARK: DitherTarget = {
  kind: "text",
  text: "auracode",
  fontSize: "fit",
  fontWeight: 600,
  tracking: -0.06,
  anchor: "bottom",
  inset: 8,
  texture: 0.22,
};

/**
 * The giant edge-to-edge wordmark (the AI in Design bar): the dither field resolves into the word as
 * it scrolls in, from 0 as its top enters to 1 once its bottom reaches the viewport's bottom.
 * Without JavaScript the word is plain text; under reduced motion it is the formed still frame.
 */
function FooterWordmark() {
  const footerMark = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const progress = useScrollValue(
    footerMark,
    (rect, viewport) => (viewport - rect.top) / Math.max(1, rect.height - 2),
    { step: 0.004 },
  );
  const formed = reduced || progress >= 1;
  return (
    <div className="footer-mark" ref={footerMark} aria-hidden="true">
      <span className="footer-mark-text">auracode</span>
      <DitherField
        className="footer-mark-field site-field"
        cell={4}
        density={0.42}
        accent={0.03}
        palette="bright"
        target={WORDMARK}
        progress={formed ? 1 : progress}
        order="up"
        still={formed}
      />
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="frame footer-top">
        <div className="footer-brand">
          <a className="footer-home" href="/" aria-label="auracode home">
            <Wordmark size={16} />
          </a>
          <p>One window for your coding agents.</p>
        </div>
        <nav className="footer-links" aria-label="Footer">
          <div className="footer-col">
            <p className="footer-heading">Product</p>
            <ul>
              <li>
                <a href="/download">Download</a>
              </li>
              <li>
                <a href="/changelog">Changelog</a>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <p className="footer-heading">Account</p>
            <ul>
              <li>
                <a href="/signin">Sign in</a>
              </li>
              <li>
                <a href="/account">Account</a>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <p className="footer-heading">Legal</p>
            <ul>
              <li>
                <a href="/privacy">Privacy</a>
              </li>
              <li>
                <a href="/terms">Terms</a>
              </li>
              <li>
                <a href="/third-party-notices">Notices</a>
              </li>
            </ul>
          </div>
        </nav>
      </div>
      <FooterWordmark />
    </footer>
  );
}
