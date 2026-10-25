import {
  type AppInfo,
  SMOKE_AGENT_CHECKS,
  SMOKE_CHAT_CHECKS,
  SMOKE_CHAT_REOPEN_CHECKS,
  type SmokeCheck,
  type SmokePlan,
  type SmokeReport,
  type SmokeScenario,
} from "../bindings";
import { errorMessage } from "./errors";
import {
  all,
  attr,
  click,
  clickWhenEnabled,
  describeSegment,
  firstDifference,
  one,
  pressEnter,
  readTranscript,
  type SegmentShape,
  type SegmentView,
  StepError,
  setValue,
  sleep,
  text,
  waitFor,
} from "./smokePage";

/**
 * The chat scenarios of smoke mode (`AURACODE_SMOKE=chat`, then `chat-reopen` on the same data
 * folder; `.github/scripts/run-smoke.sh chat` runs both), driving the real chat screens against the
 * real session manager and the demo agent, as the manual pass of the bare UI (spec 10.4) would:
 *
 * - **chat**: New chat with the demo agent in the run's folder; a turn of every kind the demo agent
 *   plays (its magic prompts, `crates/aura-drivers/src/mock_driver.rs`), answering its permission
 *   cards and its question; Stop, Force stop, and prompts queued during turns, held or sent as
 *   decision 11 says; its error, crash and sign-in cards; the whole transcript against the script.
 *   It ends with a turn running and a prompt queued behind it, then reports, and the shell quits
 *   through the quit flow, which interrupts that turn and holds that prompt.
 * - **chat_reopen**: the same data folder again. The chat is listed, opening it starts nothing,
 *   its stored history renders the same script, the turn the quit interrupted reads Interrupted,
 *   the prompt reads held, Resume starts the agent, and Send queued sends the prompt.
 * - **agent** (`AURACODE_SMOKE_AGENT`, local runs only): one minimal chat with a real agent.
 *
 * Each scenario reports every check its list defines (`SMOKE_*_CHECKS`, which the shell holds the
 * report to). The first failing check stops the run: the checks after it report that they did not
 * run, since they would only meet a page in an unknown state.
 */

/** Records the checks of one scenario, in its list's order. */
export class Checks<Name extends string> {
  readonly #names: readonly Name[];
  readonly #results = new Map<Name, SmokeCheck>();
  #stopped: string | null = null;

  constructor(names: readonly Name[]) {
    this.#names = names;
  }

  /** Whether a check failed (or the run was stopped before one): the rest are not run. */
  get stopped(): boolean {
    return this.#stopped !== null;
  }

  /** Stops the run: every check not made yet reports `reason`. */
  stop(reason: string): void {
    this.#stopped ??= reason;
  }

  /** Makes one check: `step` returns what it saw, or throws why the check failed. */
  async run(name: Name, step: () => Promise<string>): Promise<void> {
    if (this.#results.has(name)) {
      this.#results.set(name, { name, ok: false, detail: "the scenario made this check twice" });
      this.stop(`${name} was made twice`);
      return;
    }
    if (this.#stopped !== null) {
      this.#results.set(name, { name, ok: false, detail: `not run: ${this.#stopped}` });
      return;
    }
    try {
      this.#results.set(name, { name, ok: true, detail: await step() });
    } catch (error) {
      this.#results.set(name, { name, ok: false, detail: errorMessage(error) });
      this.stop(`${name} failed`);
    }
  }

  /** Every check of the list, in order; one the run never got to says so. */
  results(): SmokeCheck[] {
    return this.#names.map(
      (name) =>
        this.#results.get(name) ?? {
          name,
          ok: false,
          detail: `not run: ${this.#stopped ?? "the scenario never got to it"}`,
        },
    );
  }
}

/** What the chat scenarios need from the app around them. */
export interface ChatSmokeHooks {
  /** Shows the chats screen; resolves once it has rendered. */
  showChats(): Promise<void>;
}

/** Runs the scenario `plan` names and reports it. */
export async function runChatSmoke(
  info: AppInfo,
  plan: SmokePlan,
  hooks: ChatSmokeHooks,
): Promise<SmokeReport> {
  switch (plan.scenario) {
    case "chat":
      return scenario("chat", SMOKE_CHAT_CHECKS, info, hooks, (checks) =>
        chatScenario(checks, plan),
      );
    case "chat_reopen":
      return scenario("chat_reopen", SMOKE_CHAT_REOPEN_CHECKS, info, hooks, reopenScenario);
    case "agent":
      return scenario("agent", SMOKE_AGENT_CHECKS, info, hooks, (checks) =>
        agentScenario(checks, plan),
      );
    case "stream":
      return {
        ok: false,
        scenario: "stream",
        stream: null,
        checks: [],
        errors: ["the stream check is not a chat scenario"],
      };
  }
}

async function scenario<Name extends string>(
  name: SmokeScenario,
  names: readonly Name[],
  info: AppInfo,
  hooks: ChatSmokeHooks,
  steps: (checks: Checks<Name>) => Promise<void>,
): Promise<SmokeReport> {
  const checks = new Checks(names);
  const errors: string[] = [];
  if (info.fatal !== null) {
    errors.push(`startup failed: ${info.fatal}`);
    checks.stop("startup failed");
  } else {
    try {
      await hooks.showChats();
      await steps(checks);
    } catch (error) {
      // Checks catch their own failures; this is the scenario itself failing between them.
      errors.push(errorMessage(error));
    }
  }
  const results = checks.results();
  return {
    ok: errors.length === 0 && results.every((check) => check.ok),
    scenario: name,
    stream: null,
    checks: results,
    errors,
  };
}

// ---------- the script ----------

/** The prompts the chat scenario sends, each once, so a turn is found by its prompt. */
export const PROMPTS = {
  echo: "/echo Hello from the smoke run",
  demo: "Tidy up src/main.rs",
  autoApproved: "/permission while in Full auto",
  allow: "/permission and wait for my answer",
  reject: "/permission and I will reject it",
  withdraw: "/withdraw",
  ask: "/ask",
  dismiss: "/ask and I will dismiss it",
  big: "/big",
  background: "/background",
  slow: "/slow",
  busy: "/slow while a prompt waits behind it",
  queued: "/echo queued behind a turn",
  hang: "/hang",
  afterStop: "/echo typed after the stop",
  heldAtStop: "/echo held at stop",
  beforeFail: "/slow before a failing turn",
  fail: "/fail",
  heldAtError: "/echo held at error",
  beforeCrash: "/slow before a crash",
  crash: "/crash",
  heldAtCrash: "/echo held at crash",
  auth: "/auth",
  ignoreCancel: "/ignore-cancel",
  restart: "/echo restarted by a prompt",
  atQuit: "/ignore-cancel until auracode quits",
  heldAtQuit: "/echo held at quit",
} as const;

/** What the demo agent echoes for an `/echo` prompt. */
export function echoed(prompt: string): string {
  return prompt.replace(/^\/echo\s+/, "");
}

/** The size of `/big`'s tool output (`BIG_OUTPUT_BYTES` in the demo agent), ASCII. */
export const BIG_OUTPUT_CHARS = 200 * 1024;

/** The demo agent's 40 slash commands (`COMMANDS` in its driver). */
export const DEMO_COMMANDS = 40;

const DEMO_ITEMS = ["thought", "tool:read:completed", "tool:edit:completed", "message"];
const DEMO_PLAN = ["completed", "completed", "in_progress"];

function turn(
  prompt: string,
  stopReason: string,
  items: readonly string[],
  plan: readonly string[] = [],
): SegmentShape {
  return { kind: "turn", prompt, stopReason, items, plan };
}

function between(items: readonly string[]): SegmentShape {
  return { kind: "outside", prompt: "", stopReason: "", items, plan: [] };
}

function echoTurn(prompt: string): SegmentShape {
  return turn(prompt, "end_turn", ["message"]);
}
function demoTurn(prompt: string): SegmentShape {
  return turn(prompt, "end_turn", DEMO_ITEMS, DEMO_PLAN);
}

/** What each step of the chat scenario leaves in the transcript. */
export const SEGMENTS = {
  echo: echoTurn(PROMPTS.echo),
  demo: demoTurn(PROMPTS.demo),
  autoApproved: turn(PROMPTS.autoApproved, "end_turn", [
    "tool:execute:completed",
    "permission:auto:allow",
    "message",
  ]),
  allow: turn(PROMPTS.allow, "end_turn", [
    "tool:execute:completed",
    "permission:user:allow",
    "message",
  ]),
  reject: turn(PROMPTS.reject, "end_turn", [
    "tool:execute:failed",
    "permission:user:reject",
    "message",
  ]),
  withdraw: turn(PROMPTS.withdraw, "end_turn", ["permission:agent:cancelled", "message"]),
  ask: turn(PROMPTS.ask, "end_turn", ["question:user:select:1", "message"]),
  dismiss: turn(PROMPTS.dismiss, "end_turn", ["question:user:dismissed", "message"]),
  big: turn(PROMPTS.big, "end_turn", ["tool:read:completed", "message"]),
  background: turn(PROMPTS.background, "end_turn", ["tool:execute:completed", "message"]),
  backgroundLate: between(["permission:user:allow", "notice:info"]),
  slow: turn(PROMPTS.slow, "cancelled", ["message"]),
  busy: turn(PROMPTS.busy, "end_turn", ["message"]),
  queued: echoTurn(PROMPTS.queued),
  hang: turn(PROMPTS.hang, "cancelled", ["message"]),
  afterStop: echoTurn(PROMPTS.afterStop),
  heldAtStop: echoTurn(PROMPTS.heldAtStop),
  beforeFail: turn(PROMPTS.beforeFail, "end_turn", ["message"]),
  fail: turn(PROMPTS.fail, "error", ["error:agent_error"]),
  heldAtError: echoTurn(PROMPTS.heldAtError),
  beforeCrash: turn(PROMPTS.beforeCrash, "end_turn", ["message"]),
  crash: turn(PROMPTS.crash, "error", ["message", "error:agent_exited"]),
  heldAtCrash: echoTurn(PROMPTS.heldAtCrash),
  auth: turn(PROMPTS.auth, "error", ["error:auth_required"]),
  ignoreCancel: turn(PROMPTS.ignoreCancel, "interrupted", ["message"]),
  forceStopNotice: between(["notice:warning"]),
  restart: echoTurn(PROMPTS.restart),
  /** The last turn, which the quit flow interrupts, as the reopened chat shows it. */
  atQuit: turn(PROMPTS.atQuit, "interrupted", ["message"]),
  heldAtQuit: echoTurn(PROMPTS.heldAtQuit),
} as const satisfies Record<string, SegmentShape>;

/**
 * The transcript the chat scenario leaves before its last turn, segment by segment: what it checks
 * live at its end, and what the reopened history must show again.
 */
export const CHAT_TRANSCRIPT: readonly SegmentShape[] = [
  SEGMENTS.echo,
  SEGMENTS.demo,
  SEGMENTS.autoApproved,
  SEGMENTS.allow,
  SEGMENTS.reject,
  SEGMENTS.withdraw,
  SEGMENTS.ask,
  SEGMENTS.dismiss,
  SEGMENTS.big,
  SEGMENTS.background,
  SEGMENTS.backgroundLate,
  SEGMENTS.slow,
  SEGMENTS.busy,
  SEGMENTS.queued,
  SEGMENTS.hang,
  SEGMENTS.afterStop,
  SEGMENTS.heldAtStop,
  SEGMENTS.beforeFail,
  SEGMENTS.fail,
  SEGMENTS.heldAtError,
  SEGMENTS.beforeCrash,
  SEGMENTS.crash,
  SEGMENTS.heldAtCrash,
  SEGMENTS.auth,
  SEGMENTS.ignoreCancel,
  SEGMENTS.forceStopNotice,
  SEGMENTS.restart,
];

// ---------- reading and driving the chat ----------

/** How long the demo agent may take to start (the login shell's env comes first, up to 15 s). */
const START_TIMEOUT_MS = 60_000;

/** How long a step watches for something that must not happen. */
const QUIET_MS = 1_000;

function status(): string {
  return attr(one("chat-status"), "status");
}

async function waitStatus(want: string, timeoutMs?: number): Promise<void> {
  await waitFor(
    () => `the chat to be ${want} (it is ${status() || "not shown"})`,
    () => status() === want,
    timeoutMs,
  );
}

/** Types `prompt` into the message box and sends it with the Send button or Enter. */
async function send(prompt: string, via: "button" | "enter" = "button"): Promise<void> {
  const input = await waitFor(
    "the message box",
    () => one("composer-input") as HTMLTextAreaElement | null,
  );
  setValue(input, prompt);
  if (via === "enter") {
    // Send turns enabled once the composer re-rendered with the text Enter will send.
    await waitFor("the message box to take the prompt", () => {
      const button = one("composer-send");
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    pressEnter(input);
  } else {
    await clickWhenEnabled("Send", () => one("composer-send"));
  }
  await waitFor(`"${prompt}" to be sent`, () => {
    const error = one("composer-error");
    if (error !== null) throw new StepError(`sending "${prompt}" failed: ${text(error)}`);
    return (one("composer-input") as HTMLTextAreaElement | null)?.value === "";
  });
}

/** The newest turn of `prompt`, as the page shows it now. */
function turnOf(prompt: string): SegmentView | null {
  const turns = readTranscript().filter(
    (segment) => segment.kind === "turn" && segment.prompt === prompt,
  );
  return turns[turns.length - 1] ?? null;
}

async function waitTurnEnded(prompt: string, timeoutMs?: number): Promise<SegmentView> {
  return waitFor(
    `the turn for "${prompt}" to end`,
    () => {
      const found = turnOf(prompt);
      return found !== null && found.stopReason !== "" ? found : null;
    },
    timeoutMs,
  );
}

/** The turn's agent messages, joined. */
function reply(segment: SegmentView): string {
  return segment.views
    .filter((view) => view.kind === "message")
    .map((view) => view.text)
    .join("\n");
}

/** Waits until the turn of `prompt` shows the start of an answer. */
async function waitAnswering(prompt: string, chars = 1): Promise<SegmentView> {
  return waitFor(`"${prompt}" to start answering`, () => {
    const found = turnOf(prompt);
    return found !== null && reply(found).length >= chars ? found : null;
  });
}

/** Fails unless the segment shows what `want` says. */
function expectSegment(segment: SegmentShape, want: SegmentShape): void {
  const got = describeSegment(segment);
  const expected = describeSegment(want);
  if (got !== expected) throw new StepError(`expected ${expected}, but the page shows ${got}`);
}

/** Fails unless the turn's agent messages read `want`. */
function expectReply(segment: SegmentView, want: string): void {
  const got = reply(segment).trim();
  if (got !== want) {
    throw new StepError(`the turn for "${segment.prompt}" replied "${got}", not "${want}"`);
  }
}

function items(segment: SegmentView, kind: string): HTMLElement[] {
  return segment.views.filter((view) => view.kind === kind).map((view) => view.element);
}

function item(segment: SegmentView, kind: string): HTMLElement {
  const found = items(segment, kind)[0];
  if (found === undefined) {
    throw new StepError(`the turn for "${segment.prompt}" has no ${kind}`);
  }
  return found;
}

interface QueuedView {
  readonly prompt: string;
  readonly held: boolean;
  readonly element: HTMLElement;
}

function queue(): QueuedView[] {
  return all("queued-prompt").map((element) => ({
    prompt: text(one("queued-preview", element)),
    held: attr(element, "held") === "true",
    element,
  }));
}

function queued(prompt: string): QueuedView | null {
  return queue().find((row) => row.prompt === prompt) ?? null;
}

function describeQueue(): string {
  const rows = queue().map((row) => `"${row.prompt}"${row.held ? " (held)" : ""}`);
  return rows.length === 0 ? "nothing queued" : rows.join(", ");
}

async function waitQueued(prompt: string, held: boolean): Promise<void> {
  await waitFor(
    () =>
      `"${prompt}" to wait in the queue${held ? ", held" : ", not held"} (the queue shows ${describeQueue()})`,
    () => queued(prompt)?.held === held,
  );
}

async function waitQueueEmpty(): Promise<void> {
  await waitFor(
    () => `the queue to empty (it shows ${describeQueue()})`,
    () => queue().length === 0 && one("send-queued") === null,
  );
}

/** Watches for a while that no turn of `prompt` starts. */
async function expectNoTurn(prompt: string, why: string): Promise<void> {
  const deadline = Date.now() + QUIET_MS;
  while (Date.now() < deadline) {
    if (turnOf(prompt) !== null) throw new StepError(`"${prompt}" was sent, but ${why}`);
    await sleep(50);
  }
}

function row(chatId: string): HTMLElement | null {
  return all("chat-row").find((element) => attr(element, "chat-id") === chatId) ?? null;
}

async function waitAttention(chatId: string, want: boolean): Promise<void> {
  await waitFor(
    `the chat list to ${want ? "mark the chat as waiting for an answer" : "drop the chat's waiting mark"}`,
    () => attr(row(chatId), "attention") === String(want),
  );
}

/** Chooses `value` in a select and waits until the page took it. */
async function choose(select: HTMLElement | null, what: string, value: string): Promise<void> {
  if (!(select instanceof HTMLSelectElement)) throw new StepError(`${what} is not on the page`);
  await waitFor(`${what} to be enabled`, () => !select.disabled);
  if (![...select.options].some((option) => option.value === value)) {
    throw new StepError(`${what} offers no "${value}"`);
  }
  setValue(select, value);
}

function pickerOption(id: string): HTMLElement | null {
  return all("picker-option").find((element) => attr(element, "option-id") === id) ?? null;
}

/** The transcript as lines, to compare with a script. */
function transcriptLines(): string[] {
  return readTranscript().map(describeSegment);
}

function expectTranscript(want: readonly SegmentShape[]): string {
  const expected = want.map(describeSegment);
  const difference = firstDifference(expected, transcriptLines());
  if (difference !== null) throw new StepError(difference);
  return `${expected.length} segments as the script says`;
}

/** Waits until the turn of `prompt` shows an open permission card. */
async function waitAsking(prompt: string): Promise<SegmentView> {
  return waitFor(`"${prompt}" to ask for permission`, () => {
    const found = turnOf(prompt);
    return found?.items.includes("permission:open") ? found : null;
  });
}

/** Answers the turn's open permission card with `optionId`. */
async function answerPermission(prompt: string, optionId: string): Promise<SegmentView> {
  const asking = await waitAsking(prompt);
  const card = item(asking, "permission");
  const options = all("permission-option", card).map((button) => attr(button, "option-id"));
  if (options.join(",") !== "allow,reject") {
    throw new StepError(`the card offers ${options.join(", ") || "nothing"}, not allow and reject`);
  }
  click(
    all("permission-option", card).find((button) => attr(button, "option-id") === optionId) ?? null,
    `the card's ${optionId} button`,
  );
  return asking;
}

/** Clicks Send queued and waits for the turn of `prompt` to end with its echo. */
async function sendQueued(prompt: string): Promise<SegmentView> {
  click(one("send-queued"), "Send queued");
  const ended = await waitTurnEnded(prompt);
  expectSegment(ended, echoTurn(prompt));
  expectReply(ended, echoed(prompt));
  await waitQueueEmpty();
  return ended;
}

/**
 * Sends `busy`, a `/slow` prompt (its answer streams for about 4.7 s), and `then` right behind it:
 * the session manager takes prompts in order, so each one queues behind the running turn whatever
 * the page shows yet. Each waits in the queue, not held, until the slow turn ends normally.
 */
async function queueBehindSlowTurn(busy: string, then: readonly string[]): Promise<void> {
  await send(busy);
  for (const prompt of then) await send(prompt);
  for (const prompt of then) await waitQueued(prompt, false);
  const ended = await waitTurnEnded(busy);
  expectSegment(ended, turn(busy, "end_turn", ["message"]));
}

/** Chooses `agentId` on New chat, and the folder the smoke run's folder picker answers. */
async function chooseAgentAndFolder(agentId: string, folder: string): Promise<void> {
  if (folder === "") throw new StepError("the smoke run has no chat folder");
  await choose(one("new-chat-agent"), "the agent picker", agentId);
  await clickWhenEnabled("Choose folder", () => one("new-chat-pick-folder"));
  await waitFor(
    `New chat to show the folder ${folder}`,
    () => attr(one("new-chat-folder"), "folder") === folder,
  );
}

/** Presses Create on New chat and waits for the new chat to open; returns its id. */
async function createChat(): Promise<string> {
  await clickWhenEnabled("Create", () => one("new-chat-create"));
  const view = await waitFor("the new chat to open", () => {
    const error = one("new-chat-error");
    if (error !== null) throw new StepError(`creating the chat failed: ${text(error)}`);
    const opened = one("chat-view");
    return opened !== null && attr(opened, "chat-id") !== "" ? opened : null;
  });
  return attr(view, "chat-id");
}

/** The agent option New chat offers for `agentId`, once the agents are listed. */
async function agentOption(agentId: string): Promise<HTMLOptionElement> {
  await waitFor("the New chat screen", () => one("new-chat"));
  return waitFor(`New chat to list the agent ${agentId}`, () => {
    const select = one("new-chat-agent");
    return select?.querySelector<HTMLOptionElement>(`option[value="${agentId}"]`) ?? null;
  });
}

// ---------- chat: the demo agent, every block and path ----------

async function chatScenario(
  checks: Checks<(typeof SMOKE_CHAT_CHECKS)[number]>,
  plan: SmokePlan,
): Promise<void> {
  const folder = plan.folder ?? "";
  const agentId = plan.agent_id ?? "mock";
  let chatId = "";

  await checks.run("chats-screen", async () => {
    const option = await agentOption(agentId);
    if (option.disabled)
      throw new StepError(`New chat offers the demo agent disabled: ${option.text}`);
    return "the app opened on New chat, offering the demo agent";
  });

  await checks.run("pick-folder", async () => {
    await chooseAgentAndFolder(agentId, folder);
    return `Choose folder answered ${folder}`;
  });

  await checks.run("create-chat", async () => {
    const started = Date.now();
    chatId = await createChat();
    await waitFor("the chat list to list the chat", () => row(chatId));
    await waitStatus("ready", START_TIMEOUT_MS);
    return `chat ${chatId} opened, and its agent was ready after ${Date.now() - started} ms`;
  });

  await checks.run("pickers", async () => {
    await waitFor("the agent's options in the pickers", () =>
      ["model", "effort", "mode", "fast"].every((id) => pickerOption(id) !== null),
    );
    const autonomy = one("picker-autonomy");
    await waitFor(
      "autonomy to read Full auto with the agent's full_auto mode",
      () =>
        (autonomy as HTMLSelectElement | null)?.value === "full_auto" &&
        attr(one("picker-autonomy"), "native-mode") === "full_auto",
    );
    return "Model, Effort, Mode and Fast mode, and autonomy Full auto (agent mode full_auto)";
  });

  await checks.run("slash-menu", async () => {
    const input = await waitFor(
      "the message box",
      () => one("composer-input") as HTMLTextAreaElement | null,
    );
    setValue(input, "/");
    const listed = await waitFor(`the slash menu to list ${DEMO_COMMANDS} commands`, () => {
      const commands = all("slash-command");
      return commands.length === DEMO_COMMANDS ? commands : null;
    });
    setValue(input, "/ec");
    const narrowed = await waitFor("the slash menu to narrow to echo", () => {
      const names = all("slash-command").map((button) => attr(button, "name"));
      return names.length === 1 && names[0] === "echo" ? names : null;
    });
    click(all("slash-command")[0] ?? null, "the echo command");
    await waitFor('the message box to read "/echo "', () => input.value === "/echo ");
    setValue(input, "");
    return `"/" listed ${listed.length} commands, "/ec" narrowed them to ${narrowed.join(", ")}, and choosing it filled in "/echo "`;
  });

  await checks.run("echo-turn", async () => {
    await send(PROMPTS.echo, "enter");
    const ended = await waitTurnEnded(PROMPTS.echo);
    expectSegment(ended, echoTurn(PROMPTS.echo));
    expectReply(ended, echoed(PROMPTS.echo));
    if (one("turn-footer", ended.element) === null) throw new StepError("the turn has no footer");
    return `Enter sent it; the reply read "${echoed(PROMPTS.echo)}" and the turn ended end_turn`;
  });

  await checks.run("demo-turn", async () => {
    await send(PROMPTS.demo);
    const ended = await waitTurnEnded(PROMPTS.demo);
    expectSegment(ended, demoTurn(PROMPTS.demo));
    const thought = item(ended, "thought");
    if (!(Number(attr(thought, "duration-ms")) > 0)) {
      throw new StepError("the thought shows no duration");
    }
    const [read, edit] = items(ended, "tool");
    if (attr(one("tool-content", read), "type") !== "text") {
      throw new StepError("the read tool shows no text output");
    }
    const diff = one("tool-content", edit);
    if (
      attr(diff, "type") !== "diff" ||
      diff?.querySelector('[data-test-op="add"]') === null ||
      diff?.querySelector('[data-test-op="remove"]') === null
    ) {
      throw new StepError("the edit tool shows no diff with added and removed lines");
    }
    const answer = item(ended, "message");
    const missing = ["heading", "paragraph", "list", "code"].filter(
      (kind) => answer.querySelector(`[data-test-block="${kind}"]`) === null,
    );
    if (missing.length > 0) {
      throw new StepError(`the answer renders no markdown ${missing.join(", ")}`);
    }
    const usage = await waitFor("the header to show context and cost", () =>
      text(one("chat-usage")),
    );
    return `a thought (${attr(thought, "duration-ms")} ms), a read with text output, an edit with a diff, a 3-step plan, the markdown answer, and "${usage}" in the header`;
  });

  await checks.run("option-change", async () => {
    await choose(pickerOption("model"), "the Model picker", "mock-smart");
    await waitFor(
      "the Model picker to keep Mock Smart",
      () =>
        (pickerOption("model") as HTMLSelectElement | null)?.value === "mock-smart" &&
        attr(pickerOption("model"), "saving") === "false",
    );
    return "the Model picker kept mock-smart once the agent answered";
  });

  await checks.run("auto-approved", async () => {
    await send(PROMPTS.autoApproved);
    const ended = await waitTurnEnded(PROMPTS.autoApproved);
    expectSegment(ended, SEGMENTS.autoApproved);
    expectReply(ended, "Done.");
    return "Full auto answered the card (Auto-approved), the tool completed, and the agent said Done.";
  });

  await checks.run("autonomy-ask", async () => {
    await choose(one("picker-autonomy"), "the autonomy picker", "ask");
    await waitFor(
      "autonomy to read Ask with the agent's ask mode",
      () =>
        attr(one("picker-autonomy"), "requested") === "ask" &&
        attr(one("picker-autonomy"), "native-mode") === "ask" &&
        attr(one("picker-autonomy"), "saving") === "false",
    );
    return "autonomy Ask, agent mode ask";
  });

  await checks.run("permission-allow", async () => {
    await send(PROMPTS.allow);
    await waitAsking(PROMPTS.allow);
    await waitAttention(chatId, true);
    await answerPermission(PROMPTS.allow, "allow");
    const ended = await waitTurnEnded(PROMPTS.allow);
    expectSegment(ended, SEGMENTS.allow);
    expectReply(ended, "Done.");
    await waitAttention(chatId, false);
    return "the card waited with Allow once and Reject once while the chat list marked the chat; Allow once closed it as the user's choice, the tool completed, and the agent said Done.";
  });

  await checks.run("permission-reject", async () => {
    await send(PROMPTS.reject);
    await answerPermission(PROMPTS.reject, "reject");
    const ended = await waitTurnEnded(PROMPTS.reject);
    expectSegment(ended, SEGMENTS.reject);
    expectReply(ended, "Skipped.");
    await waitAttention(chatId, false);
    return "Reject once failed the tool and the agent said Skipped.";
  });

  await checks.run("permission-withdrawn", async () => {
    // The agent withdraws its card a second after asking: the turn shows how the card ended.
    await send(PROMPTS.withdraw);
    const ended = await waitTurnEnded(PROMPTS.withdraw);
    expectSegment(ended, SEGMENTS.withdraw);
    expectReply(ended, "The demo agent withdrew its request.");
    return "the card closed as withdrawn by the agent";
  });

  await checks.run("question-answer", async () => {
    await send(PROMPTS.ask);
    const asking = await waitFor(`"${PROMPTS.ask}" to ask its question`, () => {
      const found = turnOf(PROMPTS.ask);
      return found?.items.includes("question:open") ? found : null;
    });
    const card = item(asking, "question");
    const prompt = text(one("question-prompt", card));
    const choices = all("question-choice", card).map(text);
    if (prompt !== "Which color?" || choices.join(",") !== "Red,Green,Blue") {
      throw new StepError(`the question reads "${prompt}" with ${choices.join(", ")}`);
    }
    click(all("question-choice", card)[1] ?? null, "the Green choice");
    const ended = await waitTurnEnded(PROMPTS.ask);
    expectSegment(ended, SEGMENTS.ask);
    expectReply(ended, "You picked Green.");
    return '"Which color?" offered Red, Green and Blue; Green closed it and the agent said "You picked Green."';
  });

  await checks.run("question-dismiss", async () => {
    await send(PROMPTS.dismiss);
    const asking = await waitFor(`"${PROMPTS.dismiss}" to ask its question`, () => {
      const found = turnOf(PROMPTS.dismiss);
      return found?.items.includes("question:open") ? found : null;
    });
    click(one("question-dismiss", item(asking, "question")), "the question's Dismiss button");
    const ended = await waitTurnEnded(PROMPTS.dismiss);
    expectSegment(ended, SEGMENTS.dismiss);
    expectReply(ended, "No answer.");
    return 'Dismiss closed it and the agent said "No answer."';
  });

  await checks.run("big-output", async () => {
    await send(PROMPTS.big);
    const ended = await waitTurnEnded(PROMPTS.big);
    expectSegment(ended, SEGMENTS.big);
    const shown = await loadFullOutput(PROMPTS.big);
    return `the output arrived cut, and Load full output paged in all ${shown} characters`;
  });

  await checks.run("background-output", async () => {
    await send(PROMPTS.background);
    await waitTurnEnded(PROMPTS.background);
    const ended = await waitFor("the background tool update to complete the tool", () => {
      const found = turnOf(PROMPTS.background);
      return found?.items.includes("tool:execute:completed") ? found : null;
    });
    expectSegment(ended, SEGMENTS.background);
    const late = await waitFor("the background permission card between turns", () =>
      lastOutside()?.items.includes("permission:open") ? lastOutside() : null,
    );
    await waitAttention(chatId, true);
    click(
      all("permission-option", item(late, "permission")).find(
        (button) => attr(button, "option-id") === "allow",
      ) ?? null,
      "the background card's Allow once button",
    );
    const answered = await waitFor("the agent's notice after the background answer", () => {
      const found = lastOutside();
      return found?.items.includes("notice:info") ? found : null;
    });
    expectSegment(answered, SEGMENTS.backgroundLate);
    const notice = text(item(answered, "notice"));
    if (notice !== "The watcher wrote its cache.") {
      throw new StepError(`the notice reads "${notice}"`);
    }
    await waitAttention(chatId, false);
    return "the late update completed the ended turn's tool; the late card waited between turns, and answering it brought the agent's notice";
  });

  await checks.run("cancel-turn", async () => {
    await send(PROMPTS.slow);
    await waitAnswering(PROMPTS.slow, 10);
    click(one("composer-stop"), "Stop");
    const ended = await waitTurnEnded(PROMPTS.slow);
    expectSegment(ended, SEGMENTS.slow);
    // The whole slow answer opens with "Here is the slow answer" and runs 465 characters.
    const partial = reply(ended);
    if (!partial.startsWith("Here") || partial.length >= 465) {
      throw new StepError(`the partial answer reads "${partial}"`);
    }
    await waitStatus("ready");
    return `Stop ended the turn cancelled, keeping ${partial.length} characters of its answer`;
  });

  await checks.run("queue-after-turn", async () => {
    await queueBehindSlowTurn(PROMPTS.busy, [PROMPTS.queued]);
    const ended = await waitTurnEnded(PROMPTS.queued);
    expectSegment(ended, echoTurn(PROMPTS.queued));
    expectReply(ended, echoed(PROMPTS.queued));
    await waitQueueEmpty();
    return "the prompt waited in the queue, not held, and went out when the turn ended";
  });

  await checks.run("queue-held-at-stop", async () => {
    await send(PROMPTS.hang);
    await waitAnswering(PROMPTS.hang);
    await send(PROMPTS.heldAtStop);
    await waitQueued(PROMPTS.heldAtStop, false);
    click(one("composer-stop"), "Stop");
    const stopped = await waitTurnEnded(PROMPTS.hang);
    expectSegment(stopped, SEGMENTS.hang);
    await waitQueued(PROMPTS.heldAtStop, true);
    await waitFor("Send queued", () => one("send-queued"));
    await expectNoTurn(PROMPTS.heldAtStop, "it was queued before the Stop and is held");
    await send(PROMPTS.afterStop);
    const after = await waitTurnEnded(PROMPTS.afterStop);
    expectReply(after, echoed(PROMPTS.afterStop));
    if (queued(PROMPTS.heldAtStop)?.held !== true || turnOf(PROMPTS.heldAtStop) !== null) {
      throw new StepError(`the held prompt did not stay held (${describeQueue()})`);
    }
    await sendQueued(PROMPTS.heldAtStop);
    return "the queued prompt was held at the Stop and not sent; the prompt typed after it went out at once; Send queued sent the held one";
  });

  await checks.run("error-card", async () => {
    await queueBehindSlowTurn(PROMPTS.beforeFail, [PROMPTS.fail, PROMPTS.heldAtError]);
    const failed = await waitTurnEnded(PROMPTS.fail);
    expectSegment(failed, SEGMENTS.fail);
    const card = item(failed, "error");
    const message = text(one("error-message", card));
    if (message !== "The demo agent failed this turn on purpose.") {
      throw new StepError(`the error card reads "${message}"`);
    }
    if (one("error-retry", card) !== null) throw new StepError("a turn error offers Retry");
    if (one("error-show-log", card) === null) throw new StepError("the error card has no Show log");
    await waitStatus("ready");
    return "the error card read the agent's message with Show log and no Retry; the turn ended error and the session stayed ready";
  });

  await checks.run("queue-held-at-error", async () => {
    await waitQueued(PROMPTS.heldAtError, true);
    await expectNoTurn(PROMPTS.heldAtError, "it was queued before the failed turn and is held");
    await sendQueued(PROMPTS.heldAtError);
    return "the prompt queued behind the failed turn was held; Send queued sent it";
  });

  await checks.run("crash-card", async () => {
    await queueBehindSlowTurn(PROMPTS.beforeCrash, [PROMPTS.crash, PROMPTS.heldAtCrash]);
    const crashed = await waitTurnEnded(PROMPTS.crash);
    expectSegment(crashed, SEGMENTS.crash);
    const card = item(crashed, "error");
    const detail = text(one("error-detail", card));
    if (!detail.includes("the demo agent crashed on purpose")) {
      throw new StepError(`the crash card's detail reads "${detail}"`);
    }
    for (const button of ["error-retry", "error-start-fresh"]) {
      if (one(button, card) === null) throw new StepError(`the crash card has no ${button}`);
    }
    await waitStatus("stopped");
    return `the crash card read "${text(one("error-message", card))}" with the agent's stderr, Retry and Start fresh; the agent stopped`;
  });

  await checks.run("queue-held-at-crash", async () => {
    await waitQueued(PROMPTS.heldAtCrash, true);
    const crashed = turnOf(PROMPTS.crash);
    click(crashed === null ? null : one("error-retry", item(crashed, "error")), "Retry");
    await waitStatus("ready", START_TIMEOUT_MS);
    await expectNoTurn(PROMPTS.heldAtCrash, "it was queued before the crash and is held");
    if (queued(PROMPTS.heldAtCrash)?.held !== true) {
      throw new StepError(`the held prompt did not stay held (${describeQueue()})`);
    }
    await sendQueued(PROMPTS.heldAtCrash);
    return "the prompt queued behind the crash was held; Retry started the agent and the prompt stayed held until Send queued";
  });

  await checks.run("auth-card", async () => {
    await send(PROMPTS.auth);
    await waitStatus("auth_required");
    const command = await waitFor("the sign-in card with its command", () => {
      const card = one("auth-card");
      return card === null ? null : text(one("auth-command", card));
    });
    if (command !== "demo-agent login")
      throw new StepError(`the card's command reads "${command}"`);
    const ended = await waitTurnEnded(PROMPTS.auth);
    expectSegment(ended, SEGMENTS.auth);
    await waitQueued(PROMPTS.auth, true);
    return 'the sign-in card showed "demo-agent login" with Retry, the turn ended with an auth error card, and the prompt went back to the queue, held';
  });

  await checks.run("auth-retry", async () => {
    const held = queued(PROMPTS.auth);
    click(held === null ? null : one("queued-remove", held.element), "Remove");
    await waitQueueEmpty();
    click(one("auth-retry"), "the sign-in card's Retry");
    await waitStatus("ready", START_TIMEOUT_MS);
    await waitFor("the sign-in card to go", () => one("auth-card") === null);
    return "Remove dropped the held prompt, and Retry started the agent again";
  });

  await checks.run("force-stop", async () => {
    await send(PROMPTS.ignoreCancel);
    await waitAnswering(PROMPTS.ignoreCancel);
    click(one("composer-stop"), "Stop");
    await waitStatus("cancelling");
    await waitFor("Force stop", () => one("composer-force-stop"));
    await sleep(QUIET_MS);
    if (status() !== "cancelling") {
      throw new StepError(
        `the turn stopped on its own (${status()}) although the agent ignores cancels`,
      );
    }
    click(one("composer-force-stop"), "Force stop");
    await waitStatus("stopped");
    const ended = await waitTurnEnded(PROMPTS.ignoreCancel);
    expectSegment(ended, SEGMENTS.ignoreCancel);
    const after = await waitFor("the force-stop notice after the turn", () => {
      const next = segmentAfter(PROMPTS.ignoreCancel);
      return next?.items.includes("notice:warning") ? next : null;
    });
    expectSegment(after, SEGMENTS.forceStopNotice);
    return `the turn kept stopping after Stop; Force stop ended it interrupted with "${text(item(after, "notice"))}" and stopped the agent`;
  });

  await checks.run("send-starts-agent", async () => {
    await send(PROMPTS.restart);
    const ended = await waitTurnEnded(PROMPTS.restart, START_TIMEOUT_MS);
    expectSegment(ended, echoTurn(PROMPTS.restart));
    expectReply(ended, echoed(PROMPTS.restart));
    await waitStatus("ready");
    await waitQueueEmpty();
    return "the prompt started the stopped agent and went out once it was ready";
  });

  await checks.run("transcript", async () => expectTranscript(CHAT_TRANSCRIPT));

  await checks.run("quit-with-turn", async () => {
    await send(PROMPTS.atQuit);
    await waitAnswering(PROMPTS.atQuit);
    await send(PROMPTS.heldAtQuit);
    await waitQueued(PROMPTS.heldAtQuit, false);
    return `"${PROMPTS.atQuit}" runs with "${PROMPTS.heldAtQuit}" queued behind it as the run reports and quits`;
  });
}

/** The segment right after the newest turn of `prompt`. */
function segmentAfter(prompt: string): SegmentView | null {
  const segments = readTranscript();
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment?.kind === "turn" && segment.prompt === prompt) return segments[index + 1] ?? null;
  }
  return null;
}

/** The last segment if it is one between turns. */
function lastOutside(): SegmentView | null {
  const segments = readTranscript();
  const last = segments[segments.length - 1];
  return last?.kind === "outside" ? last : null;
}

/** The output of the newest turn of `prompt`'s tool, as the page shows it now. */
function toolOutput(prompt: string): HTMLElement | null {
  const found = turnOf(prompt);
  const tool = found?.views.find((view) => view.kind === "tool")?.element;
  return tool === undefined ? null : one("tool-content", tool);
}

/** Pages in `/big`'s whole output with Load full output; returns how many characters show. */
async function loadFullOutput(prompt: string): Promise<number> {
  const content = toolOutput(prompt);
  if (content === null) throw new StepError(`the turn for "${prompt}" shows no tool output`);
  if (attr(content, "truncated") !== "true") throw new StepError("the big output arrived whole");
  const cut = text(one("tool-text", content)).length;
  if (cut >= BIG_OUTPUT_CHARS) throw new StepError(`the cut output shows ${cut} characters`);
  click(one("load-full-output", content), "Load full output");
  return waitFor(`all ${BIG_OUTPUT_CHARS} characters of the big output`, () => {
    const shown = toolOutput(prompt);
    if (shown === null) return null;
    const length = text(one("tool-text", shown)).length;
    return length === BIG_OUTPUT_CHARS && one("load-full-output", shown) === null ? length : null;
  });
}

// ---------- chat_reopen: the same data folder after the quit ----------

async function reopenScenario(
  checks: Checks<(typeof SMOKE_CHAT_REOPEN_CHECKS)[number]>,
): Promise<void> {
  let chatId = "";

  await checks.run("reopen-list", async () => {
    const rows = await waitFor("the chat list to list the first launch's chat", () => {
      const listed = all("chat-row");
      return listed.length > 0 ? listed : null;
    });
    const [listed] = rows;
    if (rows.length !== 1 || listed === undefined) {
      throw new StepError(`the chat list shows ${rows.length} chats, not 1`);
    }
    chatId = attr(listed, "chat-id");
    const title = text(one("chat-row-title", listed));
    if (title !== PROMPTS.echo) throw new StepError(`the chat is titled "${title}"`);
    if (attr(listed, "status") !== "stopped" || attr(listed, "attention") !== "false") {
      throw new StepError(
        `the chat reads ${attr(listed, "status")}, attention ${attr(listed, "attention")}`,
      );
    }
    return `chat ${chatId}, titled by its first prompt, stopped, with nothing waiting`;
  });

  await checks.run("reopen-no-start", async () => {
    click(row(chatId), "the chat's row");
    await waitFor(
      "the chat to open",
      () =>
        attr(one("chat-view"), "chat-id") === chatId && attr(one("chat-view"), "phase") === "live",
    );
    const deadline = Date.now() + QUIET_MS;
    while (Date.now() < deadline) {
      if (status() !== "stopped") throw new StepError(`opening the chat made it ${status()}`);
      await sleep(50);
    }
    return "the chat opened and stayed stopped: opening a chat starts no agent";
  });

  await checks.run("reopen-history", async () => {
    await waitFor("the stored history", () => readTranscript().length >= CHAT_TRANSCRIPT.length);
    return `the stored history renders ${expectTranscript([...CHAT_TRANSCRIPT, SEGMENTS.atQuit])}`;
  });

  await checks.run("reopen-interrupted", async () => {
    const interrupted = turnOf(PROMPTS.atQuit);
    if (interrupted === null) throw new StepError("the turn that ran at quit is missing");
    if (interrupted.stopReason !== "interrupted" || interrupted.recovered) {
      throw new StepError(
        `the turn that ran at quit ended ${interrupted.stopReason}, recovered ${interrupted.recovered}`,
      );
    }
    if (!reply(interrupted).startsWith("Working on it")) {
      throw new StepError(`its answer reads "${reply(interrupted)}"`);
    }
    return "the quit flow ended the running turn interrupted when its cancel grace ran out, keeping its partial answer";
  });

  await checks.run("reopen-held", async () => {
    const rows = queue();
    if (rows.length !== 1 || queued(PROMPTS.heldAtQuit)?.held !== true) {
      throw new StepError(`the queue shows ${describeQueue()}`);
    }
    if (one("send-queued") === null) throw new StepError("the held prompt offers no Send queued");
    return `"${PROMPTS.heldAtQuit}" waits held, with Send queued`;
  });

  await checks.run("reopen-blob", async () => {
    const shown = await loadFullOutput(PROMPTS.big);
    return `Load full output paged in all ${shown} characters from the stored blob`;
  });

  await checks.run("reopen-resume", async () => {
    const start = one("chat-start");
    if (attr(start, "resume") !== "true" || one("chat-start-fresh") === null) {
      throw new StepError("the stopped chat offers no Resume session and Start fresh");
    }
    click(start, "Resume session");
    await waitStatus("ready", START_TIMEOUT_MS);
    await expectNoTurn(PROMPTS.heldAtQuit, "it was held at quit and Resume releases nothing");
    if (queued(PROMPTS.heldAtQuit)?.held !== true) {
      throw new StepError(`the held prompt did not stay held (${describeQueue()})`);
    }
    return "the chat offered Resume session and Start fresh; Resume started the agent, and the prompt stayed held";
  });

  await checks.run("reopen-send-queued", async () => {
    await sendQueued(PROMPTS.heldAtQuit);
    return `Send queued sent "${PROMPTS.heldAtQuit}" and its reply arrived`;
  });
}

// ---------- agent: one minimal chat with a real agent ----------

/** What the minimal chat asks a real agent. */
export const AGENT_PROMPT = "Reply with exactly: ok";

/** The demo agent cannot follow an instruction, so its minimal chat echoes the same answer. */
export const DEMO_AGENT_PROMPT = "/echo ok";

/** Whether a reply is the "ok" the minimal chat asks for, give or take case and a final period. */
export function isOk(reply: string): boolean {
  return reply.trim().toLowerCase().replace(/[.!]$/, "") === "ok";
}

/** A first adapter download may take 10 minutes; then the start itself gets a minute. */
const AGENT_START_TIMEOUT_MS = 11 * 60_000;

/** A real agent's one-line answer. */
const AGENT_REPLY_TIMEOUT_MS = 5 * 60_000;

async function agentScenario(
  checks: Checks<(typeof SMOKE_AGENT_CHECKS)[number]>,
  plan: SmokePlan,
): Promise<void> {
  const agentId = plan.agent_id ?? "";
  const folder = plan.folder ?? "";
  const prompt = agentId === "mock" ? DEMO_AGENT_PROMPT : AGENT_PROMPT;

  await checks.run("agent-available", async () => {
    const option = await agentOption(agentId);
    if (option.disabled) throw new StepError(`New chat cannot start it: ${option.text}`);
    return `New chat offers ${option.text}`;
  });

  await checks.run("agent-starts", async () => {
    const started = Date.now();
    await chooseAgentAndFolder(agentId, folder);
    const chatId = await createChat();
    await waitFor(
      "the agent to start (a first start downloads its adapter)",
      () => {
        const now = status();
        if (now === "failed" || now === "auth_required") {
          const error = all("error-message").map(text).pop() ?? "";
          const auth = text(one("auth-message"));
          throw new StepError(`the agent did not start (${now}): ${auth || error}`);
        }
        return now === "ready";
      },
      AGENT_START_TIMEOUT_MS,
    );
    // Ask, so the agent acts on nothing without a card; the one prompt needs no action.
    await choose(one("picker-autonomy"), "the autonomy picker", "ask");
    await waitFor(
      "autonomy to read Ask",
      () =>
        attr(one("picker-autonomy"), "requested") === "ask" &&
        attr(one("picker-autonomy"), "saving") === "false",
    );
    return `chat ${chatId} started its agent in ${Math.round((Date.now() - started) / 1000)} s, under Ask`;
  });

  await checks.run("agent-replies", async () => {
    await send(prompt);
    const ended = await waitFor(
      `the agent's answer to "${prompt}"`,
      () => {
        const found = turnOf(prompt);
        if (found?.items.includes("permission:open")) {
          const card = item(found, "permission");
          const reject = all("permission-option", card).find((button) =>
            attr(button, "option-kind").startsWith("reject"),
          );
          (reject ?? one("permission-dismiss", card))?.click();
          throw new StepError(
            `the agent asked to act ("${text(one("permission-title", card))}"); auracode declined`,
          );
        }
        return found !== null && found.stopReason !== "" ? found : null;
      },
      AGENT_REPLY_TIMEOUT_MS,
    );
    const answer = reply(ended).trim();
    if (ended.stopReason !== "end_turn" || !isOk(answer)) {
      throw new StepError(`the turn ended ${ended.stopReason} with "${answer}"`);
    }
    return `"${prompt}" got "${answer}"`;
  });
}
