import {
  DitherField,
  type DitherTarget,
  LOGO_PATH,
  LOGO_VIEWBOX,
  Logo,
} from "@auracode/ui/graphite";
import { useRef } from "react";
import { FOOTER_CLEARING, FOOTER_FIELD } from "./fields";
import { useReducedMotion, useScrollValue } from "./motion";

const LOGO: DitherTarget = {
  kind: "path",
  d: LOGO_PATH,
  viewBox: LOGO_VIEWBOX,
  height: 1,
  align: "start",
  anchor: "bottom",
  inset: 0,
  texture: 0.22,
};

/**
 * The giant logo (the AI in Design bar for uniqueness): the dither field resolves into the seal and
 * the turtle as it scrolls in, from 0 as its top enters to 1 once its bottom reaches the viewport's
 * bottom. Without JavaScript it is the plain logo; under reduced motion the formed still frame.
 */
function FooterLogo() {
  const mark = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const progress = useScrollValue(
    mark,
    (rect, viewport) => (viewport - rect.top) / Math.max(1, rect.height - 2),
    { step: 0.004 },
  );
  const formed = reduced || progress >= 1;
  return (
    <div className="footer-mark" ref={mark} aria-hidden="true">
      <Logo className="footer-mark-logo" size={512} />
      <DitherField
        className="footer-mark-field site-field"
        cell={FOOTER_FIELD.cell}
        density={FOOTER_FIELD.density}
        accent={FOOTER_FIELD.accent}
        palette={FOOTER_FIELD.palette}
        seed={FOOTER_FIELD.seed}
        clearing={FOOTER_CLEARING}
        target={LOGO}
        progress={formed ? 1 : progress}
        order="up"
        still={formed}
      />
    </div>
  );
}

/** x.ai's footer: the brand at left, three link columns at right, nothing else. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
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
        <FooterLogo />
      </div>
    </footer>
  );
}
