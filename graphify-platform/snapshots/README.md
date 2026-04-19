# Graphify Snapshots (versioned)

**Purpose:** Allow any Claude session to access graphify output without depending on a local `src/graphify-out/` build.

**Contents:**
- `LATEST_DIGEST.md` — TL;DR for session-init (~170 tokens). Primary entry point.
- `LATEST_REPORT.md` — full architectural map (~5.5k tokens). Lazy-load on explicit arch questions.

**Refresh cadence:** auto-updated by `.github/workflows/graphify-snapshot.yml` on every push that touches `src/**`. Workflow commits back with `[skip graphify]` tag to avoid recursion.

**Fallback rule (enforced in CLAUDE.md):**
1. If `src/graphify-out/_GRAPHIFY_DIGEST.md` exists and fresh (<7d) → read local (post-commit hook kept it fresh on dev Mac).
2. Else → read `graphify-platform/snapshots/LATEST_DIGEST.md` (always versioned, guaranteed present).

This makes the layer independent of any single developer's Mac state.

**Do NOT edit by hand** — overwritten on every graphify rebuild.
