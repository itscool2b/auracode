import { LockKeyhole } from "lucide-react";
import type { AppInfo } from "../../bindings";
import { AccountPanel } from "./AccountPanel";
import { ProfilePicker } from "./ProfilePicker";
import "./settings.css";

export function LockedProfile({ info }: { readonly info: AppInfo }) {
  return (
    <div className="locked-profile orbit-theme">
      <div className="chat-drag" data-tauri-drag-region="" />
      <main className="settings-content">
        <header>
          <LockKeyhole size={24} aria-hidden="true" />
          <h1>Your account workspace is locked</h1>
          <p>Unlock this account to open its projects and chats, or open your Local profile.</p>
        </header>
        <ProfilePicker activeId={info.profile?.id ?? null} locked />
        <AccountPanel deviceName={info.device?.name ?? "My computer"} />
      </main>
    </div>
  );
}
