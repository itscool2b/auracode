import { gridPath } from "@auracode/ui/graphite";

/* Seven-by-seven pixel glyphs, drawn like the pixel "a": square cells on whole pixels. */
export const GLYPHS = {
  window: ["#######", "#.....#", "#######", "#.....#", "#.....#", "#.....#", "#######"],
  laptop: [".#####.", ".#...#.", ".#...#.", ".#...#.", ".#####.", "#######", "......."],
  home: ["...#...", "..###..", ".#####.", "#######", ".#...#.", ".#.#.#.", ".#.#.#."],
  person: ["..###..", "..###..", "..###..", ".......", ".#####.", "#######", "#######"],
  key: ["..###..", ".#...#.", ".#...#.", "..###..", "...#...", "...##..", "...##.."],
  inbox: ["#######", "#.....#", "#.....#", "###.###", "#..#..#", "#.....#", "#######"],
  bell: ["...#...", "..###..", ".#####.", ".#####.", ".#####.", "#######", "...#..."],
  marks: ["###....", "###....", "###....", ".......", "....###", "....###", "....###"],
} as const;

export type GlyphName = keyof typeof GLYPHS;

export function Glyph({ name, className }: { name: GlyphName; className?: string }) {
  return (
    <svg
      className={className ? `glyph ${className}` : "glyph"}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={gridPath(GLYPHS[name], 2)} />
    </svg>
  );
}
