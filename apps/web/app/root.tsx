import { DitherField, type DitherTarget } from "@auracode/ui/graphite";
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
import "@auracode/ui/fonts.css";
import "@auracode/ui/graphite.css";
import "./site.css";
import { BOOT_SCRIPT, Enhancements } from "./enhance";
import { SiteFooter } from "./footer";
import { SiteHeader } from "./header";
import { useReducedMotion } from "./motion";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className="g-root" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#000000" />
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

const NOT_FOUND: DitherTarget = {
  kind: "text",
  text: "404",
  fontSize: "fit",
  fontWeight: 600,
  tracking: -0.06,
  anchor: "bottom",
  inset: 4,
  texture: 0.2,
};

export function ErrorBoundary() {
  const error = useRouteError();
  const reduced = useReducedMotion();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main id="main" className="page error-page">
      <div className="frame page-frame">
        <div className="error-column">
          {missing ? (
            <DitherField
              className="error-field site-field"
              cell={4}
              density={0.4}
              palette="bright"
              target={NOT_FOUND}
              progress={1}
              still={reduced}
            />
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
