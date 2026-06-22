'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseDiff } = require('../../src/diff');
const detector = require('../../src/detectors/deleted-tests');

test('flags a net removal of test cases from a test file', () => {
  const diff = `diff --git a/math.test.js b/math.test.js
--- a/math.test.js
+++ b/math.test.js
@@ -1,8 +1,2 @@
 describe('math', () => {
-  it('adds', () => { expect(add(1, 2)).toBe(3); });
-  it('subtracts', () => { expect(sub(2, 1)).toBe(1); });
   it('keeps this one', () => { expect(true).toBe(true); });
 });
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'deleted-tests');
  assert.equal(findings[0].severity, 'error');
  assert.equal(findings[0].file, 'math.test.js');
  assert.match(findings[0].message, /2 test cases removed/);
});

test('flags removed python test functions', () => {
  const diff = `diff --git a/test_math.py b/test_math.py
--- a/test_math.py
+++ b/test_math.py
@@ -1,5 +1,2 @@
-def test_adds():
-    assert add(1, 2) == 3
 def test_keep():
     assert True
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'test_math.py');
  assert.match(findings[0].message, /1 test case removed/);
});

test('does NOT flag a renamed/rewritten test (removal paired with addition)', () => {
  const diff = `diff --git a/math.test.js b/math.test.js
--- a/math.test.js
+++ b/math.test.js
@@ -1,3 +1,3 @@
 describe('math', () => {
-  it('adds numbers', () => { expect(add(1, 2)).toBe(3); });
+  it('adds two numbers correctly', () => { expect(add(1, 2)).toBe(3); });
 });
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 0);
});

test('does NOT flag adding new tests', () => {
  const diff = `diff --git a/math.test.js b/math.test.js
--- a/math.test.js
+++ b/math.test.js
@@ -1,2 +1,4 @@
 describe('math', () => {
+  it('adds', () => { expect(add(1, 2)).toBe(3); });
+  it('subtracts', () => { expect(sub(2, 1)).toBe(1); });
 });
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 0);
});

test('does NOT flag changes to non-test source files', () => {
  const diff = `diff --git a/src/math.js b/src/math.js
--- a/src/math.js
+++ b/src/math.js
@@ -1,4 +1,3 @@
-function it() { return legacy(); }
-test(value);
 function add(a, b) { return a + b; }
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 0);
});
