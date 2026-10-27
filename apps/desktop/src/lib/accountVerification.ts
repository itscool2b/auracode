export const VERIFICATION_ORIGIN = "https://auracode.si";
export type VerificationOrigin = "https://auracode.si" | "https://preview.auracode.si";
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
