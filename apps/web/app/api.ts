// View transport only. Authentication, authorization, limits and mutations live in the Rust Worker.
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(messages[code] ?? "The service could not complete this request. Try again.");
  }
}
const messages: Record<string, string> = {
  unauthorized: "Your session has expired. Sign in again.",
  account_deleted: "This account was deleted. Retained local work is still available in auracode.",
  invite_required:
    "This email does not have cloud access. Accounts, sync and transfers are invite-only during private preview. Use your invited email, or use the free Local app without an account.",
  forbidden: "This action needs verification. Sign in with a fresh code and try again.",
  invalid_code: "That code is invalid or expired. Check all six digits or request another code.",
  rate_limited: "Too many attempts. Wait a minute before trying again.",
  delivery_failed: "We couldn’t deliver the email. Wait a minute, then request a new code.",
  unavailable:
    "The account service is temporarily unavailable. Your local workspace is unaffected.",
  conflict: "That change conflicts with the current account. Refresh and try again.",
  invalid_request: "Check the entered details and try again.",
};
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  csrf?: string,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(csrf ? { "X-Auracode-CSRF": csrf } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "unavailable" }));
      throw new ApiError(
        response.status,
        typeof error.error === "string" ? error.error : "unavailable",
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error("Connection interrupted. Check your connection, then try again.");
  } finally {
    clearTimeout(timeout);
  }
}
export interface Session {
  user_id: string;
  client_kind: "browser" | "desktop";
  device_id: string | null;
  created_at: number;
  expires_at: number;
}
export interface SessionResponse {
  session: Session;
  csrf_token: string;
}
export interface Account {
  id: string;
  email: string;
  created_at: number;
  sync_used_bytes: number;
  sync_limit_bytes: number;
  blob_reserved_bytes: number;
  blob_limit_bytes: number;
}
export interface Device {
  id: string;
  name: string;
  platform: string;
  created_at: number;
  last_seen: number;
  approved_at: number | null;
  revoked_at: number | null;
}
export interface Challenge {
  challenge_id: string;
  expires_in: number;
  resend_after: number;
}
