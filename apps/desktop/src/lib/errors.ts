/** A sentence for the UI from anything thrown. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  if (typeof error === "string" && error !== "") return error;
  return "Something went wrong.";
}
