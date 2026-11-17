/** The production sidebar footer on its own, with a synthetic Settings action only. */
import "../styles.css";
import "../ui-tokens.css";
import "../chat.css";
import "../shell.css";
import { createRoot } from "react-dom/client";
import { SidebarFooter } from "../components/chat/SidebarFooter";

const calls: string[] = [];
Object.assign(window, { sidebarFooterFixture: { calls: () => [...calls] } });

function Fixture() {
  return (
    <main
      className="g-root"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 32,
        padding: 40,
        minHeight: "100vh",
        boxSizing: "border-box",
        background: "var(--g-bg)",
        color: "var(--g-fg-1)",
      }}
    >
      <h1>Sidebar footer</h1>
      <aside
        className="chat-sidebar"
        aria-label="Sidebar"
        style={{ width: 264, height: 160, boxSizing: "border-box", paddingTop: 0 }}
      >
        <div style={{ flex: 1 }} />
        <SidebarFooter onSettings={() => calls.push("settings")} />
      </aside>
    </main>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
