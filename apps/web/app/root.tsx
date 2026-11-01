import type { ReactNode } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "react-router";
import "@auracode/ui/graphite.css";
// Instrument Serif, for the accent phrases (Geist comes with Graphite).
import "@auracode/ui/fonts.css";
import "./styles/index.css";
import { BOOT_SCRIPT, Enhancements } from "./enhance";
import { SiteFooter } from "./footer";
import { SiteHeader } from "./header";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" className="g-root">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
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
        <SiteHeader />
        {children}
        <SiteFooter />
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
          {missing ? (
            <p className="error-code" aria-hidden="true">
              404
            </p>
          ) : null}
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
