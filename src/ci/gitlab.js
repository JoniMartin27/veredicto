'use strict';

/**
 * Veredicto — GitLab CI adapter.
 *
 * Standalone, dependency-free helper that resolves the merge-request diff when
 * running inside GitLab CI. The diff base is taken from the predefined GitLab
 * variables, the head is the current checkout (HEAD), and the raw `git diff`
 * is produced with `--unified=0` so the parser sees one record per added line.
 *
 * Resolution order for the base ref:
 *   1. CI_MERGE_REQUEST_DIFF_BASE_SHA  (set on `merge_request_event` pipelines)
 *   2. CI_COMMIT_BEFORE_SHA            (push pipelines; null-SHA on first push)
 *
 * The git invocation is factored out so the pure ref-resolution logic can be
 * unit-tested with a simulated environment, no real repository required.
 */

const { execFileSync } = require('node:child_process');

const ZERO_SHA = '0000000000000000000000000000000000000000';

/**
 * @returns {boolean} true when running inside a GitLab CI pipeline.
 */
function isGitLab(env) {
  const e = env || process.env;
  return e.GITLAB_CI === 'true' || e.GITLAB_CI === '1' || Boolean(e.CI_PROJECT_ID);
}

/**
 * Pure resolver: pick the base ref for the diff from the environment.
 *
 * @param {Record<string,string|undefined>} env  Environment variables.
 * @returns {string|null} The base ref to diff against, or null if none usable.
 */
function resolveBaseRef(env) {
  const e = env || {};
  const base = (e.CI_MERGE_REQUEST_DIFF_BASE_SHA || '').trim();
  if (base && base !== ZERO_SHA) return base;
  const before = (e.CI_COMMIT_BEFORE_SHA || '').trim();
  if (before && before !== ZERO_SHA) return before;
  return null;
}

/**
 * Pure builder: produce the git argv for the MR diff given a resolved base.
 * Falls back to `HEAD~1..HEAD` when no base ref is available.
 *
 * @param {string|null} base  Result of resolveBaseRef.
 * @returns {string[]} argv for `git`.
 */
function buildDiffArgs(base) {
  const range = base ? `${base}..HEAD` : 'HEAD~1..HEAD';
  return ['diff', '--unified=0', range];
}

/**
 * Obtain the merge-request diff in GitLab CI.
 *
 * Best-effort and non-throwing: on any git failure it returns whatever stdout
 * was captured (possibly an empty string) so callers can fall through safely.
 *
 * @param {Record<string,string|undefined>} [env]  Defaults to process.env.
 * @param {(args:string[]) => string} [runGit]      Injectable git runner (tests).
 * @returns {string} Raw unified diff text (may be empty).
 */
function getDiff(env, runGit) {
  const e = env || process.env;
  const run =
    runGit ||
    ((args) => {
      try {
        return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      } catch (err) {
        return (err.stdout && err.stdout.toString()) || '';
      }
    });

  const base = resolveBaseRef(e);
  // Ensure the base commit is present even on shallow CI checkouts.
  if (base) {
    try {
      run(['fetch', '--no-tags', '--depth=1', 'origin', base]);
    } catch {
      /* best-effort; diff may still resolve from local history */
    }
  }
  return run(buildDiffArgs(base));
}

module.exports = { isGitLab, getDiff, resolveBaseRef, buildDiffArgs, ZERO_SHA };
