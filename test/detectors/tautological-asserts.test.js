'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { parseDiff } = require('../../src/diff');
const detector = require('../../src/detectors/tautological-asserts');

function diff(file, lines) {
  const body = lines.map((l) => `+${l}`).join('\n');
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -0,0 +1,${lines.length} @@`,
    body,
  ].join('\n');
}

function run(file, lines) {
  return detector.detect(parseDiff(diff(file, lines)));
}

test('detector shape matches the plugin contract', () => {
  assert.strictEqual(detector.rule, 'tautological-asserts');
  assert.strictEqual(typeof detector.detect, 'function');
});

test('positive: flags expect(true).toBe(true)', () => {
  const f = run('foo.test.js', ['expect(true).toBe(true);']);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].severity, 'error');
  assert.strictEqual(f[0].rule, 'tautological-asserts');
});

test('positive: flags same-literal number/string and toEqual', () => {
  assert.strictEqual(run('a.spec.ts', ['expect(42).toBe(42)']).length, 1);
  assert.strictEqual(run('a.spec.ts', ['expect("x").toEqual("x")']).length, 1);
});

test('positive: flags assert(true) and Python assert True / assert 1 == 1', () => {
  assert.strictEqual(run('a.test.js', ['assert(true);']).length, 1);
  assert.strictEqual(run('test_a.py', ['assert True']).length, 1);
  assert.strictEqual(run('test_a.py', ['assert 1 == 1']).length, 1);
});

test('positive: empty test body is a warning', () => {
  const f = run('a.test.js', ['it("does nothing", () => {});']);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].severity, 'warning');
});

test('negative: honest assertions produce zero findings', () => {
  const clean = run('a.test.js', [
    'expect(add(2, 3)).toBe(5);',
    'expect(result).toBe(true);',
    'expect("hello").toEqual(greeting);',
    'assert(user.isActive);',
    'it("adds", () => { expect(sum).toBe(10); });',
  ]);
  assert.strictEqual(clean.length, 0);
});

test('negative: different literals do not fire', () => {
  assert.strictEqual(run('a.test.js', ['expect(1).toBe(2)']).length, 0);
  assert.strictEqual(run('test_a.py', ['assert 1 == 2']).length, 0);
});

test('negative: tautology in NON-test file is ignored', () => {
  assert.strictEqual(run('src/app.js', ['expect(true).toBe(true)']).length, 0);
});

test('negative: commented-out tautology is ignored', () => {
  assert.strictEqual(run('a.test.js', ['// expect(true).toBe(true)']).length, 0);
});
