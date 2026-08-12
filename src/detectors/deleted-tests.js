'use strict';

/**
 * Veredicto detector — deleted-tests.
 *
 * Flags pull requests that quietly REMOVE test cases. A common form of
 * test-gaming is deleting failing or inconvenient tests so the suite passes
 * (or coverage gates ease) without the underlying code actually working.
 *
 * For each test file in the diff we count test-case declarations on removed (-)
 * lines vs. added (+) lines. If the net is N > 0 removed, we report an error.
 * Counting net (removed minus added) avoids false positives when a test is
 * merely moved, renamed, or rewritten in place (a removal paired with an
 * addition cancels out).
 *
 * Only files that look like test files are considered, so refactoring the
 * implementation under test never trips this rule.
 *
 * Cross-file moves are also cancelled out: when a removed test case reappears
 * — same title — as an added test case in ANOTHER test file of the same diff,
 * it was consolidated, not deleted, so it does not count as a removal.
 */

// Matches *.test.js/ts/jsx/tsx, *.spec.*, anything under a __tests__/ dir,
// or Python test_*.py / *_test.py.
const TEST_FILE_RE =
  /(?:\.(?:test|spec)\.[jt]sx?$)|(?:(?:^|\/)__tests__\/)|(?:(?:^|\/)test_[^/]*\.py$)|(?:_test\.py$)/;

// Matches a test-case declaration on a single source line:
//   it('...'    it("..."    it(`...`
//   test('...   test.each(  describe-level NOT counted (it groups cases)
//   def test_foo(   (Python / pytest)
// We anchor on the call keyword followed by `(` (JS) or the def keyword.
const TEST_DECL_RE =
  /(?:\b(?:it|test)\s*(?:\.\s*\w+\s*(?:\([^)]*\))?\s*)?\()|(?:\bdef\s+test\w*\s*\()/;

// The title of a declared test case, used to recognise a case that moved to
// another file: the quoted string of `it("…")` / `test("…")`, or the function
// name of a Python `def test_foo(`.
const TEST_NAME_RE =
  /\b(?:it|test)\s*(?:\.\s*\w+\s*(?:\([^)]*\))?\s*)?\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`)/;
const PY_TEST_NAME_RE = /\bdef\s+(test\w*)\s*\(/;

function testName(line) {
  const m = TEST_NAME_RE.exec(line);
  if (m) return (m[1] ?? m[2] ?? m[3]).trim();
  const p = PY_TEST_NAME_RE.exec(line);
  return p ? p[1] : null;
}

function countTestDecls(lines) {
  let n = 0;
  for (const l of lines) {
    if (TEST_DECL_RE.test(l)) n++;
  }
  return n;
}

/** Titles of test cases ADDED anywhere in the diff, keyed by file. */
function addedNamesByFile(files) {
  const map = new Map();
  for (const f of files) {
    if (!isTestFile(f.file)) continue;
    const names = new Set();
    for (const a of f.added) {
      if (!TEST_DECL_RE.test(a.content)) continue;
      const n = testName(a.content);
      if (n) names.add(n);
    }
    map.set(f.file, names);
  }
  return map;
}

function isTestFile(file) {
  return TEST_FILE_RE.test(file);
}

module.exports = {
  rule: 'deleted-tests',
  detect(files) {
    const findings = [];
    const addedNames = addedNamesByFile(files);

    for (const f of files) {
      if (!isTestFile(f.file)) continue;

      const removedDecls = countTestDecls(f.removed.map((r) => r.content));
      const addedDecls = countTestDecls(f.added.map((a) => a.content));

      // Cases that reappear under the same title in a DIFFERENT test file of
      // this diff were moved, not deleted.
      let moved = 0;
      for (const r of f.removed) {
        if (!TEST_DECL_RE.test(r.content)) continue;
        const name = testName(r.content);
        if (!name) continue;
        if (addedNames.get(f.file)?.has(name)) continue; // re-added in place: net already covers it
        for (const [file, names] of addedNames) {
          if (file !== f.file && names.has(name)) {
            moved++;
            break;
          }
        }
      }

      const net = removedDecls - addedDecls - moved;
      if (net <= 0) continue;

      findings.push({
        rule: 'deleted-tests',
        severity: 'error',
        file: f.file,
        line: 1,
        message:
          net === 1
            ? '1 test case removed from a test file without replacement, which can hide failing behavior.'
            : `${net} test cases removed from a test file without replacement, which can hide failing behavior.`,
      });
    }
    return findings;
  },
};
