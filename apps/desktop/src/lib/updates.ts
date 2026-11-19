import { useCallback, useEffect, useRef, useState } from "react";
import { commands, type UpdateStatus } from "../bindings";
import { errorMessage } from "./errors";

type Reply = { status: "ok"; data: UpdateStatus } | { status: "error"; error: { message: string } };
async function value(call: Promise<Reply>): Promise<UpdateStatus> {
  const result = await call;
  if (result.status === "error") throw new Error(result.error.message);
  return result.data;
}

/**
 * The app's updater, as Rust exposes it (src-tauri/src/updater.rs). Reading the status never
 * touches the network. Rust looks for a newer version by itself a few times a day, unless
 * Settings turns that off; downloading and installing happen only when a button asks.
 */
export const updatesApi = {
  status: () => commands.appUpdateStatus(),
  check: () => value(commands.appUpdateCheck()),
  download: () => value(commands.appUpdateDownload()),
  install: () => value(commands.appUpdateInstall()),
};
export type UpdatesApi = typeof updatesApi;

export function updateBusy(phase: UpdateStatus["phase"]): boolean {
  return phase === "checking" || phase === "downloading" || phase === "installing";
}

export const UPDATE_LABEL: Record<UpdateStatus["phase"], string> = {
  disabled: "Manual installation",
  idle: "Up to date",
  checking: "Checking for updates…",
  available: "An update is available",
  downloading: "Downloading verified update…",
  ready: "Ready to install",
  waiting_for_idle: "Waiting for your work to finish",
  installing: "Installing update…",
  restart_required: "Restart to finish updating",
  failed: "Update could not finish",
};

/**
 * Whether the window should offer Update: a newer version was found, or one is on its way in. A
 * failure counts only while a version is known, so a check that could not reach the network
 * leaves the window as it was.
 */
export function updateOffered(status: UpdateStatus | null): boolean {
  if (!status) return false;
  switch (status.phase) {
    case "available":
    case "downloading":
    case "ready":
    case "waiting_for_idle":
    case "installing":
    case "restart_required":
      return true;
    case "failed":
      return status.version !== null;
    default:
      return false;
  }
}

/** How often the window rereads the status: seldom at rest, briskly while something runs. */
const REST_MS = 60_000;
const BUSY_MS = 500;

export interface AppUpdate {
  readonly status: UpdateStatus | null;
  /** What the last step said when it failed, until the next one starts. */
  readonly error: string | null;
  /** A step this window started is still running. */
  readonly busy: boolean;
  /**
   * Downloads the update and, once it is verified, installs it and restarts: the whole of
   * "Update and restart" in one go. It stops where Rust says to wait (a Git change still
   * running, a draft that could not be saved), and pressing again carries on from there.
   */
  readonly update: () => Promise<void>;
}

/**
 * The app's update as the window follows it. The status is reread every minute and whenever the
 * window regains focus, so an update Rust found by itself shows without anyone asking, and twice
 * a second while a download or an installation runs.
 */
export function useAppUpdate(api: UpdatesApi): AppUpdate {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const running = useRef(false);

  const read = useCallback(() => {
    api.status().then(
      (next) => {
        if (alive.current) setStatus(next);
      },
      () => undefined,
    );
  }, [api]);

  useEffect(() => {
    alive.current = true;
    read();
    window.addEventListener("focus", read);
    return () => {
      alive.current = false;
      window.removeEventListener("focus", read);
    };
  }, [read]);

  const phase = status?.phase;
  const brisk = busy || (phase !== undefined && updateBusy(phase));
  useEffect(() => {
    const timer = setInterval(read, brisk ? BUSY_MS : REST_MS);
    return () => clearInterval(timer);
  }, [read, brisk]);

  const update = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      let next = await api.status();
      // A failed step is retried from the check, which also finds a still newer version.
      if (next.phase === "failed" || next.phase === "idle") next = await api.check();
      if (next.phase === "available") next = await api.download();
      if (next.phase === "ready" || next.phase === "waiting_for_idle") next = await api.install();
      if (alive.current) setStatus(next);
    } catch (failure) {
      if (alive.current) setError(errorMessage(failure));
      read();
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }, [api, read]);

  return { status, error, busy, update };
}
