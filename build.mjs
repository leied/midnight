/**
 * Midnight — builds a single self-contained AMOLED link-in-bio page from config.json.
 *
 * Icons come from Simple Icons (CC0-1.0), resolved at build time and inlined,
 * so the deployed page ships zero JavaScript and makes zero third-party requests.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(root, 'dist');
const CONFIG = path.join(root, 'config.json');

/* ---------------------------------------------------------------- icon set */

const iconsData = require('simple-icons/icons.json');
const ICONS_DIR = path.resolve(path.dirname(require.resolve('simple-icons/icons.json')), '../icons');

const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// slug wins over title, title over alias — so "X" resolves to X, not to something aliased "X".
const index = new Map();
const add = (k, slug) => { if (k && !index.has(k)) index.set(k, slug); };
for (const i of iconsData) add(key(i.slug), i.slug);
for (const i of iconsData) add(key(i.title), i.slug);
for (const i of iconsData) {
  const a = i.aliases ?? {};
  for (const n of [...(a.aka ?? []), ...(a.old ?? []), ...(a.dup ?? []).map((d) => d.title)]) add(key(n), i.slug);
}

const byHex = new Map(iconsData.map((i) => [i.slug, i.hex]));

const iconPath = (slug) => {
  const file = path.join(ICONS_DIR, `${slug}.svg`);
  if (!fs.existsSync(file)) return null;
  const d = /\sd="([^"]+)"/.exec(fs.readFileSync(file, 'utf8'));
  return d ? d[1] : null;
};

// Neutral glyphs of our own, used when nothing in the trademark set matches.
const FALLBACK = {
  link: 'M7.05 16.95a1 1 0 0 1 0-1.41l8.49-8.49H9.17a1 1 0 1 1 0-2h8.78a1 1 0 0 1 1 1v8.78a1 1 0 1 1-2 0V8.46l-8.49 8.49a1 1 0 0 1-1.41 0Z',
  mail: 'M2 5.5A2.5 2.5 0 0 1 4.5 3h15A2.5 2.5 0 0 1 22 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18.5v-13Zm2.7-.5 7.3 5.9L19.3 5H4.7ZM20 7.1l-7.4 6a1 1 0 0 1-1.2 0L4 7.1v11.4a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5V7.1Z',
  phone: 'M6.6 2h3.1a1 1 0 0 1 1 .8l1 4.4a1 1 0 0 1-.5 1.1L9 9.4a13 13 0 0 0 5.6 5.6l1.1-2.2a1 1 0 0 1 1.1-.5l4.4 1a1 1 0 0 1 .8 1v3.1A2.6 2.6 0 0 1 19.4 20 17.4 17.4 0 0 1 4 4.6 2.6 2.6 0 0 1 6.6 2Z',
};

/** Resolve a link to { path, hex, source } — explicit icon, then name, then hostname. */
function resolveIcon(link) {
  if (link.icon === false) return null;

  const candidates = [];
  if (typeof link.icon === 'string') candidates.push([link.icon, 'icon']);
  if (link.name) candidates.push([link.name, 'name']);

  let scheme = '';
  try {
    const u = new URL(link.url);
    scheme = u.protocol;
    if (u.hostname) {
      const host = u.hostname.replace(/^www\./, '');
      candidates.push([host, 'url'], [host.split('.').slice(0, -1).join('.'), 'url']);
    }
  } catch { /* mailto:, tel:, relative — handled below */ }

  for (const [raw, source] of candidates) {
    const slug = index.get(key(raw));
    const d = slug && iconPath(slug);
    if (d) return { path: d, hex: `#${byHex.get(slug)}`, source, slug };
  }

  if (scheme === 'mailto:' || /^mail(to)?$|^e?mail$/i.test(link.name ?? '')) {
    return { path: FALLBACK.mail, hex: null, source: 'builtin', slug: 'mail' };
  }
  if (scheme === 'tel:') return { path: FALLBACK.phone, hex: null, source: 'builtin', slug: 'phone' };
  return { path: FALLBACK.link, hex: null, source: 'generic', slug: 'link' };
}

/* --------------------------------------------------------------- utilities */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Brand hexes are picked for white backgrounds — GitHub's #181717 is invisible on
 * AMOLED black. Lift lightness to a readable floor, and drop unsaturated brands
 * (X, GitHub, Apple) back to the accent colour rather than showing muddy grey.
 */
function readableOnBlack(hex, accent) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return accent;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 0.08) return accent; // effectively greyscale
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const L = Math.min(0.78, Math.max(0.62, l));
  const S = Math.min(1, Math.max(0.55, s));
  return `hsl(${h.toFixed(0)} ${(S * 100).toFixed(0)}% ${(L * 100).toFixed(0)}%)`;
}

const initials = (name) =>
  String(name ?? '')
    .trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '·';

/**
 * Give every row a keyboard shortcut: the one pinned in config, else the first
 * free letter of its name, else a digit. Returns null when the row opts out.
 */
function assignKeys(links) {
  const taken = new Set();
  const keys = new Array(links.length).fill(null);

  links.forEach((link, i) => {
    if (link.key === false) return;
    const pinned = String(link.key ?? '').toLowerCase();
    if (pinned && !taken.has(pinned)) { taken.add(pinned); keys[i] = pinned; }
  });

  links.forEach((link, i) => {
    if (keys[i] || link.key === false) return;
    const source = `${link.name ?? ''}${link.label ?? ''}`.toLowerCase() + '123456789';
    for (const ch of source) {
      if (/[a-z0-9]/.test(ch) && !taken.has(ch)) { taken.add(ch); keys[i] = ch; return; }
    }
  });

  return keys;
}

/* ------------------------------------------------------------------ render */

function render(cfg) {
  const theme = { accent: '#ffffff', brandColors: true, keys: true, radius: '14px', font: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif", ...(cfg.theme ?? {}) };
  const meta = cfg.meta ?? {};
  const title = meta.title || cfg.name || 'Links';
  const description = meta.description || (cfg.bio ?? '').replace(/\s+/g, ' ').trim();

  const report = [];
  const rows = cfg.links ?? [];
  const keys = theme.keys ? assignKeys(rows) : rows.map(() => null);

  const links = rows.map((link, i) => {
    const icon = resolveIcon(link);
    const brand = theme.brandColors && icon?.hex ? readableOnBlack(icon.hex, theme.accent) : theme.accent;
    const key = keys[i];
    report.push({ name: link.label ?? link.name, slug: icon?.slug ?? '—', source: icon?.source ?? 'off', key });

    const external = /^https?:/i.test(link.url);
    return `      <a class="link" href="${esc(link.url)}"${theme.brandColors ? ` style="--brand:${esc(brand)}"` : ''}${
      external ? ' target="_blank" rel="noopener noreferrer"' : ''
    }${key ? ` data-key="${esc(key)}" aria-keyshortcuts="${esc(key)}"` : ''}>${
      icon
        ? `\n        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${esc(icon.path)}"/></svg>`
        : ''
    }
        <span class="label">${esc(link.label ?? link.name)}</span>${
      key ? `\n        <kbd class="key" aria-hidden="true">${esc(key)}</kbd>` : ''
    }
      </a>`;
  }).join('\n');

  // Only shipped when at least one row has a shortcut.
  const script = keys.some(Boolean)
    ? `<script>
(() => {
  const rows = new Map([...document.querySelectorAll('a[data-key]')].map((a) => [a.dataset.key, a]));
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const a = rows.get(e.key.toLowerCase());
    if (!a) return;
    e.preventDefault();
    a.classList.add('hit');
    setTimeout(() => a.classList.remove('hit'), 200);
    a.click();
  });
})();
</script>
`
    : '';

  const avatar = cfg.avatar
    ? `<img class="avatar" src="${esc(cfg.avatar)}" alt="${esc(cfg.name ?? '')}" width="96" height="96" decoding="async">`
    : `<div class="avatar avatar--initials" aria-hidden="true">${esc(initials(cfg.name))}</div>`;

  const favicon =
    `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#000"/><text x="32" y="43" font-family="sans-serif" font-size="30" font-weight="600" fill="${theme.accent}" text-anchor="middle">${initials(cfg.name)}</text></svg>`,
    )}`;

  const html = `<!doctype html>
<html lang="${esc(meta.lang ?? 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="${esc(meta.themeColor ?? '#000000')}">
${meta.url ? `<link rel="canonical" href="${esc(meta.url)}">\n` : ''}<meta property="og:type" content="profile">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${meta.url ? `<meta property="og:url" content="${esc(meta.url)}">\n` : ''}${cfg.avatar ? `<meta property="og:image" content="${esc(cfg.avatar)}">\n` : ''}<meta name="twitter:card" content="summary">
<link rel="icon" href="${favicon}">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    --bg: #000;
    --fg: #fff;
    --muted: rgba(255,255,255,.52);
    --line: rgba(255,255,255,.16);
    --accent: ${esc(theme.accent)};
    --radius: ${esc(theme.radius)};
  }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    padding: 56px 20px calc(20px + env(safe-area-inset-bottom));
    background: var(--bg);
    color: var(--fg);
    font-family: ${theme.font};
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  main { margin: auto; width: 100%; max-width: 420px; text-align: center; }

  .avatar {
    width: 96px; height: 96px; border-radius: 50%;
    object-fit: cover; display: block; margin: 0 auto 22px;
    border: 1px solid rgba(255,255,255,.22);
    background: #050505;
    /* the one soft light source on the page */
    box-shadow: 0 0 0 6px rgba(255,255,255,.02), 0 0 44px -8px rgba(255,255,255,.16);
  }
  .avatar--initials {
    display: grid; place-items: center;
    font-size: 30px; font-weight: 600; letter-spacing: .02em;
    color: rgba(255,255,255,.62);
  }

  h1 { margin: 0 0 12px; font-size: 26px; font-weight: 600; letter-spacing: -.02em; }
  .bio {
    margin: 0 auto 30px; max-width: 32ch;
    font-size: 14px; line-height: 1.65; color: var(--muted);
    white-space: pre-line;
  }

  .links { display: grid; gap: 12px; }
  .link {
    --brand: var(--accent);
    position: relative;
    display: grid; place-items: center;
    min-height: 62px;
    padding: 14px 56px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: inherit; text-decoration: none;
    font-size: 15.5px; font-weight: 500; letter-spacing: -.01em;
    background: transparent;
    transition: border-color .18s ease, background-color .18s ease, transform .18s ease;
  }
  .label { line-height: 1.3; }
  .icon {
    position: absolute; left: 18px; top: 50%; translate: 0 -50%;
    width: 17px; height: 17px;
    fill: currentColor; opacity: .45;
    transition: opacity .18s ease, fill .18s ease;
  }
  .key {
    position: absolute; right: 16px; top: 50%; translate: 0 -50%;
    min-width: 20px; padding: 2px 0;
    font: inherit; font-size: 11px; line-height: 1.4;
    text-align: center; text-transform: lowercase;
    color: rgba(255,255,255,.3);
    border: 1px solid rgba(255,255,255,.1);
    border-radius: 5px;
    transition: color .18s ease, border-color .18s ease;
  }
  /* A shortcut hint is noise without a keyboard to press. */
  @media (hover: none), (pointer: coarse) { .key { display: none; } }
  .link:hover, .link:focus-visible {
    border-color: color-mix(in srgb, var(--brand) 42%, transparent);
    background: rgba(255,255,255,.035);
    transform: translateY(-1px);
  }
  .link:hover .icon, .link:focus-visible .icon { opacity: 1; fill: var(--brand); }
  .link:hover .key, .link:focus-visible .key {
    color: rgba(255,255,255,.6);
    border-color: rgba(255,255,255,.22);
  }
  /* Flash the row that a keypress just fired, so the jump is not a surprise. */
  .link.hit {
    border-color: var(--brand);
    background: rgba(255,255,255,.07);
  }
  .link.hit .icon { opacity: 1; fill: var(--brand); }
  .link:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }
  .link:active { transform: translateY(0); background: rgba(255,255,255,.06); }

  footer {
    align-self: flex-end; padding-top: 32px;
    font-size: 12px; letter-spacing: .01em; color: rgba(255,255,255,.28);
  }
  footer a { color: inherit; text-decoration: none; }
  footer a:hover { color: rgba(255,255,255,.55); }

  @media (max-width: 520px) { footer { align-self: center; } }
  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; }
    .link:hover, .link:focus-visible, .link:active { transform: none; }
  }
</style>
</head>
<body>
  <main>
    ${avatar}
    <h1>${esc(cfg.name ?? '')}</h1>
${cfg.bio ? `    <p class="bio">${esc(cfg.bio)}</p>\n` : ''}    <nav class="links">
${links}
    </nav>
  </main>
${cfg.footer ? `  <footer>${esc(cfg.footer)}</footer>\n` : ''}${script}</body>
</html>
`;

  return { html, report };
}

/* ------------------------------------------------------------------- build */

function validate(cfg) {
  const errors = [];
  if (!cfg.name) errors.push('"name" is required.');
  if (!Array.isArray(cfg.links) || cfg.links.length === 0) errors.push('"links" must be a non-empty array.');
  (cfg.links ?? []).forEach((l, i) => {
    if (!l || typeof l !== 'object') return errors.push(`links[${i}] must be an object.`);
    if (!l.url) errors.push(`links[${i}] ("${l.name ?? '?'}") is missing "url".`);
    if (!l.name && !l.label) errors.push(`links[${i}] needs a "name" or "label".`);
  });
  if (errors.length) {
    console.error('\n  config.json is invalid:\n' + errors.map((e) => `    · ${e}`).join('\n') + '\n');
    process.exit(1);
  }
}

function build() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  validate(cfg);
  const { html, report } = render(cfg);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);

  const pad = Math.max(...report.map((r) => r.name?.length ?? 0), 4);
  console.log(`\n  midnight → dist/index.html  (${(Buffer.byteLength(html) / 1024).toFixed(1)} kB)\n`);
  const note = {
    icon: 'brand icon, pinned in config',
    name: 'brand icon, matched on name',
    url: 'brand icon, matched on domain',
    builtin: 'built-in glyph',
    generic: 'generic glyph — no brand icon matched',
    off: 'icon disabled',
  };
  for (const r of report) {
    const hint = r.key ? `[${r.key}]` : '[ ]';
    console.log(`  ${'●○○'[['icon', 'name', 'url'].includes(r.source) ? 0 : r.source === 'builtin' ? 1 : 2]} ${hint} ${String(r.name).padEnd(pad)}  ${String(r.slug).padEnd(12)}${note[r.source]}`);
  }
  console.log('');
}

build();

if (process.argv.includes('--watch')) {
  console.log('  watching config.json …\n');
  let t;
  fs.watch(CONFIG, () => {
    clearTimeout(t);
    t = setTimeout(() => { try { build(); } catch (e) { console.error('  ' + e.message); } }, 60);
  });
}
