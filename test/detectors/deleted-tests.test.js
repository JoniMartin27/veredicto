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

test('a test MOVED to another file in the same diff is not a deletion', () => {
  const diff = `diff --git a/test/cart.test.js b/test/cart.test.js
--- a/test/cart.test.js
+++ b/test/cart.test.js
@@ -1,5 +1,2 @@
 describe('cart', () => {
-  it('rejects an out-of-range percentage', () => {
-    expect(() => discount(100, 150)).toThrow(RangeError);
-  });
 });
diff --git a/test/checkout.test.js b/test/checkout.test.js
--- a/test/checkout.test.js
+++ b/test/checkout.test.js
@@ -1,2 +1,5 @@
 describe('checkout', () => {
+  it('rejects an out-of-range percentage', () => {
+    expect(() => discount(100, 150)).toThrow(RangeError);
+  });
 });
`;
  assert.equal(detector.detect(parseDiff(diff)).length, 0);
});

test('a test deleted while a DIFFERENT one is added elsewhere is still a deletion', () => {
  const diff = `diff --git a/test/cart.test.js b/test/cart.test.js
--- a/test/cart.test.js
+++ b/test/cart.test.js
@@ -1,5 +1,2 @@
-  it('rejects an out-of-range percentage', () => {
-    expect(() => discount(100, 150)).toThrow(RangeError);
-  });
diff --git a/test/checkout.test.js b/test/checkout.test.js
--- a/test/checkout.test.js
+++ b/test/checkout.test.js
@@ -1,2 +1,5 @@
+  it('totals an empty cart', () => {
+    expect(subtotal([])).toBe(0);
+  });
`;
  const findings = detector.detect(parseDiff(diff));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'test/cart.test.js');
});

test('python test functions moved between modules are not deletions', () => {
  const diff = `diff --git a/test_cart.py b/test_cart.py
--- a/test_cart.py
+++ b/test_cart.py
@@ -1,3 +1,1 @@
-def test_discount_rejects_out_of_range():
-    assert discount(100, 150) is None
diff --git a/test_checkout.py b/test_checkout.py
--- a/test_checkout.py
+++ b/test_checkout.py
@@ -1,1 +1,3 @@
+def test_discount_rejects_out_of_range():
+    assert discount(100, 150) is None
`;
  assert.equal(detector.detect(parseDiff(diff)).length, 0);
});
