import type { ComponentType } from "react";
import type { Workspace } from "../fixture/types";
import type { LabState } from "../lab/states";
import type { TranscriptModel } from "../model/types";
import type { Player } from "../model/usePlayer";

/** What every direction's App receives. Directions differ only in how they present it. */
export interface DirectionProps {
  /** Which moment to render (see src/lab/states.ts). */
  readonly state: LabState;
  /**
   * The open chat's transcript at the playhead. Empty (no turns) in the `empty` state. It changes
   * only when the playhead crosses an event, and finished blocks keep their identity.
   */
  readonly model: TranscriptModel;
  /**
   * Sidebar, agent dock and composer. `workspace.composer.pickerOpen` is true in `picker`. Like the
   * model, parts that did not change keep their identity between renders.
   */
  readonly workspace: Workspace;
  /** The timeline player. Read the moving playhead with `usePlayhead(player)`. */
  readonly player: Player;
}

/** A direction's name card, kept in its own folder (meta.ts) so only its designer edits it. */
export interface DirectionCard {
  readonly name: string;
  /** One line under the name in the gallery. */
  readonly tagline: string;
}

export interface Direction extends DirectionCard {
  /** The folder name and URL segment: `#/<id>/<state>`. Fixed by the registry. */
  readonly id: string;
  /** Renders the whole window content (everything inside the 1440x900 window). */
  readonly App: ComponentType<DirectionProps>;
}
