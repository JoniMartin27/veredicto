'use strict';

/**
 * Veredicto entitlement — 100% OFFLINE licence verification.
 *
 * Veredicto is paid software. There is no free tier, and there is also no licence
 * server: the whole point of this tool is that nothing about your code — not the
 * diff, not the file names, not even the fact that a run happened — leaves the
 * runner. A phone-home entitlement check would quietly break that promise on
 * every pull request, so the licence is a compact Ed25519-signed token verified
 * locally with the embedded PUBLIC key using `node:crypto`. It works on a runner
 * with no egress, forever, and still costs zero dependencies.
 *
 *   VEREDICTO.<base64url(payloadJSON)>.<base64url(signature)>
 *
 *   payload = {
 *     plan:   'repo',
 *     repo:   'owner/name'  (or 'owner/*' for every repository of one owner),
 *     exp:    ISO expiry,
 *     issued: ISO,
 *     email?: string
 *   }
 *   signature = Ed25519 over the payload segment
 *
 * FAIL-CLOSED, without exception: absent, malformed, forged, expired or
 * issued-for-another-repository all return `{ ok: false }` and the run stops.
 * The failure is never silent and never degrades into "analyse anyway" — a check
 * that quietly does nothing is worse than one that is honestly absent.
 *
 * `VEREDICTO_DEV=1` bypasses the gate for this repository's OWN test suite and
 * local development. It is deliberately not documented as a customer-facing
 * escape hatch, and it cannot be set from a workflow you do not control.
 */

const crypto = require('node:crypto');

// The PUBLIC half of the Fervon signing key. The PRIVATE half exists only on the
// author's machine (scripts/keys/, gitignored) and signs each licence sold.
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAbA/vnO8Cr5hm+VGwjY/7cR8K7xQZt+QqiEayawQtHk4=
-----END PUBLIC KEY-----`;

const TOKEN_PREFIX = 'VEREDICTO';

/** Where a buyer goes to purchase. Self-serve, no sales conversation. */
const STORE_URL = 'https://fervon.dev/veredicto/';

function b64urlToBuf(s) {
  return Buffer.from(s, 'base64url');
}

/**
 * Does a licence issued for `licensed` cover the repository `actual`?
 *
 * Matching is case-insensitive because GitHub treats owner and repository names
 * that way, and a buyer who types `Acme/Web` must not be locked out of
 * `acme/web`. A trailing `/*` licenses every repository of that owner.
 */
function repoCovered(licensed, actual) {
  if (typeof licensed !== 'string' || typeof actual !== 'string') return false;
  const want = licensed.trim().toLowerCase();
  const got = actual.trim().toLowerCase();
  if (!want || !got) return false;
  if (want.endsWith('/*')) return got.startsWith(want.slice(0, -1));
  return want === got;
}

/**
 * Verify a licence token offline. Never throws.
 *
 * @param {string} token   the token from the VEREDICTO_LICENSE secret
 * @param {string} repo    'owner/name' of the repository being analysed
 * @param {{now?: Date, publicKeyPem?: string}} [opts]
 *   `now` and `publicKeyPem` are injection points for the test suite: the real
 *   private key is gitignored and never reaches CI, so the tests sign with an
 *   ephemeral keypair of their own. Production always uses the embedded key.
 *   This is not a weakening — anyone willing to patch the source can delete the
 *   check outright. The licence is enforced legally; this code enforces honesty.
 * @returns {{valid: boolean, reason?: string, repo?: string, exp?: string, email?: string}}
 */
function verifyToken(token, repo, opts = {}) {
  const now = opts.now || new Date();
  const publicKeyPem = opts.publicKeyPem || PUBLIC_KEY_PEM;
  try {
    if (typeof token !== 'string' || !token.trim()) {
      return { valid: false, reason: 'no licence key' };
    }
    const parts = token.trim().split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
      return { valid: false, reason: 'malformed licence key' };
    }
    const [, payloadSeg, sigSeg] = parts;

    // Signature first: never parse or trust a payload that is not ours.
    const pub = crypto.createPublicKey(publicKeyPem);
    const ok = crypto.verify(null, Buffer.from(payloadSeg), pub, b64urlToBuf(sigSeg));
    if (!ok) return { valid: false, reason: 'licence key signature does not verify' };

    const payload = JSON.parse(b64urlToBuf(payloadSeg).toString('utf8'));
    if (payload.plan !== 'repo') return { valid: false, reason: 'unknown licence plan' };

    if (!payload.exp) return { valid: false, reason: 'licence key has no expiry' };
    const exp = Date.parse(payload.exp);
    if (!Number.isFinite(exp)) return { valid: false, reason: 'licence key has an unreadable expiry' };
    if (exp <= now.getTime()) {
      return { valid: false, reason: `licence expired on ${String(payload.exp).slice(0, 10)}` };
    }

    if (!repoCovered(payload.repo, repo)) {
      return {
        valid: false,
        reason: `licence was issued for ${payload.repo || '(no repository)'}, not ${repo || '(unknown repository)'}`,
      };
    }

    return {
      valid: true,
      repo: payload.repo,
      exp: payload.exp,
      email: payload.email || null,
    };
  } catch {
    return { valid: false, reason: 'licence key could not be read' };
  }
}

/**
 * Gate for the Action entrypoint. Reads the key and the repository from the
 * environment and decides whether this run is allowed to proceed.
 *
 * @param {{env?: NodeJS.ProcessEnv, now?: Date, publicKeyPem?: string}} [opts]
 * @returns {{ok: boolean, reason?: string, exp?: string, repo?: string, dev?: boolean}}
 */
function checkEntitlement(opts = {}) {
  const env = opts.env || process.env;

  if (env.VEREDICTO_DEV === '1') return { ok: true, dev: true };

  const repo = env.GITHUB_REPOSITORY || '';
  const token = env.VEREDICTO_LICENSE || env.INPUT_LICENSE || '';

  const v = verifyToken(token, repo, { now: opts.now, publicKeyPem: opts.publicKeyPem });
  if (!v.valid) return { ok: false, reason: v.reason };
  return { ok: true, repo: v.repo, exp: v.exp };
}

/**
 * The message shown when a run is refused. It has one job: tell the reader
 * exactly what is wrong and what to do next, without making them read docs.
 */
function entitlementMessage(reason) {
  return [
    `Veredicto: ${reason}.`,
    '',
    'Veredicto is paid software. Add your licence key as a repository secret',
    'named VEREDICTO_LICENSE and pass it to the step:',
    '',
    '    - uses: JoniMartin27/veredicto@v0',
    '      env:',
    '        VEREDICTO_LICENSE: ${{ secrets.VEREDICTO_LICENSE }}',
    '        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
    '',
    `Buy a key, or renew one that has lapsed: ${STORE_URL}`,
  ].join('\n');
}

module.exports = {
  verifyToken,
  checkEntitlement,
  entitlementMessage,
  repoCovered,
  STORE_URL,
  TOKEN_PREFIX,
  PUBLIC_KEY_PEM,
};
