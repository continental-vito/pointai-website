#!/usr/bin/env node
//
// Put each subscriber's personal invite link into their beehiiv profile, so one
// designed email can carry a different link to every recipient.
//
//     node tools/beehiiv-invites.js                  # dry run — shows what it would do
//     node tools/beehiiv-invites.js --write          # actually writes to beehiiv
//     node tools/beehiiv-invites.js --csv            # emit a CSV to import by hand
//     node tools/beehiiv-invites.js --file list.txt  # only these addresses
//
// It writes the link into the `beta_invite_url` custom field. In the beehiiv
// editor that becomes the merge tag {{beta_invite_url}}, which you put behind
// the download button — beehiiv substitutes each recipient's own link at send
// time. One email, designed once, personalised per person.
//
// Why not send the emails from here: beehiiv already owns deliverability, the
// unsubscribe footer, bounce handling and the design. A script that sent mail
// directly would reinvent all of it worse, and land in spam.
//
// Environment:
//   BEEHIIV_API_KEY   beehiiv → Settings → Integrations → API  (same key Vercel has)
//   INVITE_SECRET     the same value set in Vercel — links minted with a
//                     different secret will be rejected by /api/download
//
// Dry run by default. This writes to a live mailing list, so doing nothing
// unless explicitly told to is the safer default direction.

const crypto = require('crypto');
const fs = require('fs');

const PUBLICATION_ID = process.env.BEEHIIV_PUBLICATION_ID
  || 'pub_15c9d5e4-3af0-4601-9782-8067057fedaf';
const FIELD = 'beta_invite_url';
const SITE = process.env.SITE || 'https://pointai.dev';
const SIG_BYTES = 16;              // must match api/download.js
const API = 'https://api.beehiiv.com/v2';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };

const WRITE = has('--write');
const CSV = has('--csv');

const secret = process.env.INVITE_SECRET;
if (!secret) {
  console.error('INVITE_SECRET is not set — it must be the SAME value as in Vercel,');
  console.error('or every link this mints will be rejected by /api/download.\n');
  console.error('  INVITE_SECRET="…" node tools/beehiiv-invites.js');
  process.exit(1);
}

const apiKey = process.env.BEEHIIV_API_KEY;
if (!apiKey && !CSV) {
  console.error('BEEHIIV_API_KEY is not set.\n');
  console.error('Get it from beehiiv → Settings → Integrations → API, or use --csv');
  console.error('to produce a file you can import by hand instead.');
  process.exit(1);
}

// Same computation as api/download.js and tools/invite.js. If these three ever
// disagree, every link stops verifying at once — which is loud, at least.
const sign = (id) =>
  crypto.createHmac('sha256', secret).update(id).digest('hex').slice(0, SIG_BYTES * 2);

function idFor(email) {
  const clean = String(email).trim().toLowerCase();
  const local = clean.split('@')[0].replace(/[^a-z0-9]+/g, '-').slice(0, 20).replace(/^-|-$/g, '');
  const short = crypto.createHash('sha256').update(clean).digest('hex').slice(0, 6);
  return `${local || 'tester'}-${short}`;
}

const linkFor = (email) => {
  const id = idFor(email);
  return `${SITE}/download?t=${id}.${sign(id)}`;
};

const bee = async (path, options = {}) => {
  const r = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await r.text();
  let body = {};
  try { body = JSON.parse(text); } catch (_) {}
  if (!r.ok) {
    // beehiiv's own message, never the key. A bare status here is undiagnosable.
    const err = new Error(`beehiiv ${r.status}: ${text.slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
  return body;
};

async function activeSubscribers() {
  const out = [];
  for (let page = 1; ; page++) {
    const data = await bee(
      `/publications/${PUBLICATION_ID}/subscriptions?status=active&per_page=100&page=${page}`
    );
    out.push(...(data.data || []));
    const total = (data.total_pages) || (data.pagination && data.pagination.total_pages) || 1;
    if (page >= total) break;
  }
  return out;
}

(async () => {
  let people;

  const file = valueOf('--file');
  if (file) {
    // An explicit list still has to be matched to real subscriptions: writing a
    // custom field needs the subscription id, and an address that never signed
    // up has none. Those are reported rather than skipped in silence.
    const wanted = new Set(
      fs.readFileSync(file, 'utf8').split('\n')
        .map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#'))
    );
    const all = CSV ? [] : await activeSubscribers();
    if (CSV) {
      people = [...wanted].map((email) => ({ email, id: null }));
    } else {
      people = all.filter((s) => wanted.has(String(s.email).toLowerCase()));
      const found = new Set(people.map((p) => String(p.email).toLowerCase()));
      for (const email of wanted) {
        if (!found.has(email)) console.error(`  ! not an active subscriber, skipped: ${email}`);
      }
    }
  } else {
    people = await activeSubscribers();
  }

  if (!people.length) {
    console.error('No matching subscribers.');
    process.exit(1);
  }

  if (CSV) {
    // Import this in beehiiv and map the second column to beta_invite_url.
    console.log('email,beta_invite_url');
    for (const p of people) console.log(`${p.email},${linkFor(p.email)}`);
    return;
  }

  console.error(`${people.length} active subscriber${people.length === 1 ? '' : 's'}`);
  console.error(WRITE ? 'Writing to beehiiv…\n' : 'DRY RUN — nothing is being written. Add --write.\n');

  let written = 0;
  for (const p of people) {
    const url = linkFor(p.email);
    if (!WRITE) {
      console.log(`${p.email}\t${url}`);
      continue;
    }
    try {
      await bee(`/publications/${PUBLICATION_ID}/subscriptions/${p.id}`, {
        method: 'PUT',
        body: JSON.stringify({ custom_fields: [{ name: FIELD, value: url }] }),
      });
      written++;
      console.log(`  ✓ ${p.email}`);
    } catch (err) {
      console.error(`  ✗ ${p.email} — ${err.message}`);
    }
  }

  if (!WRITE) return;

  // Read one back. A 200 from beehiiv is not proof the field landed under the
  // name the merge tag will look for, and a silently-empty merge tag ships an
  // email with a dead button to everyone at once.
  const check = people[0];
  const back = await bee(`/publications/${PUBLICATION_ID}/subscriptions/${check.id}?expand[]=custom_fields`);
  const fields = (back.data && back.data.custom_fields) || [];
  const got = fields.find((f) => f.name === FIELD);

  console.error(`\n${written}/${people.length} written.`);
  if (got && got.value === linkFor(check.email)) {
    console.error(`✓ verified on ${check.email} — merge tag {{${FIELD}}} will resolve`);
  } else {
    console.error(`✗ VERIFY FAILED — ${FIELD} did not read back on ${check.email}.`);
    console.error(`  got: ${JSON.stringify(fields)}`);
    console.error('  Do NOT send the email: the button would be empty for everyone.');
    process.exit(1);
  }
})().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
