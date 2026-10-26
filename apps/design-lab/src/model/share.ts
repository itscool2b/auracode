/**
 * Structural sharing between two versions of plain data: wherever `next` equals `previous`
 * (deeply), the result reuses `previous`'s object. Arrays line up by index, which suits a
 * transcript, since blocks are only ever appended. Strings, numbers and other primitives compare by
 * value; only plain objects and arrays are walked.
 *
 * The point is React: after a reduction, finished blocks are the very same objects as before, so
 * `React.memo` and `useMemo` skip them and only the streaming block re-renders.
 */
export function shareStructure<T>(previous: unknown, next: T): T {
  return share(previous, next) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function share(previous: unknown, next: unknown): unknown {
  if (Object.is(previous, next)) return previous;

  if (Array.isArray(previous) && Array.isArray(next)) {
    let same = previous.length === next.length;
    const out = next.map((item: unknown, index) => {
      const shared = share(previous[index], item);
      if (shared !== previous[index]) same = false;
      return shared;
    });
    return same ? previous : out;
  }

  if (isPlainObject(previous) && isPlainObject(next)) {
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(previous).length;
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const shared = share(previous[key], next[key]);
      out[key] = shared;
      if (!Object.hasOwn(previous, key) || shared !== previous[key]) same = false;
    }
    return same ? previous : out;
  }

  return next;
}
