/** A visible text fragment, used only while loading an older page into an existing turn. */
export interface ReadingAnchor {
  readonly key: string;
  readonly text: string;
  readonly y: number;
  readonly fromEnd: number;
}

function textY(element: Element, offset: number): number {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (offset < length) {
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      return range.getBoundingClientRect().top;
    }
    offset -= length;
  }
  return element.getBoundingClientRect().top;
}

export function captureReadingAnchor(scroller: HTMLElement): ReadingAnchor | null {
  const viewport = scroller.getBoundingClientRect();
  for (const element of scroller.querySelectorAll<HTMLElement>(
    "[data-row-key] .md-block, [data-row-key] [data-testid=item]",
  )) {
    const bounds = element.getBoundingClientRect();
    if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) continue;
    // Markdown blocks are finer anchors than a message containing many paragraphs.
    if (element.querySelector(".md-block")) continue;
    const row = element.closest<HTMLElement>("[data-row-key]");
    const key = row?.dataset.rowKey;
    if (key && row) {
      const text = element.textContent ?? "";
      const matches = [...row.querySelectorAll(".md-block, [data-testid=item]")].filter(
        (candidate) => !candidate.querySelector(".md-block") && candidate.textContent === text,
      );
      return {
        key,
        text,
        y: textY(element, 0),
        fromEnd: matches.length - matches.indexOf(element) - 1,
      };
    }
  }
  return null;
}

export function readingAnchorOffset(row: HTMLElement, anchor: ReadingAnchor): number | null {
  let matched = 0;
  for (const element of [...row.querySelectorAll(".md-block, [data-testid=item]")].reverse()) {
    if (element.querySelector(".md-block")) continue;
    const text = element.textContent ?? "";
    const offset = text.lastIndexOf(anchor.text);
    if (offset < 0) continue;
    if (matched++ !== anchor.fromEnd) continue;
    return textY(element, offset) - row.getBoundingClientRect().top;
  }
  return null;
}
