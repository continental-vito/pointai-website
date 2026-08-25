# pointai.dev

Waitlist landing page for **Point** — an AI-powered cursor for macOS.

Static pages plus three serverless functions. No build step, no dependencies.

```
index.html          the whole page — markup, styles, animation, form logic
versions.html       /versions — the beta build list, rendered from /api/versions
privacy.html        /privacy — the privacy policy, same text as the app's
api/subscribe.js    serverless function: creates the beehiiv subscription
api/versions.js     serverless function: lists beta releases from the private repo
api/download.js     serverless function: invite-gated redirect to a beta DMG
tools/invite.js     mints invite links (run locally, never deployed)
og-image.png        1200×630 social card
favicon.ico         16/32/48 multi-size, for Safari and anything ignoring SVG icons
favicon.svg         dark tile + white mark, matching the PNGs
apple-touch-icon.png  180×180, opaque — iOS ignores an SVG here
icon-192/512.png    web manifest icons (+ a maskable variant)
safari-pinned-tab.svg  single flat path, Safari colours it itself
site.webmanifest    name, theme colour, icon set
point-mark.svg      the mark on its own (white)
app-icon.svg        macOS squircle icon
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

## The beta

Point AI's source is in a **private** repository, `continental-vito/point-ai`.
That is the constraint everything here works around: a private repo's release
list and its DMG assets both need an authenticated request, so a browser can
reach neither. These two functions are the door.

```
tester clicks the link in their invitation email
        ↓
/download?t=<invite>          api/download.js
        ↓  verifies the HMAC, no database involved
        ↓  asks GitHub for the asset with Accept: application/octet-stream
        ↓  GitHub answers 302 + a short-lived signed URL
        ↓  that redirect is handed to the browser
tester's Mac downloads straight from GitHub — the bytes never touch Vercel
```

`/versions` is the human-readable half, and the app's **Check for Updates…**
reads the same `/api/versions`. GitHub Releases stays the only place a release is
recorded — there is no manifest file to forget to update.

### Required environment variables

Add to the two already there (Vercel → Settings → Environment Variables):

| Variable | Value |
|---|---|
| `GITHUB_TOKEN` | fine-grained PAT, **only** `continental-vito/point-ai`, permissions `Contents: Read-only` |
| `INVITE_SECRET` | any long random string — `openssl rand -hex 32` |
| `REVOKED_INVITES` | optional, comma-separated invite ids to refuse |
| `RELEASES_REPO` | optional, defaults to `continental-vito/point-ai` |

Redeploy after adding them.

### Inviting someone

```bash
INVITE_SECRET=… node tools/invite.js ada@example.com
INVITE_SECRET=… node tools/invite.js --file testers.txt      # one address per line
INVITE_SECRET=… node tools/invite.js --verify <code>
```

It prints `email <TAB> link`, which pastes straight into a beehiiv merge-field
import. The invite id is derived from the address so downloads are attributable
in the logs, but the address itself **cannot be recovered from it** — these links
get pasted into group chats.

To revoke one, add its id to `REVOKED_INVITES` and redeploy. There is no database
to update: a code is valid because it verifies, not because it was stored.

### What the gate does and does not do

It keeps the build to the people invited. It is **not** a security boundary
around the software — anyone with a valid link can pass the DMG on. That is
acceptable for a beta and would not be for a paid release; the answer then is
notarization plus a real licence check, not a longer code.

`/api/versions` and `/api/download` both require a release to be **a prerelease
AND tagged `-beta`**. Two independent conditions, so an internal build cannot
appear on a page testers read because one flag was wrong.

## Design

Follows the Point video design system: near-black canvas (`#08080A`), electric
blue `#5B8CFF` → violet `#A78BFA` accent, the pointer mark as the brand, physical
keycaps for every shortcut. The mark itself stays monochrome per the brand rules.

The demo panel is a pure CSS/JS animation — no video file — cycling
Understand ⌥Space, Translate ⌥T, Save ⌥S and Voice ⌥^. It pauses when
scrolled out of view or when the tab is backgrounded, and collapses to a
static end-state under `prefers-reduced-motion`.

The **voice** scene runs in two beats: a mic badge rides along with the pointer
while the spoken command is shown in quotes, then the pill swaps to the result.

Three things to preserve if you edit it:

- The result pill is **deliberately solid**, not glass. Nested `backdrop-filter`
  doesn't blur through the parent's own blur, so body copy read straight through it.
- The animation loop is guarded by a generation token. Without it, a tab-away and
  back starts a second concurrent loop and the pill drifts out of sync with the keycap.
- The pill is measured and positioned against each scene's **final** copy before the
  first beat is shown. The voice scene's result line is longer than the spoken one, so
  measuring the short text first would let the pill grow off the bottom on narrow screens.

## Icons

`apple-touch-icon` must be a PNG — iOS silently ignores an SVG, which makes browsers
fall back to a generated letter tile (the site showed a plain "P"). All raster icons are
generated from the brand mark by `icons/render.js`; the small sizes use a tighter corner
radius and a larger mark, because a squircle turns to mush at 16px.

## Local preview

The static page works from any file server, but `/api/subscribe` needs the Vercel runtime:

```bash
npx vercel dev          # serves the page and the function together
```

## Deploying

Push to `main`. Vercel builds from the repo root with no framework preset.
