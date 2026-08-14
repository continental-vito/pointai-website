# pointai.dev

Waitlist landing page for **Point** — an AI-powered cursor for macOS.

Static, single file, no build step and no dependencies. Vercel serves the repo root as-is.

```
index.html      the whole page — markup, styles, animation, form logic
og-image.png    1200×630 social card
favicon.svg     flips black/white via prefers-color-scheme
point-mark.svg  the mark on its own (white)
app-icon.svg    macOS squircle icon, used as the apple-touch-icon
vercel.json     cache + security headers
```

## ⚠️ One thing left to do: connect the waitlist

Signups are **not** being collected yet. Open `index.html`, find this line near the
top of the `<script>` block, and paste your provider's form URL between the quotes:

```js
const WAITLIST_ENDPOINT = "";
```

Three providers are supported out of the box — the page detects which one you used:

| Provider | What to paste | Where to find it |
|---|---|---|
| **Mailchimp** | `https://pointai.us21.list-manage.com/subscribe/post?u=XXXX&id=YYYY` | Audience → Signup forms → Embedded form → the `<form action="...">` value |
| **ConvertKit / Kit** | `https://app.kit.com/forms/1234567/subscriptions` | Form → Embed → HTML → the `<form action="...">` value |
| **Beehiiv** | `https://embeds.beehiiv.com/<uuid>` | Publication → Subscribe forms → Embed |

Mailchimp sends no CORS headers, so it is called over JSONP and an
already-subscribed address is treated as success. The other two get a plain
cross-origin `POST`. Either way the visitor never leaves the page.

Until an endpoint is set, the form validates the address and then tells the
visitor to email `hello@pointai.dev` — it never pretends to have saved an
address it didn't save.

## Design

Follows the Point video design system: near-black canvas (`#08080A`), electric
blue `#5B8CFF` → violet `#A78BFA` accent, the pointer mark as the brand, physical
keycaps for every shortcut. The mark itself stays monochrome per the brand rules.

The demo panel is a pure CSS/JS animation — no video file — cycling
Translate ⌥T, Understand ⌥Space, Save ⌥S and Research ⌥R. It pauses when
scrolled out of view or when the tab is backgrounded, and collapses to a
static end-state under `prefers-reduced-motion`.

## Local preview

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Deploying

Push to `main`. Vercel builds from the repo root with no framework preset.
Point the `pointai.dev` domain at the project in Vercel → Settings → Domains.
