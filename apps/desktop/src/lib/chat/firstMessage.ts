/**
 * New chat's first message on its way to the chat it made (type first, owner, 17 November 2026).
 * New chat holds the words as it creates the chat; the chat's view takes them once, as it opens,
 * and sends them as its message box would. Held in memory only: they are the person's words in a
 * box they just saw, never a record.
 */
const held = new Map<string, string>();

/** Holds `text` for `chatId` until its view takes it; blank words hold nothing. */
export function holdFirstMessage(chatId: string, text: string): void {
  if (text.trim() !== "") held.set(chatId, text);
}

/** The words held for `chatId`, once: a second call answers null. */
export function takeFirstMessage(chatId: string): string | null {
  const text = held.get(chatId) ?? null;
  held.delete(chatId);
  return text;
}
