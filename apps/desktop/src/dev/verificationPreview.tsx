import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AccountVerification } from "../components/settings/AccountVerification";

function Preview() {
  const [token, setToken] = useState("");
  return (
    <main className="settings-shell g-root" style={{ display: "block", overflow: "auto" }}>
      <div className="settings-content">
        <header>
          <h1>Sign-in verification fixture</h1>
        </header>
        <AccountVerification onToken={setToken} />
        <button type="button" className="g-button g-button-primary" disabled={!token}>
          Request sign-in code
        </button>
      </div>
    </main>
  );
}
export function mountVerificationPreview(container: HTMLElement) {
  createRoot(container).render(
    <StrictMode>
      <Preview />
    </StrictMode>,
  );
}
