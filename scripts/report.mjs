#!/usr/bin/env node
'use strict';

/**
 * Veredicto — data report generator.
 *
 * Standalone ESM script that runs the Veredicto detectors over a corpus of
 * diffs and emits a markdown report to stdout. This is the raw material for a
 * launch post: "Analyzed N PRs/diffs — X% showed test-gaming signals", with a
 * per-rule breakdown and a few concrete examples.
 *
 * INPUT (pick one):
 *   - A directory argument: every `*.diff` / `*.patch` file inside it (recursive)
 *     is treated as one PR/diff. Multiple directories may be passed.
 *   - File arguments: each `*.diff` / `*.patch` path is one PR/diff.
 *   - stdin: if no path arguments are given, the whole stdin is read as a
 *     single diff (one PR/diff).
 *
 * USAGE:
 *   node scripts/report.mjs ./corpus/                 # all diffs in a dir
 *   node scripts/report.mjs a.diff b.patch            # explicit files
 *   git diff origin/main | node scripts/report.mjs    # one diff via stdin
 *   node scripts/report.mjs ./corpus/ > REPORT.md     # capture the markdown
 *
 * Pure analysis: no network, no mutation of the repo. Reuses the SAME detector
 * registry as the Action (src/registry.js) via createRequire, so the report
 * stays in lock-step with whatever detectors ship.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { analyze } = require('../src/registry.js');

const DIFF_EXTS = new Set(['.diff', '.patch']);

/** Recursively collect *.diff / *.patch files under a directory. */
function collectDiffFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...collectDiffFiles(full));
    } else if (DIFF_EXTS.has(extname(name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

/** Read everything from stdin as a single string (sync, fd 0). */
function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Resolve CLI args into a list of diff "units": { name, diff }.
 * Each unit is one PR/diff that we analyze independently.
 */
function resolveDiffUnits(args) {
  const units = [];
  if (args.length === 0) {
    const stdin = readStdin();
    if (stdin.trim()) units.push({ name: 'stdin', diff: stdin });
    return units;
  }
  for (const arg of args) {
    let st;
    try {
      st = statSync(arg);
    } catch {
      // Skip non-existent paths quietly; the report just sees fewer units.
      continue;
    }
    if (st.isDirectory()) {
      for (const file of collectDiffFiles(arg)) {
        units.push({ name: basename(file), diff: readFileSync(file, 'utf8') });
      }
    } else {
      units.push({ name: basename(arg), diff: readFileSync(arg, 'utf8') });
    }
  }
  return units;
}

/**
 * Run the detectors over each diff unit and aggregate the statistics.
 * @param {Array<{name:string,diff:string}>} units
 */
export function buildReport(units) {
  const total = units.length;
  let flagged = 0;
  const byRule = new Map(); // rule -> { count, units:Set, example }
  const flaggedUnits = []; // { name, findings }

  for (const unit of units) {
    let findings = [];
    try {
      findings = analyze(unit.diff) || [];
    } catch {
      findings = [];
    }
    if (findings.length === 0) continue;
    flagged++;
    flaggedUnits.push({ name: unit.name, findings });
    for (const f of findings) {
      let agg = byRule.get(f.rule);
      if (!agg) {
        agg = { count: 0, units: new Set(), example: null };
        byRule.set(f.rule, agg);
      }
      agg.count++;
      agg.units.add(unit.name);
      if (!agg.example) agg.example = { ...f, unit: unit.name };
    }
  }

  const pct = total === 0 ? 0 : Math.round((flagged / total) * 100);

  return { total, flagged, pct, byRule, flaggedUnits };
}

/** Render the aggregated stats as a markdown document. */
export function renderMarkdown(stats) {
  const { total, flagged, pct, byRule, flaggedUnits } = stats;
  const lines = [];

  lines.push('# Veredicto — test-gaming corpus report');
  lines.push('');
  lines.push(
    `**Analyzed ${total} PRs/diffs — ${pct}% showed test-gaming signals** ` +
      `(${flagged}/${total} flagged).`
  );
  lines.push('');

  // Per-rule breakdown.
  lines.push('## Breakdown by rule');
  lines.push('');
  if (byRule.size === 0) {
    lines.push('_No detectors fired across the corpus._');
  } else {
    lines.push('| Rule | Findings | PRs/diffs affected | Severity |');
    lines.push('| --- | ---: | ---: | --- |');
    const rows = [...byRule.entries()].sort(
      (a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])
    );
    for (const [rule, agg] of rows) {
      lines.push(
        `| \`${rule}\` | ${agg.count} | ${agg.units.size} | ${agg.example.severity} |`
      );
    }
  }
  lines.push('');

  // Examples.
  lines.push('## Examples');
  lines.push('');
  if (byRule.size === 0) {
    lines.push('_Nothing to show — the corpus looks clean._');
  } else {
    const rows = [...byRule.entries()].sort(
      (a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])
    );
    for (const [rule, agg] of rows) {
      const ex = agg.example;
      lines.push(`### \`${rule}\``);
      lines.push('');
      lines.push(`> ${ex.message}`);
      lines.push('');
      lines.push(`- **Where:** \`${ex.file}\`:${ex.line} (in ${ex.unit})`);
      lines.push(`- **Severity:** ${ex.severity}`);
      lines.push('');
    }
  }

  // Flagged diffs roster (compact).
  if (flaggedUnits.length > 0) {
    lines.push('## Flagged diffs');
    lines.push('');
    for (const u of flaggedUnits) {
      lines.push(`- \`${u.name}\` — ${u.findings.length} finding(s)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/** Entry point: resolve units, build stats, print markdown. */
export function run(argv) {
  const units = resolveDiffUnits(argv);
  const stats = buildReport(units);
  return renderMarkdown(stats);
}

// Only execute when invoked directly (not when imported by a test).
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  process.stdout.write(run(process.argv.slice(2)) + '\n');
}
