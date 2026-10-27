import { useEffect, useRef, useState } from "react";
import {
  VERIFICATION_ORIGIN,
  type VerificationOrigin,
  verificationMessage,
} from "../../lib/accountVerification";

/** Remote verification has no native capabilities. Only a bounded proof crosses this boundary. */
export function AccountVerification({
  onToken,
  origin = VERIFICATION_ORIGIN,
}: {
  readonly onToken: (token: string) => void;
  readonly origin?: VerificationOrigin;
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
    const deadline = setTimeout(() => setPhase("failed"), 30_000);
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
  return (
    <div className="account-verification">
      <iframe
        key={attempt}
        ref={frame}
        src={`${origin}/verify-device`}
        title="Cloudflare sign-in verification"
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        className="account-verification-frame"
      />
      <p role="status">
        {phase === "verified"
          ? "Verification complete."
          : phase === "failed"
            ? "Verification could not load. Check your connection and retry."
            : phase === "loading"
              ? "Loading verification…"
              : "Complete verification above to continue."}
      </p>
      {phase === "failed" || phase === "pending" ? (
        <button
          type="button"
          className="g-button g-button-28"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry verification
        </button>
      ) : null}
    </div>
  );
}
