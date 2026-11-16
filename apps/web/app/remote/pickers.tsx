import { useEffect, useId, useRef, useState } from "react";
import type { Choices, RemoteAgent, RemoteClient } from "./client";

const words = (failure: unknown): string =>
  failure instanceof Error && failure.message ? failure.message : "The computer refused.";

/**
 * A chat's model, thinking level and agent, chosen from the phone as the composer's picker does on
 * the computer. A model or a level applies as it is chosen. Another agent is a handoff: the chat
 * carries on in a new chat with its history, so it waits for its own button.
 */
export function ChatPickers({
  client,
  chatId,
  agentId,
  agentName,
  agents,
  running,
  onClose,
}: {
  readonly client: RemoteClient;
  readonly chatId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly agents: readonly RemoteAgent[];
  /** A turn is under way: a handoff waits for it. */
  readonly running: boolean;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [choices, setChoices] = useState<Choices | null>(null);
  const [agent, setAgent] = useState(agentId);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const [error, setError] = useState("");
  const ids = useId();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  useEffect(() => {
    let live = true;
    client.options(chatId).then(
      (value) => {
        if (live) setChoices(value);
      },
      (failure) => {
        if (live) setError(words(failure));
      },
    );
    return () => {
      live = false;
    };
  }, [client, chatId]);

  /** Applies one choice, then reads the chat's choices again: the computer has the last word. */
  const choose = async (work: Promise<void>, done: string) => {
    setBusy(true);
    setError("");
    setSaid("");
    try {
      await work;
      setSaid(done);
    } catch (failure) {
      setError(words(failure));
    }
    try {
      setChoices(await client.options(chatId));
    } catch {
      // What is shown stays; the next choice says what is wrong.
    }
    setBusy(false);
  };
  const handOff = async () => {
    setBusy(true);
    setError("");
    setSaid("");
    try {
      await client.switchAgent(chatId, agent);
      onClose();
    } catch (failure) {
      setError(words(failure));
      setBusy(false);
    }
  };

  const others = agents.filter((entry) => entry.available || entry.id === agentId);
  const next = others.find((entry) => entry.id === agent);
  const name = (list: Choices["models"], value: string) =>
    list.find((entry) => entry.value === value)?.name ?? value;
  return (
    <dialog
      ref={dialog}
      className="remote-dialog"
      aria-labelledby={`${ids}-title`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (agent !== agentId && !busy && !running) void handOff();
        }}
      >
        <h2 id={`${ids}-title`}>Model and agent</h2>
        {choices === null && !error ? <p className="remote-hint">Asking the computer.</p> : null}
        {choices && choices.models.length > 0 ? (
          <>
            <label htmlFor={`${ids}-model`}>Model</label>
            <select
              id={`${ids}-model`}
              className="g-select"
              value={choices.model ?? ""}
              disabled={busy}
              onChange={(event) => {
                const value = event.currentTarget.value;
                void choose(
                  client.setModel(chatId, value),
                  `Model set to ${name(choices.models, value)}.`,
                );
              }}
            >
              {choices.model === null ? <option value="">The agent's default</option> : null}
              {choices.models.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.name}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {choices && choices.thinking.length > 0 ? (
          <>
            <label htmlFor={`${ids}-thinking`}>Thinking</label>
            <select
              id={`${ids}-thinking`}
              className="g-select"
              value={choices.thinking_level ?? ""}
              disabled={busy}
              onChange={(event) => {
                const value = event.currentTarget.value;
                void choose(
                  client.setThinking(chatId, value),
                  `Thinking set to ${name(choices.thinking, value)}.`,
                );
              }}
            >
              {choices.thinking_level === null ? <option value="">Default</option> : null}
              {choices.thinking.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.name}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {choices && choices.models.length === 0 && choices.thinking.length === 0 ? (
          <p className="remote-hint">
            {agentName} offers no choice of model here. It may list them once it has started.
          </p>
        ) : null}
        <label htmlFor={`${ids}-agent`}>Agent</label>
        <select
          id={`${ids}-agent`}
          className="g-select"
          value={agent}
          disabled={busy}
          onChange={(event) => setAgent(event.currentTarget.value)}
        >
          {others.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.id === agentId ? `${entry.name} (now)` : entry.name}
            </option>
          ))}
        </select>
        {agent !== agentId ? (
          <p className="remote-hint">
            {running
              ? `${agentName} is still working. Stop the turn, or wait for it, then switch.`
              : `The chat carries on with ${next?.name ?? "the other agent"} in a new chat that starts from this one's history. ${agentName} stops.`}
          </p>
        ) : null}
        {said ? (
          <p className="remote-hint" role="status">
            {said}
          </p>
        ) : null}
        {error ? (
          <p className="remote-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="remote-dialog-actions">
          <button
            type="button"
            className="g-button g-button-outline g-button-44"
            disabled={busy}
            onClick={onClose}
          >
            Done
          </button>
          {agent !== agentId ? (
            <button
              type="submit"
              className="g-button g-button-primary g-button-44"
              disabled={busy || running}
            >
              {busy ? "Switching" : `Switch to ${next?.name ?? "it"}`}
            </button>
          ) : null}
        </div>
      </form>
    </dialog>
  );
}
