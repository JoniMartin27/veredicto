'use strict';

/**
 * Veredicto — golden-corpus harness.
 *
 * Drives every fixture under test/fixtures/{gamed,clean}/ through the real
 * pipeline (parseDiff -> registry.analyze) and checks the result against the
 * fixture's `.expected.json` sidecar. The corpus measures two things:
 *
 *   1. RECALL — each "gamed" diff must trip the trick it demonstrates
 *      (`expectRules[rule] >= N` and total findings >= `minFindings`).
 *   2. FALSE POSITIVES — each "clean" diff is a legitimate change that must
 *      produce EXACTLY zero findings, no matter how many detectors exist.
 *
 * Tolerant of the detector folder filling up over time:
 *   - gamed fixtures assert a LOWER BOUND per rule, so adding more detectors
 *     (which may add unrelated findings) never breaks them;
 *   - the rule a gamed fixture targets must already be loaded for its recall
 *     assertion to run — before the Integrate phase ships that detector the
 *     check is skipped (structure is still validated);
 *   - clean fixtures demand zero — a new detector that fires on legit code
 *     fails here, which is exactly the regression we want to catch.
 *
 * See test/fixtures/README.md for the fixture + expected-file format.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { parseDiff } = require('../src/diff');
const { analyze, loadDetectors } = require('../src/registry');

const FIXTURES_DIR = __dirname + path.sep + 'fixtures';

/** Set of rule ids currently loaded by the registry (may be empty pre-Integrate). */
function loadedRuleSet() {
  const ids = new Set();
  for (const d of loadDetectors()) {
    if (d && typeof d.rule === 'string') ids.add(d.rule);
  }
  return ids;
}

/** Collect every fixture pair under a category dir: { name, diff, expected }. */
function collect(category) {
  const dir = path.join(FIXTURES_DIR, category);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of entries) {
    if (!name.endsWith('.diff')) continue;
    const base = name.slice(0, -'.diff'.length);
    const diffPath = path.join(dir, name);
    const expPath = path.join(dir, base + '.expected.json');
    out.push({ category, base, diffPath, expPath });
  }
  return out.sort((a, b) => a.base.localeCompare(b.base));
}

function countByRule(findings) {
  const m = Object.create(null);
  for (const f of findings) m[f.rule] = (m[f.rule] || 0) + 1;
  return m;
}

const gamed = collect('gamed');
const clean = collect('clean');

test('corpus has gamed and clean fixtures', () => {
  assert.ok(gamed.length > 0, 'expected at least one gamed fixture');
  assert.ok(clean.length > 0, 'expected at least one clean fixture');
});

// ---- Structure validation (runs even before any detector exists) ----------

for (const fx of [...gamed, ...clean]) {
  test(`fixture ${fx.category}/${fx.base} is well-formed`, () => {
    assert.ok(fs.existsSync(fx.expPath), `missing ${fx.base}.expected.json`);
    const raw = fs.readFileSync(fx.expPath, 'utf8');
    let exp;
    assert.doesNotThrow(() => {
      exp = JSON.parse(raw);
    }, 'expected.json must be valid JSON');

    assert.equal(typeof exp.description, 'string');
    assert.ok(exp.description.length > 0, 'description must be non-empty');
    assert.equal(typeof exp.minFindings, 'number');
    assert.ok(exp.minFindings >= 0, 'minFindings must be >= 0');

    if (fx.category === 'gamed') {
      assert.equal(exp.cleanExpectedZero, false, 'gamed fixtures are not clean');
      assert.ok(exp.minFindings >= 1, 'a gamed fixture must expect >= 1 finding');
      assert.equal(typeof exp.trick, 'string', 'gamed fixture needs a trick id');
      assert.equal(typeof exp.expectRules, 'object', 'gamed needs expectRules');
      for (const [rule, n] of Object.entries(exp.expectRules)) {
        assert.equal(typeof n, 'number');
        assert.ok(n >= 1, `expectRules.${rule} must be >= 1`);
      }
    } else {
      assert.equal(exp.cleanExpectedZero, true, 'clean fixtures must mark cleanExpectedZero');
      assert.equal(exp.minFindings, 0, 'clean fixtures expect zero findings');
    }

    // The diff must parse into at least one resolvable file.
    const files = parseDiff(fs.readFileSync(fx.diffPath, 'utf8'));
    assert.ok(Array.isArray(files));
    assert.ok(files.length > 0, 'diff must parse to >= 1 file');
  });
}

// ---- Behavioural checks (real registry; tolerant pre-Integrate) -----------

for (const fx of gamed) {
  test(`gamed/${fx.base} trips its trick (recall)`, () => {
    const exp = JSON.parse(fs.readFileSync(fx.expPath, 'utf8'));
    const loaded = loadedRuleSet();
    const targetRules = Object.keys(exp.expectRules);
    const allTargetsLoaded = targetRules.every((r) => loaded.has(r));

    if (!allTargetsLoaded) {
      // Detector(s) for this trick not wired yet (pre-Integrate). Skip recall;
      // structure was already validated above.
      return;
    }

    const findings = analyze(fs.readFileSync(fx.diffPath, 'utf8'));
    const byRule = countByRule(findings);

    assert.ok(
      findings.length >= exp.minFindings,
      `${fx.base}: expected >= ${exp.minFindings} findings, got ${findings.length}`
    );
    for (const [rule, n] of Object.entries(exp.expectRules)) {
      assert.ok(
        (byRule[rule] || 0) >= n,
        `${fx.base}: expected rule "${rule}" to fire >= ${n} time(s), got ${byRule[rule] || 0}`
      );
    }
  });
}

for (const fx of clean) {
  test(`clean/${fx.base} produces zero findings (no false positives)`, () => {
    // Clean fixtures must stay silent against WHATEVER detectors are loaded.
    const findings = analyze(fs.readFileSync(fx.diffPath, 'utf8'));
    assert.deepEqual(
      findings,
      [],
      `clean fixture "${fx.base}" should yield no findings but got: ` +
        JSON.stringify(findings, null, 2)
    );
  });
}
