import type { ChangelogDay } from "./changelog-types";

/**
 * The repository's CHANGELOG.md as the website shows it, newest day first. This file is a stand-in:
 * the build replaces its contents with the parsed changelog (scripts/changelog.ts), so the pages
 * that import it always carry the file as it was when the site was built.
 */
const days: readonly ChangelogDay[] = [];

export default days;
