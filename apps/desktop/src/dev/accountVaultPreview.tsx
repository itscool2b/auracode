import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AccountVault } from "../components/settings/AccountVault";
import type { AccountVaultApi } from "../lib/account/vault";
import "../styles.css";
import "../ui-tokens.css";
import "../chat.css";
import "../shell.css";
import "../components/settings/settings.css";
import "../components/settings/account.css";

const mode = new URLSearchParams(location.search).get("mode");
function Preview() {
  const [calls, setCalls] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const [api] = useState<AccountVaultApi>(() => ({
    status: async () => ({
      mode: mode === "create" ? "native" : "passphrase_locked",
      can_create: mode === "create",
    }),
    unlock: async (passphrase, create) => {
      setCalls((value) => value + 1);
      if (passphrase !== "synthetic correct passphrase")
        throw new Error("The passphrase is incorrect. Saved ciphertext was preserved.");
      return { mode: create ? "restart_required" : "passphrase_unlocked", can_create: false };
    },
  }));
  return (
    <main
      className="orbit-theme settings-shell"
      data-theme="dark"
      style={{ display: "block", padding: "48px", overflow: "auto" }}
    >
      <div className="account-panel">
        <h1>Secure account storage</h1>
        <h2>Your account</h2>
        <AccountVault api={api} onUnlocked={() => setUnlocked(true)} />
        <output aria-label="Vault writes">{calls}</output>
        {unlocked ? <p role="status">Account access can continue</p> : null}
      </div>
    </main>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Preview />);
