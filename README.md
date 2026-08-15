# pointai.dev

Waitlist landing page for **Point** — an AI-powered cursor for macOS.

Static page plus one serverless function. No build step, no dependencies.

```
index.html          the whole page — markup, styles, animation, form logic
api/subscribe.js    serverless function: creates the beehiiv subscription
og-image.png        1200×630 social card
favicon.svg         flips black/white via prefers-color-scheme
point-mark.svg      the mark on its own (white)
app-icon.svg        macOS squircle icon, used as the apple-touch-icon
vercel.json         cache + security headers
```

## Waitlist → beehiiv

The form posts to `/api/subscribe`, which calls the beehiiv API **server-side**.
The API key never reaches the browser — that's the whole reason the route exists
instead of the form talking to beehiiv directly.

### Required environment variables

Set both in **Vercel → Settings → Environment Variables** (all environments):

| Variable | Value |
|---|---|
| `BEEHIIV_API_KEY` | beehiiv → Settings → Integrations → API → create a key |
| `BEEHIIV_PUBLICATION_ID` | `pub_15c9d5e4-3af0-4601-9782-8067057fedaf` |

Redeploy after adding them — env vars are baked in at deploy time.

Until they're set the form validates the address and then tells the visitor to
email `hello@pointai.dev`. It never reports success for an address it didn't save.

### What the route does

- Normalises the address (trim + lowercase) and rejects obvious junk before calling beehiiv
- `reactivate_existing: true` — someone who unsubscribed and came back is re-added
- `send_welcome_email: false` — the **Waitlist welcome** automation sends that email,
  so this stays off or people get two
- Forwards `utm_source` / `utm_medium` / `utm_campaign` from the query string,
  defaulting to `pointai.dev` / `waitlist_form`
- Surfaces beehiiv's `validating` status, so if double opt-in ever gets switched on
  the page tells people to go and confirm instead of leaving them hanging
- Logs upstream failures with status and message, never the key or the payload

### The welcome email

Lives in beehiiv as the **Waitlist welcome** automation (`aut_c405c8e7…`), triggered
on both `signup` and `api` with `limited` enrolment so nobody receives it twice.
It is a **draft** until published from the beehiiv editor.

## Design

Follows the Point video design system: near-black canvas (`#08080A`), electric
blue `#5B8CFF` → violet `#A78BFA` accent, the pointer mark as the brand, physical
keycaps for every shortcut. The mark itself stays monochrome per the brand rules.

The demo panel is a pure CSS/JS animation — no video file — cycling
Translate ⌥T, Understand ⌥Space, Save ⌥S and Research ⌥R. It pauses when
scrolled out of view or when the tab is backgrounded, and collapses to a
static end-state under `prefers-reduced-motion`.

Two things to preserve if you edit it:

- The result pill is **deliberately solid**, not glass. Nested `backdrop-filter`
  doesn't blur through the parent's own blur, so body copy read straight through it.
- The animation loop is guarded by a generation token. Without it, a tab-away and
  back starts a second concurrent loop and the pill drifts out of sync with the keycap.

## Local preview

The static page works from any file server, but `/api/subscribe` needs the Vercel runtime:

```bash
npx vercel dev          # serves the page and the function together
```

## Deploying

Push to `main`. Vercel builds from the repo root with no framework preset.
