'use strict';

/**
 * Veredicto — static test-gaming detectors.
 *
 * Pure functions over a parsed unified diff. No LLM, no network, no API key.
 * Each detector returns findings: { rule, severity, file, line, message }.
 */

const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)(__tests__|tests?|spec)\//i;
const PY_TEST_FILE = /(^|\/)test_[^/]*\.py$|_test\.py$/i;
const CONFIG_FILE = /(jest\.config\.|vitest\.config\.|\.nycrc|\.c8rc|package\.json$|sonar-project\.properties$|jest\.setup\.)/i;

const TEST_DECL = /\b(it|test)\s*\(/g;
const PY_TEST_DECL = /\bdef\s+test_/g;

function countMatches(lines, re) {
  let n = 0;
  for (const l of lines) {
    const m = (l.content || l).match(new RegExp(re.source, re.flags.replace('g', '') + 'g'));
    if (m) n += m.length;
  }
  return n;
}

/** Parse `git diff` unified output into per-file added/removed line records. */
function parseDiff(diff) {
  const files = [];
  let cur = null;
  let newLine = 0;
  for (const raw of String(diff).split('\n')) {
    if (raw.startsWith('diff --git')) {
      cur = { file: null, added: [], removed: [] };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim();
      if (p !== '/dev/null') cur.file = p.replace(/^b\//, '');
      continue;
    }
    if (raw.startsWith('--- ')) {
      const p = raw.slice(4).trim();
      if (!cur.file && p !== '/dev/null') cur.file = p.replace(/^a\//, '');
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = /\+(\d+)/.exec(raw);
      newLine = m ? parseInt(m[1], 10) : 0;
      continue;
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      cur.added.push({ line: newLine, content: raw.slice(1) });
      newLine++;
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      cur.removed.push({ content: raw.slice(1) });
    } else {
      newLine++;
    }
  }
  return files.filter((f) => f.file);
}

// ── Rule 1: deleted tests ───────────────────────────────────────────────────
function deletedTests(files) {
  const out = [];
  for (const f of files) {
    if (!(TEST_FILE.test(f.file) || PY_TEST_FILE.test(f.file))) continue;
    const re = PY_TEST_FILE.test(f.file) ? PY_TEST_DECL : TEST_DECL;
    const removed = countMatches(f.removed, re);
    const added = countMatches(f.added, re);
    if (removed > added) {
      out.push({
        rule: 'deleted-tests',
        severity: 'error',
        file: f.file,
        line: 1,
        message: `${removed - added} test case(s) removed in a test file. Deleting failing tests turns CI green without fixing the bug.`,
      });
    }
  }
  return out;
}

// ── Rule 2: skipped / narrowed tests ────────────────────────────────────────
const SKIP_PATTERNS = [
  { re: /\b(it|test|describe)\s*\.\s*skip\s*\(/, label: '.skip()' },
  { re: /\b(it|test)\s*\.\s*todo\s*\(/, label: '.todo()' },
  { re: /\b(xit|xdescribe|xtest)\s*\(/, label: 'x-prefixed skip' },
  { re: /\b(it|describe|test)\s*\.\s*only\s*\(/, label: '.only() (narrows the suite to one case)' },
  { re: /@pytest\.mark\.(skip|xfail)/, label: 'pytest skip/xfail' },
  { re: /@unittest\.skip/, label: 'unittest.skip' },
  { re: /#\s*eslint-disable/, label: 'eslint-disable' },
];
function skippedTests(files) {
  const out = [];
  for (const f of files) {
    for (const a of f.added) {
      for (const p of SKIP_PATTERNS) {
        if (p.re.test(a.content)) {
          out.push({
            rule: 'skipped-tests',
            severity: 'warning',
            file: f.file,
            line: a.line,
            message: `Test silenced via ${p.label}. A skipped test cannot fail.`,
          });
          break;
        }
      }
    }
  }
  return out;
}

// ── Rule 3: tautological / empty asserts ────────────────────────────────────
const TAUTOLOGY = [
  /expect\(\s*true\s*\)\s*\.\s*toBe(Truthy)?\(\s*(true)?\s*\)/,
  /expect\(\s*(\d+)\s*\)\s*\.\s*toBe\(\s*\1\s*\)/,
  /expect\(\s*(['"`].*?['"`])\s*\)\s*\.\s*toBe\(\s*\1\s*\)/,
  /\bassert\s*\(\s*true\s*\)/,
  /\bassert\s+True\b/,
  /\bassert\s+1\s*==\s*1\b/,
  /expect\(\s*true\s*\)\.toEqual\(\s*true\s*\)/,
];
const EMPTY_TEST = /\b(it|test)\s*\(\s*(['"`]).*?\2\s*,\s*(async\s*)?\(\s*\)\s*=>\s*\{\s*\}\s*\)/;
function tautologicalAsserts(files) {
  const out = [];
  for (const f of files) {
    for (const a of f.added) {
      if (TAUTOLOGY.some((re) => re.test(a.content))) {
        out.push({
          rule: 'tautological-assert',
          severity: 'error',
          file: f.file,
          line: a.line,
          message: 'Assertion always passes — it verifies nothing.',
        });
      } else if (EMPTY_TEST.test(a.content)) {
        out.push({
          rule: 'empty-test',
          severity: 'warning',
          file: f.file,
          line: a.line,
          message: 'Empty test body — passes without asserting anything.',
        });
      }
    }
  }
  return out;
}

// ── Rule 4: relaxed coverage thresholds ─────────────────────────────────────
const THRESHOLD_KEY = /\b(branches|functions|lines|statements|global|minCoverage|coverageThreshold)\b[^0-9]*?(\d{1,3})/i;
function relaxedThresholds(files) {
  const out = [];
  for (const f of files) {
    if (!CONFIG_FILE.test(f.file)) continue;
    // Pair removed→added by key to catch a number going down.
    const removed = new Map();
    for (const r of f.removed) {
      const m = THRESHOLD_KEY.exec(r.content);
      if (m) removed.set(m[1].toLowerCase(), parseInt(m[2], 10));
    }
    for (const a of f.added) {
      const m = THRESHOLD_KEY.exec(a.content);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const now = parseInt(m[2], 10);
      if (removed.has(key) && now < removed.get(key)) {
        out.push({
          rule: 'relaxed-threshold',
          severity: 'error',
          file: f.file,
          line: a.line,
          message: `Coverage/quality threshold "${key}" lowered ${removed.get(key)} → ${now} in the same change.`,
        });
      }
    }
  }
  return out;
}

// ── Rule 5: mass-regenerated snapshots ──────────────────────────────────────
function massSnapshots(files) {
  const out = [];
  for (const f of files) {
    if (!/\.snap$|__snapshots__\//.test(f.file)) continue;
    const churn = f.added.length + f.removed.length;
    if (churn >= 20) {
      out.push({
        rule: 'mass-snapshots',
        severity: 'warning',
        file: f.file,
        line: 1,
        message: `${churn} snapshot lines changed. Bulk-regenerated snapshots bless whatever the new output happens to be.`,
      });
    }
  }
  return out;
}

function analyze(diff) {
  const files = parseDiff(diff);
  return [
    ...deletedTests(files),
    ...skippedTests(files),
    ...tautologicalAsserts(files),
    ...relaxedThresholds(files),
    ...massSnapshots(files),
  ];
}

module.exports = {
  parseDiff,
  deletedTests,
  skippedTests,
  tautologicalAsserts,
  relaxedThresholds,
  massSnapshots,
  analyze,
};
