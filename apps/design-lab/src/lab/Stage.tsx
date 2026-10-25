import { MotionConfig } from "motion/react";
import { Suspense, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { getDirection } from "../directions";
import { sceneFor, workspaceFor } from "../fixture/scenes";
import type { TimedEvent, Workspace } from "../fixture/types";
import { shareStructure } from "../model/share";
import { eventsAt, reduceTranscript } from "../model/transcript";
import type { TranscriptModel } from "../model/types";
import { usePlayer } from "../model/usePlayer";
import { WindowChrome } from "../shared/WindowChrome";
import { DirectionBoundary } from "./DirectionBoundary";
import { Hud } from "./Hud";
import { playbackFor } from "./playback";
import { ReadyMarker } from "./ready";
import type { StageRoute } from "./route";

const NO_EVENTS: readonly TimedEvent[] = [];

/** One direction in one state: the player, the model at the playhead, and the window around it. */
export function Stage({ route }: { readonly route: StageRoute }) {
  const direction = getDirection(route.direction);
  const scene = useMemo(() => sceneFor(route.state), [route.state]);
  const events = scene.recording?.events ?? NO_EVENTS;
  const duration = scene.recording?.duration ?? 0;
  const { startAt, autoplay, loop } = playbackFor(route, scene.playback, duration);
  const player = usePlayer({ duration, speed: route.speed, loop, startAt, autoplay });

  // Re-render the window only when the playhead crosses an event, not on every frame.
  const count = useSyncExternalStore(
    player.subscribe,
    () => eventsAt(events, player.getTime()),
    () => eventsAt(events, player.getTime()),
  );
  const previous = useRef<TranscriptModel | null>(null);
  const model = useMemo(
    () => reduceTranscript(events.slice(0, count), previous.current),
    [events, count],
  );
  useEffect(() => {
    previous.current = model;
  }, [model]);
  // Shared the same way, so a memoised sidebar re-renders only when a row really changes.
  const previousWorkspace = useRef<Workspace | null>(null);
  const workspace = useMemo(
    () => shareStructure(previousWorkspace.current, workspaceFor(scene, model)),
    [scene, model],
  );
  useEffect(() => {
    previousWorkspace.current = workspace;
  }, [workspace]);

  // The shoot script starts the video's playback through this, once the page has settled.
  useEffect(() => {
    const lab = window.__designLab;
    if (!lab) return;
    lab.player = player;
    return () => {
      if (lab.player === player) lab.player = undefined;
    };
  }, [player]);

  if (!direction) return null;
  const App = direction.App;
  return (
    <MotionConfig reducedMotion={route.reducedMotion ? "always" : "user"}>
      <WindowChrome wallpaper={route.wallpaper} compact={route.thumb}>
        <div className="lab-direction" data-direction={direction.id}>
          <DirectionBoundary name={direction.name}>
            <Suspense fallback={null}>
              <App state={route.state} model={model} workspace={workspace} player={player} />
              <ReadyMarker />
            </Suspense>
          </DirectionBoundary>
        </div>
      </WindowChrome>
      {route.thumb || route.hud === false ? null : (
        <Hud route={route} player={player} pinned={route.hud === true} />
      )}
    </MotionConfig>
  );
}
