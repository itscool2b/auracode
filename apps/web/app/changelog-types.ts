/** One merged pull request, as the website's changelog shows it. */
export interface ChangelogEntry {
  /** What changed, up to its first colon or full stop: the part set in ink. */
  readonly head: string;
  /** The rest of the line. May be empty. */
  readonly rest: string;
  /** The pull request's number. The repository is private, so the page shows it without a link. */
  readonly pull: number;
}

/** The pull requests that merged on one UTC day. */
export interface ChangelogDay {
  /** The day as YYYY-MM-DD. */
  readonly date: string;
  /** The same day in words: "10 November 2026". */
  readonly label: string;
  readonly entries: readonly ChangelogEntry[];
}
