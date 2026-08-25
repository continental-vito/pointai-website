#!/usr/bin/env node
//
// Mint beta invite links.
//
//     INVITE_SECRET=… node tools/invite.js ada@example.com
//     INVITE_SECRET=… node tools/invite.js --file testers.txt
//     INVITE_SECRET=… node tools/invite.js --verify ada-4f2c.9a1b…
//
// An invite is `<id>.<signature>` where the signature is an HMAC of the id under
// INVITE_SECRET — the same computation /api/download verifies. There is no
// database and nothing to keep in sync: a code is valid because it verifies.
//
// The id is derived from the email so it is recognisable in the download log
// ("who is downloading?" is answerable), but it is NOT the email itself and the
// email is not recoverable from it — these links get pasted into group chats,
// and a code that leaked someone's address when it leaked would be worse than
// one that leaks nothing. The short hash disambiguates two people called ada.
//
// Revoking one: add its id to REVOKED_INVITES in Vercel and redeploy.

const crypto = require('crypto');
const fs = require('fs');

const SIG_BYTES = 16;   // must match api/download.js
const SITE = process.env.SITE || 'https://pointai.dev';

const secret = process.env.INVITE_SECRET;
if (!secret) {
  console.error('INVITE_SECRET is not set.\n');
  console.error('Use the same value as Vercel → Settings → Environment Variables.');
  console.error('If there is not one yet:  openssl rand -hex 32');
  process.exit(1);
}

const sign = (id) =>
  crypto.createHmac('sha256', secret).update(id).digest('hex').slice(0, SIG_BYTES * 2);

function idFor(email) {
  const clean = String(email).trim().toLowerCase();
  const local = clean.split('@')[0].replace(/[^a-z0-9]+/g, '-').slice(0, 20).replace(/^-|-$/g, '');
  const short = crypto.createHash('sha256').update(clean).digest('hex').slice(0, 6);
  return `${local || 'tester'}-${short}`;
}

const args = process.argv.slice(2);

if (args[0] === '--verify') {
  const [id, signature] = String(args[1] || '').split('.');
  const ok = id && signature && sign(id) === signature;
  console.log(ok ? `✓ valid — id ${id}` : '✗ not a valid invite');
  process.exit(ok ? 0 : 1);
}

let emails = args.filter((a) => !a.startsWith('--'));
const fileFlag = args.indexOf('--file');
if (fileFlag !== -1) {
  emails = emails.concat(
    fs.readFileSync(args[fileFlag + 1], 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  );
}

if (!emails.length) {
  console.error('Usage: INVITE_SECRET=… node tools/invite.js <email> [email…]');
  console.error('       INVITE_SECRET=… node tools/invite.js --file testers.txt');
  process.exit(1);
}

for (const email of emails) {
  const id = idFor(email);
  console.log(`${email}\t${SITE}/download?t=${id}.${sign(id)}`);
}
