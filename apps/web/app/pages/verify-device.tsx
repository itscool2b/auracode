import { useCallback, useEffect, useRef, useState } from "react";
import { Turnstile } from "../turnstile";

const APP_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
]);
export const meta = () => [
  { title: "Verify sign-in | auracode" },
  { name: "robots", content: "noindex, nofollow" },
];

/** This page only hosts verification. It cannot call the desktop's native command bridge. */
export default function VerifyDevice() {
  const parent = useRef<{ nonce: string; origin: string } | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (window.parent === window) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || !APP_ORIGINS.has(event.origin)) return;
      const data = event.data;
      if (
        data?.type !== "auracode:verification-init" ||
        typeof data.nonce !== "string" ||
        !/^[a-f0-9]{48}$/.test(data.nonce)
      )
        return;
      if (parent.current && parent.current.nonce !== data.nonce) return;
      parent.current = { nonce: data.nonce, origin: event.origin };
      setConnected(true);
    };
    window.addEventListener("message", receive);
    // No token or identifier is sent before the parent proves its allowed origin and attempt.
    window.parent.postMessage({ type: "auracode:verification-ready" }, "*");
    return () => {
      window.removeEventListener("message", receive);
      parent.current = null;
    };
  }, []);
  const onToken = useCallback((token: string) => {
    const target = parent.current;
    if (target)
      window.parent.postMessage(
        { type: "auracode:verification-token", nonce: target.nonce, token },
        target.origin,
      );
  }, []);
  return (
    <main id="main" className="device-verification" aria-label="Sign-in verification">
      <h1>Verify your sign-in</h1>
      {connected ? <Turnstile onToken={onToken} /> : <p>Continue from the auracode desktop app.</p>}
    </main>
  );
}
