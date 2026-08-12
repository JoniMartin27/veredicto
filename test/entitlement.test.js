'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { verifyToken, checkEntitlement, repoCovered, entitlementMessage } = require('../src/entitlement');

// The real signing key is gitignored and never reaches CI, so the suite mints its
// own keypair and injects the public half. Everything else is the production path.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' });

const OTRA = crypto.generateKeyPairSync('ed25519'); // para firmar tokens forjados

function mint(payload, key = privateKey) {
  const seg = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.sign(null, Buffer.from(seg), key);
  return `VEREDICTO.${seg}.${sig.toString('base64url')}`;
}

const enUnAno = new Date(Date.now() + 365 * 86400000).toISOString();
const ayer = new Date(Date.now() - 86400000).toISOString();

const valido = (over = {}) =>
  mint({ plan: 'repo', repo: 'acme/web', issued: new Date().toISOString(), exp: enUnAno, ...over });

// ---- lo que debe PASAR ----

test('a well-formed licence for this repository is accepted', () => {
  const v = verifyToken(valido(), 'acme/web', { publicKeyPem: PUB });
  assert.strictEqual(v.valid, true, v.reason);
  assert.strictEqual(v.repo, 'acme/web');
});

test('repository matching is case-insensitive', () => {
  // GitHub treats Acme/Web and acme/web as the same repository; a buyer who
  // typed it with capitals must not be locked out of their own CI.
  const v = verifyToken(valido({ repo: 'Acme/Web' }), 'acme/web', { publicKeyPem: PUB });
  assert.strictEqual(v.valid, true, v.reason);
});

test('an owner-wide licence covers every repository of that owner', () => {
  const t = valido({ repo: 'acme/*' });
  for (const r of ['acme/web', 'acme/api', 'acme/anything-at-all']) {
    assert.strictEqual(verifyToken(t, r, { publicKeyPem: PUB }).valid, true, r);
  }
});

// ---- lo que debe FALLAR (fail-closed) ----

test('no licence key at all is refused', () => {
  for (const t of [undefined, null, '', '   ', 42, {}]) {
    const v = verifyToken(t, 'acme/web', { publicKeyPem: PUB });
    assert.strictEqual(v.valid, false, `deberia rechazar: ${String(t)}`);
  }
});

test('a malformed key is refused', () => {
  for (const t of ['nonsense', 'VEREDICTO.only-two', 'OTRO.aaa.bbb', 'VEREDICTO..', 'a.b.c.d']) {
    assert.strictEqual(verifyToken(t, 'acme/web', { publicKeyPem: PUB }).valid, false, t);
  }
});

test('a key signed with the WRONG private key is refused', () => {
  // El ataque obvio: generar tu propio par y firmarte una licencia perpetua.
  const forjada = mint({ plan: 'repo', repo: 'acme/web', exp: enUnAno }, OTRA.privateKey);
  const v = verifyToken(forjada, 'acme/web', { publicKeyPem: PUB });
  assert.strictEqual(v.valid, false);
  assert.match(v.reason, /signature/);
});

test('a tampered payload is refused even though the signature is real', () => {
  // Firmamos para un repo y reescribimos el payload para otro: la firma deja de
  // cuadrar. Esto es lo que impide compartir una licencia editando el token.
  const t = valido({ repo: 'acme/web' });
  const [pref, , sig] = t.split('.');
  const otroSeg = Buffer.from(JSON.stringify({ plan: 'repo', repo: 'pirata/repo', exp: enUnAno })).toString('base64url');
  const v = verifyToken(`${pref}.${otroSeg}.${sig}`, 'pirata/repo', { publicKeyPem: PUB });
  assert.strictEqual(v.valid, false);
  assert.match(v.reason, /signature/);
});

test('an expired licence is refused, and says when it lapsed', () => {
  const v = verifyToken(valido({ exp: ayer }), 'acme/web', { publicKeyPem: PUB });
  assert.strictEqual(v.valid, false);
  assert.match(v.reason, /expired on \d{4}-\d{2}-\d{2}/);
});

test('a licence with no expiry is refused', () => {
  const sinExp = mint({ plan: 'repo', repo: 'acme/web' });
  assert.strictEqual(verifyToken(sinExp, 'acme/web', { publicKeyPem: PUB }).valid, false);
});

test('a licence for another repository is refused, and names both', () => {
  const v = verifyToken(valido({ repo: 'otra/cosa' }), 'acme/web', { publicKeyPem: PUB });
  assert.strictEqual(v.valid, false);
  assert.match(v.reason, /otra\/cosa/);
  assert.match(v.reason, /acme\/web/);
});

test('an owner-wide licence does NOT leak to a lookalike owner', () => {
  // 'acme/*' no debe cubrir 'acme-corp/web': el prefijo comparte letras pero no
  // es el mismo dueno. Se comprueba porque un fallo aqui regala licencias.
  assert.strictEqual(repoCovered('acme/*', 'acme-corp/web'), false);
  assert.strictEqual(repoCovered('acme/*', 'acmecorp/web'), false);
  assert.strictEqual(repoCovered('acme/*', 'acme/web'), true);
});

test('an unknown plan is refused', () => {
  const t = mint({ plan: 'enterprise', repo: 'acme/web', exp: enUnAno });
  assert.strictEqual(verifyToken(t, 'acme/web', { publicKeyPem: PUB }).valid, false);
});

// ---- la puerta que usa la Action ----

test('checkEntitlement reads VEREDICTO_LICENSE and GITHUB_REPOSITORY', () => {
  const env = { VEREDICTO_LICENSE: valido(), GITHUB_REPOSITORY: 'acme/web' };
  assert.strictEqual(checkEntitlement({ env, publicKeyPem: PUB }).ok, true);
});

test('checkEntitlement also accepts the action input as a fallback', () => {
  const env = { INPUT_LICENSE: valido(), GITHUB_REPOSITORY: 'acme/web' };
  assert.strictEqual(checkEntitlement({ env, publicKeyPem: PUB }).ok, true);
});

test('checkEntitlement is FAIL-CLOSED on an empty environment', () => {
  const r = checkEntitlement({ env: {}, publicKeyPem: PUB });
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason);
});

test('a valid key does not unlock a run whose repository is unknown', () => {
  // Sin GITHUB_REPOSITORY no se puede comprobar a quien pertenece la licencia,
  // y "no se puede comprobar" tiene que significar NO, no "adelante".
  const r = checkEntitlement({ env: { VEREDICTO_LICENSE: valido() }, publicKeyPem: PUB });
  assert.strictEqual(r.ok, false);
});

test('VEREDICTO_DEV=1 bypasses the gate for local development', () => {
  const r = checkEntitlement({ env: { VEREDICTO_DEV: '1' }, publicKeyPem: PUB });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.dev, true);
});

test('the refusal message tells the reader what to do', () => {
  const m = entitlementMessage('no licence key');
  assert.match(m, /VEREDICTO_LICENSE/);
  assert.match(m, /fervon\.dev\/veredicto/);
  assert.match(m, /secrets\.VEREDICTO_LICENSE/);
});
