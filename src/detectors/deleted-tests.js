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

function countTestDecls(lines) {
  let n = 0;
  for (const l of lines) {
    if (TEST_DECL_RE.test(l)) n++;
  }
  return n;
}

function isTestFile(file) {
  return TEST_FILE_RE.test(file);
}

module.exports = {
  rule: 'deleted-tests',
  detect(files) {
    const findings = [];
    for (const f of files) {
      if (!isTestFile(f.file)) continue;

      const removedDecls = countTestDecls(f.removed.map((r) => r.content));
      const addedDecls = countTestDecls(f.added.map((a) => a.content));
      const net = removedDecls - addedDecls;
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
