import { Channel } from "@tauri-apps/api/core";
import { commands, type PluginLibrary } from "../../bindings";
import { settle } from "../ipc";

/** The Plugin library's native calls. Rust decides which CLI commands run and when. */
export interface PluginsApi {
  snapshot(refresh: boolean, onUpdate?: (library: PluginLibrary) => void): Promise<PluginLibrary>;
  setSync(agentId: string, enabled: boolean): Promise<string[]>;
  /** The reviewed vendor update of the detected installation (the Agents page's Update). */
  update(agentId: string): Promise<void>;
}

export const pluginsApi: PluginsApi = {
  snapshot: (refresh, onUpdate = () => {}) => {
    const channel = new Channel<PluginLibrary>();
    channel.onmessage = onUpdate;
    return settle(commands.pluginLibrarySnapshot(refresh, channel));
  },
  setSync: (agentId, enabled) => settle(commands.pluginSyncSet(agentId, enabled)),
  update: async (agentId) => {
    await settle(commands.agentUpdate(agentId));
  },
};
