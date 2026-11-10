import { Wordmark } from "@auracode/ui/graphite";

/**
 * The footer on every page: the wordmark with what it stands for, then three columns of links,
 * under the page's last hairline.
 */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div className="footer-home">
          <a href="/" aria-label="auracode home">
            <Wordmark size={17} />
          </a>
          <p className="footer-statement">Your agents. Your machine.</p>
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
    </footer>
  );
}
