/**
 * Midnight — builds a single self-contained AMOLED link-in-bio page from config.json.
 *
 * Brand marks come from Simple Icons (CC0-1.0). Every mark a build actually uses is
 * copied into icons/icons.json and committed, so the page — and any later build or
 * deploy — needs nothing fetched or installed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(root, 'dist');
const CONFIG = path.join(root, 'config.json');
const ICONS = path.join(root, 'icons', 'icons.json');
const SOCIAL_CARD = path.join(OUT_DIR, 'social-card.png');

/* ---------------------------------------------------------------- icon set */

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// The committed subset: { slug: { title, hex, keys, path } }.
const store = (() => {
  try { return JSON.parse(fs.readFileSync(ICONS, 'utf8')); } catch { return {}; }
})();
const vendored = store.icons ?? {};
// Snapshot of what is on disk right now — `vendored` is mutated as new marks are pulled in.
let committed = Object.keys(vendored);

// Lookup key → slug. Seeded from what is committed, extended as new marks are pulled in.
const lookup = new Map();
for (const [slug, icon] of Object.entries(vendored)) {
  for (const k of icon.keys ?? [slug]) if (!lookup.has(k)) lookup.set(k, slug);
}

/**
 * simple-icons, loaded lazily and only when the committed set has no answer.
 * Not having it installed is fine — you just cannot introduce a new brand until you do.
 */
let pkg;
function iconPackage() {
  if (pkg !== undefined) return pkg;
  try {
    const data = require('simple-icons/icons.json');
    const dir = path.resolve(path.dirname(require.resolve('simple-icons/icons.json')), '../icons');

    // slug wins over title, title over alias — so "X" resolves to X, not to something aliased "X".
    const index = new Map();
    const add = (k, slug) => { if (k && !index.has(k)) index.set(k, slug); };
    for (const i of data) add(norm(i.slug), i.slug);
    for (const i of data) add(norm(i.title), i.slug);
    for (const i of data) {
      const a = i.aliases ?? {};
      for (const n of [...(a.aka ?? []), ...(a.old ?? []), ...(a.dup ?? []).map((d) => d.title)]) add(norm(n), i.slug);
    }

    // The package does not export its own package.json, so read it off the resolved path.
    const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(dir), 'package.json'), 'utf8'));
    pkg = { index, dir, bySlug: new Map(data.map((i) => [i.slug, i])), version: manifest.version };
  } catch {
    pkg = null;
  }
  return pkg;
}

let missedOffline = false;

/** Resolve one normalised key to { slug, title, hex, path }, vendoring the mark on first use. */
function findIcon(k) {
  if (!k) return null;
  if (lookup.has(k)) {
    const slug = lookup.get(k);
    return slug ? { slug, ...vendored[slug] } : null;
  }

  const p = iconPackage();
  if (!p) { missedOffline = true; return null; }

  const slug = p.index.get(k);
  const file = slug && path.join(p.dir, `${slug}.svg`);
  const d = file && fs.existsSync(file) && /\sd="([^"]+)"/.exec(fs.readFileSync(file, 'utf8'));
  if (!d) { lookup.set(k, null); return null; }

  vendored[slug] = {
    title: p.bySlug.get(slug).title,
    hex: p.bySlug.get(slug).hex,
    // Every name that resolves here, so renaming a row later still hits the committed copy.
    keys: [...p.index].filter(([, s]) => s === slug).map(([key]) => key).sort(),
    path: d[1],
  };
  for (const key of vendored[slug].keys) if (!lookup.has(key)) lookup.set(key, slug);
  return { slug, ...vendored[slug] };
}

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
    const icon = findIcon(norm(raw));
    if (icon) return { path: icon.path, hex: `#${icon.hex}`, source, slug: icon.slug };
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

// Anything else — javascript:, data: — is left as literal text rather than linked.
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|[#/]|\.{1,2}\/)/i;

/**
 * The slice of Markdown a bio actually needs: [text](url), **bold**, *italic*, `code`.
 * Everything is HTML-escaped first, so a config can never inject markup — the patterns
 * below only ever match text that is already inert.
 */
function md(src) {
  return esc(src)
    .replace(/\[([^\]\n]+)]\(\s*([^\s)]+)\s*\)/g, (whole, text, href) => {
      const url = href.replace(/&amp;/g, '&');
      if (!SAFE_HREF.test(url)) return whole;
      const external = /^https?:/i.test(url);
      return `<a href="${esc(url)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>`;
    })
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
}

/** The same text with the markup dropped, for <title> and social cards. */
const plain = (s) =>
  String(s ?? '')
    .replace(/\[([^\]\n]+)]\(\s*[^\s)]+\s*\)/g, '$1')
    .replace(/[*`]/g, '');

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

const CARD_COLOR = /^#[0-9a-f]{6}$/i;
const cardColor = (value) => CARD_COLOR.test(value ?? '') ? value : null;
const truncate = (value, limit) => {
  const text = String(value ?? '');
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
};

function socialCardOptions(cfg) {
  const card = {
    enabled: true,
    instance: '',
    showAvatar: true,
    ribbon: 'links',
    ribbonColors: [],
    ...(cfg.meta?.socialCard ?? {}),
  };
  if (!card.instance && cfg.meta?.url) {
    try { card.instance = new URL(cfg.meta.url).hostname; } catch { /* keep it empty */ }
  }
  return card;
}

function publicAssetUrl(metaUrl, filename) {
  try { return new URL(filename, metaUrl).href; } catch { return null; }
}

function cardRibbonColors(cfg, card) {
  if (card.ribbon === 'none') return [];
  if (card.ribbon === 'custom') return (card.ribbonColors ?? []).map(cardColor).filter(Boolean);

  const accent = cfg.theme?.accent ?? '#ffffff';
  return (cfg.links ?? []).map((link) => cardColor(resolveIcon(link)?.hex) ?? accent).filter(cardColor);
}

async function cardAvatar(avatar) {
  if (!avatar) return null;
  try {
    let image;
    if (/^https?:\/\//i.test(avatar)) {
      const response = await fetch(avatar, { signal: AbortSignal.timeout(8000) });
      const type = response.headers.get('content-type') ?? '';
      const size = Number(response.headers.get('content-length') ?? 0);
      if (!response.ok || !type.startsWith('image/') || size > 5_000_000) throw new Error('not a usable image');
      image = Buffer.from(await response.arrayBuffer());
      if (image.length > 5_000_000) throw new Error('image is too large');
    } else {
      const local = path.resolve(OUT_DIR, avatar.replace(/^\//, ''));
      if (!local.startsWith(`${OUT_DIR}${path.sep}`)) throw new Error('image must be inside dist');
      image = fs.readFileSync(local);
    }
    return sharp(image).resize(224, 224, { fit: 'cover' }).png().toBuffer();
  } catch (error) {
    console.warn(`  ! Could not add avatar to social card: ${error.message}`);
    return null;
  }
}

/** Build a broadly supported PNG card rather than relying on social crawlers to render SVG. */
async function writeSocialCard(cfg) {
  const meta = cfg.meta ?? {};
  const card = socialCardOptions(cfg);
  const generatedUrl = card.enabled && !meta.image ? publicAssetUrl(meta.url, 'social-card.png') : null;
  if (!generatedUrl) return meta.image || cfg.avatar || null;

  const avatar = card.showAvatar ? await cardAvatar(cfg.avatar) : null;
  const avatarSvg = avatar
    ? `<image x="936" y="72" width="224" height="224" preserveAspectRatio="xMidYMid slice" href="data:image/png;base64,${avatar.toString('base64')}"/>`
    : '';
  const colors = cardRibbonColors(cfg, card);
  const ribbon = colors.length
    ? colors.map((color, i) => `<rect x="${24 + (1152 * i) / colors.length}" y="600" width="${1152 / colors.length + 1}" height="6" fill="${color}"/>`).join('')
    : '';
  const title = truncate(cfg.name || 'Links', 48);
  const description = truncate(plain(card.description ?? cfg.bio).replace(/\s+/g, ' ').trim(), 52);
  const instance = truncate(card.instance, 72);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#181818"/>
  <rect x="24" y="24" width="1152" height="582" fill="none" stroke="#d9d9d9" stroke-opacity=".75" stroke-width="2"/>
  <g fill="#e7e7e7" font-family="Roboto, Arial, sans-serif">
    ${instance ? `<text x="80" y="98" font-size="30" font-weight="400">${esc(instance)}</text>` : ''}
    <text x="80" y="468" font-size="84" font-weight="700" letter-spacing="-2">${esc(title)}</text>
    ${description ? `<text x="80" y="552" font-size="32" font-weight="400" fill="#d0d0d0">${esc(description)}</text>` : ''}
  </g>
  ${avatarSvg}
  ${ribbon}
</svg>`;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(SOCIAL_CARD);
  return generatedUrl;
}

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

function render(cfg, generatedSocialImage) {
  const theme = { accent: '#ffffff', brandColors: true, keys: true, hideKeyHintsOnMobile: true, radius: '999px', font: 'Roboto, Arial, sans-serif', ...(cfg.theme ?? {}) };
  const meta = cfg.meta ?? {};
  const title = meta.title || cfg.name || 'Links';
  const description = meta.description || plain(cfg.bio).replace(/\s+/g, ' ').trim();

  const report = [];
  const used = new Set();
  const rows = cfg.links ?? [];
  const keys = theme.keys ? assignKeys(rows) : rows.map(() => null);

  let previousGroup;
  const links = rows.map((link, i) => {
    const icon = resolveIcon(link);
    if (icon && vendored[icon.slug]) used.add(icon.slug);
    const brand = theme.brandColors && icon?.hex ? readableOnBlack(icon.hex, theme.accent) : theme.accent;
    const key = keys[i];
    report.push({ name: link.label ?? link.name, slug: icon?.slug ?? '—', source: icon?.source ?? 'off', key });

    const external = /^https?:/i.test(link.url);
    const group = link.group?.trim();
    const groupHeading = group && group !== previousGroup
      ? `      <h2 class="group-heading">${esc(group)}</h2>\n`
      : '';
    previousGroup = group;
    return `${groupHeading}      <a class="link" href="${esc(link.url)}"${theme.brandColors ? ` style="--brand:${esc(brand)}"` : ''}${
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
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#000"/><text x="32" y="43" font-family="Roboto, Arial, sans-serif" font-size="30" font-weight="600" fill="${theme.accent}" text-anchor="middle">${initials(cfg.name)}</text></svg>`,
    )}`;

  const socialImage = generatedSocialImage;
  const twitterCard = socialImage ? 'summary_large_image' : 'summary';
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
${meta.url ? `<meta property="og:url" content="${esc(meta.url)}">\n` : ''}${socialImage ? `<meta property="og:image" content="${esc(socialImage)}">\n<meta name="twitter:image" content="${esc(socialImage)}">\n` : ''}<meta name="twitter:card" content="${twitterCard}">
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

  /* Inline markup allowed in bio and footer. A link is brighter than the text around it. */
  .bio a, footer a {
    color: var(--fg); text-decoration: none;
    border-bottom: 1px solid rgba(255,255,255,.25);
    transition: color .18s ease, border-color .18s ease;
  }
  .bio a:hover { border-color: var(--accent); }
  .bio strong, footer strong { color: rgba(255,255,255,.8); font-weight: 600; }
  .bio code, footer code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em;
    padding: 1px 5px; border-radius: 5px; background: rgba(255,255,255,.07);
  }
  .bio a:focus-visible, footer a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }

  .links { display: grid; gap: 12px; }
  .group-heading {
    margin: 18px 0 0; padding: 0 4px;
    color: var(--muted); font-size: 11px; font-weight: 600;
    letter-spacing: .1em; text-align: left; text-transform: uppercase;
  }
  .group-heading:first-child { margin-top: 0; }
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
    /* A crisp, physical offset rather than a soft floating card. */
    transition: border-color .14s ease, background-color .14s ease, transform .14s ease, box-shadow .14s ease;
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
  ${theme.hideKeyHintsOnMobile ? '@media (hover: none), (pointer: coarse) { .key { display: none; } }' : ''}
  .link:hover, .link:focus-visible {
    border-color: rgba(255,255,255,.82);
    background: rgba(255,255,255,.055);
    transform: translate(-4px, -4px);
    box-shadow: 7px 7px 0 var(--brand);
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
  .link:active {
    transform: translate(2px, 2px);
    background: rgba(255,255,255,.08);
    box-shadow: 1px 1px 0 var(--brand);
    transition-duration: 45ms;
  }

  footer {
    align-self: flex-end; padding-top: 32px;
    font-size: 12px; letter-spacing: .01em; color: rgba(255,255,255,.28);
  }
  footer a { color: inherit; border-bottom-color: rgba(255,255,255,.2); }
  footer a:hover { color: rgba(255,255,255,.55); border-bottom-color: rgba(255,255,255,.35); }

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
${cfg.bio ? `    <p class="bio">${md(cfg.bio)}</p>\n` : ''}    <nav class="links">
${links}
    </nav>
  </main>
${cfg.footer ? `  <footer>${md(cfg.footer)}</footer>\n` : ''}${script}</body>
</html>
`;

  return { html, report, used };
}

/* ------------------------------------------------------------------- build */

function validate(cfg) {
  const errors = [];
  if (!cfg.name) errors.push('"name" is required.');
  if (!Array.isArray(cfg.links) || cfg.links.length === 0) errors.push('"links" must be a non-empty array.');
  const cardDescription = cfg.meta?.socialCard?.description;
  if (typeof cardDescription === 'string' && cardDescription.length > 52) {
    errors.push('"meta.socialCard.description" must be 52 characters or fewer.');
  }
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

/**
 * Rewrite icons/icons.json to exactly the marks this config uses, so the file stays
 * small and the repo carries no marks it no longer shows. Untouched when nothing changed.
 */
function writeIcons(used) {
  const icons = {};
  for (const slug of [...used].sort()) icons[slug] = vendored[slug];

  const file = {
    _: 'Brand marks from Simple Icons, committed so builds and deploys need no icon dependency. Rewritten by every build — do not edit by hand.',
    source: 'https://github.com/simple-icons/simple-icons',
    license: 'CC0-1.0',
    version: iconPackage()?.version ?? store.version ?? null,
    icons,
  };

  const json = JSON.stringify(file, null, 2) + '\n';
  if (fs.existsSync(ICONS) && fs.readFileSync(ICONS, 'utf8') === json) return null;

  fs.mkdirSync(path.dirname(ICONS), { recursive: true });
  fs.writeFileSync(ICONS, json);

  const added = Object.keys(icons).filter((s) => !committed.includes(s));
  const dropped = committed.filter((s) => !(s in icons));
  committed = Object.keys(icons);
  return { size: Buffer.byteLength(json), count: Object.keys(icons).length, added, dropped };
}

async function build() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  validate(cfg);
  const socialImage = await writeSocialCard(cfg);
  const { html, report, used } = render(cfg, socialImage);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);
  const icons = writeIcons(used);

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

  if (icons) {
    const change = [...icons.added.map((s) => `+${s}`), ...icons.dropped.map((s) => `−${s}`)].join(' ');
    console.log(`\n  icons/icons.json → ${icons.count} mark${icons.count === 1 ? '' : 's'}, ${(icons.size / 1024).toFixed(1)} kB${change ? `  (${change})` : ''}  — commit this`);
  }
  if (missedOffline) {
    console.log('\n  ! A row needed a brand mark that is not committed yet, and simple-icons is not');
    console.log('    installed. Run `pnpm install` and build again to pull it in.');
  }
  console.log('');
}

build().catch((error) => {
  console.error(`\n  ${error.message}\n`);
  process.exitCode = 1;
});

if (process.argv.includes('--watch')) {
  console.log('  watching config.json …\n');
  let t;
  fs.watch(CONFIG, () => {
    clearTimeout(t);
    t = setTimeout(() => { build().catch((e) => console.error('  ' + e.message)); }, 60);
  });
}
