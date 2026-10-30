import { useEffect, useRef, useState } from "react";
import { api } from "./api";

interface TurnstileApi {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      theme: "light" | "dark";
      action: "signin";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}
let loader: Promise<void> | undefined;
function load() {
  if (window.turnstile) return Promise.resolve();
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    const failed = () => {
      clearTimeout(timer);
      script.remove();
      loader = undefined;
      reject(new Error("Verification could not load. Check your connection and retry."));
    };
    const timer = setTimeout(failed, 20000);
    script.onload = () => {
      clearTimeout(timer);
      if (window.turnstile) resolve();
      else failed();
    };
    script.onerror = failed;
    document.head.append(script);
  });
  return loader;
}
export function Turnstile({ onToken }: { onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry deliberately remounts the remote widget.
  useEffect(() => {
    let active = true;
    let id: string | undefined;
    setError("");
    callback.current("");
    void api<{ turnstile_site_key: string | null }>("/config")
      .then(async (config) => {
        if (!config.turnstile_site_key)
          throw new Error(
            "Account sign-in is not available yet. You can use auracode locally without an account.",
          );
        await load();
        if (active && container.current && window.turnstile)
          id = window.turnstile.render(container.current, {
            sitekey: config.turnstile_site_key,
            theme: "light",
            action: "signin",
            callback: (token) => callback.current(token),
            "expired-callback": () => callback.current(""),
            "error-callback": () => {
              callback.current("");
              setError("Verification expired or failed. Try again.");
            },
          });
      })
      .catch((error: Error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
      if (id) window.turnstile?.remove(id);
    };
  }, [attempt]);
  return (
    <div className="verification">
      <div ref={container} />
      {error && (
        <p role="alert">
          {error}{" "}
          <button className="text-button" type="button" onClick={() => setAttempt((v) => v + 1)}>
            Retry
          </button>
        </p>
      )}
    </div>
  );
}
