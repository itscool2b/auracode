import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { ProfileMeta } from "../bindings";
import { ProfilePicker } from "../components/settings/ProfilePicker";
import { type ProfileApi, performProfileSwitch } from "../lib/profiles";
import "../components/settings/settings.css";

const profiles: ProfileMeta[] = [
  { id: "local", kind: "local", display_name: "Local", created_at: 0 },
  { id: "account", kind: "account", display_name: "Account", created_at: 0 },
];
const api = { list: async () => profiles } as ProfileApi;
function Preview() {
  const mode = new URLSearchParams(location.search).get("case");
  const [result, setResult] = useState("");
  const [activationCount, setActivationCount] = useState(0);
  return (
    <main
      className="settings-shell orbit-theme"
      style={{ display: "block", padding: "60px", overflow: "auto" }}
    >
      <div className="settings-content" style={{ maxWidth: 640, margin: "0 auto" }}>
        <header>
          <h1>{mode === "locked" ? "Your account workspace is locked" : "Account"}</h1>
          <p>Open your encrypted workspace or continue with Local.</p>
        </header>
        <ProfilePicker
          activeId={mode === "locked" ? "account" : "local"}
          locked={mode === "locked"}
          api={api}
          onSwitch={(id) =>
            performProfileSwitch(
              async () => {
                setActivationCount((value) => value + 1);
                if (mode === "busy")
                  throw new Error("Finish your active chat before switching profiles.");
                setResult(`Opened ${id}`);
              },
              async () => mode !== "unsaved",
              () => setResult((value) => `${value}; old page discarded`),
            )
          }
        />
        <p className="account-notice" role="status">
          {result || "Current workspace preserved"}
        </p>
        <output aria-label="Activation count" hidden>
          {activationCount}
        </output>
      </div>
    </main>
  );
}
export function mountProfilesPreview(container: HTMLElement) {
  createRoot(container).render(<Preview />);
}
