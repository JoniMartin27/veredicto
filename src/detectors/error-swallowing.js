'use strict';

/**
 * Veredicto detector — error-swallowing.
 *
 * Flags newly ADDED patterns that hide a failing test instead of fixing it.
 * Making a red command go green by suppressing its exit code (or swallowing an
 * assertion failure) is test-gaming: the suite "passes" while proving nothing.
 *
 * Hard errors (a test result is forcibly turned into success):
 *   - `<test-cmd> || true`        — discards the test's non-zero exit.
 *   - `--passWithNoTests`         — lets an empty/zero-test run succeed.
 *   - `exit 0` right after a test  — overrides the real status.
 *
 * Warnings (softer, but still suspicious):
 *   - `set +e`                    — turns off shell fail-on-error.
 *   - empty `catch {}` around asserts — swallows assertion exceptions.
 *   - `xfail(strict=False)`       — an unexpectedly passing xfail won't fail.
 *   - `: # noqa` / trailing `# noqa` on an assert — silences the line.
 *
 * Only added lines are inspected, and each pattern is anchored to a test/assert
 * context so ordinary code (a legitimate `|| true`, a real error handler, an
 * `exit 0` at the end of a non-test script) does not fire.
 */

// Commands that run a test suite; used to qualify `|| true` and `exit 0`.
const TEST_CMD_RE =
  /\b(?:npm\s+(?:run\s+)?test|npm\s+t\b|yarn\s+test|pnpm\s+(?:run\s+)?test|jest|vitest|mocha|pytest|py\.test|go\s+test|cargo\s+test|gradle(?:w)?\s+test|mvn\s+test|rspec|phpunit|ctest|tox|nox|ava|tap\b|node\s+--test)/i;

// `|| true` (or `|| :`) — unconditionally swallow a non-zero exit.
const OR_TRUE_RE = /\|\|\s*(?:true|:)\s*(?:#.*)?$/;

// `--passWithNoTests` flag.
const PASS_NO_TESTS_RE = /--pass[-]?with[-]?no[-]?tests\b/i;

// `set +e` as a whole word (shell: disable exit-on-error).
const SET_PLUS_E_RE = /(?:^|;|&&|\|\||\s)set\s+\+e\b/;

// `exit 0` standing alone on the line (whole statement).
const EXIT_0_RE = /^\s*exit\s+0\s*(?:#.*)?$/;

// pytest xfail with strict disabled — a passing xfail won't fail the run.
const XFAIL_NONSTRICT_RE = /xfail\s*\([^)]*\bstrict\s*=\s*False\b/i;

// `# noqa` (optionally on a bare `:` no-op) silencing a line.
const NOQA_RE = /#\s*noqa\b/i;

// Does the line look like it references a test/assert (to qualify soft rules)?
const ASSERT_CTX_RE =
  /\b(?:assert|expect|should|assertEqual|assertTrue|assertFalse|assertRaises|assertThat|verify|require\.(?:Equal|NoError|True))\b/i;

function add(findings, file, line, severity, message) {
  findings.push({ rule: 'error-swallowing', severity, file, line: line || 1, message });
}

function detect(files) {
  const findings = [];

  for (const f of files) {
    // Track an open `try {` so we can spot an immediately-empty catch.
    for (let i = 0; i < f.added.length; i++) {
      const a = f.added[i];
      const c = a.content;
      const trimmed = c.trim();
      if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('#')) {
        // Pure comment / blank lines never carry an executable swallow.
        // (A trailing `# noqa` after code is handled below, on the code line.)
        if (!/#\s*noqa/i.test(c)) continue;
      }

      // --- Hard errors ---------------------------------------------------

      // `<test-cmd> ... || true` — only when the command on the line is a test.
      if (OR_TRUE_RE.test(c) && TEST_CMD_RE.test(c)) {
        add(
          findings,
          f.file,
          a.line,
          'error',
          'Test command piped to "|| true" swallows its failure, making the suite pass regardless of the result.'
        );
        continue;
      }

      // `--passWithNoTests` — green build with zero tests run.
      if (PASS_NO_TESTS_RE.test(c)) {
        add(
          findings,
          f.file,
          a.line,
          'error',
          '"--passWithNoTests" lets a run with no tests succeed, hiding deleted or unmatched tests.'
        );
        continue;
      }

      // `exit 0` immediately following a test command line.
      if (EXIT_0_RE.test(c)) {
        const prev = i > 0 ? f.added[i - 1].content : '';
        if (TEST_CMD_RE.test(prev)) {
          add(
            findings,
            f.file,
            a.line,
            'error',
            '"exit 0" right after a test command overrides its real exit status, forcing a pass.'
          );
          continue;
        }
      }

      // --- Warnings ------------------------------------------------------

      // `set +e` — disable shell fail-on-error.
      if (SET_PLUS_E_RE.test(c)) {
        add(
          findings,
          f.file,
          a.line,
          'warning',
          '"set +e" disables fail-on-error, so a failing test command no longer stops the script.'
        );
        continue;
      }

      // pytest xfail(strict=False).
      if (XFAIL_NONSTRICT_RE.test(c)) {
        add(
          findings,
          f.file,
          a.line,
          'warning',
          'xfail(strict=False) lets an unexpectedly passing test slip by instead of failing.'
        );
        continue;
      }

      // `# noqa` silencing an assert line.
      if (NOQA_RE.test(c) && ASSERT_CTX_RE.test(c)) {
        add(
          findings,
          f.file,
          a.line,
          'warning',
          '"# noqa" on an assertion suppresses linter checks on the very line that proves the test.'
        );
        continue;
      }

      // Empty `catch` around asserts: `try { ... assert ... } catch (e) {}`
      // Two shapes: a single-line empty catch, or a `catch {` followed by `}`.
      if (/\bcatch\b/.test(c)) {
        // single-line empty catch: `catch (e) {}` or `catch {}`
        const singleEmpty = /\bcatch\b\s*(?:\([^)]*\))?\s*\{\s*\}/.test(c);
        // catch opener with nothing meaningful before the closing brace
        const openerEmpty =
          /\bcatch\b\s*(?:\([^)]*\))?\s*\{\s*$/.test(c) &&
          (() => {
            const next = i + 1 < f.added.length ? f.added[i + 1].content.trim() : '';
            return next === '}' || next === '};';
          })();

        if (singleEmpty || openerEmpty) {
          // Only flag if the surrounding added block references an assert,
          // otherwise an empty catch is a normal (if sloppy) pattern.
          const windowText = f.added
            .slice(Math.max(0, i - 4), Math.min(f.added.length, i + 2))
            .map((x) => x.content)
            .join('\n');
          if (ASSERT_CTX_RE.test(windowText)) {
            add(
              findings,
              f.file,
              a.line,
              'warning',
              'Empty catch around an assertion swallows the failure, so the test can never fail.'
            );
          }
        }
      }
    }
  }

  return findings;
}

module.exports = { rule: 'error-swallowing', detect };
