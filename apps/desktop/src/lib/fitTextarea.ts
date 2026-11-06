/**
 * Sizes a textarea to its text, between `min` and `max` pixels. It is measured collapsed, which
 * would also collapse everything laid out around it for that moment: a transcript scrolled to its
 * bottom beside the composer then gets its position clamped for the taller view, lands short of
 * the bottom once the box is back, and its follow pulls it down again on the next streamed frame,
 * a flicker on every keystroke. So the box around the field holds its height while it measures.
 * `natural` adds another height the field must fit (dictation's ghost text).
 */
export function fitTextarea(
  field: HTMLTextAreaElement,
  min: number,
  max: number,
  natural: () => number = () => 0,
): void {
  const box = field.parentElement;
  const held = box?.style.height ?? "";
  // The resolved height follows the box's own box-sizing, so writing it back changes nothing.
  if (box) box.style.height = getComputedStyle(box).height;
  field.style.height = "0px";
  const height = Math.max(field.scrollHeight, natural());
  field.style.height = `${Math.min(max, Math.max(min, height))}px`;
  if (box) box.style.height = held;
}
