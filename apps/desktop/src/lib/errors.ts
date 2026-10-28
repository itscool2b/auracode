/**
 * A sentence for the UI from anything thrown. A raw Tauri `invoke` rejects with the command's
 * error as data (Rust's `AppError` arrives as `{ code, message }`), not as an `Error`, so its
 * message is read from the object instead of being replaced by the fallback.
 */
export function errorMessage(error: unknown, fallback = "Something went wrong."): string {
  if (error instanceof Error && error.message !== "") return error.message;
  if (typeof error === "string" && error !== "") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { readonly message: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
  }
  return fallback;
}
