import { defineConfig } from "vitest/config";

// Node environment on purpose: everything under test here is pure logic or React rendered to a
// string. WebGL and layout behaviour is verified in a real engine (Playwright), not a DOM shim.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // Vitest blanks CSS imports unless told otherwise; the token tests read stylesheets as text.
    css: { include: [/\.css\?raw$/] },
  },
});
