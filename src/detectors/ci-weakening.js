'use strict';

/**
 * Veredicto detector — ci-weakening.
 *
 * Flags pull requests that quietly DISARM continuous-integration so that a
 * failing build or test no longer blocks the merge. Common forms of this
 * test-gaming pattern, all scoped to CI workflow files:
 *
 *   - adding `continue-on-error: true` (the step can fail silently)
 *   - appending `|| true` / `|| exit 0` to a test command (swallows failures)
 *   - removing a step/line that actually runs the tests
 *   - inflating a `timeout-minutes` or `retries`/`retry` count to mask flakiness
 *
 * Only CI configuration files are considered (GitHub Actions workflows,
 * `.gitlab-ci.yml`, or anything under a `/workflows/` path), so ordinary source
 * or shell changes never trip this rule.
 */

// Recognises CI config files: GitHub Actions workflows, GitLab CI, CircleCI,
// or any file living under a `workflows/` directory.
const CI_FILE_RE =
  /(?:(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$)|(?:(?:^|\/)\.gitlab-ci\.ya?ml$)|(?:(?:^|\/)\.circleci\/[^/]+\.ya?ml$)|(?:(?:^|\/)workflows\/[^/]+\.ya?ml$)/i;

// `continue-on-error: true` on an added line.
const CONTINUE_ON_ERROR_RE = /continue-on-error\s*:\s*true\b/i;

// A shell command that swallows a non-zero exit: `... || true` or `... || exit 0`.
const SWALLOW_RE = /\|\|\s*(?:true\b|:\s*$|exit\s+0\b)/;

// Heuristic for "this line runs tests": references a test runner / `npm test` /
// a `test`/`coverage`/`lint` script invocation. Used both to detect a swallowed
// test command and to detect removal of a test step.
const TEST_CMD_RE =
  /\b(?:npm\s+(?:run\s+)?(?:test|coverage)|yarn\s+(?:test|coverage)|pnpm\s+(?:run\s+)?(?:test|coverage)|jest|vitest|mocha|pytest|py\.test|go\s+test|cargo\s+test|gradle\s+test|mvn\s+test|rspec|phpunit|ctest|node\s+--test|tox)\b/i;

// `timeout-minutes:` (GitHub) or `timeout:` value, captured for inflation check.
const TIMEOUT_RE = /\b(?:timeout-minutes|timeout)\s*:\s*(\d+)/i;

// Threshold above which a timeout looks deliberately inflated (minutes).
const TIMEOUT_INFLATED = 120;

// `retries:` / `retry:` / `max-attempts:` count, captured for inflation check.
const RETRY_RE = /\b(?:retries|retry|max[-_]attempts|attempts)\s*:\s*(\d+)/i;

// Threshold above which a retry count looks like it is masking flaky tests.
const RETRY_INFLATED = 3;

function isCiFile(file) {
  return CI_FILE_RE.test(file);
}

module.exports = {
  rule: 'ci-weakening',
  detect(files) {
    const findings = [];
    for (const f of files) {
      if (!isCiFile(f.file)) continue;

      for (const a of f.added) {
        const content = a.content;

        if (CONTINUE_ON_ERROR_RE.test(content)) {
          findings.push({
            rule: 'ci-weakening',
            severity: 'error',
            file: f.file,
            line: a.line,
            message:
              'continue-on-error: true added in CI lets a failing step pass silently.',
          });
          continue;
        }

        if (SWALLOW_RE.test(content) && TEST_CMD_RE.test(content)) {
          findings.push({
            rule: 'ci-weakening',
            severity: 'error',
            file: f.file,
            line: a.line,
            message:
              '"|| true" appended to a CI test command swallows test failures.',
          });
          continue;
        }

        const tm = TIMEOUT_RE.exec(content);
        if (tm && parseInt(tm[1], 10) > TIMEOUT_INFLATED) {
          findings.push({
            rule: 'ci-weakening',
            severity: 'warning',
            file: f.file,
            line: a.line,
            message: `CI timeout inflated to ${tm[1]}, which can mask hanging or failing jobs.`,
          });
          continue;
        }

        const rm = RETRY_RE.exec(content);
        if (rm && parseInt(rm[1], 10) > RETRY_INFLATED) {
          findings.push({
            rule: 'ci-weakening',
            severity: 'warning',
            file: f.file,
            line: a.line,
            message: `CI retry count inflated to ${rm[1]}, which can mask flaky failing tests.`,
          });
        }
      }

      // Detect REMOVAL of a step/line that runs tests, with no matching test
      // command added back (net removal), so reordering/renaming does not trip.
      const removedTest = f.removed.filter((r) => TEST_CMD_RE.test(r.content)).length;
      const addedTest = f.added.filter((a) => TEST_CMD_RE.test(a.content)).length;
      if (removedTest > addedTest) {
        findings.push({
          rule: 'ci-weakening',
          severity: 'error',
          file: f.file,
          line: 1,
          message:
            'A CI step that runs tests was removed, so failures are no longer caught.',
        });
      }
    }
    return findings;
  },
};
