'use strict';

/**
 * Veredicto detector — gutted-tests.
 *
 * Flags a test file whose ASSERTIONS were removed while the test cases
 * themselves stayed. The suite still reports the same number of green tests,
 * but the tests no longer check anything:
 *
 *   it('rejects an expired token', () => {
 *  -  expect(verify(expired)).toBe(false);
 *   });
 *
 * This is the blind spot the other rules leave open. `deleted-tests` counts
 * test *declarations*, so it sees nothing here — no declaration was removed.
 * `tautological-asserts` inspects *added* lines, and this diff adds none. The
 * whole change is a removal, which is exactly what makes it cheap for an agent
 * to do and easy for a reviewer to skim past.
 *
 * Fires only when ALL of the following hold for one test file:
 *   1. at least one assertion line was removed,
 *   2. no assertion line was added (nothing replaced them),
 *   3. no test declaration was removed (the cases are still there — otherwise
 *      this is an ordinary deletion and `deleted-tests` owns it),
 *   4. no test declaration was added (a rewrite is not a gutting).
 *
 * Severity is `warning`: removing a redundant assertion during a genuine
 * cleanup is a real thing people do, so this never blocks a merge on its own.
 */

const RULE = 'gutted-tests';

const TEST_FILE_RE =
  /(?:\.(?:test|spec)\.[cm]?[jt]sx?$)|(?:(?:^|[\\/])__tests__[\\/])|(?:(?:^|[\\/])test_[^\\/]*\.py$)|(?:_test\.py$)/;

// A test-case declaration (same shape the deleted-tests rule anchors on).
const TEST_DECL_RE =
  /(?:\b(?:it|test)\s*(?:\.\s*\w+\s*(?:\([^)]*\))?\s*)?\()|(?:\bdef\s+test\w*\s*\()/;

// An assertion CALL: jest/vitest `expect(...)`, chai `.should.`, node:assert
// `assert.x(...)` / `assert(...)`, python `assert <expr>`, and the common
// xunit `self.assertX(...)` family.
const ASSERT_RE =
  /\bexpect\s*\(|\.should\b|\bassert\s*\.\s*\w+\s*\(|\bassert\s*\(|\bassert\s+\S|\bself\s*\.\s*assert\w*\s*\(/;

function isComment(s) {
  const t = s.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('#') || t.startsWith('/*');
}

function countAsserts(lines) {
  let n = 0;
  for (const l of lines) {
    if (isComment(l)) continue; // a commented assertion is commented-asserts' job
    if (TEST_DECL_RE.test(l)) continue; // the declaration line itself is not an assert
    if (ASSERT_RE.test(l)) n++;
  }
  return n;
}

function countDecls(lines) {
  let n = 0;
  for (const l of lines) {
    if (TEST_DECL_RE.test(l)) n++;
  }
  return n;
}

/** An assertion that was commented out rather than deleted — commented-asserts' territory. */
function hasCommentedAssert(lines) {
  return lines.some((l) => isComment(l) && ASSERT_RE.test(l));
}

module.exports = {
  rule: RULE,
  detect(files) {
    const findings = [];
    for (const f of files) {
      if (!TEST_FILE_RE.test(f.file)) continue;

      const removedLines = f.removed.map((r) => r.content);
      const addedLines = f.added.map((a) => a.content);

      const removedAsserts = countAsserts(removedLines);
      if (removedAsserts === 0) continue;
      if (countAsserts(addedLines) > 0) continue; // assertions were replaced, not dropped
      if (hasCommentedAssert(addedLines)) continue; // commented out → commented-asserts owns it
      if (countDecls(removedLines) > 0) continue; // a case was deleted → deleted-tests
      if (countDecls(addedLines) > 0) continue; // a case was rewritten → not a gutting

      findings.push({
        rule: RULE,
        severity: 'warning',
        file: f.file,
        line: 1,
        message:
          removedAsserts === 1
            ? '1 assertion removed while its test case stayed, so the test still passes but no longer checks anything.'
            : `${removedAsserts} assertions removed while their test cases stayed, so the tests still pass but no longer check anything.`,
      });
    }
    return findings;
  },
};
