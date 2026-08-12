// Mint a Veredicto licence key — run this AFTER a self-serve sale.
//
// The key is an Ed25519-signed token verified 100% OFFLINE by src/entitlement.js.
// The PRIVATE signing key lives only here, under scripts/keys/ (gitignored).
// Never commit it; never ship it; back it up somewhere you will still have in a
// year, because losing it means no existing customer can ever be renewed.
//
//   node scripts/sign-license.mjs --repo acme/web --months 12
//   node scripts/sign-license.mjs --repo acme/'*' --months 1 --email buyer@acme.com
//
// Output: one VEREDICTO.<...>.<...> token the buyer stores as the repository
// secret VEREDICTO_LICENSE.
//
// First-time setup (only if scripts/keys is empty):
//   node scripts/sign-license.mjs --init    # generates the keypair and prints the
//                                           # PUBLIC PEM to paste into entitlement.js

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = path.join(__dirname, 'keys');
const PRIV = path.join(KEYS_DIR, 'veredicto-signing-private.pem');
const PUB = path.join(KEYS_DIR, 'veredicto-signing-public.pem');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};

if (has('--init')) {
  if (fs.existsSync(PRIV)) {
    console.error(`Refusing to overwrite an existing signing key at ${PRIV}.`);
    console.error('Overwriting it would orphan every licence already sold.');
    process.exit(1);
  }
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(PRIV, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(PUB, publicKey.export({ type: 'spki', format: 'pem' }));
  console.log('Keypair written to scripts/keys/ (gitignored).');
  console.log('Paste this PUBLIC key into src/entitlement.js as PUBLIC_KEY_PEM:\n');
  console.log(publicKey.export({ type: 'spki', format: 'pem' }));
  console.log('BACK UP the private key. Losing it means no customer can be renewed.');
  process.exit(0);
}

const repo = opt('--repo');
if (!repo) {
  console.error('Usage: node scripts/sign-license.mjs --repo owner/name [--months 12] [--email buyer@example.com]');
  console.error('       node scripts/sign-license.mjs --repo "owner/*"    (every repository of one owner)');
  console.error('       node scripts/sign-license.mjs --init              (first-time keypair setup)');
  process.exit(1);
}
if (!/^[^/\s]+\/([^/\s]+|\*)$/.test(repo)) {
  console.error(`--repo must look like "owner/name" or "owner/*", got: ${repo}`);
  process.exit(1);
}

const months = Number(opt('--months', '12'));
if (!Number.isFinite(months) || months <= 0) {
  console.error(`--months must be a positive number, got: ${opt('--months')}`);
  process.exit(1);
}
const email = opt('--email');

let privPem;
try {
  privPem = fs.readFileSync(PRIV, 'utf8');
} catch {
  console.error(`No private key at ${PRIV}. Run with --init first.`);
  process.exit(1);
}

const now = new Date();
const exp = new Date(now);
exp.setMonth(exp.getMonth() + months);

const payload = { plan: 'repo', repo, issued: now.toISOString(), exp: exp.toISOString() };
if (email) payload.email = email;

const payloadSeg = Buffer.from(JSON.stringify(payload)).toString('base64url');
const sig = crypto.sign(null, Buffer.from(payloadSeg), crypto.createPrivateKey(privPem));
const token = `VEREDICTO.${payloadSeg}.${sig.toString('base64url')}`;

console.log(`\nLicence for ${repo}${email ? ` (${email})` : ''}`);
console.log(`Valid until ${exp.toISOString().slice(0, 10)} (${months} month${months === 1 ? '' : 's'})\n`);
console.log(token);
console.log('\nThe buyer stores this as the repository secret VEREDICTO_LICENSE.');
