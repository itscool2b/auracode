/**
 * Finds the token `claude setup-token` printed, in the terminal's rendered lines (its screen and
 * scrollback, after the terminal resolved wrapping and cursor moves). Claude Code 2.1.316 prints:
 *
 *     ✓ Long-lived authentication token created successfully!
 *     Your OAuth token (valid for 1 year):
 *     sk-ant-oat01-…            (wrapped onto as many lines as the width needs)
 *
 *     Store this token securely. You won't be able to see it again.
 *
 * The token is read from its `sk-ant-oat` start through every following line made only of token
 * characters, up to a blank line or other text. Until something follows it, the token may still
 * be printing, so it counts only once the command has `finished`. The last one printed wins:
 * the terminal user interface can draw a frame more than once.
 */
export function findSetupToken(lines: readonly string[], finished = false): string | null {
  const TOKEN = /^[A-Za-z0-9_-]+/;
  let found: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const start = line.lastIndexOf("sk-ant-oat");
    if (start < 0) continue;
    let token = TOKEN.exec(line.slice(start))?.[0] ?? "";
    let next = index + 1;
    let ended = line.slice(start + token.length).trim() !== "";
    while (!ended && next < lines.length) {
      const part = (lines[next] ?? "").trim();
      const piece = TOKEN.exec(part)?.[0] ?? "";
      if (!part || piece.length !== part.length) {
        ended = true;
        break;
      }
      token += piece;
      next += 1;
    }
    if ((ended || finished) && token.length >= 40) found = token;
    index = next - 1;
  }
  return found;
}
