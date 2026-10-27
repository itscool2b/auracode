import { useEffect, useState } from "react";
import { CodeForm } from "../code-form";
import { Arrow } from "../ui";

export const meta = () => [{ title: "Sign in · auracode" }, { name: "robots", content: "noindex" }];

export function AuthPage({ signup = false }: { signup?: boolean }) {
  const [email, setEmail] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<string | null>(null);
  useEffect(() => {
    setPrefill(new URLSearchParams(location.search).get("email")?.slice(0, 254) ?? "");
  }, []);
  return (
    <main id="main" className="page">
      <div className="frame">
        <div className="auth-column">
          <div className="auth-shell">
            <header className="auth-head" data-reveal="">
              <h1 className="auth-title">
                {signup ? "Your invitation." : "Sign in."}{" "}
                <span>{signup ? "Starts here." : "With a one-time code."}</span>
              </h1>
              <p className="auth-intro">
                <strong>
                  Cloud accounts, encrypted sync and transfers are invite-only during the private
                  preview.
                </strong>{" "}
                The{" "}
                <a className="auth-inline-link" href="/download">
                  Local desktop app
                </a>{" "}
                is free and works offline without an account.
              </p>
            </header>
            <section className="auth-panel" aria-labelledby="auth-panel-title">
              <noscript>
                <p className="note">
                  JavaScript is required for secure code verification. Downloads and public
                  information work without it.
                </p>
              </noscript>
              {email ? (
                <>
                  <div>
                    <h2 className="auth-panel-title" id="auth-panel-title">
                      You’re signed in.
                    </h2>
                    <p className="auth-panel-copy">
                      Open auracode to connect this device and set up encryption. This link shares
                      only your email address.
                    </p>
                  </div>
                  <div className="auth-actions">
                    <a
                      className="g-button g-button-primary g-button-44"
                      href={`auracode://signin?email=${encodeURIComponent(email)}`}
                    >
                      Open auracode
                    </a>
                    <a className="g-button g-button-outline g-button-44" href="/account">
                      Manage your account
                    </a>
                  </div>
                  <div className="auth-links">
                    <a className="text-link" href="/download">
                      Download auracode <Arrow />
                    </a>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <h2 className="auth-panel-title" id="auth-panel-title">
                      Invited sign-in
                    </h2>
                    <p className="auth-panel-copy">
                      Use the email address on your invitation. We’ll send a one-time code.
                    </p>
                  </div>
                  {prefill !== null ? (
                    <CodeForm initialEmail={prefill} onSuccess={setEmail} />
                  ) : (
                    <p className="note" role="status">
                      Preparing sign-in…
                    </p>
                  )}
                  <p className="auth-terms">
                    Already have an account? You can still sign in to manage or export it if your
                    cloud preview access has ended. By continuing, you agree to the{" "}
                    <a href="/terms">Terms</a> and acknowledge the{" "}
                    <a href="/privacy">Privacy notice</a>.
                  </p>
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function SignIn() {
  return <AuthPage />;
}
