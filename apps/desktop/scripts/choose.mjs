/**
 * Picks a choice in the app's own dropdown (src/components/Select.tsx), as a person does: opens the
 * field, then presses the row. `choice` is a value, or `{ label }` for the row's words, the two
 * forms Playwright's selectOption takes. Native selects are gone from the app (owner, 17 November
 * 2026), so checks call this instead.
 */
export async function choose(field, choice) {
  // Held once: open, the list shares the field's name, so finding the field again by it would
  // match both.
  const handle = await field.elementHandle();
  await handle.click();
  const page = field.page();
  const list = page.locator(`[id="${await handle.getAttribute("aria-controls")}"]`);
  const row =
    typeof choice === "string"
      ? list.locator(`[role="option"][data-value="${choice.replaceAll('"', '\\"')}"]`)
      : list.getByRole("option", { name: choice.label, exact: true });
  await row.click();
}

/** The value a dropdown holds now, as `inputValue()` reads a native select's. */
export async function chosen(field) {
  return (await field.getAttribute("data-value")) ?? "";
}

/** Every choice's words, in order, as a native select's options read; the field need not be open. */
export async function labels(field) {
  return field.locator(".ui-select-sizer > span").allTextContents();
}

/** A choice's words inside the closed field, to wait for a choice to be offered. */
export function offered(field, label) {
  return field.locator(".ui-select-sizer > span", { hasText: label });
}
