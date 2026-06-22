'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseDiff } = require('../../src/diff');
const detector = require('../../src/detectors/skipped-tests');

/** Build a one-file unified diff whose added lines are `lines`. */
function diffOf(file, lines) {
  const header =
    `diff --git a/${file} b/${file}\n` +
    `--- a/${file}\n` +
    `+++ b/${file}\n` +
    `@@ -1,0 +1,${lines.length} @@\n`;
  return header + lines.map((l) => `+${l}`).join('\n') + '\n';
}

test('detector exposes the correct rule id', () => {
  assert.strictEqual(detector.rule, 'skipped-tests');
});

test('positive: flags it.skip / describe.only / xit / pytest.mark.skip / unittest.skip', () => {
  const diff = diffOf('test/sample.test.js', [
    "it.skip('does a thing', () => {});",
    "describe.only('focused suite', () => {});",
    "xit('disabled spec', () => {});",
    "test.todo('write me later');",
  ]);
  const py = diffOf('tests/test_sample.py', [
    '@pytest.mark.skip(reason="flaky")',
    '@unittest.skip("broken")',
    '@pytest.mark.xfail',
  ]);
  const findings = detector.detect([...parseDiff(diff), ...parseDiff(py)]);

  assert.strictEqual(findings.length, 7);
  for (const fnd of findings) {
    assert.strictEqual(fnd.rule, 'skipped-tests');
    assert.strictEqual(fnd.severity, 'warning');
    assert.match(fnd.message, /silenced/i);
    assert.ok(typeof fnd.line === 'number' && fnd.line >= 1);
  }
});

test('negative: clean test code produces zero findings', () => {
  const diff = diffOf('test/sample.test.js', [
    "it('adds numbers', () => { assert.equal(add(1, 2), 3); });",
    "describe('math', () => {});",
    "test('subtracts', () => {});",
    'const monitor = { skipped: 0 }; // a property named skipped, not a skip',
    'function describeThing() { return onlyOne(); }',
    "logger.info('skipping cache for this request');",
  ]);
  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 0);
});

test('negative: empty input is safe', () => {
  assert.deepStrictEqual(detector.detect([]), []);
  assert.deepStrictEqual(detector.detect(undefined), []);
});
