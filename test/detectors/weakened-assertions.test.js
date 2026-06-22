'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseDiff } = require('../../src/diff');
const detector = require('../../src/detectors/weakened-assertions');

test('flags a strict matcher weakened to toBeTruthy on the same subject', () => {
  const diff = `diff --git a/math.test.js b/math.test.js
--- a/math.test.js
+++ b/math.test.js
@@ -1,3 +1,3 @@
 describe('math', () => {
-  it('adds', () => { expect(add(1, 2)).toBe(3); });
+  it('adds', () => { expect(add(1, 2)).toBeTruthy(); });
 });
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'weakened-assertions');
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].file, 'math.test.js');
  assert.match(findings[0].message, /weakened/);
});

test('flags toEqual weakened to toBeDefined', () => {
  const diff = `diff --git a/api.spec.ts b/api.spec.ts
--- a/api.spec.ts
+++ b/api.spec.ts
@@ -1,2 +1,2 @@
-  expect(response.body).toEqual({ ok: true });
+  expect(response.body).toBeDefined();
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'api.spec.ts');
});

test('does NOT flag a strict assertion whose expected value merely changed', () => {
  const diff = `diff --git a/math.test.js b/math.test.js
--- a/math.test.js
+++ b/math.test.js
@@ -1,1 +1,1 @@
-  expect(add(1, 2)).toBe(3);
+  expect(add(1, 2)).toBe(4);
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 0);
});

test('does NOT flag unrelated strict-removal and weak-addition (different subjects)', () => {
  const diff = `diff --git a/math.test.js b/math.test.js
--- a/math.test.js
+++ b/math.test.js
@@ -1,4 +1,4 @@
-  expect(oldThing).toBe(3);
+  expect(brandNewThing).toBeTruthy();
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 0);
});

test('does NOT flag adding a brand-new weak assertion (no matching removal)', () => {
  const diff = `diff --git a/math.test.js b/math.test.js
--- a/math.test.js
+++ b/math.test.js
@@ -1,2 +1,3 @@
 describe('math', () => {
+  it('exists', () => { expect(thing).toBeDefined(); });
 });
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 0);
});

test('does NOT flag changes to non-test source files', () => {
  const diff = `diff --git a/src/math.js b/src/math.js
--- a/src/math.js
+++ b/src/math.js
@@ -1,2 +1,2 @@
-  expect(add(1, 2)).toBe(3);
+  expect(add(1, 2)).toBeTruthy();
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 0);
});

test('does NOT flag a strict matcher replaced by another strict matcher', () => {
  const diff = `diff --git a/math.test.js b/math.test.js
--- a/math.test.js
+++ b/math.test.js
@@ -1,1 +1,1 @@
-  expect(result).toBe(3);
+  expect(result).toStrictEqual(3);
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 0);
});
