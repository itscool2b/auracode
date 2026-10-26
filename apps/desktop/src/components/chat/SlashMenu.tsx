import type { SlashCommand } from "../../bindings";

/** The commands the agent offers, filtered by what follows the `/`; choosing one inserts it. */
export function SlashMenu({
  id,
  commands,
  active,
  onChoose,
}: {
  readonly id: string;
  readonly commands: readonly SlashCommand[];
  /** The highlighted entry, moved with the arrow keys. */
  readonly active: number;
  readonly onChoose: (command: SlashCommand) => void;
}) {
  if (commands.length === 0) return null;
  return (
    <ul id={id} className="chat-slash" aria-label="Slash commands" data-testid="slash-menu">
      {commands.map((command, index) => (
        <li key={command.name}>
          <button
            type="button"
            data-testid="slash-command"
            data-test-name={command.name}
            data-active={index === active}
            aria-current={index === active ? "true" : undefined}
            // The textarea keeps the focus, so typing goes on while the menu is open.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChoose(command)}
          >
            <span>/{command.name}</span>
            <span className="ui-muted">{command.description}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
