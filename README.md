# Midnight

A minimal AMOLED link-in-bio page. Everything you can configure lives in `config.json`;
`build.mjs` turns it into one static HTML file and `wrangler` puts it on Cloudflare.

- **True black** (`#000`) — real pixels off on OLED.
- **One ~11 kB file, no requests.** CSS and every icon inlined; the only JavaScript is 413 bytes
  for the keyboard shortcuts.
- **Brand icons resolve themselves.** Name a link `GitHub` and it gets the GitHub mark, from
  [Simple Icons](https://github.com/simple-icons/simple-icons) (CC0-1.0, 3,400+ brands) — and the
  marks you use are committed to `icons/`, so builds need no dependency.
- **Keyboard shortcuts.** Every row gets a letter; pressing it opens that link.
- **Tactile links.** Hovering creates a crisp offset shadow; pressing settles the row into it.
- **Markdown in the text.** `[links](https://…)`, `**bold**`, `*italic*` and `` `code` `` in the
  bio and footer.

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
2. For each link, picks an icon and takes that brand's `<path d="…">` from `icons/icons.json`.
   A brand that isn't in there yet is copied in from `node_modules/simple-icons` and written back,
   so the next build — and CI — no longer needs the package.
3. Converts the brand colour to something readable on black, and assigns a keyboard key.
4. Renders the bio and footer through a small inline-Markdown pass.
5. Fills all of that into a template string — the HTML, the CSS and the icons are one document —
   and writes `dist/index.html`.

`wrangler` then uploads `dist/` as a static-assets Worker. Nothing is fetched at page load, and
nothing is computed in the browser, so changing anything means editing `config.json` and
rebuilding.

## config.json

```json
{
  "name": "Jane Doe",
  "bio": "Quick description.\nA \\n starts a new line, and [links](https://x.com) work.",
  "avatar": null,                       // image URL, or null for initials
  "footer": "Powered by **Midnight**",   // omit to hide

  "meta": {
    "title": "Jane Doe",                // <title> and social card title
    "description": "Links for Jane.",
    "url": "https://links.example.com", // canonical URL, once you have one
    "themeColor": "#000000",
    "image": null,
    "socialCard": {
      "instance": "bio.example.com",
      "description": "Short copy for social sharing",
      "showAvatar": true,
      "ribbon": "links",
      "ribbonColors": ["#ff6b6b", "#4dabf7"]
    }
  },

  "theme": {
    "accent": "#ffffff",                // focus rings, icons with no usable brand colour
    "brandColors": true,                // tint each row with its brand colour on hover
    "keys": true,                       // keyboard shortcuts
    "hideKeyHintsOnMobile": true,       // hide shortcut badges on touch devices
    "radius": "999px",                  // pill-shaped link rows
    "font": "Roboto, Arial, sans-serif"
  },

  "links": [
    { "name": "GitHub",  "url": "https://github.com/janedoe", "group": "Find me" },
    { "name": "YouTube", "url": "https://youtube.com/@janedoe", "label": "My channel", "group": "Find me" },
    { "name": "Shop",    "url": "https://example.com", "icon": "shopify" },
    { "name": "Email",   "url": "mailto:jane@example.com", "key": "e" },
    { "name": "Website", "url": "https://example.com", "icon": false, "key": false, "group": "Contact" }
  ]
}
```

`config.schema.json` is wired up via `$schema`, so editors autocomplete and validate these fields.

### Markdown in `bio` and `footer`

Those two fields take a small slice of inline Markdown:

| | |
|---|---|
| `[text](https://example.com)` | link — external ones get `target="_blank" rel="noopener"` |
| `**text**` | bold |
| `*text*` | italic |
| `` `text` `` | code |

`mailto:`, `tel:`, `/paths` and `#anchors` are valid link targets too. Anything else — a
`javascript:` or `data:` URL — is left on the page as plain text rather than linked, and the
whole string is HTML-escaped before any of this runs, so the config can't inject markup. Block
Markdown (headings, lists) is not supported; `\n` still just starts a new line.

The social-card description falls back to your bio with the markup stripped, so links don't leak
into `<meta name="description">`. Every build creates `dist/social-card.png`: a 1200×630 Roboto
card with your instance name, profile name, card-only description and (when present) avatar. The
description has a 52-character limit and falls back to the bio when omitted. Its URL is derived from
`meta.url`. The bottom ribbon can use brand colors from your links (`"links"`), an explicit list
of hex values (`"custom"` plus `ribbonColors`), or be removed (`"none"`). Set `meta.image` to an
absolute URL only when you want to override this generated card.

### Link groups

Add the same `group` value to adjacent rows to place a quiet heading above them. Grouping is
optional, so ungrouped rows continue to render exactly as before. Keep each group together in the
`links` array; a heading is rendered whenever the group name changes.

### How icons are chosen

For each link, in order:

1. `"icon": "<slug>"` if you pinned one — any [Simple Icons slug](https://simpleicons.org).
   `"icon": false` turns the icon off.
2. The link's `name` — matched against every brand title, slug and **alias**. Aliases are why
   `"Twitter"` correctly resolves to the X mark.
3. The link's domain — `https://youtube.com/@jane` finds YouTube even if you named the row "Watch".
4. Otherwise a neutral built-in glyph: an envelope for `mailto:`, a handset for `tel:`,
   an arrow for everything else.

Whatever it picks is cached into `icons/icons.json` and committed — see [icons/](icons/).

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
Combinations with Ctrl/Cmd/Alt are ignored, so browser shortcuts keep working. Shortcut hints are
hidden on touch devices by default; set `theme.hideKeyHintsOnMobile` to `false` if you want to
show them there too.

## The vendored icons

`icons/icons.json` holds only the marks the current config uses — the path, the brand colour, and
the names that resolve to it. A build adds anything new and drops anything you stopped using, then
tells you it changed:

```
  icons/icons.json → 4 marks, 4.0 kB  (+github +instagram +x +youtube)  — commit this
```

Commit it alongside `config.json`. The point is that nothing else in the pipeline needs the icon
set: `simple-icons` is 15 MB of SVGs and a devDependency, consulted only when you name a brand that
isn't committed yet. CI, `pnpm build` on a fresh clone, and the deploy itself all work without it —
you can delete it from `package.json` entirely once your links have settled, and the build will
tell you if you ever need it back.

## Deploying from GitHub

`.github/workflows/deploy.yml` builds `config.json` into `dist/index.html` and deploys it on every
push to `main` or `master` (or when manually run from the Actions tab). The job summary includes
the deployed URL. Add two repository secrets:

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

Icons come from Simple Icons and are **CC0-1.0** — public domain, no attribution required, and
redistribution is explicitly allowed, which is what makes committing them to this repo fine. The
brands themselves are still trademarks of their respective owners: use a company's mark to link to
that company, and follow their brand guidelines if you do anything more. See Simple Icons'
[legal disclaimer](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md).
