// Duplicated from next.config.js's basePath literal (not imported from a
// shared file -- a cross-file require() between repo-root .js and this
// lib/*.ts client file previously broke: a filename-casing mismatch that
// only surfaced on GitHub Actions' case-sensitive Ubuntu runner, plus a
// separate "module not found" build error from a missing/misplaced file).
// Duplicating this one already-decided literal is lower-risk than that
// indirection. If you ever change next.config.js's basePath, update this too.
export const BASE_PATH = process.env.NODE_ENV === "production" ? "/space-3" : "";