# `scripts/report.mjs` — test-gaming corpus report

A standalone Node ESM script that runs the Veredicto detectors over a batch of
diffs and prints a markdown report to **stdout**. It's the raw material for a
launch post: a headline number, a per-rule breakdown, and concrete examples.

It reuses the **same** detector registry as the Action (`src/registry.js`), so
the report always reflects whatever detectors currently ship — add a detector in
`src/detectors/` and it shows up here automatically.

## Usage

```bash
# Every *.diff / *.patch under a directory (recursive); each file = one PR/diff
node scripts/report.mjs ./corpus/

# Explicit files
node scripts/report.mjs a.diff b.patch

# A single diff piped via stdin (counts as one PR/diff)
git diff origin/main | node scripts/report.mjs

# Capture the markdown into a file
node scripts/report.mjs ./corpus/ > REPORT.md
```

### Input rules

- **Directory args** — every `*.diff` / `*.patch` file inside (recursively) is
  treated as one independent PR/diff.
- **File args** — each path is one PR/diff.
- **stdin** — if no path arguments are given, all of stdin is read as a single
  PR/diff.
- Non-existent paths are skipped silently.

## Output

Markdown with three sections:

1. **Headline** — `Analyzed N PRs/diffs — X% showed test-gaming signals`, where
   a diff "shows signals" if at least one detector fired on it.
2. **Breakdown by rule** — a table of finding counts, affected diffs, and
   severity per rule.
3. **Examples** — one representative finding per rule (message, file:line,
   severity), plus a roster of flagged diffs.

## Notes

- Pure analysis: no network, no repo mutation.
- Zero dependencies — Node builtins only (Node ≥ 20).
- Exit code is `0` even when signals are found; this is a reporting tool, not a
  gate. Use the Action (`src/index.js`) to actually block PRs.
