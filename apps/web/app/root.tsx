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
import "./site.css";
import { Mark } from "./ui";
export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#000000" />
        <Meta />
        <Links />
      </head>
      <body>
        <a href="#main" className="skip">
          Skip to content
        </a>
        <header className="nav">
          <a className="wordmark" href="/" aria-label="auracode home">
            <Mark />
            auracode
          </a>
          <nav aria-label="Main">
            <a href="/download">Download</a>
            <a href="/changelog">Changelog</a>
          </nav>
          <div className="nav-actions">
            <a href="/signin">Sign in</a>
            <a className="button small" href="/download">
              Get auracode <span aria-hidden="true">↗</span>
            </a>
          </div>
        </header>
        {children}
        <footer className="footer">
          <a className="wordmark" href="/">
            <Mark />
            auracode
          </a>
          <p>Your agents. Your machine.</p>
          <nav aria-label="Footer">
            <a href="/account">Account</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/third-party-notices">Notices</a>
          </nav>
          <span className="mono">LOCAL BY DEFAULT</span>
        </footer>
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
  return (
    <main id="main" className="page narrow">
      <p className="eyebrow">
        {isRouteErrorResponse(error) && error.status === 404 ? "404" : "CONNECTION INTERRUPTED"}
      </p>
      <h1>This page isn’t here.</h1>
      <p>Return home or try again. Your local workspace is unaffected.</p>
      <a className="button" href="/">
        Go home
      </a>
    </main>
  );
}
