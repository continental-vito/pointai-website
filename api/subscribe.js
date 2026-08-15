// POST /api/subscribe  →  creates a beehiiv subscription
//
// Runs on Vercel as a Node serverless function. The beehiiv API key is a
// server-side secret and must never be shipped to the browser, which is the
// whole reason this route exists instead of the form calling beehiiv directly.
//
// Required environment variables (Vercel → Settings → Environment Variables):
//   BEEHIIV_API_KEY         from beehiiv → Settings → Integrations → API
//   BEEHIIV_PUBLICATION_ID  pub_15c9d5e4-3af0-4601-9782-8067057fedaf
//
// The welcome email is sent by the "Waitlist welcome" automation in beehiiv,
// not by this route — send_welcome_email stays false so nobody gets two.

const BEEHIIV_API = 'https://api.beehiiv.com/v2';

// Deliberately permissive: the goal is to reject obvious typos and junk,
// not to out-clever RFC 5322. beehiiv does the authoritative validation.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  const apiKey = process.env.BEEHIIV_API_KEY;
  const pubId = process.env.BEEHIIV_PUBLICATION_ID;
  if (!apiKey || !pubId) {
    // Surfaced to the visitor as "the waitlist isn't open yet" rather than a
    // fake success — never pretend to have stored an address we didn't store.
    console.error('[subscribe] missing BEEHIIV_API_KEY or BEEHIIV_PUBLICATION_ID');
    return json(res, 503, { ok: false, error: 'not_configured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const email = String(body.email || '').trim().toLowerCase();
  if (!email || email.length > 320 || !EMAIL_RE.test(email)) {
    return json(res, 400, { ok: false, error: 'invalid_email' });
  }

  const payload = {
    email,
    reactivate_existing: true,      // someone who unsubscribed and came back
    send_welcome_email: false,      // the automation owns the welcome email
    utm_source: body.utm_source || 'pointai.dev',
    utm_medium: body.utm_medium || 'waitlist_form',
  };
  if (body.utm_campaign) payload.utm_campaign = String(body.utm_campaign).slice(0, 120);

  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 10000);

  try {
    const r = await fetch(`${BEEHIIV_API}/publications/${pubId}/subscriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });

    const text = await r.text();
    let data = {};
    try { data = JSON.parse(text); } catch (_) {}

    if (!r.ok) {
      // Log the status and beehiiv's message, never the key or the payload.
      console.error('[subscribe] beehiiv %d: %s', r.status, text.slice(0, 400));
      if (r.status === 400 || r.status === 422) {
        return json(res, 400, { ok: false, error: 'invalid_email' });
      }
      if (r.status === 429) {
        return json(res, 429, { ok: false, error: 'rate_limited' });
      }
      return json(res, 502, { ok: false, error: 'upstream_error' });
    }

    // The API doesn't reliably distinguish "new" from "already subscribed", so
    // we don't claim to. It does report "validating" when double opt-in is on
    // for the publication or the form, and that changes what we must tell the
    // visitor — otherwise they'd never know to go and confirm.
    const status = (data && data.data && data.data.status) || 'active';
    return json(res, 200, { ok: true, status });
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    console.error('[subscribe] %s: %s', aborted ? 'timeout' : 'network', err && err.message);
    return json(res, 504, { ok: false, error: aborted ? 'timeout' : 'network_error' });
  } finally {
    clearTimeout(timeout);
  }
};
