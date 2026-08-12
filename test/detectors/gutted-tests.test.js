'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { parseDiff } = require('../../src/diff');
const detector = require('../../src/detectors/gutted-tests');

/** Build a unified diff for one file from `-`/`+` prefixed lines. */
function diff(file, lines) {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${lines.length} +1,${lines.length} @@`,
    ...lines,
  ].join('\n');
}

function run(file, lines) {
  return detector.detect(parseDiff(diff(file, lines)));
}

test('detector shape matches the plugin contract', () => {
  assert.strictEqual(detector.rule, 'gutted-tests');
  assert.strictEqual(typeof detector.detect, 'function');
});

test('positive: the only assertion is removed, the test case stays', () => {
  const f = run('test/cart.test.js', ['-    expect(subtotal([])).toBe(0);']);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].rule, 'gutted-tests');
  assert.strictEqual(f[0].severity, 'warning');
  assert.match(f[0].message, /1 assertion removed/);
});

test('positive: counts several gutted assertions', () => {
  const f = run('test/cart.test.js', [
    '-    expect(a).toBe(1);',
    '-    expect(b).toBe(2);',
    '-    expect(c).toBe(3);',
  ]);
  assert.strictEqual(f.length, 1);
  assert.match(f[0].message, /3 assertions removed/);
});

test('positive: python and node:assert styles', () => {
  assert.strictEqual(run('test_cart.py', ['-    assert total == 20']).length, 1);
  assert.strictEqual(run('test/cart.test.js', ['-  assert.strictEqual(total, 20);']).length, 1);
  assert.strictEqual(run('test_cart.py', ['-        self.assertEqual(total, 20)']).length, 1);
});

test('negative: assertions replaced by other assertions (a rewrite)', () => {
  assert.strictEqual(
    run('test/cart.test.js', [
      '-    expect(total).toBe(20);',
      '+    expect(total).toStrictEqual(20);',
    ]).length,
    0
  );
});

test('negative: the whole test case was deleted — deleted-tests owns that', () => {
  assert.strictEqual(
    run('test/cart.test.js', [
      "-  it('sums line items', () => {",
      '-    expect(subtotal(items)).toBe(20);',
      '-  });',
    ]).length,
    0
  );
});

test('negative: a new test case is added in the same diff', () => {
  assert.strictEqual(
    run('test/cart.test.js', [
      '-    expect(total).toBe(20);',
      "+  it('sums line items', () => {",
      '+    expect(subtotal(items)).toBe(20);',
      '+  });',
    ]).length,
    0
  );
});

test('negative: production code is never considered', () => {
  assert.strictEqual(run('src/cart.js', ['-  assert(total >= 0);']).length, 0);
});

test('negative: removing a non-assertion line (setup, log, comment)', () => {
  assert.strictEqual(
    run('test/cart.test.js', [
      '-    const items = [{ price: 10, qty: 2 }];',
      '-    console.log(items);',
      '-    // expect(total).toBe(20);',
    ]).length,
    0
  );
});

test('negative: an empty diff produces nothing', () => {
  assert.strictEqual(detector.detect([]).length, 0);
});

test('negative: an assertion commented out is commented-asserts territory, not a double report', () => {
  assert.strictEqual(
    run('test/cart.test.js', [
      '-    expect(discount(100, 25)).toBe(75);',
      '+    // expect(discount(100, 25)).toBe(75);',
    ]).length,
    0
  );
});
