'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { parseDiff } = require('../../src/diff');
const detector = require('../../src/detectors/circular-mocks');

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
  assert.strictEqual(detector.rule, 'circular-mocks');
  assert.strictEqual(typeof detector.detect, 'function');
});

test('positive: jest.mock of the module under test + assert on the mock', () => {
  const f = run('foo.test.js', [
    'jest.mock("./foo");',
    'import { foo } from "./foo";',
    'test("foo", () => {',
    '  foo();',
    '  expect(foo).toHaveBeenCalled();',
    '});',
  ]);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].severity, 'warning');
  assert.strictEqual(f[0].rule, 'circular-mocks');
  assert.strictEqual(f[0].file, 'foo.test.js');
});

test('positive: vi.mock with relative path and basename match', () => {
  const f = run('components/Bar.spec.tsx', [
    'vi.mock("../components/Bar");',
    'expect(barMock).toHaveBeenCalledWith(1);',
  ]);
  assert.strictEqual(f.length, 1);
});

test('positive: python patch of the module under test', () => {
  const f = run('test_baz.py', [
    'from baz import compute',
    'with patch("baz.compute") as m:',
    '    compute()',
    '    m.assert_called_once()',
  ]);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].severity, 'warning');
});

test('negative: mocking a DEPENDENCY (not the module under test) is fine', () => {
  const f = run('foo.test.js', [
    'jest.mock("./database");',
    'import { foo } from "./foo";',
    'test("foo", () => {',
    '  expect(foo(2, 3)).toBe(5);',
    '  expect(dbMock).toHaveBeenCalled();',
    '});',
  ]);
  assert.strictEqual(f.length, 0);
});

test('negative: mocking module under test but NOT asserting on the mock', () => {
  const f = run('foo.test.js', [
    'jest.mock("./logger");',
    'import { foo } from "./foo";',
    'test("foo", () => {',
    '  expect(foo(2, 3)).toBe(5);',
    '});',
  ]);
  assert.strictEqual(f.length, 0);
});

test('negative: honest test with real calls and value assertions', () => {
  const f = run('sum.test.js', [
    'import { sum } from "./sum";',
    'test("adds", () => {',
    '  expect(sum(2, 3)).toBe(5);',
    '});',
  ]);
  assert.strictEqual(f.length, 0);
});

test('negative: non-test file is ignored', () => {
  const f = run('src/foo.js', [
    'jest.mock("./foo");',
    'expect(fooMock).toHaveBeenCalled();',
  ]);
  assert.strictEqual(f.length, 0);
});

test('negative: commented-out self-mock is ignored', () => {
  const f = run('foo.test.js', [
    '// jest.mock("./foo");',
    'expect(foo).toHaveBeenCalled();',
  ]);
  assert.strictEqual(f.length, 0);
});
