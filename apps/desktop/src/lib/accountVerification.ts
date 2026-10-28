export const VERIFICATION_ORIGIN = "https://auracode.si";
export type VerificationOrigin = "https://auracode.si" | "https://preview.auracode.si";

/**
 * The app origins auracode.si's verification page lets embed it: its `frame-ancestors`
 * (apps/web/scripts/headers.mjs) and the parents it answers (apps/web/app/pages/verify-device.tsx).
 * A development build served by Vite (http://localhost:1420) is none of them, so the site refuses
 * the frame there by design.
 */
export const EMBEDDING_ORIGINS: readonly string[] = [
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
];

export function canEmbedVerification(host: string): boolean {
  return EMBEDDING_ORIGINS.includes(host);
}

/** How long the frame has to say it is ready before the check reports that it could not load. */
export const VERIFICATION_LOAD_MS = 30_000;
export function verificationOrigin(value: string): VerificationOrigin {
  if (value !== "https://auracode.si" && value !== "https://preview.auracode.si")
    throw new Error("The account verification service is not configured correctly.");
  return value;
}

/** A verification proof is never an account session. Rust exchanges it only for an email code. */
export function verificationMessage(value: unknown, nonce: string): { token: string } | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (
    message.type !== "auracode:verification-token" ||
    message.nonce !== nonce ||
    typeof message.token !== "string" ||
    message.token.length > 2048
  )
    return null;
  return { token: message.token };
}
