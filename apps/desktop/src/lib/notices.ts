import type { AppInfo } from "../bindings";

/**
 * When `app_info` is read again for notices that arrived after startup (the sweep of what a
 * crashed session left running reports once it finishes, in the background).
 */
export const LATE_NOTICE_CHECKS_MS: readonly number[] = [3000, 10_000];

/** `current` with the notices of a later `app_info`: only additions, so nothing else flickers. */
export function withLateNotices(current: AppInfo, later: AppInfo): AppInfo {
  const added = later.notices.filter((notice) => !current.notices.includes(notice));
  return added.length === 0 ? current : { ...current, notices: [...current.notices, ...added] };
}
