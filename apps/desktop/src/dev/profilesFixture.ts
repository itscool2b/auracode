import type { ProfileApi } from "../lib/profiles";

/**
 * One profile, as on a fresh install: Settings' Data & privacy shows no profile list. No native
 * call is made and no profile opens.
 */
export const oneProfile: ProfileApi = {
  list: async () => [{ id: "local", kind: "local", display_name: "Local", created_at: 1 }],
  activate: async () => {
    throw new Error("Synthetic fixture: no profile opens here.");
  },
};
