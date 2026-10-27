export function noticesPlugin(distribution: "desktop" | "web"): {
  name: string;
  resolveId(id: string): string | null;
  load(id: string): string | null;
  generateBundle(this: {
    emitFile(asset: { type: "asset"; fileName: string; source: string }): unknown;
  }): void;
};
