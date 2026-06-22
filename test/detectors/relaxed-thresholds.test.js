'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { parseDiff } = require('../../src/diff');
const detector = require('../../src/detectors/relaxed-thresholds');

test('rule id is relaxed-thresholds', () => {
  assert.strictEqual(detector.rule, 'relaxed-thresholds');
});

test('flags a coverage threshold lowered in jest.config.js', () => {
  const diff = [
    'diff --git a/jest.config.js b/jest.config.js',
    '--- a/jest.config.js',
    '+++ b/jest.config.js',
    '@@ -1,5 +1,5 @@',
    ' coverageThreshold: {',
    '   global: {',
    '-    branches: 90,',
    '+    branches: 70,',
    '   },',
    ' },',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 1);
  const fnd = findings[0];
  assert.strictEqual(fnd.rule, 'relaxed-thresholds');
  assert.strictEqual(fnd.severity, 'error');
  assert.strictEqual(fnd.file, 'jest.config.js');
  assert.ok(fnd.line >= 1);
  assert.match(fnd.message, /branches/);
  assert.match(fnd.message, /90/);
  assert.match(fnd.message, /70/);
});

test('flags a lowered threshold in package.json with quoted keys', () => {
  const diff = [
    'diff --git a/package.json b/package.json',
    '--- a/package.json',
    '+++ b/package.json',
    '@@ -10,3 +10,3 @@',
    '-      "lines": 85,',
    '+      "lines": 50,',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].file, 'package.json');
});

test('flags minCoverage lowered in sonar properties (key=value form)', () => {
  const diff = [
    'diff --git a/sonar-project.properties b/sonar-project.properties',
    '--- a/sonar-project.properties',
    '+++ b/sonar-project.properties',
    '@@ -1,1 +1,1 @@',
    '-minCoverage=80',
    '+minCoverage=60',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 1);
  assert.match(findings[0].message, /mincoverage/i);
});

test('does NOT flag raising a threshold (clean, honest change)', () => {
  const diff = [
    'diff --git a/jest.config.js b/jest.config.js',
    '--- a/jest.config.js',
    '+++ b/jest.config.js',
    '@@ -1,3 +1,3 @@',
    '-    branches: 70,',
    '+    branches: 90,',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 0);
});

test('does NOT flag an unchanged threshold value', () => {
  const diff = [
    'diff --git a/jest.config.js b/jest.config.js',
    '--- a/jest.config.js',
    '+++ b/jest.config.js',
    '@@ -1,3 +1,3 @@',
    '-    branches: 80, // old comment',
    '+    branches: 80, // new comment',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 0);
});

test('does NOT flag a lowered number in a non-config source file', () => {
  const diff = [
    'diff --git a/src/app.js b/src/app.js',
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -1,1 +1,1 @@',
    '-  const lines = 90;',
    '+  const lines = 12;',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 0);
});

test('does NOT flag unrelated numeric keys in a config file', () => {
  const diff = [
    'diff --git a/package.json b/package.json',
    '--- a/package.json',
    '+++ b/package.json',
    '@@ -1,1 +1,1 @@',
    '-  "maxWorkers": 8,',
    '+  "maxWorkers": 4,',
  ].join('\n');

  const findings = detector.detect(parseDiff(diff));
  assert.strictEqual(findings.length, 0);
});
