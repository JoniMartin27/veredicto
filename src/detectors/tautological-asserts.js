'use strict';

/**
 * Veredicto detector — tautological-asserts.
 *
 * Flags asserts that can never fail (they compare a value to itself / a
 * constant to the same constant) and test bodies that assert nothing.
 * These are classic "test-gaming" patterns: they make the suite green while
 * verifying nothing about the code under test.
 *
 *   error  — tautological assertion (always passes):
 *              expect(true).toBe(true), expect(1).toBe(1),
 *              expect("x").toBe("x"), expect(true).toEqual(true),
 *              assert(true), assert True, assert 1 == 1
 *   warning — empty test body: it("...", () => {}), test("...", function(){})
 *
 * Conservative by design: only fires when both sides of a comparison are the
 * SAME literal (boolean / number / quoted string), or on the explicit
 * `assert(true)` / `assert True` forms. Comparing two different values, or a
 * value to a variable, never fires.
 */

const RULE = 'tautological-asserts';

// A literal token: boolean, number (int/float), or a quoted string.
// Captured so we can compare the two sides for textual identity.
const BOOL = 'true|false';
const NUM = '-?\\d+(?:\\.\\d+)?';
const STR = '"[^"\\n]*"|\'[^\'\\n]*\'|`[^`\\n]*`';
const LITERAL = `(?:${BOOL}|${NUM}|${STR})`;

// expect(<lit>).toBe(<lit>) / .toEqual(<lit>) / .toStrictEqual(<lit>) / .todiscEqual
const EXPECT_RE = new RegExp(
  `expect\\s*\\(\\s*(${LITERAL})\\s*\\)\\s*\\.\\s*(?:toBe|toEqual|toStrictEqual)\\s*\\(\\s*(${LITERAL})\\s*\\)`
);

// assert(true) / assert(true, "msg") / assertTrue(true)  — JS/TS style
const ASSERT_TRUE_JS_RE = /\bassert(?:True)?\s*\(\s*true\s*[,)]/;

// Python: `assert True` (optionally with a message) — not assert <expr>
const ASSERT_TRUE_PY_RE = /\bassert\s+True\s*(?:,|$)/;

// assert <lit> == <lit>  (Python) and assert(<lit> == <lit>) / assert(<lit> === <lit>)
const ASSERT_EQ_RE = new RegExp(
  `\\bassert\\b[\\s(]*?(${LITERAL})\\s*={2,3}\\s*(${LITERAL})`
);

// Empty test body: it("x", () => {}), test('x', function () {}), it("x", async () => {})
const EMPTY_TEST_RE =
  /\b(?:it|test)\s*\(\s*(?:"[^"\n]*"|'[^'\n]*'|`[^`\n]*`)\s*,\s*(?:async\s*)?(?:\(\s*\)|function\s*\w*\s*\(\s*\))\s*(?:=>)?\s*\{\s*\}/;

// Only inspect changes to test files — keeps false positives near zero in
// production code (which can legitimately contain constant comparisons).
function isTestFile(file) {
  return /(?:^|[\\/])__tests__[\\/]|[._-](?:test|spec)\.[cm]?[jt]sx?$|_test\.py$|(?:^|[\\/])test_[^\\/]*\.py$/i.test(
    file
  );
}

// Strip trailing line comments so `expect(true).toBe(true) // note` still matches
// and so commented-out code does not. A line that is wholly a comment is skipped.
function isComment(s) {
  const t = s.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('#');
}

function detect(files) {
  const findings = [];
  for (const f of files) {
    if (!isTestFile(f.file)) continue;
    for (const a of f.added) {
      const content = a.content;
      if (isComment(content)) continue;

      // --- Tautologies (errors) ---
      let matched = false;

      const em = EXPECT_RE.exec(content);
      if (em && em[1] === em[2]) {
        findings.push({
          rule: RULE,
          severity: 'error',
          file: f.file,
          line: a.line,
          message:
            'Tautological assertion: expect() compares a literal to itself, so it can never fail.',
        });
        matched = true;
      }

      if (!matched) {
        const aeq = ASSERT_EQ_RE.exec(content);
        if (aeq && aeq[1] === aeq[2]) {
          findings.push({
            rule: RULE,
            severity: 'error',
            file: f.file,
            line: a.line,
            message:
              'Tautological assertion: both sides of the comparison are the same literal, so it always passes.',
          });
          matched = true;
        }
      }

      if (!matched && (ASSERT_TRUE_JS_RE.test(content) || ASSERT_TRUE_PY_RE.test(content))) {
        findings.push({
          rule: RULE,
          severity: 'error',
          file: f.file,
          line: a.line,
          message: 'Tautological assertion: asserting a constant truthy value verifies nothing.',
        });
        matched = true;
      }

      // --- Empty test body (warning) ---
      if (!matched && EMPTY_TEST_RE.test(content)) {
        findings.push({
          rule: RULE,
          severity: 'warning',
          file: f.file,
          line: a.line,
          message: 'Empty test body: the test asserts nothing and passes vacuously.',
        });
      }
    }
  }
  return findings;
}

module.exports = { rule: RULE, detect };
