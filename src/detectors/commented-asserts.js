'use strict';

/**
 * Veredicto detector — commented-asserts.
 *
 * Flags added lines that COMMENT OUT an assertion instead of fixing or
 * removing it: a classic test-gaming move that silently disables a check
 * while keeping the test "green".
 *
 * Only fires when a comment line actually contains an assertion keyword
 * (expect / assert / should), so ordinary explanatory comments are never
 * flagged. Distinguishes commented assertions from live ones (a live
 * `expect(...)` is code, not a comment, and is ignored).
 */

// Assertion keywords used as whole words, so identifiers like `assertion`,
// `shouldRender` or `expectation` in prose comments don't trip the detector.
const ASSERT_KEYWORD = /\b(?:expect|assert|should)\b/;

// Line comment prefixes for common languages: // (JS/TS/Go/Java/C),
// # (Python/Ruby/shell). Optionally preceded by indentation.
const LINE_COMMENT = /^\s*(?:\/\/+|#+)\s*(.*)$/;

// A single-line block comment: /* ... */ (JS/TS/C family).
const BLOCK_COMMENT = /^\s*\/\*+\s*(.*?)\s*\*+\/\s*$/;

// Heuristic that the comment body is really a (now-disabled) assertion call,
// not prose merely mentioning the word. Requires the keyword immediately
// followed by an opening paren or a dot/space then content, e.g.
//   expect(...).toBe(...)   assert x == y   expect.equal(...)   x.should.equal
// `should` is only treated as an assertion in its chai method form
// (`.should.` / `should(` / `should.`), never as the plain English word.
const ASSERT_CALL = /\bexpect\s*[(.]|\bassert\b\s*[(.]|\bassert\b\s+\w|\.should\.|\bshould\s*[(.]/;

function detect(files) {
  const findings = [];

  for (const file of files) {
    for (const a of file.added) {
      const text = a.content;

      // Extract the comment body, if this added line is a comment at all.
      let body = null;
      const block = BLOCK_COMMENT.exec(text);
      if (block) {
        body = block[1];
      } else {
        const line = LINE_COMMENT.exec(text);
        if (line) body = line[1];
      }

      if (body === null) continue; // not a comment line → live code, skip
      if (body.trim() === '') continue; // empty comment

      // Must mention an assertion keyword AND look like an assertion call,
      // not just prose that happens to use the word "should"/"assert".
      if (!ASSERT_KEYWORD.test(body)) continue;
      if (!ASSERT_CALL.test(body)) continue;

      findings.push({
        rule: 'commented-asserts',
        severity: 'warning',
        file: file.file,
        line: a.line || 1,
        message: 'assertion commented out',
      });
    }
  }

  return findings;
}

module.exports = { rule: 'commented-asserts', detect };
