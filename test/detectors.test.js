'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const d = require('../src/detectors');

function diff(parts) {
  return parts.join('\n');
}

test('parseDiff extracts file + added/removed lines', () => {
  const files = d.parseDiff(diff([
    'diff --git a/src/x.js b/src/x.js',
    '--- a/src/x.js',
    '+++ b/src/x.js',
    '@@ -1,2 +1,2 @@',
    '-const a = 1;',
    '+const a = 2;',
  ]));
  assert.equal(files.length, 1);
  assert.equal(files[0].file, 'src/x.js');
  assert.equal(files[0].added[0].content, 'const a = 2;');
  assert.equal(files[0].removed[0].content, 'const a = 1;');
});

test('detects deleted tests', () => {
  const f = d.analyze(diff([
    'diff --git a/foo.test.js b/foo.test.js',
    '--- a/foo.test.js',
    '+++ b/foo.test.js',
    '@@ -1,6 +1,1 @@',
    "-it('adds', () => { expect(add(1,2)).toBe(3); });",
    "-it('subtracts', () => { expect(sub(2,1)).toBe(1); });",
    "+it('adds', () => { expect(add(1,2)).toBe(3); });",
  ]));
  assert.ok(f.some((x) => x.rule === 'deleted-tests'));
});

test('detects .skip and .only', () => {
  const f = d.analyze(diff([
    'diff --git a/a.spec.ts b/a.spec.ts',
    '--- a/a.spec.ts',
    '+++ b/a.spec.ts',
    '@@ -1,1 +1,2 @@',
    "+it.skip('flaky', () => {});",
    "+describe.only('one', () => {});",
  ]));
  assert.equal(f.filter((x) => x.rule === 'skipped-tests').length, 2);
});

test('detects tautological asserts', () => {
  const f = d.analyze(diff([
    'diff --git a/b.test.js b/b.test.js',
    '--- a/b.test.js',
    '+++ b/b.test.js',
    '@@ -1,1 +1,3 @@',
    '+expect(true).toBe(true);',
    '+assert True',
    '+expect(2).toBe(2);',
  ]));
  assert.ok(f.filter((x) => x.rule === 'tautological-assert').length >= 3);
});

test('detects lowered coverage threshold', () => {
  const f = d.analyze(diff([
    'diff --git a/jest.config.js b/jest.config.js',
    '--- a/jest.config.js',
    '+++ b/jest.config.js',
    '@@ -1,1 +1,1 @@',
    '-      branches: 80,',
    '+      branches: 40,',
  ]));
  assert.ok(f.some((x) => x.rule === 'relaxed-threshold' && /80 → 40/.test(x.message)));
});

test('clean diff produces no findings', () => {
  const f = d.analyze(diff([
    'diff --git a/src/add.js b/src/add.js',
    '--- a/src/add.js',
    '+++ b/src/add.js',
    '@@ -1,1 +1,1 @@',
    '-const add = (a, b) => a - b;',
    '+const add = (a, b) => a + b;',
  ]));
  assert.equal(f.length, 0);
});
