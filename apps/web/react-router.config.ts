import type { Config } from "@react-router/dev/config";
export default {
  ssr: false,
  prerender: ["/", "/download", "/privacy", "/terms", "/changelog", "/remote"],
} satisfies Config;
