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
//
// The bare Python `assert <expr>` form (`assert x == y`, `assert foo()`,
// `assert obj.ok`) is only recognised when the asserted expression contains a
// token that can only be code:
//   - a comparison operator            assert x == y, assert n >= 3
//   - a call attached to an identifier assert foo(), assert is_valid(u)
//   - attribute access between words   assert obj.ok, assert r.status
//   - indexing attached to an identifier   assert items[0]
// Crucially the token must be ATTACHED to a word. An English sentence that
// merely ends in a period — `// The caller should assert the total is right.`
// — has a lone `.` after a word but nothing after it, so it is not code and no
// longer trips the detector.
const CODE_TOKEN = /[=!<>]=|[<>]|\w\(|\w\.\w|\w\[/;
const ASSERT_BARE_PY = /\bassert\b\s+(\w[^\n]*)$/;
const ASSERT_CALL = /\bexpect\s*[(.]|\bassert\b\s*[(.]|\.should\.|\bshould\s*[(.]/;

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
      const bare = ASSERT_BARE_PY.exec(body);
      const looksLikeCode = ASSERT_CALL.test(body) || (bare !== null && CODE_TOKEN.test(bare[1]));
      if (!looksLikeCode) continue;

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
