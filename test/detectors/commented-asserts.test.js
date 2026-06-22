'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { parseDiff } = require('../../src/diff');
const detector = require('../../src/detectors/commented-asserts');

test('rule name is commented-asserts', () => {
  assert.strictEqual(detector.rule, 'commented-asserts');
});

test('flags a commented-out JS expect assertion', () => {
  const diff = [
    'diff --git a/test/foo.test.js b/test/foo.test.js',
    '--- a/test/foo.test.js',
    '+++ b/test/foo.test.js',
    '@@ -10,3 +10,3 @@',
    "+  // expect(result).toBe(42);",
    '+  doWork();',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].rule, 'commented-asserts');
  assert.strictEqual(findings[0].severity, 'warning');
  assert.strictEqual(findings[0].file, 'test/foo.test.js');
  assert.strictEqual(findings[0].message, 'assertion commented out');
  assert.strictEqual(findings[0].line, 10);
});

test('flags a commented-out Python assert', () => {
  const diff = [
    'diff --git a/tests/test_x.py b/tests/test_x.py',
    '--- a/tests/test_x.py',
    '+++ b/tests/test_x.py',
    '@@ -1,2 +1,2 @@',
    '+    # assert total == expected_total',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].file, 'tests/test_x.py');
});

test('flags a commented-out block-comment assertion', () => {
  const diff = [
    'diff --git a/test/bar.test.js b/test/bar.test.js',
    '--- a/test/bar.test.js',
    '+++ b/test/bar.test.js',
    '@@ -5,1 +5,1 @@',
    '+  /* expect(user.name).toEqual("Ada"); */',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 1);
});

test('flags a chai should-style commented assertion', () => {
  const diff = [
    'diff --git a/test/baz.test.js b/test/baz.test.js',
    '--- a/test/baz.test.js',
    '+++ b/test/baz.test.js',
    '@@ -5,1 +5,1 @@',
    '+  // result.should.equal(3);',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 1);
});

test('clean code with live assertions produces 0 findings', () => {
  const diff = [
    'diff --git a/test/clean.test.js b/test/clean.test.js',
    '--- a/test/clean.test.js',
    '+++ b/test/clean.test.js',
    '@@ -1,4 +1,6 @@',
    "+  // Arrange the input before running the work",
    '+  const result = doWork(input);',
    '+  expect(result).toBe(42);',
    "+  // This should return the expected total for valid users",
    '+  assert.strictEqual(result.ok, true);',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 0);
});

test('prose comments mentioning the words are not flagged', () => {
  const diff = [
    'diff --git a/src/util.js b/src/util.js',
    '--- a/src/util.js',
    '+++ b/src/util.js',
    '@@ -1,3 +1,3 @@',
    '+  // We should validate the input here',
    '+  // This assertion logic lives upstream',
    '+  // expectations are documented in the README',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 0);
});

test('prose using "assert" as a plain verb is not flagged', () => {
  const diff = [
    'diff --git a/src/util.js b/src/util.js',
    '--- a/src/util.js',
    '+++ b/src/util.js',
    '@@ -1,3 +1,3 @@',
    '+  // assert ordering is stable across runs',
    '+  // this should not assert anything yet',
    '+  # assert callers always pass a valid token',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 0);
});
