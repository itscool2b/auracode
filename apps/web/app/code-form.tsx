import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, type Challenge } from "./api";
import { Turnstile } from "./turnstile";
import { Notice } from "./ui";
export function CodeForm({
  mode = "signin",
  csrf,
  initialEmail = "",
  onSuccess,
}: {
  mode?: "signin" | "email";
  csrf?: string;
  initialEmail?: string;
  onSuccess: (email: string) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [token, setToken] = useState("");
  const [challenge, setChallenge] = useState<(Challenge & { started: number }) | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [captcha, setCaptcha] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!challenge) return;
    codeInput.current?.focus();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [challenge]);
  const remaining = challenge
    ? Math.max(0, Math.ceil(challenge.expires_in - (now - challenge.started) / 1000))
    : 0;
  const cooldown = challenge
    ? Math.max(0, Math.ceil(challenge.resend_after - (now - challenge.started) / 1000))
    : 0;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (challenge) {
        await api(
          mode === "signin" ? "/auth/verify" : "/account/email/verify",
          "POST",
          { challenge_id: challenge.challenge_id, code },
          csrf,
        );
        onSuccess(email);
      } else {
        const result = await api<Challenge>(
          mode === "signin" ? "/auth/challenges" : "/account/email/challenges",
          "POST",
          mode === "signin"
            ? { email, turnstile_token: token, client_kind: "browser" }
            : { email, turnstile_token: token },
          csrf,
        );
        setNow(Date.now());
        setChallenge({ ...result, started: Date.now() });
        setToken("");
      }
    } catch (error) {
      setError((error as Error).message);
      if (!challenge) {
        setToken("");
        setCaptcha((v) => v + 1);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="code-form">
      {challenge ? (
        <>
          <label htmlFor="code">Six-digit code</label>
          <p className="field-help">
            Sent to <strong>{email}</strong>. Check your spam folder too.
          </p>
          <input
            ref={codeInput}
            autoComplete="one-time-code"
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            required
            className="code-input"
          />
          <p className="caption">
            {remaining
              ? `Code expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}.`
              : "This code has expired. Request another code."}
          </p>
        </>
      ) : (
        <>
          <label htmlFor="email">{mode === "email" ? "New email address" : "Email address"}</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={254}
          />
          <Turnstile key={captcha} onToken={setToken} />
        </>
      )}
      {error && <Notice error>{error}</Notice>}
      <button
        type="submit"
        className="button full"
        disabled={
          busy || (!challenge && !token) || (!!challenge && (!remaining || code.length !== 6))
        }
      >
        {busy
          ? "Please wait…"
          : challenge
            ? mode === "email"
              ? "Confirm email change"
              : "Verify and sign in"
            : "Send a code"}
        <span aria-hidden="true">↗</span>
      </button>
      {challenge && (
        <button
          type="button"
          className="text-button"
          disabled={busy || cooldown > 0}
          onClick={() => {
            setChallenge(null);
            setCode("");
            setError("");
          }}
        >
          {cooldown ? `Request another code in ${cooldown}s` : "Request another code"}
        </button>
      )}
      <noscript>
        <p>
          JavaScript is required for secure code verification. Downloads and public information work
          without it.
        </p>
      </noscript>
    </form>
  );
}
