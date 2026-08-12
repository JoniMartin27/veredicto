'use strict';

// End-to-end check of the licence gate through the REAL entrypoint.
//
// The unit tests in entitlement.test.js prove the verifier says no. This proves
// the Action *behaves* as if it said no — which is a different claim, and the one
// that matters. The failure mode being guarded against is not "someone uses it
// free"; it is an unlicensed run that prints nothing and goes green, which a
// buyer would read as "Veredicto ran and my PR is clean".

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ENTRY = path.join(__dirname, '..', 'src', 'index.js');

function run(env) {
  const limpio = { ...process.env };
  // El entorno heredado trae VEREDICTO_DEV=1 en el CI de este repo (se
  // dogfoodea). Si no se borra, esta prueba pasaria sin probar nada.
  delete limpio.VEREDICTO_DEV;
  delete limpio.VEREDICTO_LICENSE;
  delete limpio.INPUT_LICENSE;

  return spawnSync(process.execPath, [ENTRY], {
    env: { ...limpio, ...env },
    encoding: 'utf8',
    cwd: path.join(__dirname, '..'),
    timeout: 30000,
  });
}

test('an unlicensed run FAILS the step', () => {
  const r = run({ GITHUB_REPOSITORY: 'acme/web' });
  assert.strictEqual(r.status, 1, `salida ${r.status}\n${r.stdout}\n${r.stderr}`);
});

test('an unlicensed run says what is wrong and where to fix it', () => {
  const r = run({ GITHUB_REPOSITORY: 'acme/web' });
  assert.match(r.stdout, /::error::/);
  assert.match(r.stdout, /licence/i);
  assert.match(r.stdout, /VEREDICTO_LICENSE/);
  assert.match(r.stdout, /fervon\.dev\/veredicto/);
});

test('an unlicensed run NEVER looks like a clean result', () => {
  // Sin esto, la peor version del fallo: la Action no corre, no dice nada
  // reconocible, y el PR se pone verde. El comprador cree que esta cubierto.
  const r = run({ GITHUB_REPOSITORY: 'acme/web' });
  const salida = r.stdout + r.stderr;
  assert.doesNotMatch(salida, /signal\(s\)/, 'no debe publicar un recuento de hallazgos');
  assert.doesNotMatch(salida, /nothing to analyze/, 'no debe informar de un diff vacio');
  assert.doesNotMatch(salida, /::warning::.*veredicto-disable/i);
});

test('an expired licence is refused by the entrypoint, not just by the verifier', () => {
  // Token con forma correcta pero firmado por nadie: recorre el mismo camino
  // que uno caducado hasta el punto en que la Action decide parar.
  const payload = Buffer.from(
    JSON.stringify({ plan: 'repo', repo: 'acme/web', exp: '2020-01-01T00:00:00.000Z' })
  ).toString('base64url');
  const r = run({ GITHUB_REPOSITORY: 'acme/web', VEREDICTO_LICENSE: `VEREDICTO.${payload}.bm8` });
  assert.strictEqual(r.status, 1);
  assert.doesNotMatch(r.stdout + r.stderr, /signal\(s\)/);
});

test('the dev bypass is not readable from an untrusted input', () => {
  // VEREDICTO_DEV solo puede venir del entorno del proceso. Que alguien pase
  // `license: VEREDICTO_DEV=1` como input de la Action no debe abrir la puerta.
  const r = run({ GITHUB_REPOSITORY: 'acme/web', INPUT_LICENSE: 'VEREDICTO_DEV=1' });
  assert.strictEqual(r.status, 1);
});
