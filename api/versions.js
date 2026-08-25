// GET /api/versions?channel=beta  →  the releases that channel is offering
//
// Point AI's source lives in a PRIVATE repository, which is what makes this
// route necessary: a private repo's release list and its DMG assets both need an
// authenticated request, so a browser cannot read either. This function holds
// the token server-side and republishes only what a tester is allowed to know —
// version, date and notes. Never the asset URL, which is what /api/download
// gates, and never anything about the internal channel.
//
// Two consumers, one source of truth: the /versions page renders this, and the
// app's "Check for Updates…" reads it. GitHub Releases stays the only place a
// release is recorded — there is no manifest file to forget to update.
//
// Required environment variables (Vercel → Settings → Environment Variables):
//   GITHUB_TOKEN   fine-grained PAT, ONLY continental-vito/point-ai,
//                  permissions: Contents: Read-only. Nothing else.
//   RELEASES_REPO  continental-vito/point-ai   (optional; this is the default)

const DEFAULT_REPO = 'continental-vito/point-ai';

// The internal channel is not routable. Not because the filter below would let
// it through — it would not — but because a typo that made it routable would
// publish the full-feature build's existence to the world, and an allowlist
// fails closed where a denylist fails open.
const CHANNELS = { beta: true };

function json(res, status, body, cacheSeconds) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheSeconds
    ? `public, s-maxage=${cacheSeconds}, stale-while-revalidate=600`
    : 'no-store');
  res.status(status).send(JSON.stringify(body));
}

// "v0.12.0-beta" → "0.12.0". The app compares this against its own
// CFBundleShortVersionString, which carries neither the v nor the suffix.
function plainVersion(tag) {
  return String(tag).replace(/^v/, '').split('-')[0];
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { error: 'method_not_allowed' });
  }

  const channel = String((req.query && req.query.channel) || 'beta').toLowerCase();
  if (!CHANNELS[channel]) {
    return json(res, 404, { error: 'unknown_channel', channel });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    // Never an empty list — that is indistinguishable from "no builds yet", and
    // it would tell every tester they are up to date while the feed is broken.
    console.error('[versions] GITHUB_TOKEN is not set');
    return json(res, 503, { error: 'not_configured' });
  }

  const repo = process.env.RELEASES_REPO || DEFAULT_REPO;
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 8000);

  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'pointai.dev',
      },
      signal: ctl.signal,
    });

    if (!r.ok) {
      const text = await r.text();
      // Status and GitHub's message, never the token.
      console.error('[versions] github %d: %s', r.status, text.slice(0, 300));
      return json(res, 502, { error: 'upstream_error' });
    }

    const all = await r.json();

    // Both conditions, not either. `prerelease` is what `make release-beta`
    // sets and the tag suffix is what it names the tag — requiring both means a
    // release has to be wrong in two independent ways before an internal build
    // could appear on a page testers read.
    const releases = all
      .filter((rel) => !rel.draft && rel.prerelease && /-beta(\.|$)/.test(rel.tag_name))
      .map((rel) => ({
        version: plainVersion(rel.tag_name),
        tag: rel.tag_name,
        publishedAt: rel.published_at,
        notes: rel.body || null,
        // Which file to ask /api/download for. An id, not a URL: the real asset
        // URL is authenticated and short-lived, and publishing it here would
        // route around the invite code entirely.
        assetId: (rel.assets.find((a) => a.name.endsWith('.dmg')) || {}).id || null,
        size: (rel.assets.find((a) => a.name.endsWith('.dmg')) || {}).size || null,
      }))
      // Newest first, so a client can trust `releases[0]` and one that re-sorts
      // agrees with one that does not.
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    // Five minutes at the edge. A hundred apps checking for updates must not be
    // a hundred GitHub calls, and a release is never more than five minutes from
    // being visible.
    return json(res, 200, { channel, releases }, 300);
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    console.error('[versions] %s: %s', aborted ? 'timeout' : 'network', err && err.message);
    return json(res, 504, { error: aborted ? 'timeout' : 'network_error' });
  } finally {
    clearTimeout(timeout);
  }
};
