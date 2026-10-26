export function noticesPlugin(distribution: "desktop" | "web"): {
  name: string;
  generateBundle(this: {
    emitFile(asset: { type: "asset"; fileName: string; source: string }): unknown;
  }): void;
};
