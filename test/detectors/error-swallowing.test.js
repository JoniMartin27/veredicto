'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { parseDiff } = require('../../src/diff');
const detector = require('../../src/detectors/error-swallowing');

test('rule id is error-swallowing', () => {
  assert.strictEqual(detector.rule, 'error-swallowing');
});

test('flags "npm test || true" as an error', () => {
  const diff = [
    'diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml',
    '--- a/.github/workflows/ci.yml',
    '+++ b/.github/workflows/ci.yml',
    '@@ -1,1 +1,1 @@',
    '+      run: npm test || true',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].rule, 'error-swallowing');
  assert.strictEqual(findings[0].severity, 'error');
  assert.ok(findings[0].line >= 1);
  assert.match(findings[0].message, /swallow/i);
});

test('flags --passWithNoTests as an error', () => {
  const diff = [
    'diff --git a/package.json b/package.json',
    '--- a/package.json',
    '+++ b/package.json',
    '@@ -1,1 +1,1 @@',
    '+    "test": "jest --passWithNoTests"',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].severity, 'error');
});

test('flags "exit 0" right after a test command', () => {
  const diff = [
    'diff --git a/scripts/test.sh b/scripts/test.sh',
    '--- a/scripts/test.sh',
    '+++ b/scripts/test.sh',
    '@@ -1,2 +1,2 @@',
    '+pytest tests/',
    '+exit 0',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].severity, 'error');
  assert.match(findings[0].message, /exit status/i);
});

test('flags "set +e" as a warning', () => {
  const diff = [
    'diff --git a/scripts/run.sh b/scripts/run.sh',
    '--- a/scripts/run.sh',
    '+++ b/scripts/run.sh',
    '@@ -1,1 +1,1 @@',
    '+set +e',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].severity, 'warning');
});

test('flags xfail(strict=False) as a warning', () => {
  const diff = [
    'diff --git a/tests/test_x.py b/tests/test_x.py',
    '--- a/tests/test_x.py',
    '+++ b/tests/test_x.py',
    '@@ -1,1 +1,1 @@',
    '+@pytest.mark.xfail(strict=False)',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].severity, 'warning');
});

test('flags "# noqa" on an assert line as a warning', () => {
  const diff = [
    'diff --git a/tests/test_y.py b/tests/test_y.py',
    '--- a/tests/test_y.py',
    '+++ b/tests/test_y.py',
    '@@ -1,1 +1,1 @@',
    '+    assert result == expected  # noqa',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].severity, 'warning');
});

test('flags an empty catch around an assertion', () => {
  const diff = [
    'diff --git a/test/foo.test.js b/test/foo.test.js',
    '--- a/test/foo.test.js',
    '+++ b/test/foo.test.js',
    '@@ -1,3 +1,5 @@',
    '+  try {',
    '+    assert.strictEqual(add(1, 2), 3);',
    '+  } catch (e) {}',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].severity, 'warning');
  assert.match(findings[0].message, /Empty catch/i);
});

// --- Negative cases: clean code must produce zero findings ---------------

test('does NOT flag a legitimate "|| true" that is not a test command', () => {
  const diff = [
    'diff --git a/scripts/clean.sh b/scripts/clean.sh',
    '--- a/scripts/clean.sh',
    '+++ b/scripts/clean.sh',
    '@@ -1,1 +1,1 @@',
    '+  rm -f cache.tmp || true',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 0);
});

test('does NOT flag a real error handler with logging', () => {
  const diff = [
    'diff --git a/src/api.js b/src/api.js',
    '--- a/src/api.js',
    '+++ b/src/api.js',
    '@@ -1,5 +1,5 @@',
    '+  try {',
    '+    const data = await fetchUser(id);',
    '+    return data;',
    '+  } catch (e) {',
    '+    logger.error(e);',
    '+    throw e;',
    '+  }',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 0);
});

test('does NOT flag "exit 0" at the end of a non-test script', () => {
  const diff = [
    'diff --git a/scripts/deploy.sh b/scripts/deploy.sh',
    '--- a/scripts/deploy.sh',
    '+++ b/scripts/deploy.sh',
    '@@ -1,2 +1,2 @@',
    '+echo "done deploying"',
    '+exit 0',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 0);
});

test('does NOT flag normal test code without swallowing', () => {
  const diff = [
    'diff --git a/test/math.test.js b/test/math.test.js',
    '--- a/test/math.test.js',
    '+++ b/test/math.test.js',
    '@@ -1,4 +1,4 @@',
    '+test("adds", () => {',
    '+  assert.strictEqual(add(2, 2), 4);',
    '+});',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 0);
});

test('does NOT flag an empty catch with no assert nearby', () => {
  const diff = [
    'diff --git a/src/util.js b/src/util.js',
    '--- a/src/util.js',
    '+++ b/src/util.js',
    '@@ -1,3 +1,3 @@',
    '+  try {',
    '+    JSON.parse(raw);',
    '+  } catch (e) {}',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 0);
});

test('does NOT flag "# noqa" on a non-assert line', () => {
  const diff = [
    'diff --git a/src/config.py b/src/config.py',
    '--- a/src/config.py',
    '+++ b/src/config.py',
    '@@ -1,1 +1,1 @@',
    '+import os  # noqa',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 0);
});
