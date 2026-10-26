import "./styles.css";
import "./ui-tokens.css";
import "./chat.css";
import { getOrbSupport } from "@auracode/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppStore } from "./lib/chat/appStore";
import { tauriTransport } from "./lib/chat/transport";
import { cancelDemoStream, inTauri, startDemoStream } from "./lib/ipc";
import { StreamStore } from "./lib/session";

// Probe WebGL2 and compile the orb shader now, while the window is still hidden, instead of on
// the first orb's render.
if (inTauri()) getOrbSupport();

const store = new StreamStore({ start: startDemoStream, cancel: cancelDemoStream });
const chats = new AppStore(tauriTransport);

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        <App store={store} chats={chats} transport={tauriTransport} />
      </ErrorBoundary>
    </StrictMode>,
  );
}
