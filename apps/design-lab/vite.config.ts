import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** The lab's own port. 1420 belongs to the desktop app's dev server and is never used here. */
export const DEFAULT_PORT = 5180;

/**
 * The port this process was asked for (`--port <n>` or `--port=<n>`), so every dev server keeps its
 * own dependency cache. Three designers run three dev servers in this one package; sharing Vite's
 * pre-bundle cache would let one server's re-optimisation clobber another's mid-request.
 */
function requestedPort(argv: readonly string[]): string {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--port") return argv[index + 1] ?? String(DEFAULT_PORT);
    if (arg.startsWith("--port=")) return arg.slice("--port=".length);
  }
  return String(DEFAULT_PORT);
}

export default defineConfig({
  // Relative asset URLs, so the built lab (dist/) works from any folder on any static host. Routing
  // lives in the hash, so no server rewrites are needed either. The dev server still serves at "/".
  base: "./",
  plugins: [react(), tailwindcss()],
  cacheDir: `node_modules/.vite/port-${requestedPort(process.argv).replace(/\D/g, "") || "default"}`,
  server: { port: DEFAULT_PORT, strictPort: true },
  preview: { port: DEFAULT_PORT, strictPort: true },
  build: {
    // The engines the real app runs in: WKWebView first (Safari 16.4 is the desktop app's floor too),
    // and a recent Chromium for WebView2.
    target: ["safari16.4", "chrome130"],
    // The lab is a review tool: readable stack traces beat a smaller bundle.
    sourcemap: true,
  },
});
