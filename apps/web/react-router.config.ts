import type { Config } from "@react-router/dev/config";
export default {
  ssr: false,
  prerender: [
    "/",
    "/download",
    "/signin",
    "/signup",
    "/verify-device",
    "/account",
    "/privacy",
    "/terms",
    "/changelog",
  ],
} satisfies Config;
