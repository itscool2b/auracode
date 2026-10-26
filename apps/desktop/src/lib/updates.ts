import { commands, type UpdateStatus } from "../bindings";

type Reply = { status: "ok"; data: UpdateStatus } | { status: "error"; error: { message: string } };
async function value(call: Promise<Reply>): Promise<UpdateStatus> {
  const result = await call;
  if (result.status === "error") throw new Error(result.error.message);
  return result.data;
}

/** Only status is read on mount. Every network or installation operation requires a button press. */
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
  idle: "Ready to check",
  checking: "Checking for updates…",
  available: "An update is available",
  downloading: "Downloading verified update…",
  ready: "Ready to install",
  waiting_for_idle: "Waiting for your work to finish",
  installing: "Installing update…",
  restart_required: "Restart to finish updating",
  failed: "Update could not finish",
};
