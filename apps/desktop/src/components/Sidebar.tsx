import {
  AGENT_BRAND_IDS,
  AGENT_BRANDS,
  type AgentBrandId,
  ORB_STATE_LABELS,
  type OrbState,
} from "@auracode/ui";
import { OrbitMark } from "@auracode/ui/orbit";
import { useId } from "react";
import { PlusIcon } from "./icons";

/**
 * The slim sidebar of Diagnostics: wordmark, the way back to chats, and the sample agent's live
 * mark. Its top strip is a window drag region, with room for
 * the macOS traffic lights.
 */
export function Sidebar({
  brandId,
  onBrandChange,
  orbState,
  onChats,
}: {
  readonly brandId: AgentBrandId;
  readonly onBrandChange: (brand: AgentBrandId) => void;
  readonly orbState: OrbState;
  /** Back to the chats. */
  readonly onChats: () => void;
}) {
  const brand = AGENT_BRANDS[brandId];
  const selectId = useId();
  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="drag-strip" data-tauri-drag-region="" />
      <div className="wordmark" data-tauri-drag-region="">
        auracode
      </div>
      <nav aria-label="Main">
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          <li>
            <button type="button" className="nav-item" onClick={onChats}>
              <PlusIcon />
              Chats
            </button>
          </li>
        </ul>
      </nav>
      <div className="flex-1" data-tauri-drag-region="" />
      <div className="agent-chip">
        <OrbitMark
          agent={brand.id}
          state={orbState}
          size={40}
          label={`${brand.name} demo agent, ${ORB_STATE_LABELS[orbState]}`}
        />
        <div className="flex min-w-0 flex-col">
          <label htmlFor={selectId} className="sr-only">
            Demo agent colour
          </label>
          <select
            id={selectId}
            value={brandId}
            onChange={(event) => onBrandChange(event.currentTarget.value as AgentBrandId)}
          >
            {AGENT_BRAND_IDS.map((id) => (
              <option key={id} value={id}>
                {AGENT_BRANDS[id].name}
              </option>
            ))}
          </select>
          <span className="text-xs text-(--aura-text-3)">
            Demo agent · {ORB_STATE_LABELS[orbState]}
          </span>
        </div>
      </div>
    </aside>
  );
}
