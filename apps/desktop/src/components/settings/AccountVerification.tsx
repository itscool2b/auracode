import { PixelLoader } from "@auracode/ui/graphite";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  canEmbedVerification,
  VERIFICATION_LOAD_MS,
  VERIFICATION_ORIGIN,
  type VerificationOrigin,
  verificationMessage,
} from "../../lib/accountVerification";

/**
 * Remote verification has no native capabilities. Only a bounded proof crosses this boundary.
 *
 * The site lets only the installed app's origins embed its check, so a build served from anywhere
 * else (the development build at http://localhost:1420) says so at once instead of loading a frame
 * the site refuses; nothing is requested from the site there.
 */
export function AccountVerification({
  onToken,
  origin = VERIFICATION_ORIGIN,
  host = typeof location === "undefined" ? "" : location.origin,
}: {
  readonly onToken: (token: string) => void;
  readonly origin?: VerificationOrigin;
  /** This page's origin; the site embeds its check only in the installed app's. */
  readonly host?: string;
}) {
  if (!canEmbedVerification(host)) return <VerificationUnavailable host={host} origin={origin} />;
  return <VerificationFrame onToken={onToken} origin={origin} />;
}

/** The development build: the reason in one sentence, and no frame. */
function VerificationUnavailable({
  host,
  origin,
}: {
  readonly host: string;
  readonly origin: VerificationOrigin;
}) {
  return (
    <div className="account-verification" data-phase="unavailable">
      <div className="account-verification-status">
        <span className="account-verification-square" aria-hidden="true" />
        <p role="status">
          {`Sign-in verification runs only in the installed app. ${new URL(origin).host} does not let this build (${host || "no origin"}) show its check, so no code can be requested here.`}
        </p>
      </div>
    </div>
  );
}

function VerificationFrame({
  onToken,
  origin,
}: {
  readonly onToken: (token: string) => void;
  readonly origin: VerificationOrigin;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<"loading" | "pending" | "verified" | "failed">("loading");
  useEffect(() => {
    void attempt;
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(24)), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    callback.current("");
    setPhase("loading");
    let expires: ReturnType<typeof setTimeout> | undefined;
    const deadline = setTimeout(() => setPhase("failed"), VERIFICATION_LOAD_MS);
    const receive = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "auracode:verification-ready") {
        clearTimeout(deadline);
        setPhase("pending");
        frame.current?.contentWindow?.postMessage(
          { type: "auracode:verification-init", nonce },
          origin,
        );
        return;
      }
      const result = verificationMessage(event.data, nonce);
      if (!result) return;
      clearTimeout(deadline);
      clearTimeout(expires);
      callback.current(result.token);
      setPhase(result.token ? "verified" : "pending");
      if (result.token)
        expires = setTimeout(() => {
          callback.current("");
          setPhase("pending");
        }, 240_000);
    };
    window.addEventListener("message", receive);
    return () => {
      clearTimeout(deadline);
      clearTimeout(expires);
      window.removeEventListener("message", receive);
      callback.current("");
    };
  }, [attempt, origin]);
  useEffect(() => {
    // A cross-origin frame never matches :focus here, so the ring (3.7) follows the window's blur
    // into the frame instead, and only after a key press, as :focus-visible would.
    let keyboard = false;
    const key = () => {
      keyboard = true;
    };
    const pointer = () => {
      keyboard = false;
    };
    const enter = () => {
      if (keyboard && document.activeElement === frame.current)
        frame.current?.setAttribute("data-focus-visible", "");
    };
    const leave = () => frame.current?.removeAttribute("data-focus-visible");
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", pointer, true);
    window.addEventListener("blur", enter);
    window.addEventListener("focus", leave);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener("blur", enter);
      window.removeEventListener("focus", leave);
    };
  }, []);
  return (
    <div className="account-verification" data-phase={phase}>
      <div className="account-verification-well">
        <iframe
          key={attempt}
          ref={frame}
          src={`${origin}/verify-device`}
          title="Cloudflare sign-in verification"
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          className="account-verification-frame"
        />
      </div>
      <div className="account-verification-status">
        {/* One mark for the phase: the loader while it loads, a check once done, red on failure. */}
        {phase === "loading" ? (
          <PixelLoader size={12} tempo="thinking" />
        ) : phase === "verified" ? (
          <Check size={14} aria-hidden="true" />
        ) : (
          <span className="account-verification-square" aria-hidden="true" />
        )}
        <p role="status">
          {phase === "verified"
            ? "Verification complete."
            : phase === "failed"
              ? "Verification could not load. Check your connection and retry."
              : phase === "loading"
                ? "Loading verification…"
                : "Complete the check above to continue."}
        </p>
        {phase === "failed" || phase === "pending" ? (
          <button
            type="button"
            className="g-button g-button-ghost g-button-24"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry verification
          </button>
        ) : null}
      </div>
    </div>
  );
}
