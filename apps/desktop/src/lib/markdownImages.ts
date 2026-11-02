import { type Inline, parseBlock, parseInline, type SplitCache } from "./markdown";

export interface ImagePathCache {
  readonly source: string;
  readonly stableCount: number;
  readonly stable: ReadonlySet<string>;
  readonly visible: ReadonlySet<string>;
}
export const EMPTY_IMAGE_PATHS: ImagePathCache = {
  source: "",
  stableCount: 0,
  stable: new Set(),
  visible: new Set(),
};

/** Shares the streaming block cache: complete blocks are scanned once, only the tail changes. */
export function imagePathsIncremental(previous: ImagePathCache, split: SplitCache): ImagePathCache {
  const base = split.source.startsWith(previous.source) ? previous : EMPTY_IMAGE_PATHS;
  const stable = new Set(base.stable);
  const scan = (source: string, paths: Set<string>) => {
    const visit = (nodes: readonly Inline[]) => {
      for (const node of nodes) {
        if (paths.size >= 8) return;
        if (node.kind === "image") paths.add(node.path);
        else if ("children" in node) visit(node.children);
      }
    };
    if (paths.size >= 8 || !source.includes("![")) return;
    for (const block of parseBlock(source)) {
      if (block.kind === "paragraph" || block.kind === "heading" || block.kind === "quote")
        visit(parseInline(block.text));
      else if (block.kind === "list") for (const item of block.items) visit(parseInline(item.text));
      else if (block.kind === "table")
        for (const cell of [...block.header, ...block.rows.flat()]) visit(parseInline(cell));
    }
  };
  for (const source of split.stable.slice(base.stableCount)) scan(source, stable);
  const visible = new Set(stable);
  if (split.tail !== null) scan(split.tail, visible);
  const unchanged =
    visible.size === previous.visible.size &&
    [...visible].every((path) => previous.visible.has(path));
  return {
    source: split.source,
    stableCount: split.stable.length,
    stable,
    visible: unchanged ? previous.visible : visible,
  };
}
