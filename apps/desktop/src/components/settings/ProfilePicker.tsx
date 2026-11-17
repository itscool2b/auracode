import { HardDrive } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProfileMeta } from "../../bindings";
import { errorMessage } from "../../lib/errors";
import { type ProfileApi, profileApi, switchProfile } from "../../lib/profiles";
import "./settings.css";

/**
 * Profiles as X Money rows: an icon, the name, where it lives, and Open or Current. Every profile
 * is on this computer. Most people have one, and then there is nothing to choose: the list shows
 * once the data folder holds a second (an earlier version could keep a workspace as one).
 */
export function ProfilePicker({
  activeId,
  api = profileApi,
  onSwitch = (id: string) => switchProfile(id, "privacy"),
}: {
  readonly activeId: string | null;
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
  // One profile is not a choice.
  if (!error && (!profiles || profiles.length < 2)) return null;
  return (
    <section className="settings-section" aria-labelledby="profile-title">
      <h2 id="profile-title">Profiles</h2>
      <p className="settings-lead">Each profile keeps its own projects, chats and drafts.</p>
      <ul className="settings-group">
        {profiles?.map((profile) => {
          const current = profile.id === activeId;
          return (
            <li className="settings-row" key={profile.id}>
              <div className="settings-row-text">
                <span className="settings-badge" aria-hidden="true">
                  <HardDrive size={16} />
                </span>
                <div>
                  <strong>{profile.display_name}</strong>
                  <p>On this computer{current ? " · Open" : ""}</p>
                </div>
              </div>
              <button
                className="g-button g-button-outline g-button-28"
                type="button"
                disabled={pending !== null || current}
                onClick={() => void choose(profile.id)}
              >
                {pending === profile.id ? "Opening…" : current ? "Current" : "Open"}
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
              className="g-button g-button-28"
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
