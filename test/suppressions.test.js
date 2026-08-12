'use strict';

/**
 * Tests for the inline suppression directives applied in src/index.js.
 *
 * Two shapes exist and both must keep working:
 *   - line-anchored: the directive sits on the line ABOVE the finding.
 *   - file-level:    rules that describe a whole file report on line 1, where
 *                    there is no line above, so a directive anywhere in the
 *                    file silences them.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { applySuppressions } = require('../src/index');

/** A diff whose added lines are exactly `lines`, starting at line 1. */
function diff(file, lines) {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
  ].join('\n');
}

const finding = (rule, line, file = 'test/a.test.js', severity = 'warning') => ({
  rule,
  severity,
  file,
  line,
  message: 'x',
});

test('a named directive silences that rule on the next line', () => {
  const d = diff('test/a.test.js', ['// veredicto-disable-next-line skipped-tests', 'it.skip("x", () => {});']);
  const out = applySuppressions([finding('skipped-tests', 2)], d);
  assert.strictEqual(out.length, 0);
});

test('a named directive does NOT silence a different rule', () => {
  const d = diff('test/a.test.js', ['// veredicto-disable-next-line mass-snapshots', 'it.skip("x", () => {});']);
  const out = applySuppressions([finding('skipped-tests', 2)], d);
  assert.strictEqual(out.length, 1);
});

test('a bare directive silences every rule on the next line', () => {
  const d = diff('test/a.test.js', ['// veredicto-disable-next-line', 'it.skip("x", () => {});']);
  const out = applySuppressions([finding('skipped-tests', 2), finding('tautological-asserts', 2)], d);
  assert.strictEqual(out.length, 0);
});

test('a directive does not leak to other lines', () => {
  const d = diff('test/a.test.js', ['// veredicto-disable-next-line skipped-tests', 'it.skip("x", () => {});', 'it.skip("y", () => {});']);
  const out = applySuppressions([finding('skipped-tests', 2), finding('skipped-tests', 3)], d);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].line, 3);
});

test('a directive does not leak to another file', () => {
  const d = diff('test/a.test.js', ['// veredicto-disable-next-line skipped-tests', 'it.skip("x", () => {});']);
  const out = applySuppressions([finding('skipped-tests', 2, 'test/b.test.js')], d);
  assert.strictEqual(out.length, 1);
});

// --- file-level findings (reported on line 1, no "line above" exists) ---

test('file-level deleted-tests is silenced by a directive anywhere in the file', () => {
  const d = diff('test/a.test.js', ['// veredicto-disable deleted-tests — moved to the integration suite', 'it("keeps this", () => {});']);
  const out = applySuppressions([finding('deleted-tests', 1, 'test/a.test.js', 'error')], d);
  assert.strictEqual(out.length, 0);
});

test('file-level gutted-tests is silenced by a directive anywhere in the file', () => {
  const d = diff('test/a.test.js', ['const x = 1;', '// veredicto-disable gutted-tests — the assertion was a duplicate']);
  const out = applySuppressions([finding('gutted-tests', 1)], d);
  assert.strictEqual(out.length, 0);
});

test('file-level findings are NOT silenced by a directive naming another rule', () => {
  const d = diff('test/a.test.js', ['// veredicto-disable skipped-tests', 'it("keeps this", () => {});']);
  const out = applySuppressions([finding('deleted-tests', 1, 'test/a.test.js', 'error')], d);
  assert.strictEqual(out.length, 1);
});

test('file-level suppression is scoped to its own file', () => {
  const d = diff('test/a.test.js', ['// veredicto-disable deleted-tests']);
  const out = applySuppressions([finding('deleted-tests', 1, 'test/b.test.js', 'error')], d);
  assert.strictEqual(out.length, 1);
});

test('a diff with no directives changes nothing', () => {
  const d = diff('test/a.test.js', ['it("x", () => {});']);
  const findings = [finding('skipped-tests', 1), finding('deleted-tests', 1)];
  assert.strictEqual(applySuppressions(findings, d).length, 2);
});
