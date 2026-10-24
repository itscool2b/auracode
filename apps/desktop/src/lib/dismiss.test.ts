import { describe, expect, it } from "vitest";
import { type DismissState, dismiss, SHOWN } from "./dismiss";
import { CommandError } from "./ipc";

describe("dismiss", () => {
  it("starts out shown, with no problem", () => {
    expect(SHOWN).toEqual({ status: "shown", problem: null });
  });

  it("hides the notice only once the shell confirms", async () => {
    const states: DismissState[] = [];
    let confirm = (): void => {};
    const confirmed = new Promise<void>((resolve) => {
      confirm = resolve;
    });
    const done = dismiss(
      () => confirmed,
      (state) => states.push(state),
    );
    expect(states).toEqual([{ status: "dismissing" }]);
    confirm();
    await done;
    expect(states).toEqual([{ status: "dismissing" }, { status: "dismissed" }]);
  });

  it("keeps the notice, with the reason, when the shell fails", async () => {
    const states: DismissState[] = [];
    const reason = "Could not dismiss the notice: the database is closed.";
    await dismiss(
      () => Promise.reject(new CommandError("acknowledge_failed", reason)),
      (state) => states.push(state),
    );
    expect(states).toEqual([{ status: "dismissing" }, { status: "shown", problem: reason }]);
  });

  it("says something even when the failure carries no message", async () => {
    const states: DismissState[] = [];
    await dismiss(
      () => Promise.reject(undefined),
      (state) => states.push(state),
    );
    expect(states).toEqual([
      { status: "dismissing" },
      { status: "shown", problem: "Something went wrong." },
    ]);
  });
});
