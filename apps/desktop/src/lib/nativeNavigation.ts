import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { commands } from "../bindings";
import { inTauri } from "./ipc";

/** Rust retains notification navigation while the webview is suspended or reloading. */
export function subscribeNativeNavigation(open: (chatId: string) => void): () => void {
  if (!inTauri()) return () => {};
  let disposed = false;
  let unlisten: UnlistenFn | undefined;
  const consume = () => {
    if (disposed) return;
    void commands
      .shellTakeNavigation()
      .then((id) => {
        if (id) open(id);
      })
      .catch(() => {
        // A closing window cannot accept navigation. Rust owns any subsequent wake request.
      });
  };
  void listen("auracode-open-chat", consume).then((stop) => {
    if (disposed) stop();
    else {
      unlisten = stop;
      consume();
    }
  });
  window.addEventListener("focus", consume);
  return () => {
    disposed = true;
    unlisten?.();
    window.removeEventListener("focus", consume);
  };
}
