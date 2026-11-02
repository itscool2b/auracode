import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProjectMemoryApi } from "../../lib/projectMemory";
import type { SetupApi } from "../../lib/setup";
import { DiffBlock } from "../chat/DiffBlock";
import { ProjectMemoryPanel } from "./ProjectMemoryPanel";

const never = () => new Promise<never>(() => {});
const api: ProjectMemoryApi = {
  read: never,
  save: never,
  accept: never,
  reject: never,
  history: never,
  proposals: never,
  export: never,
  import: never,
  subscribe: () => () => {},
};
const setup: SetupApi = { snapshot: never, apply: never };

describe("the project memory panel", () => {
  it("offers the switch for agents' direct edits, on until the profile says otherwise", () => {
    const html = renderToStaticMarkup(
      <ProjectMemoryPanel projects={[{ id: "one", name: "auracode" }]} api={api} setup={setup} />,
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-label="Let agents edit memory directly"');
    expect(html).toMatch(/role="switch"[^>]*checked=""[^>]*disabled=""|disabled=""[^>]*checked=""/);
    expect(html).toContain("Agents save their edits as new revisions");
    expect(html).toContain("Agents read and edit memory through Aura");
    // The review-only wording is gone.
    expect(html).not.toContain("Only you can accept");
  });
  it("renders without projects or a subscription, and starts no write", () => {
    const save = vi.fn(never);
    const html = renderToStaticMarkup(
      <ProjectMemoryPanel projects={[]} api={{ ...api, save }} setup={setup} />,
    );
    expect(html).toContain("Create a project to keep shared project memory.");
    expect(save).not.toHaveBeenCalled();
  });
});

describe("memory revision diffs", () => {
  it("reuse the production diff without a file path to copy", () => {
    const html = renderToStaticMarkup(
      <DiffBlock
        path="Project memory"
        oldText={"Owner notes\n"}
        newText={"Owner notes\nAgent addition\n"}
        disclosureKey="memory:r2"
        wholeFile
        copyPath={false}
      />,
    );
    expect(html).toContain("Project memory");
    expect(html).toContain('data-test-op="add"');
    expect(html).toContain("Agent addition");
    expect(html).not.toContain("Copy path");
    const file = renderToStaticMarkup(
      <DiffBlock path="src/main.rs" oldText="a" newText="b" disclosureKey="file" />,
    );
    expect(file).toContain("Copy path");
  });
});
