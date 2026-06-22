'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const REPORT_MJS = pathToFileURL(
  path.join(__dirname, '..', '..', 'scripts', 'report.mjs')
).href;
const FIXTURES = path.join(__dirname, '..', 'fixtures', 'report');

// Dynamically import the ESM script from this CommonJS test.
let report;
test('load report.mjs', async () => {
  report = await import(REPORT_MJS);
  assert.strictEqual(typeof report.buildReport, 'function');
  assert.strictEqual(typeof report.renderMarkdown, 'function');
  assert.strictEqual(typeof report.run, 'function');
});

test('buildReport: 1 gaming + 1 clean diff => 50% flagged', () => {
  const units = [
    { name: 'gaming.diff', diff: gamingDiff() },
    { name: 'clean.patch', diff: cleanDiff() },
  ];
  const stats = report.buildReport(units);
  assert.strictEqual(stats.total, 2);
  assert.strictEqual(stats.flagged, 1);
  assert.strictEqual(stats.pct, 50);
  assert.ok(stats.byRule.has('skipped-tests'));
});

test('buildReport: empty corpus => 0% (no division by zero)', () => {
  const stats = report.buildReport([]);
  assert.strictEqual(stats.total, 0);
  assert.strictEqual(stats.flagged, 0);
  assert.strictEqual(stats.pct, 0);
});

test('buildReport: all-clean corpus => 0% flagged', () => {
  const stats = report.buildReport([
    { name: 'a.diff', diff: cleanDiff() },
    { name: 'b.diff', diff: cleanDiff() },
  ]);
  assert.strictEqual(stats.total, 2);
  assert.strictEqual(stats.flagged, 0);
  assert.strictEqual(stats.pct, 0);
});

test('renderMarkdown: headline carries the percentage and counts', () => {
  const md = report.renderMarkdown(
    report.buildReport([
      { name: 'gaming.diff', diff: gamingDiff() },
      { name: 'clean.patch', diff: cleanDiff() },
    ])
  );
  assert.match(md, /Analyzed 2 PRs\/diffs — 50% showed test-gaming signals/);
  assert.match(md, /## Breakdown by rule/);
  assert.match(md, /skipped-tests/);
  assert.match(md, /## Examples/);
});

test('run: reads diff fixtures from a directory and reports 50%', () => {
  const md = report.run([FIXTURES]);
  // The fixtures dir holds one gaming diff and one clean patch.
  assert.match(md, /Analyzed 2 PRs\/diffs — 50% showed test-gaming signals/);
  assert.match(md, /skipped-tests/);
});

test('run: empty args with no stdin => 0 PRs/diffs', () => {
  // In the test runner stdin is not a diff; resolveDiffUnits yields nothing
  // meaningful, so this asserts the headline shape stays valid for 0 units.
  const md = report.renderMarkdown(report.buildReport([]));
  assert.match(md, /Analyzed 0 PRs\/diffs — 0% showed test-gaming signals/);
});

// ── fixtures (inline, so the test is self-contained) ─────────────────────────

function gamingDiff() {
  return [
    'diff --git a/test/math.test.js b/test/math.test.js',
    '--- a/test/math.test.js',
    '+++ b/test/math.test.js',
    '@@ -1,0 +1,3 @@',
    "+it.skip('adds numbers', () => {",
    '+  assert.equal(add(1, 2), 3);',
    '+});',
    '',
  ].join('\n');
}

function cleanDiff() {
  return [
    'diff --git a/src/math.js b/src/math.js',
    '--- a/src/math.js',
    '+++ b/src/math.js',
    '@@ -1,0 +1,3 @@',
    '+function add(a, b) {',
    '+  return a + b;',
    '+}',
    '',
  ].join('\n');
}
