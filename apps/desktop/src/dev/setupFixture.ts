/**
 * Development previews only: the profile's setup preferences kept in memory, starting from Rust's
 * defaults. Covers what the Instructions, Project memory and Customize previews change.
 */
import type { GeneralPreferences, SetupSnapshot } from "../bindings";
import { getAppearancePreference } from "../lib/appearance";
import { DEFAULT_GENERAL, type SetupApi } from "../lib/setup";

export function createSetupFixture(): SetupApi & { readonly general: () => GeneralPreferences } {
  const snapshot: SetupSnapshot = {
    cold_start: false,
    notice: null,
    preferences: {
      revision: 0,
      step: "motion",
      motion: "full",
      appearance: getAppearancePreference(),
      completed: true,
      first_project_id: null,
      general: { ...DEFAULT_GENERAL },
    },
  };
  return {
    general: () => snapshot.preferences.general,
    snapshot: async () => structuredClone(snapshot),
    apply: async (revision, action) => {
      if (revision !== snapshot.preferences.revision)
        throw new Error("Preferences changed. Reload and retry.");
      if (action.type === "copy_instructions_to_worktrees")
        snapshot.preferences.general.copy_instructions_to_worktrees = action.enabled;
      if (action.type === "agent_memory_writes")
        snapshot.preferences.general.agent_memory_writes = action.enabled;
      snapshot.preferences.revision++;
      return structuredClone(snapshot);
    },
  };
}
