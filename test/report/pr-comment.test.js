'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const reporter = require('../../src/report/pr-comment');

/** Capture the original env keys we mutate so each test starts clean. */
const ENV_KEYS = [
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'INPUT_GITHUB_TOKEN',
  'GITHUB_REPOSITORY',
  'GITHUB_EVENT_PATH',
];

let savedEnv;
let savedFetch;
let eventFile;

/** Write a fake GitHub event payload to a temp file and point env at it. */
function writeEvent(payload) {
  eventFile = path.join(os.tmpdir(), `veredicto-event-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(eventFile, JSON.stringify(payload), 'utf8');
  process.env.GITHUB_EVENT_PATH = eventFile;
}

/** A small mock fetch that records calls and returns scripted responses. */
function mockFetch(script) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    const next = script.shift();
    if (!next) throw new Error(`unexpected fetch call to ${url}`);
    return {
      ok: next.ok !== false,
      status: next.status || 200,
      json: async () => (next.json === undefined ? [] : next.json),
    };
  };
  global.fetch._calls = calls;
  return calls;
}

const SAMPLE_FINDINGS = [
  { rule: 'skipped-tests', severity: 'warning', file: 'test/a.test.js', line: 3, message: 'Test silenced via .skip.' },
  { rule: 'deleted-tests', severity: 'error', file: 'test/b.test.js', line: 1, message: 'A passing test was deleted.' },
];

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  savedFetch = global.fetch;
  // Clean slate.
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  global.fetch = savedFetch;
  if (eventFile && fs.existsSync(eventFile)) {
    try {
      fs.unlinkSync(eventFile);
    } catch {
      /* ignore */
    }
  }
  eventFile = undefined;
});

test('module exposes postComment (and a post alias)', () => {
  assert.strictEqual(typeof reporter.postComment, 'function');
  assert.strictEqual(typeof reporter.post, 'function');
});

test('no GITHUB_TOKEN: does nothing and never throws', async () => {
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  writeEvent({ pull_request: { number: 7 } });
  let fetched = false;
  global.fetch = async () => {
    fetched = true;
    return { ok: true, status: 200, json: async () => [] };
  };
  const result = await reporter.postComment(SAMPLE_FINDINGS);
  assert.strictEqual(result, false);
  assert.strictEqual(fetched, false, 'must not hit the network without a token');
});

test('not a PR context: does nothing', async () => {
  process.env.GITHUB_TOKEN = 't';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  writeEvent({ push: true }); // no pull_request
  let fetched = false;
  global.fetch = async () => {
    fetched = true;
    return { ok: true, status: 200, json: async () => [] };
  };
  const result = await reporter.postComment(SAMPLE_FINDINGS);
  assert.strictEqual(result, false);
  assert.strictEqual(fetched, false);
});

test('positive: posts a NEW sticky comment when none exists', async () => {
  process.env.GITHUB_TOKEN = 'secret-token';
  process.env.GITHUB_REPOSITORY = 'JoniMartin27/veredicto';
  writeEvent({ pull_request: { number: 42 } });

  const calls = mockFetch([
    { json: [] }, // list comments -> none with marker
    { json: { id: 999 } }, // create comment
  ]);

  const result = await reporter.postComment(SAMPLE_FINDINGS);
  assert.strictEqual(result, true);
  assert.strictEqual(calls.length, 2);

  // First call lists comments (GET) for the PR.
  assert.match(calls[0].url, /issues\/42\/comments/);
  assert.strictEqual((calls[0].opts.method || 'GET'), 'GET');

  // Second call creates the comment (POST) with marker + table + landing link.
  const create = calls[1];
  assert.match(create.url, /issues\/42\/comments$/);
  assert.strictEqual(create.opts.method, 'POST');
  assert.match(create.opts.headers.Authorization, /Bearer secret-token/);
  const body = JSON.parse(create.opts.body).body;
  assert.ok(body.includes('<!-- veredicto -->'), 'must carry the sticky marker');
  assert.match(body, /skipped-tests/);
  assert.match(body, /deleted-tests/);
  assert.match(body, /https:\/\/fervon\.dev\/veredicto\//);
  assert.match(body, /\| Severity \| Rule \| File \| Line \| Detail \|/);
});

test('sticky: UPDATES the existing comment instead of duplicating', async () => {
  process.env.GITHUB_TOKEN = 'secret-token';
  process.env.GITHUB_REPOSITORY = 'JoniMartin27/veredicto';
  writeEvent({ pull_request: { number: 5 } });

  const calls = mockFetch([
    { json: [
      { id: 1, body: 'unrelated human comment' },
      { id: 1234, body: 'previous run\n<!-- veredicto -->\nold table' },
    ] }, // list -> finds existing sticky id 1234
    { json: { id: 1234 } }, // patch
  ]);

  const result = await reporter.postComment(SAMPLE_FINDINGS);
  assert.strictEqual(result, true);
  assert.strictEqual(calls.length, 2);

  const patch = calls[1];
  assert.strictEqual(patch.opts.method, 'PATCH');
  assert.match(patch.url, /issues\/comments\/1234$/);
  const body = JSON.parse(patch.opts.body).body;
  assert.ok(body.includes('<!-- veredicto -->'));
});

test('clean diff: renders the no-signals body', async () => {
  process.env.GITHUB_TOKEN = 'secret-token';
  process.env.GITHUB_REPOSITORY = 'JoniMartin27/veredicto';
  writeEvent({ pull_request: { number: 8 } });

  const calls = mockFetch([{ json: [] }, { json: { id: 1 } }]);
  const result = await reporter.postComment([]);
  assert.strictEqual(result, true);
  const body = JSON.parse(calls[1].opts.body).body;
  assert.match(body, /No test-gaming signals detected/i);
});

test('best-effort: a thrown fetch is swallowed (returns false, no throw)', async () => {
  process.env.GITHUB_TOKEN = 'secret-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  writeEvent({ pull_request: { number: 3 } });
  global.fetch = async () => {
    throw new Error('network down');
  };
  const result = await reporter.postComment(SAMPLE_FINDINGS);
  assert.strictEqual(result, false);
});

test('best-effort: a non-2xx response is handled without throwing', async () => {
  process.env.GITHUB_TOKEN = 'secret-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  writeEvent({ pull_request: { number: 9 } });
  mockFetch([{ ok: false, status: 403, json: [] }]); // list fails
  const result = await reporter.postComment(SAMPLE_FINDINGS);
  assert.strictEqual(result, false);
});

test('table cells escape pipes and newlines', () => {
  const body = reporter._internal.buildBody([
    { rule: 'r', severity: 'warning', file: 'f|g.js', line: 2, message: 'has | pipe\nand newline' },
  ]);
  // The pipe inside the message must be escaped so it does not break the table.
  assert.ok(body.includes('has \\| pipe and newline'));
  assert.ok(body.includes('f\\|g.js'));
});
