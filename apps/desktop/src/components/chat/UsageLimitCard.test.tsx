import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UsageLimitCard } from "./UsageLimitCard";

const limit = {
  message: "You've hit your 5-hour limit · resets 5:30pm (America/New_York)",
  resets_at: 1_793_572_200_000,
};

describe("the usage-limit card", () => {
  it("shows the agent's own words once, without a second reset time", () => {
    const html = renderToStaticMarkup(
      <UsageLimitCard
        limit={limit}
        chatId="c1"
        agentId="claude"
        agentName="Claude Code"
        accountId={null}
      />,
    );
    expect(html).toContain("You&#x27;ve hit your 5-hour limit · resets 5:30pm (America/New_York)");
    expect(html).not.toContain("Resets at");
    expect(html).toContain("Send it again once the limit resets.");
    expect(html).not.toContain("Continue with");
  });

  it("says when the limit resets when the agent's words do not", () => {
    const html = renderToStaticMarkup(
      <UsageLimitCard
        limit={{ message: "Usage limit reached.", resets_at: limit.resets_at }}
        chatId="c1"
        agentId="claude"
        agentName="Claude Code"
        accountId={null}
      />,
    );
    expect(html).toContain("Resets ");
  });
});
