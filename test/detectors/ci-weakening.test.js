'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseDiff } = require('../../src/diff');
const detector = require('../../src/detectors/ci-weakening');

test('flags continue-on-error: true added to a CI step', () => {
  const diff = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -10,3 +10,4 @@
       - name: Run tests
+        continue-on-error: true
         run: npm test
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'ci-weakening');
  assert.equal(findings[0].severity, 'error');
  assert.equal(findings[0].file, '.github/workflows/ci.yml');
  assert.match(findings[0].message, /continue-on-error/);
});

test('flags "|| true" appended to a test command', () => {
  const diff = `diff --git a/.github/workflows/test.yml b/.github/workflows/test.yml
--- a/.github/workflows/test.yml
+++ b/.github/workflows/test.yml
@@ -5,2 +5,2 @@
-        run: npm test
+        run: npm test || true
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'error');
  assert.match(findings[0].message, /swallows test failures/);
});

test('flags removal of a CI step that runs tests', () => {
  const diff = `diff --git a/.gitlab-ci.yml b/.gitlab-ci.yml
--- a/.gitlab-ci.yml
+++ b/.gitlab-ci.yml
@@ -1,5 +1,2 @@
 build:
   script:
-    - npm ci
-    - npm test
+    - npm ci
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'error');
  assert.match(findings[0].message, /runs tests was removed/);
});

test('flags an inflated timeout as a warning', () => {
  const diff = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -3,2 +3,3 @@
     runs-on: ubuntu-latest
+    timeout-minutes: 600
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warning');
  assert.match(findings[0].message, /timeout inflated/);
});

test('flags an inflated retry count as a warning', () => {
  const diff = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -8,2 +8,3 @@
       - name: Flaky tests
+        retries: 10
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warning');
  assert.match(findings[0].message, /retry count inflated/);
});

test('does NOT flag legitimate CI additions (new test step, normal timeout)', () => {
  const diff = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -3,4 +3,8 @@
     runs-on: ubuntu-latest
+    timeout-minutes: 15
     steps:
+      - name: Run tests
+        run: npm test
+      - name: Lint
+        run: npm run lint
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 0);
});

test('does NOT flag "|| true" in a non-CI shell script', () => {
  const diff = `diff --git a/scripts/setup.sh b/scripts/setup.sh
--- a/scripts/setup.sh
+++ b/scripts/setup.sh
@@ -1,2 +1,3 @@
 #!/bin/sh
+npm test || true
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 0);
});

test('does NOT flag a renamed/reordered test step (removal paired with addition)', () => {
  const diff = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -5,3 +5,3 @@
-        run: npm test
+        name: Tests
+        run: npm test
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 0);
});
