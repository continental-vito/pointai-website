// GET /api/download?t=<invite>[&v=<version>]  →  302 to the beta DMG
//
// The gate that keeps the beta to the people invited to it.
//
// An invite is `<id>.<signature>`, where the signature is an HMAC-SHA256 of the
// id under INVITE_SECRET. That means there is no database: a code is valid
// because it verifies, not because it was looked up. Codes cannot be guessed
// without the secret, each tester gets their own — so downloads are attributable
// and one leaked code can be revoked without disturbing the other ninety-nine.
//
// The bytes never pass through this function. GitHub answers an authenticated
// asset request with a 302 to a short-lived signed URL, and that redirect is
// handed to the browser. Streaming instead would put a 2 MB body through a
// serverless response — slower, metered, and capped.
//
// Required environment variables (Vercel → Settings → Environment Variables):
//   GITHUB_TOKEN     fine-grained PAT, ONLY continental-vito/point-ai,
//                    permissions: Contents: Read-only
//   INVITE_SECRET    any long random string; `openssl rand -hex 32`
//   REVOKED_INVITES  optional, comma-separated invite ids to refuse
//   RELEASES_REPO    optional, defaults to continental-vito/point-ai

const crypto = require('crypto');

const DEFAULT_REPO = 'continental-vito/point-ai';

// 16 bytes of the HMAC, hex. Full-length is 64 characters of URL for no
// meaningful gain; 128 bits is far past guessable for a link nobody is
// rate-limited into brute-forcing.
const SIG_BYTES = 16;

function sign(id, secret) {
  return crypto.createHmac('sha256', secret).update(id).digest('hex').slice(0, SIG_BYTES * 2);
}

/// Constant-time compare. `===` on a signature leaks its prefix through timing,
/// which is a real attack against a code with no rate limit in front of it.
function signatureMatches(expected, given) {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Plain text, not JSON: this route is opened by a human clicking a link, and a
// browser showing raw JSON when their invite expired is a support email.
function deny(res, status, message) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(message + '\n\nhello@pointai.dev\n');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return deny(res, 405, 'Method not allowed.');
  }

  const secret = process.env.INVITE_SECRET;
  const token = process.env.GITHUB_TOKEN;
  if (!secret || !token) {
    console.error('[download] missing INVITE_SECRET or GITHUB_TOKEN');
    return deny(res, 503, 'Downloads are not switched on yet. Email us and we will send you a build.');
  }

  const invite = String((req.query && req.query.t) || '').trim();
  const [id, signature] = invite.split('.');
  if (!id || !signature) {
    return deny(res, 401,
      'This link is missing its invite code.\n\n' +
      'Use the download link from your invitation email — the whole link, including ' +
      'the part after "?t=". If you have lost it, ask us for another.');
  }

  if (!signatureMatches(sign(id, secret), signature)) {
    console.warn('[download] bad signature for id=%s', id.slice(0, 40));
    return deny(res, 403,
      'This invite code is not valid.\n\n' +
      'It may have been retyped or cut short. Copy the link straight from your ' +
      'invitation email rather than typing it.');
  }

  const revoked = String(process.env.REVOKED_INVITES || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (revoked.includes(id)) {
    console.warn('[download] revoked invite id=%s', id);
    return deny(res, 403, 'This invite has been withdrawn. Email us if that is a surprise.');
  }

  const repo = process.env.RELEASES_REPO || DEFAULT_REPO;
  const wanted = String((req.query && req.query.v) || '').trim();
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 8000);

  const gh = (path, accept) => fetch(`https://api.github.com/repos/${repo}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept || 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'pointai.dev',
    },
    redirect: 'manual',
    signal: ctl.signal,
  });

  try {
    const listed = await gh('/releases?per_page=30');
    if (!listed.ok) {
      const text = await listed.text();
      console.error('[download] github list %d: %s', listed.status, text.slice(0, 300));
      return deny(res, 502, 'GitHub did not answer. Try again in a few minutes.');
    }

    // Same filter as /api/versions, for the same reason: a build that is not a
    // beta prerelease must not be reachable from a tester's link even if the
    // version number is guessed.
    const betas = (await listed.json())
      .filter((rel) => !rel.draft && rel.prerelease && /-beta(\.|$)/.test(rel.tag_name))
      .sort((a, b) => new Date(b.published_at) - new Date(a.published_at));

    const release = wanted
      ? betas.find((rel) => rel.tag_name === wanted || rel.tag_name === `v${wanted}`
                         || rel.tag_name.replace(/^v/, '').split('-')[0] === wanted)
      : betas[0];

    if (!release) {
      return deny(res, 404, wanted
        ? `There is no beta build ${wanted}.`
        : 'No beta build has been published yet. You will get an email when one is.');
    }

    const asset = release.assets.find((a) => a.name.endsWith('.dmg'));
    if (!asset) {
      console.error('[download] %s has no .dmg asset', release.tag_name);
      return deny(res, 500, `Build ${release.tag_name} has no download attached. We have been told.`);
    }

    // octet-stream is what turns this into a 302 at a signed URL rather than
    // JSON describing the asset. Without it GitHub returns metadata, 200, and
    // the browser downloads a JSON file named like a DMG.
    const assetRes = await gh(`/releases/assets/${asset.id}`, 'application/octet-stream');
    const location = assetRes.headers.get('location');

    if (!location) {
      console.error('[download] asset %s gave %d with no location', asset.id, assetRes.status);
      return deny(res, 502, 'GitHub did not hand over the file. Try again in a few minutes.');
    }

    console.log('[download] %s → %s (invite %s)', release.tag_name, asset.name, id);

    // no-store on the redirect: the signed URL it points at expires in minutes,
    // and a cached 302 would send someone to a dead link tomorrow.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', location);
    return res.status(302).end();
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    console.error('[download] %s: %s', aborted ? 'timeout' : 'network', err && err.message);
    return deny(res, 504, 'The download timed out. Try again in a few minutes.');
  } finally {
    clearTimeout(timeout);
  }
};
