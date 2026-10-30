import { Wordmark } from "@auracode/ui/graphite";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div className="footer-home">
          <a href="/" aria-label="auracode home">
            <Wordmark size={16} />
          </a>
          <span className="footer-statement">
            Your agents.
            <br />
            Your machine.
          </span>
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
