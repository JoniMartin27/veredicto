'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { parseDiff } = require('../../src/diff');
const detector = require('../../src/detectors/mass-snapshots');

function diffFor(file, addedLines, removedLines = []) {
  const body = [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${removedLines.length} +1,${addedLines.length} @@`,
    ...removedLines.map((l) => `-${l}`),
    ...addedLines.map((l) => `+${l}`),
  ];
  return body.join('\n');
}

function lines(n, prefix = 'exports[`x ${i}`] = `value') {
  return Array.from({ length: n }, (_, i) => `${prefix} ${i}`);
}

test('exports the plugin contract', () => {
  assert.equal(detector.rule, 'mass-snapshots');
  assert.equal(typeof detector.detect, 'function');
});

test('positive: a .snap file with >= 20 churn lines is flagged', () => {
  const diff = diffFor('test/__snapshots__/App.test.js.snap', lines(15), lines(10));
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 1);
  const f = findings[0];
  assert.equal(f.rule, 'mass-snapshots');
  assert.equal(f.severity, 'warning');
  assert.equal(f.file, 'test/__snapshots__/App.test.js.snap');
  assert.ok(f.line >= 1);
  assert.match(f.message, /25 snapshot lines bulk-regenerated/);
});

test('positive: __snapshots__/ dir without .snap extension is also flagged', () => {
  const diff = diffFor('src/__snapshots__/foo', lines(20));
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'src/__snapshots__/foo');
});

test('negative: ordinary source change is never flagged', () => {
  const diff = diffFor('src/util.js', lines(40, 'const v = '), lines(30, 'const w = '));
  const findings = detector.detect(parseDiff(diff));
  assert.deepEqual(findings, []);
});

test('negative: a small snapshot edit (below threshold) is not flagged', () => {
  const diff = diffFor('test/__snapshots__/App.test.js.snap', lines(5), lines(5));
  const findings = detector.detect(parseDiff(diff));
  assert.deepEqual(findings, []);
});

test('negative: a non-snapshot test file with large churn is not flagged', () => {
  const diff = diffFor('test/App.test.js', lines(50, 'expect(x).toBe'));
  const findings = detector.detect(parseDiff(diff));
  assert.deepEqual(findings, []);
});
