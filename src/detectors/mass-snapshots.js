'use strict';

/**
 * Veredicto detector — mass-snapshots.
 *
 * Flags snapshot artifacts (`*.snap` files or anything under a
 * `__snapshots__/` directory) that are regenerated in bulk: when the combined
 * churn (added + removed lines) for the file is >= THRESHOLD, the snapshot was
 * almost certainly re-baselined wholesale rather than reviewed. Bulk-accepting
 * regenerated snapshots is a classic way to make failing tests "pass" without
 * inspecting what actually changed.
 *
 * Conservative by design:
 *  - Only inspects snapshot files (`.snap` / `__snapshots__/`); ordinary source
 *    and test changes are never considered.
 *  - Requires substantial churn (>= 20 lines) so small, intentional snapshot
 *    edits don't trip the rule.
 */

const THRESHOLD = 20;

/** True when the path is a snapshot artifact. */
function isSnapshotFile(file) {
  if (typeof file !== 'string') return false;
  return file.endsWith('.snap') || file.includes('__snapshots__/');
}

function detect(files) {
  const findings = [];
  for (const f of files) {
    if (!isSnapshotFile(f.file)) continue;
    const churn = f.added.length + f.removed.length;
    if (churn < THRESHOLD) continue;
    // Anchor the finding to the first added line if present, else line 1.
    const line = f.added.length ? f.added[0].line : 1;
    findings.push({
      rule: 'mass-snapshots',
      severity: 'warning',
      file: f.file,
      line,
      message: `${churn} snapshot lines bulk-regenerated; review the change instead of re-baselining.`,
    });
  }
  return findings;
}

module.exports = { rule: 'mass-snapshots', detect };
