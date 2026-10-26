/** Synthetic recovery only. This entry never opens a native account or configuration store. */
import "../styles.css";
import "../ui-tokens.css";
import "../chat.css";
import "../orbit-shell.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppInfo, ConfigProfileRecovery } from "../bindings";
import { ConfigurationRecovery } from "../components/settings/ConfigurationRecovery";

function Preview() {
  const mode = new URLSearchParams(location.search).get("case");
  const [calls, setCalls] = useState(0);
  const [done, setDone] = useState(false);
  const recovery: ConfigProfileRecovery = {
    transaction: "fixture",
    owner_profile: "account",
    from_profile: "local",
    to_profile: "account",
    phase:
      mode === "unavailable"
        ? "unavailable"
        : mode === "finish"
          ? "finish_switch"
          : "restore_previous",
    detail:
      "A configuration switch was interrupted. Restore the previous profile's managed configuration before continuing.",
  };
  return done ? (
    <main className="orbit-theme settings-content">
      <h1>Recovery confirmed</h1>
    </main>
  ) : (
    <>
      <ConfigurationRecovery
        recovery={recovery}
        locked={mode === "locked"}
        onRecovered={() => setDone(true)}
        recoverConfiguration={async () => {
          setCalls((value) => value + 1);
          await new Promise((resolve) => setTimeout(resolve, 150));
          if (mode === "conflict")
            throw new Error("A managed setting changed. Existing files were preserved.");
          return { config_profile_recovery: null } as AppInfo;
        }}
      />
      <output aria-label="Recovery calls" hidden>
        {calls}
      </output>
    </>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Preview />);
