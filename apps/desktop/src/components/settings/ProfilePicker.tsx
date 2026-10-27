import { Cloud, HardDrive, LockKeyhole } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProfileMeta } from "../../bindings";
import { errorMessage } from "../../lib/errors";
import { type ProfileApi, profileApi, switchProfile } from "../../lib/profiles";
import "./settings.css";
import "./account.css";

export function ProfilePicker({
  activeId,
  locked = false,
  api = profileApi,
  onSwitch = switchProfile,
}: {
  readonly activeId: string | null;
  readonly locked?: boolean;
  readonly api?: ProfileApi;
  readonly onSwitch?: (id: string) => Promise<void>;
}) {
  const [profiles, setProfiles] = useState<ProfileMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const acting = useRef(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    void attempt;
    let live = true;
    setError(null);
    void api.list().then(
      (value) => {
        if (live) setProfiles(value);
      },
      (failure) => {
        if (live) setError(errorMessage(failure));
      },
    );
    return () => {
      live = false;
    };
  }, [api, attempt]);
  const choose = async (id: string) => {
    if (acting.current) return;
    acting.current = true;
    setPending(id);
    setError(null);
    try {
      await onSwitch(id);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      acting.current = false;
      setPending(null);
    }
  };
  return (
    <section className="settings-section" aria-labelledby="profile-title">
      <h2 id="profile-title">Your profiles</h2>
      <p className="account-notice">
        Each profile has its own projects, chats and drafts. Local is free and stays on this
        computer. Cloud profiles require an invitation during private preview.
      </p>
      {!profiles && !error ? (
        <p role="status" className="settings-footnote">
          Loading profiles…
        </p>
      ) : null}
      <ul className="account-profiles">
        {profiles?.map((profile) => {
          const current = profile.id === activeId;
          const Icon =
            current && locked ? LockKeyhole : profile.kind === "local" ? HardDrive : Cloud;
          return (
            <li key={profile.id}>
              <Icon size={16} aria-hidden="true" />
              <div>
                <strong>{profile.display_name}</strong>
                <p>
                  {profile.kind === "local" ? "On this computer" : "Encrypted account workspace"}
                  {current ? (locked ? " · Locked" : " · Open") : ""}
                </p>
              </div>
              <button
                className="g-button g-button-outline g-button-28"
                type="button"
                disabled={pending !== null || (current && !locked)}
                onClick={() => void choose(profile.id)}
              >
                {pending === profile.id ? "Opening…" : current && !locked ? "Current" : "Open"}
                <span className="sr-only"> {profile.display_name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {error ? (
        <div className="settings-error" role="alert">
          <p>{error}</p>
          {!profiles ? (
            <button
              className="g-button"
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
