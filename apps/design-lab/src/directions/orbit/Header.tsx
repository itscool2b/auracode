import {
  Archive,
  FolderInput,
  GitBranch,
  MoreHorizontal,
  PanelRight,
  PenLine,
  Pin,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import type { Player } from "../../kit";
import type { MarkTimeline } from "./geometry";
import { Menu } from "./Menu";
import { OrbitMark } from "./OrbitMark";
import { DiffCounts, DiffSquares, IconButton } from "./ui";

/*
 * The chat header (visual-language.md 4.3): 44px inside the pane. The agent's live mark, the
 * title (click to rename, in place), and Harvey's muted inline metadata instead of a breadcrumb
 * bar; at right the diffstat chip, the right panel toggle and the chat menu. No border at rest; a
 * rule fades in once the chat scrolls. When room runs out the metadata goes first, then the title
 * cuts.
 */
export function Header({
  agent,
  agentName,
  title,
  project,
  branch,
  player,
  timeline,
  changes,
  panelOpen,
  scrolled,
  onTogglePanel,
  onOpenChanges,
  onRename,
  onArchive,
  onDelete,
}: {
  readonly agent: string;
  readonly agentName: string;
  readonly title: string;
  readonly project: string;
  readonly branch: string;
  readonly player: Player;
  readonly timeline: MarkTimeline | null;
  readonly changes: { readonly added: number; readonly removed: number } | null;
  readonly panelOpen: boolean;
  readonly scrolled: boolean;
  readonly onTogglePanel: () => void;
  readonly onOpenChanges: () => void;
  readonly onRename: (title: string) => void;
  readonly onArchive: (() => void) | null;
  readonly onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLButtonElement>(null);
  // A rename ends once: Enter, Esc or blur, whichever comes first. The field's removal can blur
  // it, and that blur must not commit what Esc threw away.
  const ended = useRef(false);
  const finish = (value: string): void => {
    if (ended.current) return;
    ended.current = true;
    setRenaming(null);
    const next = value.trim();
    if (next !== "" && next !== title) onRename(next);
  };
  const cancel = (): void => {
    ended.current = true;
    setRenaming(null);
  };
  // The field opens as wide as the title it replaces, plus room to type.
  const startRename = (): void => {
    ended.current = false;
    setRenaming(Math.max(160, Math.min(420, (titleRef.current?.offsetWidth ?? 148) + 12)));
  };
  return (
    <header className="o-head" data-scrolled={scrolled ? "" : undefined}>
      <div className="o-head-left">
        <OrbitMark
          agent={agent}
          size={16}
          live={timeline ? { timeline, player } : undefined}
          label={agentName}
        />
        {renaming !== null ? (
          <input
            className="o-head-rename o-t-ui o-w-strong"
            defaultValue={title}
            aria-label="Chat title"
            style={{ width: renaming }}
            // biome-ignore lint/a11y/noAutofocus: the field opens because the user asked to rename.
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onBlur={(event) => finish(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") finish(event.currentTarget.value);
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                cancel();
              }
            }}
          />
        ) : (
          <h1 className="o-head-title o-t-ui o-w-strong">
            <button
              ref={titleRef}
              type="button"
              className="o-head-title-btn"
              title="Rename"
              onClick={startRename}
            >
              <span className="o-head-title-text">{title}</span>
            </button>
          </h1>
        )}
        <span className="o-head-meta o-t-ui o-c3">
          <span className="o-head-meta-text">{project}</span>
          <span className="o-c4">·</span>
          <GitBranch size={12} strokeWidth={1.5} aria-hidden="true" />
          <span className="o-t-mono">{branch}</span>
        </span>
      </div>
      <div className="o-head-right">
        {changes && changes.added + changes.removed > 0 ? (
          <button
            type="button"
            className="o-diff-chip"
            onClick={onOpenChanges}
            title="Open Changes"
          >
            <DiffCounts added={changes.added} removed={changes.removed} />
            <DiffSquares added={changes.added} removed={changes.removed} />
          </button>
        ) : null}
        <IconButton
          icon={PanelRight}
          label={panelOpen ? "Hide the right panel" : "Show the right panel"}
          active={panelOpen}
          onClick={onTogglePanel}
        />
        <span className="o-menu-anchor">
          <IconButton
            ref={moreRef}
            icon={MoreHorizontal}
            label="Chat menu"
            active={menu}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((value) => !value)}
          />
          {menu ? (
            <Menu
              label="Chat"
              anchor={moreRef}
              side="bottom"
              onClose={() => setMenu(false)}
              groups={[
                [
                  { label: "Rename", icon: PenLine, onSelect: startRename },
                  { label: "Pin", icon: Pin, soon: true },
                  { label: "Move to project", icon: FolderInput, soon: true },
                  {
                    label: "Archive",
                    icon: Archive,
                    shortcut: "⌘⌫",
                    onSelect: onArchive ?? undefined,
                    soon: onArchive === null,
                  },
                ],
                [{ label: "Delete", icon: Trash2, destructive: true, onSelect: onDelete }],
              ]}
            />
          ) : null}
        </span>
      </div>
    </header>
  );
}
