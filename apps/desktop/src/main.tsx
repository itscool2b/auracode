import "./styles.css";
import "./ui-tokens.css";
import "./chat.css";
import "./orbit-shell.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppStore } from "./lib/chat/appStore";
import { tauriTransport } from "./lib/chat/transport";
import { cancelDemoStream, startDemoStream } from "./lib/ipc";
import { StreamStore } from "./lib/session";
import { WorkspaceStore, workspaceApi } from "./lib/workspace";

const store = new StreamStore({ start: startDemoStream, cancel: cancelDemoStream });
const chats = new AppStore(tauriTransport);
const workspace = new WorkspaceStore(workspaceApi);

const container = document.getElementById("root");
if (container) {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("preview")) {
    void import("./dev/preview").then(({ mountPreview }) => mountPreview(container));
  } else
    createRoot(container).render(
      <StrictMode>
        <ErrorBoundary>
          <App store={store} chats={chats} transport={tauriTransport} workspace={workspace} />
        </ErrorBoundary>
      </StrictMode>,
    );
}
