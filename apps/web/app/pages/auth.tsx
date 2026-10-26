import { useEffect, useState } from "react";
import { CodeForm } from "../code-form";
import { Mark } from "../ui";
export const meta = () => [{ title: "Sign in · auracode" }, { name: "robots", content: "noindex" }];
export function AuthPage({ signup = false }: { signup?: boolean }) {
  const [email, setEmail] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<string | null>(null);
  useEffect(() => {
    setPrefill(new URLSearchParams(location.search).get("email")?.slice(0, 254) ?? "");
  }, []);
  return (
    <main id="main" className="auth-page">
      <section className="auth-intro">
        <Mark />
        <p className="eyebrow">YOUR WORK, WITH YOU</p>
        <h1>{signup ? "A home for your workspace." : "Pick up where you left off."}</h1>
        <p>
          Sign in for optional encrypted sync and device management. Local work always stays
          available without an account.
        </p>
        <a className="text-link" href="/download">
          Just here for the app? Download ↗
        </a>
      </section>
      <section className="auth-panel" aria-label={signup ? "Create account" : "Sign in"}>
        <noscript>
          <p>
            JavaScript is required for secure code verification. Downloads and public information
            work without it.
          </p>
        </noscript>
        {email ? (
          <>
            <p className="eyebrow">VERIFIED</p>
            <h2>You’re signed in.</h2>
            <p>
              Open auracode to connect this device and set up encryption. This link shares only your
              email address.
            </p>
            <div className="stack">
              <a className="button" href={`auracode://signin?email=${encodeURIComponent(email)}`}>
                Open auracode ↗
              </a>
              <a className="button secondary" href="/account">
                Manage your account
              </a>
              <a className="text-link" href="/download">
                Download auracode
              </a>
            </div>
          </>
        ) : (
          <>
            <h2>{signup ? "Create your account" : "Welcome back"}</h2>
            <p>We’ll email you a one-time code. No password to remember.</p>
            {prefill !== null ? (
              <CodeForm initialEmail={prefill} onSuccess={setEmail} />
            ) : (
              <p role="status">Preparing sign-in…</p>
            )}
            <p className="caption">
              By continuing, you agree to the <a href="/terms">Terms</a> and acknowledge the{" "}
              <a href="/privacy">Privacy notice</a>.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
export default function SignIn() {
  return <AuthPage />;
}
