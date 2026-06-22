'use strict';

/**
 * Tests for the "rules-docs" feature: docs/RULES.md, CONTRIBUTING.md, and the
 * example workflows under examples/. These guard that the documentation stays
 * in sync with the actual detectors (every rule documented, no stale rules) and
 * that the shipped example workflows are well-formed.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DETECTORS_DIR = path.join(ROOT, 'src', 'detectors');

/** The canonical list of rule ids, derived from the detector modules. */
function actualRules() {
  return fs
    .readdirSync(DETECTORS_DIR)
    .filter((n) => n.endsWith('.js'))
    .map((n) => require(path.join(DETECTORS_DIR, n)).rule)
    .sort();
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('docs/RULES.md exists and is non-trivial', () => {
  const md = read('docs/RULES.md');
  assert.ok(md.length > 1000, 'RULES.md should be a real catalog');
});

test('RULES.md documents every detector rule', () => {
  const md = read('docs/RULES.md');
  for (const rule of actualRules()) {
    assert.ok(
      md.includes('`' + rule + '`'),
      `RULES.md is missing a section for rule "${rule}"`
    );
  }
});

test('RULES.md does not reference unknown rules in headings', () => {
  const md = read('docs/RULES.md');
  const known = new Set(actualRules());
  // Rule headings look like:  ### `rule-name`
  const headingRe = /^###\s+`([a-z0-9-]+)`/gm;
  let m;
  while ((m = headingRe.exec(md)) !== null) {
    assert.ok(
      known.has(m[1]),
      `RULES.md documents "${m[1]}" but no such detector exists`
    );
  }
});

test('RULES.md covers exactly the 10 expected rules', () => {
  const expected = [
    'deleted-tests',
    'skipped-tests',
    'tautological-asserts',
    'relaxed-thresholds',
    'mass-snapshots',
    'weakened-assertions',
    'circular-mocks',
    'error-swallowing',
    'ci-weakening',
    'commented-asserts',
  ].sort();
  assert.deepStrictEqual(actualRules(), expected);
  const md = read('docs/RULES.md');
  for (const rule of expected) {
    assert.ok(md.includes('`' + rule + '`'), `RULES.md missing "${rule}"`);
  }
});

test('RULES.md shows a suppression example for each rule', () => {
  const md = read('docs/RULES.md');
  for (const rule of actualRules()) {
    assert.ok(
      md.includes('veredicto-disable-next-line ' + rule),
      `RULES.md should show a suppression example for "${rule}"`
    );
  }
});

test('RULES.md documents both severities', () => {
  const md = read('docs/RULES.md');
  assert.ok(md.includes('`error`'), 'RULES.md should explain error severity');
  assert.ok(md.includes('`warning`'), 'RULES.md should explain warning severity');
});

test('CONTRIBUTING.md exists and explains the detector contract', () => {
  const md = read('CONTRIBUTING.md');
  assert.ok(md.length > 1000, 'CONTRIBUTING.md should be substantial');
  for (const needle of ['rule:', 'detect(', 'parseDiff', 'node --test', 'severity']) {
    assert.ok(md.includes(needle), `CONTRIBUTING.md should mention "${needle}"`);
  }
});

test('two example workflows exist (warn and block)', () => {
  const warn = read('examples/veredicto-warn.yml');
  const block = read('examples/veredicto-block.yml');
  assert.match(warn, /mode:\s*warn/, 'warn example must set mode: warn');
  assert.match(block, /mode:\s*block/, 'block example must set mode: block');
  for (const wf of [warn, block]) {
    assert.match(wf, /on:\s*\n\s*pull_request:/, 'workflow must run on pull_request');
    assert.match(wf, /actions\/checkout@v4/, 'workflow must check out the code');
    assert.match(wf, /fetch-depth:\s*0/, 'workflow needs full history to diff');
    assert.match(wf, /JoniMartin27\/veredicto@v0/, 'workflow must use the action');
  }
});
