import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { ProfileMeta } from "../bindings";
import { ProfilePicker } from "../components/settings/ProfilePicker";
import { type ProfileApi, performProfileSwitch } from "../lib/profiles";
import "../components/settings/settings.css";

/** A data folder with a second profile, as an earlier version could leave one. */
const profiles: ProfileMeta[] = [
  { id: "local", kind: "local", display_name: "Local", created_at: 0 },
  { id: "kept", kind: "local", display_name: "Kept workspace", created_at: 1 },
];
const api = { list: async () => profiles } as ProfileApi;
function Preview() {
  const mode = new URLSearchParams(location.search).get("case");
  const [result, setResult] = useState("");
  const [activationCount, setActivationCount] = useState(0);
  return (
    <main className="settings-shell g-root" style={{ display: "block", overflow: "auto" }}>
      <div className="settings-content">
        <h1>Data & privacy</h1>
        <ProfilePicker
          activeId="local"
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
        <p className="settings-footnote" role="status">
          {result || "Current profile preserved"}
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
