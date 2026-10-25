import type { ComponentType } from "react";
import type { Workspace } from "../fixture/types";
import type { LabState } from "../lab/states";
import type { LabTheme } from "../lab/theme";
import type { TranscriptModel } from "../model/types";
import type { Player } from "../model/usePlayer";
import type { WallpaperId } from "../shared/wallpapers";

/** What every direction's App receives. Directions differ only in how they present it. */
export interface DirectionProps {
  /** Which moment to render (see src/lab/states.ts). */
  readonly state: LabState;
  /**
   * The open chat's transcript at the playhead. Empty (no turns) in the `empty` and `onboarding`
   * states. It changes only when the playhead crosses an event, and finished blocks keep their
   * identity.
   */
  readonly model: TranscriptModel;
  /**
   * Sidebar, agent dock and composer. `workspace.composer.pickerOpen` is true in `picker`,
   * `workspace.rightPanel` is set in `changes`, and `workspace.discovery` in `onboarding`. Like the
   * model, parts that did not change keep their identity between renders.
   */
  readonly workspace: Workspace;
  /** The timeline player. Read the moving playhead with `usePlayhead(player)`. */
  readonly player: Player;
  /**
   * `?theme=`: dark (the default) or light. The lab always passes it; a direction that lists only
   * dark in its meta.ts may ignore it.
   */
  readonly theme?: LabTheme;
}

/** A direction's name card, kept in its own folder (meta.ts) so only its designer edits it. */
export interface DirectionCard {
  readonly name: string;
  /** One line under the name in the gallery. */
  readonly tagline: string;
  /**
   * The lab states it renders, in gallery order. Leave it out for the core five (CORE_STATES);
   * the gallery, the controls and the shoot script skip any state not listed.
   */
  readonly states?: readonly LabState[];
  /** The themes it renders. Leave it out for dark only. */
  readonly themes?: readonly LabTheme[];
  /** The desktop its pages open on when the URL names no `wall`. Leave it out for dusk. */
  readonly wallpaper?: WallpaperId;
}

/** A registered direction: its name card with the defaults filled in, and its App. */
export interface Direction extends Required<DirectionCard> {
  /** The folder name and URL segment: `#/<id>/<state>`. Fixed by the registry. */
  readonly id: string;
  /** Renders the whole window content (everything inside the 1440x900 window). */
  readonly App: ComponentType<DirectionProps>;
}
