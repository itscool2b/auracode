/** Synthetic review data only. No vault, account identifier or credential is accessed. */
import type { DataCleanupReview } from "../bindings";

// Canonical-looking opaque names, deliberately unrelated to any real service entry.
const target = (letter: string) => `auracode.sync.v1:${letter.repeat(42)}A`;

export function syntheticCleanupKeys(
  uncertain = false,
): Pick<DataCleanupReview, "keys" | "warnings"> {
  const keys: DataCleanupReview["keys"] = [
    {
      target: target("A"),
      kind: "Index",
      remove: !uncertain,
      reason: uncertain
        ? "Reference discovery is uncertain; retain index for retry"
        : "Index belongs to a deleted root",
    },
    {
      target: target("B"),
      kind: "Account",
      remove: !uncertain,
      reason: uncertain
        ? "Reference discovery is uncertain"
        : "Exclusively referenced by deleted roots",
    },
    {
      target: target("C"),
      kind: "Index",
      remove: false,
      reason: "Index belongs to another data root",
    },
    {
      target: target("D"),
      kind: "Account",
      remove: false,
      reason: uncertain ? "Reference discovery is uncertain" : "Referenced by another data root",
    },
    {
      target: target("E"),
      kind: "Account",
      remove: !uncertain,
      reason: uncertain
        ? "Reference discovery is uncertain"
        : "Unreferenced account bundle; default root is deleted",
    },
  ];
  if (uncertain) {
    keys.push({
      target: target("F"),
      kind: "Unknown",
      remove: false,
      reason: "Unreadable, malformed or unsupported payload",
    });
  }
  return {
    keys,
    warnings: uncertain
      ? [
          "Some secure-store entries or root identities could not be verified. All account keys and retry indexes are retained.",
        ]
      : [],
  };
}
