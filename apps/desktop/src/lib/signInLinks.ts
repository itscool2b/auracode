import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { type AppInfo, commands, type SignInLink } from "../bindings";
import { inTauri } from "./ipc";

export function signInNavigationReady(
  info: Pick<
    AppInfo,
    "profile_locked" | "profile_switching" | "config_profile_recovery" | "fatal" | "launch"
  > | null,
  blocked: boolean,
): boolean {
  return (
    !!info &&
    !blocked &&
    info.launch.type === "normal" &&
    !info.profile_locked &&
    !info.profile_switching &&
    !info.config_profile_recovery &&
    info.fatal === null
  );
}

/** Rust validates links and retains them until a mounted window accepts the navigation. */
export function subscribeSignInLinks(open: (link: SignInLink) => boolean): () => void {
  if (!inTauri()) return () => {};
  let disposed = false;
  let reading = false;
  let again = false;
  let opened: string | undefined;
  let unlisten: UnlistenFn | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const consume = async () => {
    if (disposed) return;
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    clearTimeout(retry);
    try {
      const link = await commands.signInLinkPending();
      if (!disposed && link) {
        if (opened === link.id || open(link)) {
          opened = link.id;
          await commands.signInLinkAcknowledge(link.id);
        } else {
          // An open confirmation or recovery dialog keeps its place until it is dismissed.
          retry = setTimeout(() => void consume(), 500);
        }
      }
    } catch {
      // The native request survives a suspended/reloading window. Focus retries the handshake.
    } finally {
      reading = false;
      if (again && !disposed) {
        again = false;
        void consume();
      }
    }
  };
  const wake = () => void consume();
  void listen("auracode-sign-in-link", wake)
    .then((stop) => {
      if (disposed) stop();
      else {
        unlisten = stop;
        wake();
      }
    })
    .catch(wake);
  window.addEventListener("focus", wake);
  return () => {
    disposed = true;
    clearTimeout(retry);
    unlisten?.();
    window.removeEventListener("focus", wake);
  };
}
