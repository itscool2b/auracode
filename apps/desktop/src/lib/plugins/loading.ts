import type { PluginLibrary } from "../../bindings";
import type { PluginsApi } from "./api";

/** Renderer request lifetime only. Rust owns refresh scheduling and retained inventory. */
export class PluginLibraryLoader {
  private generation = 0;

  cancel() {
    this.generation += 1;
  }

  async load(
    api: PluginsApi,
    refresh: boolean,
    callbacks: {
      value: (library: PluginLibrary) => void;
      error: (reason: unknown) => void;
      done: () => void;
    },
  ) {
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    const value = (library: PluginLibrary) => {
      if (current()) callbacks.value(library);
    };
    try {
      value(await api.snapshot(refresh, value));
    } catch (reason) {
      if (current()) callbacks.error(reason);
    } finally {
      if (current()) callbacks.done();
    }
  }
}
