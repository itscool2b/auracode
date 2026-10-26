import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AccountVerification } from "../components/settings/AccountVerification";

function Preview() {
  const [token, setToken] = useState("");
  return (
    <main
      className="orbit-theme settings-shell"
      data-theme="dark"
      style={{ display: "block", padding: 32 }}
    >
      <h1>Sign-in verification fixture</h1>
      <AccountVerification onToken={setToken} />
      <button type="button" className="ui-button" disabled={!token}>
        Request sign-in code
      </button>
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
