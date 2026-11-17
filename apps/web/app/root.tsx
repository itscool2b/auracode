import type { ReactNode } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useRouteError,
} from "react-router";
// Geist and Geist Mono, the site's only faces, come with Graphite.
import "@auracode/ui/graphite.css";
import "./styles/index.css";
import { BOOT_SCRIPT, Enhancements } from "./enhance";
import { SiteFooter } from "./footer";
import { SiteHeader } from "./header";

export function Layout({ children }: { children: ReactNode }) {
  // The site follows the system appearance (dark unless the system asks for light), with no
  // switch and nothing stored.
  const path = useLocation().pathname;
  // The remote page is a tool that fills the screen: it has no site header or footer.
  const tool = path === "/remote" || path.startsWith("/remote/");
  return (
    <html lang="en" className="g-root">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark light" />
        {/* The browser's own bars take the page's colour in each appearance. */}
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta property="og:site_name" content="auracode" />
        <meta property="og:image" content="https://auracode.si/og.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="The auracode logo" />
        <meta name="twitter:card" content="summary_large_image" />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed, hashed boot script. */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
        <Meta />
        <Links />
      </head>
      <body>
        <a href="#main" className="skip">
          Skip to content
        </a>
        {tool ? null : <SiteHeader />}
        {children}
        {tool ? null : <SiteFooter />}
        <Enhancements />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main id="main" className="page error-page">
      <div className="frame page-frame">
        <div className="error-panel">
          <h1 className="error-title">
            {missing ? "This page does not exist." : "This page could not load."}{" "}
            <span>{missing ? "It may have moved." : "Your local workspace is unaffected."}</span>
          </h1>
          <div className="error-actions">
            <a className="g-button g-button-primary g-button-44" href="/">
              Go home
            </a>
            {missing ? null : (
              <a className="g-button g-button-outline g-button-44" href="/download">
                Downloads
              </a>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
