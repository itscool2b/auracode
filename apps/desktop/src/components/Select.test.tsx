import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { choicesOf, Select, stepChoice, typedChoice } from "./Select";

const options = (
  <>
    <option value="">Choose each time</option>
    <optgroup label="Installed">
      <option value="claude">Claude Code</option>
      <option value="codex" disabled>
        Codex
      </option>
    </optgroup>
    {["pi", "cursor"].map((id) => (
      <option key={id} value={id}>
        {id === "pi" ? "Pi" : "Cursor"}
      </option>
    ))}
  </>
);

describe("the app's dropdown", () => {
  it("reads its choices from the same <option> and <optgroup> children a native select takes", () => {
    expect(choicesOf(options)).toEqual([
      { value: "", label: "Choose each time", disabled: false },
      { value: "claude", label: "Claude Code", disabled: false, group: "Installed" },
      { value: "codex", label: "Codex", disabled: true, group: "Installed" },
      { value: "pi", label: "Pi", disabled: false },
      { value: "cursor", label: "Cursor", disabled: false },
    ]);
    // An option without a value is its label, as in HTML.
    expect(choicesOf(<option>Plain</option>)).toEqual([
      { value: "Plain", label: "Plain", disabled: false },
    ]);
  });

  it("steps over choices that cannot be picked and stops at the ends", () => {
    const choices = choicesOf(options);
    expect(stepChoice(choices, 1, 1)).toBe(3); // over the disabled Codex
    expect(stepChoice(choices, 3, -1)).toBe(1);
    expect(stepChoice(choices, 4, 1)).toBe(4); // the last stays
    expect(stepChoice(choices, -1, 1)).toBe(0); // Home
    expect(stepChoice(choices, choices.length, -1)).toBe(4); // End
  });

  it("finds a choice by its first letters, cycling on a repeated letter, as a native select does", () => {
    const choices = choicesOf(
      <>
        <option value="a">Alpha</option>
        <option value="c1">Cobalt</option>
        <option value="c2">Copper</option>
        <option value="c3">Cyan</option>
      </>,
    );
    expect(typedChoice(choices, 0, "c")).toBe(1);
    expect(typedChoice(choices, 1, "c")).toBe(2);
    expect(typedChoice(choices, 3, "c")).toBe(1); // wraps
    expect(typedChoice(choices, 1, "cop")).toBe(2);
    expect(typedChoice(choices, 0, "z")).toBe(0); // nothing matches: stays
  });

  it("draws a closed field as a combobox showing the chosen label, sized by every label", () => {
    const html = renderToStaticMarkup(
      <Select value="pi" aria-label="Default agent" data-testid="agent" onChange={() => {}}>
        {options}
      </Select>,
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Default agent"');
    expect(html).toContain('data-testid="agent"');
    expect(html).toContain('data-value="pi"');
    expect(html).toContain('<span class="ui-select-value">Pi</span>');
    // The unseen sizer holds every label, so the field keeps the widest one's width, with each
    // choice's value and whether it can be picked.
    expect(html).toContain('<span data-value="">Choose each time</span>');
    expect(html).toContain('<span data-value="claude">Claude Code</span>');
    expect(html).toContain('<span data-value="codex" data-disabled="">Codex</span>');
    expect(html).toContain('<span data-value="cursor">Cursor</span>');
    // Closed, no list is drawn.
    expect(html).not.toContain('role="listbox"');
  });
});
