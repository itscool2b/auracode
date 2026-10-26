import type { LabEvent, TimedEvent } from "./types";

/**
 * Helpers that turn an authored script ("this thought streams from 1.6 s to 7.6 s") into timed
 * events the way a real stream arrives: text in small uneven deltas, at a steady overall rate.
 * Everything is deterministic (seeded), so the same fixture always produces the same frames.
 */

/** A small seeded PRNG (mulberry32): the same seed always gives the same sequence. */
export function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Splits text into stream deltas of roughly `minChars` to `maxChars` characters, breaking after
 * whitespace where it can, the way token batches arrive. Joining the chunks gives the text back.
 */
export function chunkText(text: string, seed: string, minChars = 6, maxChars = 18): string[] {
  const random = seededRandom(seed);
  // Words with the whitespace after them; leading whitespace stays with the first word.
  const words = text.match(/\s*\S+\s*/g) ?? (text === "" ? [] : [text]);
  const chunks: string[] = [];
  let current = "";
  let target = minChars + Math.floor(random() * (maxChars - minChars + 1));
  for (const word of words) {
    if (current !== "" && current.length + word.length > target) {
      chunks.push(current);
      current = "";
      target = minChars + Math.floor(random() * (maxChars - minChars + 1));
    }
    current += word;
  }
  if (current !== "") chunks.push(current);
  return chunks;
}

export class TimelineBuilder {
  readonly #events: TimedEvent[] = [];

  /** Adds one event at `at` seconds. */
  at(seconds: number, event: LabEvent): this {
    this.#events.push({ at: Math.round(seconds * 1000), event });
    return this;
  }

  /**
   * Streams `text` as deltas from `start` to `end` seconds at a steady character rate, with a
   * little seeded jitter between deltas. The first delta lands at `start`, the last at `end`.
   */
  stream(
    start: number,
    end: number,
    text: string,
    seed: string,
    toEvent: (delta: string) => LabEvent,
  ): this {
    const chunks = chunkText(text, seed);
    const random = seededRandom(`${seed}:time`);
    const startMs = start * 1000;
    const endMs = startMs + Math.max(0, (end - start) * 1000);
    const step = chunks.length > 1 ? (endMs - startMs) / (chunks.length - 1) : 0;
    // The last delta starts once everything before it has been sent.
    const beforeLast = Math.max(1, text.length - (chunks[chunks.length - 1]?.length ?? 0));
    let sent = 0;
    let previous = Math.round(startMs);
    chunks.forEach((chunk, index) => {
      const last = index === chunks.length - 1;
      // Proportional to the characters already sent, nudged by up to a third of a step.
      const ideal = startMs + Math.min(1, sent / beforeLast) * (endMs - startMs);
      const nudge = index === 0 || last ? 0 : (random() - 0.5) * (step / 1.5);
      const time =
        index === 0 ? startMs : last ? endMs : Math.min(endMs, Math.max(previous, ideal + nudge));
      previous = Math.round(time);
      this.#events.push({ at: previous, event: toEvent(chunk) });
      sent += chunk.length;
    });
    return this;
  }

  /** The events in time order; events at the same time keep the order they were added in. */
  build(): TimedEvent[] {
    return this.#events
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => a.entry.at - b.entry.at || a.index - b.index)
      .map(({ entry }) => entry);
  }
}
