import { defineConfig } from "vitest/config";

// Node environment on purpose: the tests cover the fixture, the transcript reducer, the player and
// the URL scheme, all pure logic, plus server-rendered markup. What the directions look like is
// checked in real engines by scripts/shoot.mjs (WebKit and Chromium).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
