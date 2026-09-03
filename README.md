# Midnight

A minimal AMOLED link-in-bio page. Everything you can configure lives in `config.json`;
`build.mjs` turns it into one static HTML file and `wrangler` puts it on Cloudflare.

- **True black** (`#000`) — real pixels off on OLED.
- **One ~10 kB file, no requests.** CSS and every icon inlined; the only JavaScript is 413 bytes
  for the keyboard shortcuts.
- **Brand icons resolve themselves.** Name a link `GitHub` and it gets the GitHub mark, from
  [Simple Icons](https://github.com/simple-icons/simple-icons) (CC0-1.0, 3,400+ brands).
- **Keyboard shortcuts.** Every row gets a letter; pressing it opens that link.

## Quick start

```bash
pnpm install
pnpm dev         # http://localhost:8787
```

Edit `config.json`, then:

```bash
pnpm run deploy  # builds, then deploys to Cloudflare
```

First deploy opens a browser to log in and publishes to `midnight.<your-subdomain>.workers.dev`.
Change `name` in `wrangler.jsonc` to change that subdomain.

While editing, run `pnpm watch` in a second terminal to rebuild on every save.

## How the build works

There is no framework and no runtime — `build.mjs` is one script that runs at build time:

1. Reads `config.json` and validates it (a missing `url` fails the build with the row that broke).
2. For each link, picks an icon and reads that brand's `<path d="…">` straight out of
   `node_modules/simple-icons/icons/<slug>.svg`.
3. Converts the brand colour to something readable on black, and assigns a keyboard key.
4. Fills all of that into a template string — the HTML, the CSS and the icons are one document —
   and writes `dist/index.html`.

`wrangler` then uploads `dist/` as a static-assets Worker. Nothing is fetched at page load, and
nothing is computed in the browser, so changing anything means editing `config.json` and
rebuilding.

## config.json

```jsonc
{
  "name": "Jane Doe",
  "bio": "Quick description.\nA \\n starts a new line.",
  "avatar": null,                       // image URL, or null for initials
  "footer": "Powered by Midnight",      // omit to hide

  "meta": {
    "title": "Jane Doe",                // <title> and social card title
    "description": "Links for Jane.",
    "url": "https://links.example.com", // canonical URL, once you have one
    "themeColor": "#000000"
  },

  "theme": {
    "accent": "#ffffff",                // focus rings, icons with no usable brand colour
    "brandColors": true,                // tint each row with its brand colour on hover
    "keys": true,                       // keyboard shortcuts
    "radius": "14px",
    "font": "ui-sans-serif, -apple-system, …"
  },

  "links": [
    { "name": "GitHub",  "url": "https://github.com/janedoe" },
    { "name": "YouTube", "url": "https://youtube.com/@janedoe", "label": "My channel" },
    { "name": "Shop",    "url": "https://example.com", "icon": "shopify" },
    { "name": "Email",   "url": "mailto:jane@example.com", "key": "e" },
    { "name": "Website", "url": "https://example.com", "icon": false, "key": false }
  ]
}
```

`config.schema.json` is wired up via `$schema`, so editors autocomplete and validate these fields.

### How icons are chosen

For each link, in order:

1. `"icon": "<slug>"` if you pinned one — any [Simple Icons slug](https://simpleicons.org).
   `"icon": false` turns the icon off.
2. The link's `name` — matched against every brand title, slug and **alias**. Aliases are why
   `"Twitter"` correctly resolves to the X mark.
3. The link's domain — `https://youtube.com/@jane` finds YouTube even if you named the row "Watch".
4. Otherwise a neutral built-in glyph: an envelope for `mailto:`, a handset for `tel:`,
   an arrow for everything else.

Every build prints what it picked, so a wrong icon is obvious before you deploy:

```
  ● [g] GitHub         github      brand icon, matched on name
  ● [w] Watch          youtube     brand icon, matched on domain
  ○ [m] My newsletter  link        generic glyph — no brand icon matched
```

Brand colours are only used on hover, and are corrected for a black background first: near-greyscale
marks (GitHub `#181717`, X `#000000`) would be invisible, so those fall back to your accent, while
coloured ones keep their hue at a readable lightness.

### Keyboard shortcuts

Each row shows its key on the right; pressing that key opens the link. Keys are assigned
automatically — the first letter of the row's name that nothing else has claimed yet, so
`GitHub / YouTube / Twitter / Instagram` become `g / y / t / i`.

Pin one with `"key": "e"`, switch it off for a single row with `"key": false`, or drop the
feature entirely with `"keys": false` in `theme` (which also stops the script being written).
Combinations with Ctrl/Cmd/Alt are ignored, so browser shortcuts keep working, and the hints
are hidden on touch devices where there is no keyboard.

## Deploying from GitHub

`.github/workflows/deploy.yml` deploys on every push to `main`. Add two repository secrets:

- `CLOUDFLARE_API_TOKEN` — an API token with the **Edit Cloudflare Workers** template.
- `CLOUDFLARE_ACCOUNT_ID` — from the Workers overview page in the dashboard.

## Custom domain

Add a route to `wrangler.jsonc` (the zone must be on your Cloudflare account):

```jsonc
"routes": [{ "pattern": "links.example.com", "custom_domain": true }]
```

Then `pnpm run deploy`, and set `meta.url` to the same address.

## Commands

| | |
|---|---|
| `pnpm build`  | Write `dist/index.html` |
| `pnpm watch`  | Rebuild whenever `config.json` changes |
| `pnpm dev`    | Build, then serve locally with Wrangler |
| `pnpm check`  | Build and validate the deploy without publishing |
| `pnpm run deploy` | Build and publish |

`deploy` needs the explicit `run` — plain `pnpm deploy` is pnpm's own workspace command.
`npm` works too: swap `pnpm x` for `npm run x`.

> pnpm blocks dependency install scripts by default. `pnpm-workspace.yaml` allows the two that
> need them, `esbuild` and `workerd`, both of which are wrangler's own dependencies unpacking a
> platform binary. Without that, `pnpm install` exits non-zero and `pnpm dev` refuses to start.

## Licensing of the icons

Icons come from Simple Icons and are **CC0-1.0** — free to use, no attribution required. The brands
themselves are still trademarks of their respective owners: use a company's mark to link to that
company, and follow their brand guidelines if you do anything more. See Simple Icons'
[legal disclaimer](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md).
