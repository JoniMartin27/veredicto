'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseDiff } = require('../src/diff');
const { analyze, loadDetectors } = require('../src/registry');

function diffFor(file, addedLines, removedLines = []) {
  const body = [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${removedLines.length} +1,${addedLines.length} @@`,
    ...removedLines.map((l) => `-${l}`),
    ...addedLines.map((l) => `+${l}`),
  ];
  return body.join('\n');
}

test('parseDiff extracts file, added (with line numbers) and removed', () => {
  const diff = diffFor('src/a.js', ['const a = 1;', 'const b = 2;'], ['old();']);
  const files = parseDiff(diff);
  assert.equal(files.length, 1);
  assert.equal(files[0].file, 'src/a.js');
  assert.equal(files[0].added.length, 2);
  assert.equal(files[0].added[0].line, 1);
  assert.equal(files[0].added[1].line, 2);
  assert.deepEqual(files[0].removed.map((r) => r.content), ['old();']);
});

test('parseDiff drops files with no resolvable path', () => {
  // diff --git header with both sides /dev/null (no name) is filtered out.
  const diff = ['diff --git a/x b/x', '--- /dev/null', '+++ /dev/null', '@@ -0,0 +0,0 @@'].join('\n');
  assert.deepEqual(parseDiff(diff), []);
});

test('registry.analyze tolerates an empty detectors directory', () => {
  // No plugins are shipped by the architecture phase.
  assert.deepEqual(analyze(''), []);
  assert.deepEqual(analyze(diffFor('src/a.js', ['x();'])), []);
});

test('registry auto-loads a detector plugin and concatenates its findings', () => {
  // The plugin goes in a TEMPORARY directory, never in src/detectors/.
  // `node --test` runs test files in parallel processes and the registry
  // re-reads its directory on every analyze() call, so writing into the shipped
  // folder makes other test processes see a ghost detector or crash with ENOENT
  // on a file this test just unlinked. That was a real, reproducible flake.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veredicto-plugin-'));
  const tmpPath = path.join(dir, '__test_plugin.js');
  fs.writeFileSync(
    tmpPath,
    "module.exports={rule:'test-plugin',detect(files){return files.map(f=>({rule:'test-plugin',severity:'warning',file:f.file,line:1,message:'hit'}));}};"
  );
  try {
    const detectors = loadDetectors(dir);
    assert.equal(detectors.length, 1);
    assert.ok(detectors.some((d) => d.rule === 'test-plugin'));
    const findings = analyze(diffFor('src/a.js', ['x();']), dir);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'test-plugin');
    assert.equal(findings[0].file, 'src/a.js');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadDetectors tolerates a directory that does not exist', () => {
  assert.deepEqual(loadDetectors(path.join(os.tmpdir(), 'veredicto-nope-' + process.pid)), []);
});

test('the shipped detectors directory is never written to by the tests', () => {
  const dir = path.join(__dirname, '..', 'src', 'detectors');
  const stray = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.js') && !/^[a-z][a-z0-9-]*\.js$/.test(n));
  assert.deepEqual(stray, [], `stray files in src/detectors/: ${stray.join(', ')}`);
});

test('detectors directory exists with a .gitkeep', () => {
  const dir = path.join(__dirname, '..', 'src', 'detectors');
  assert.ok(fs.existsSync(dir));
  assert.ok(fs.existsSync(path.join(dir, '.gitkeep')));
});
