'use strict';

/**
 * Veredicto — pull-request comment reporter.
 *
 * Standalone, dependency-free module that posts (or updates) a single "sticky"
 * comment on the current pull request summarizing the test-gaming findings.
 *
 * It is strictly best-effort: it only acts when running inside a GitHub Actions
 * pull-request context with a token available, and ANY failure (missing env,
 * network error, non-2xx response) is swallowed and logged — it never throws,
 * so it can never break the Action.
 *
 * Sticky behavior: the comment body carries a hidden HTML marker
 * (`<!-- veredicto -->`). On each run we look for an existing comment bearing
 * that marker and PATCH it in place instead of posting a duplicate.
 *
 * Uses the global `fetch` (Node >=18/20) — no external HTTP library.
 */

const fs = require('node:fs');

const MARKER = '<!-- veredicto -->';
const LANDING = 'https://fervon.dev/veredicto/';
const API = 'https://api.github.com';

/**
 * Resolve the GitHub token from the conventional env vars.
 * @returns {string|undefined}
 */
function getToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.INPUT_GITHUB_TOKEN || undefined;
}

/**
 * Read `{ owner, repo, prNumber }` from the Actions environment.
 * Returns `null` when we are not in a usable PR context.
 * @returns {{owner:string, repo:string, prNumber:number}|null}
 */
function getContext() {
  // owner/repo come from GITHUB_REPOSITORY ("owner/repo").
  const repoFull = process.env.GITHUB_REPOSITORY || '';
  const slash = repoFull.indexOf('/');
  if (slash <= 0) return null;
  const owner = repoFull.slice(0, slash);
  const repo = repoFull.slice(slash + 1);
  if (!owner || !repo) return null;

  // The PR number lives in the event payload.
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return null;
  let ev;
  try {
    ev = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  } catch {
    return null;
  }
  const pr = ev && ev.pull_request;
  const prNumber =
    (pr && pr.number) ||
    (ev && ev.issue && ev.issue.pull_request && ev.issue.number) ||
    null;
  if (!prNumber || typeof prNumber !== 'number') return null;

  return { owner, repo, prNumber };
}

/**
 * Escape a string so it is safe inside a single markdown table cell.
 * @param {*} s
 * @returns {string}
 */
function cell(s) {
  return String(s == null ? '' : s)
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|');
}

/**
 * Build the markdown comment body for a set of findings.
 * @param {Array<{rule:string,severity:string,file:string,line:number,message:string}>} findings
 * @returns {string}
 */
function buildBody(findings) {
  const list = Array.isArray(findings) ? findings : [];
  const lines = [MARKER, '## ⚖️ Veredicto', ''];

  if (list.length === 0) {
    lines.push('✅ **No test-gaming signals detected** in this diff.');
  } else {
    const errors = list.filter((f) => f && f.severity === 'error').length;
    const warnings = list.length - errors;
    lines.push(
      `Found **${list.length}** test-gaming signal(s): **${errors}** hard, **${warnings}** soft.`,
      '',
      '| Severity | Rule | File | Line | Detail |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const f of list) {
      const sev = f && f.severity === 'error' ? 'error' : 'warning';
      const icon = sev === 'error' ? '🛑' : '⚠️';
      lines.push(
        `| ${icon} ${sev} | \`${cell(f && f.rule)}\` | \`${cell(f && f.file)}\` | ${cell(f && f.line)} | ${cell(f && f.message)} |`,
      );
    }
  }

  lines.push(
    '',
    `_Free static detection by [Veredicto](${LANDING}). The diff-vs-claim LLM judge + signed report is the Pro tier._`,
  );
  return lines.join('\n');
}

/**
 * Shared headers for the GitHub REST API.
 * @param {string} token
 * @returns {Record<string,string>}
 */
function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'veredicto',
    'Content-Type': 'application/json',
  };
}

/**
 * Find the id of a pre-existing sticky Veredicto comment, if any.
 * @returns {Promise<number|null>}
 */
async function findStickyComment(ctx, token) {
  // Page through issue comments looking for our marker.
  for (let page = 1; page <= 10; page++) {
    const url = `${API}/repos/${ctx.owner}/${ctx.repo}/issues/${ctx.prNumber}/comments?per_page=100&page=${page}`;
    const res = await fetch(url, { method: 'GET', headers: headers(token) });
    if (!res || !res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    for (const c of arr) {
      if (c && typeof c.body === 'string' && c.body.includes(MARKER)) {
        return c.id;
      }
    }
    if (arr.length < 100) return null; // last page
  }
  return null;
}

/**
 * Post a new sticky comment, or update the existing one in place.
 *
 * Best-effort: returns `false` (never throws) when it could not act, `true`
 * when a comment was created/updated.
 *
 * @param {Array<{rule:string,severity:string,file:string,line:number,message:string}>} findings
 * @returns {Promise<boolean>}
 */
async function postComment(findings) {
  try {
    if (typeof fetch !== 'function') {
      console.log('Veredicto reporter: global fetch unavailable; skipping PR comment.');
      return false;
    }
    const token = getToken();
    if (!token) {
      console.log('Veredicto reporter: no GITHUB_TOKEN; skipping PR comment.');
      return false;
    }
    const ctx = getContext();
    if (!ctx) {
      console.log('Veredicto reporter: not a pull-request context; skipping PR comment.');
      return false;
    }

    const body = buildBody(findings);
    const existingId = await findStickyComment(ctx, token);

    if (existingId) {
      const url = `${API}/repos/${ctx.owner}/${ctx.repo}/issues/comments/${existingId}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: headers(token),
        body: JSON.stringify({ body }),
      });
      if (!res || !res.ok) {
        console.log(`Veredicto reporter: failed to update comment (HTTP ${res ? res.status : 'n/a'}).`);
        return false;
      }
      console.log('Veredicto reporter: updated sticky PR comment.');
      return true;
    }

    const url = `${API}/repos/${ctx.owner}/${ctx.repo}/issues/${ctx.prNumber}/comments`;
    const res = await fetch(url, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ body }),
    });
    if (!res || !res.ok) {
      console.log(`Veredicto reporter: failed to post comment (HTTP ${res ? res.status : 'n/a'}).`);
      return false;
    }
    console.log('Veredicto reporter: posted sticky PR comment.');
    return true;
  } catch (err) {
    // Never let the reporter break the Action.
    console.log(`Veredicto reporter: error (ignored): ${err && err.message ? err.message : err}`);
    return false;
  }
}

module.exports = {
  postComment,
  // Alias so the entrypoint (which calls reporter.post) wires up cleanly.
  post: postComment,
  // Exported for testing.
  _internal: { buildBody, getContext, getToken, findStickyComment, MARKER },
};
