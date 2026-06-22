'use strict';

/**
 * Veredicto detector — weakened-assertions.
 *
 * Flags pull requests that quietly WEAKEN an existing assertion inside a test
 * file. A common form of test-gaming is turning a precise check
 * (`expect(x).toBe(3)`) into a vacuous one (`expect(x).toBeTruthy()`,
 * `.toBeDefined()`, `not.toThrow()`, …): the test still "passes" but no longer
 * verifies the actual value, so a regression slips through.
 *
 * Heuristic: within the same test file we look for a removed (-) line carrying a
 * STRICT matcher whose assertion SUBJECT (the `expect(...)` / `assert.equal(...,`
 * receiver) reappears on an added (+) line — but now wrapped in a WEAK matcher.
 * Tying the pair by a shared subject keeps false positives near zero: an
 * unrelated strict-removal plus an unrelated weak-addition won't be paired, and
 * a strict assertion that stays strict (only the expected value changed) never
 * fires. Each matched pair is a `warning` (soft signal).
 */

// Only consider real test files (mirror of the deleted-tests rule).
const TEST_FILE_RE =
  /(?:\.(?:test|spec)\.[jt]sx?$)|(?:(?:^|\/)__tests__\/)|(?:(?:^|\/)test_[^/]*\.py$)|(?:_test\.py$)/;

// Strict matchers: assert an exact value/equality.
const STRICT_RE = /\b(?:toBe|toEqual|toStrictEqual|toBeCloseTo)\s*\(|\b(?:assertEqual|assertIs|assertSame)\s*\(|\bassert\b[^=]*===|\.toHaveBeenCalledWith\s*\(/;

// Weak matchers: pass for a wide range of values, verifying almost nothing.
const WEAK_RE = /\b(?:toBeTruthy|toBeFalsy|toBeDefined|toBeUndefined|toBeNull|toBeNaN)\s*\(\s*\)|\.?not\.toThrow\s*\(|\btoBeGreaterThanOrEqual\s*\(|\btoHaveBeenCalled\s*\(\s*\)/;

function isTestFile(file) {
  return TEST_FILE_RE.test(file);
}

/**
 * Extract the assertion subject — the text up to (and including) the first
 * matcher dot — so we can pair a removed strict line with an added weak line
 * that checks the SAME thing. e.g. both
 *   expect(result).toBe(3)
 *   expect(result).toBeTruthy()
 * share the subject `expect(result)`.
 * Returns a normalized (whitespace-collapsed) subject, or null if none found.
 */
function subjectOf(line) {
  const m = /(expect\s*\([^]*?\))\s*\.\s*(?:not\s*\.\s*)?[a-zA-Z]/.exec(line);
  if (!m) return null;
  return m[1].replace(/\s+/g, '');
}

module.exports = {
  rule: 'weakened-assertions',
  detect(files) {
    const findings = [];
    for (const f of files) {
      if (!isTestFile(f.file)) continue;

      // Index removed strict assertions by their subject.
      const removedStrict = new Map();
      for (const r of f.removed) {
        if (!STRICT_RE.test(r.content) || WEAK_RE.test(r.content)) continue;
        const subj = subjectOf(r.content);
        if (subj) removedStrict.set(subj, r.content);
      }
      if (removedStrict.size === 0) continue;

      // Find added weak assertions whose subject was previously strict.
      for (const a of f.added) {
        if (!WEAK_RE.test(a.content) || STRICT_RE.test(a.content)) continue;
        const subj = subjectOf(a.content);
        if (!subj || !removedStrict.has(subj)) continue;

        findings.push({
          rule: 'weakened-assertions',
          severity: 'warning',
          file: f.file,
          line: a.line || 1,
          message:
            'A strict assertion was weakened to a lax matcher, so the test no longer verifies the expected value.',
        });
        // Consume the match so one removal can't pair with many additions.
        removedStrict.delete(subj);
      }
    }
    return findings;
  },
};
