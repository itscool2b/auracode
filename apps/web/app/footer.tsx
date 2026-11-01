import { Wordmark } from "@auracode/ui/graphite";
import type { CSSProperties } from "react";

const GIANT = "auracode";

/**
 * The night footer on every page: the wordmark and the promise, three link columns, and the name
 * set as large as the page allows, its letters rising in once it scrolls into view.
 */
export function SiteFooter() {
  return (
    <footer className="site-footer night">
      <div className="wrap footer-grid">
        <div className="footer-home">
          <a href="/" aria-label="auracode home">
            <Wordmark size={17} />
          </a>
          <p className="footer-statement">
            Your agents.
            <br />
            Your machine.
          </p>
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
      <p className="footer-giant" aria-hidden="true" data-reveal="trigger">
        {Array.from(GIANT).map((letter, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: letters repeat; the position is identity.
          <span key={i} style={{ "--n": i } as CSSProperties}>
            {letter}
          </span>
        ))}
      </p>
    </footer>
  );
}
