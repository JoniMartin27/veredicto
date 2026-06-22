'use strict';

const test = require('node:test');
const assert = require('node:assert');
const gl = require('../../src/ci/gitlab');

test('isGitLab: true when GITLAB_CI=true', () => {
  assert.equal(gl.isGitLab({ GITLAB_CI: 'true' }), true);
});

test('isGitLab: true when CI_PROJECT_ID is set', () => {
  assert.equal(gl.isGitLab({ CI_PROJECT_ID: '42' }), true);
});

test('isGitLab: false outside GitLab', () => {
  assert.equal(gl.isGitLab({ GITHUB_ACTIONS: 'true' }), false);
  assert.equal(gl.isGitLab({}), false);
});

test('resolveBaseRef: prefers CI_MERGE_REQUEST_DIFF_BASE_SHA', () => {
  const base = gl.resolveBaseRef({
    CI_MERGE_REQUEST_DIFF_BASE_SHA: 'aaaa1111',
    CI_COMMIT_BEFORE_SHA: 'bbbb2222',
  });
  assert.equal(base, 'aaaa1111');
});

test('resolveBaseRef: falls back to CI_COMMIT_BEFORE_SHA', () => {
  const base = gl.resolveBaseRef({ CI_COMMIT_BEFORE_SHA: 'bbbb2222' });
  assert.equal(base, 'bbbb2222');
});

test('resolveBaseRef: ignores the all-zero SHA (first push) and falls back', () => {
  const base = gl.resolveBaseRef({
    CI_MERGE_REQUEST_DIFF_BASE_SHA: gl.ZERO_SHA,
    CI_COMMIT_BEFORE_SHA: 'cccc3333',
  });
  assert.equal(base, 'cccc3333');
});

test('resolveBaseRef: null when nothing usable', () => {
  assert.equal(gl.resolveBaseRef({}), null);
  assert.equal(gl.resolveBaseRef({ CI_COMMIT_BEFORE_SHA: gl.ZERO_SHA }), null);
});

test('buildDiffArgs: uses base..HEAD with --unified=0', () => {
  assert.deepEqual(gl.buildDiffArgs('aaaa1111'), ['diff', '--unified=0', 'aaaa1111..HEAD']);
});

test('buildDiffArgs: falls back to HEAD~1..HEAD when no base', () => {
  assert.deepEqual(gl.buildDiffArgs(null), ['diff', '--unified=0', 'HEAD~1..HEAD']);
});

test('getDiff: diffs against the MR base via injected git runner', () => {
  const calls = [];
  const runGit = (args) => {
    calls.push(args);
    if (args[0] === 'diff') return 'DIFF_OUTPUT';
    return '';
  };
  const out = gl.getDiff({ CI_MERGE_REQUEST_DIFF_BASE_SHA: 'aaaa1111' }, runGit);
  assert.equal(out, 'DIFF_OUTPUT');
  const diffCall = calls.find((c) => c[0] === 'diff');
  assert.deepEqual(diffCall, ['diff', '--unified=0', 'aaaa1111..HEAD']);
  // A fetch is attempted to materialize the base on shallow checkouts.
  assert.ok(calls.some((c) => c[0] === 'fetch'));
});

test('getDiff: falls back to HEAD~1..HEAD with no MR variables', () => {
  const calls = [];
  const runGit = (args) => {
    calls.push(args);
    return args[0] === 'diff' ? 'FALLBACK_DIFF' : '';
  };
  const out = gl.getDiff({}, runGit);
  assert.equal(out, 'FALLBACK_DIFF');
  assert.deepEqual(calls.find((c) => c[0] === 'diff'), ['diff', '--unified=0', 'HEAD~1..HEAD']);
  // No base => no fetch attempted.
  assert.ok(!calls.some((c) => c[0] === 'fetch'));
});

test('getDiff: returns empty string when git produces nothing', () => {
  const out = gl.getDiff({ CI_COMMIT_BEFORE_SHA: 'bbbb2222' }, () => '');
  assert.equal(out, '');
});
