# Dictation models

Release bundles carry the speech models listed in `apps/desktop/scripts/dictation-models.mjs`:
`pnpm bundle` fetches any that are missing and verifies each against its pinned SHA-256 before
Tauri packages this folder. Run `node scripts/dictation-models.mjs` (from `apps/desktop`) to
fetch them for a debug build. They are not committed; this file keeps the folder present, and a
build without them says the models are missing when dictation starts.
