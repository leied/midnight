/**
 * Midnight's renderer: config in, HTML out. Shared by build.mjs and the launch page's live
 * editor, so it must stay free of imports and Node APIs — the launch build inlines this file
 * into a browser page as-is.
 *
 * Icon lookup is passed in as `findIcon(key)`, which returns { slug, title, hex, path } for a
 * normalised name or null. The build backs it with icons/icons.json and Simple Icons; the
 * editor backs it with a bundled subset.
 */

/* ------------------------------------------------------------------- icons */

export const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Neutral glyphs of our own, used when nothing in the trademark set matches.
export const FALLBACK = {
  link: 'M7.05 16.95a1 1 0 0 1 0-1.41l8.49-8.49H9.17a1 1 0 1 1 0-2h8.78a1 1 0 0 1 1 1v8.78a1 1 0 1 1-2 0V8.46l-8.49 8.49a1 1 0 0 1-1.41 0Z',
  mail: 'M2 5.5A2.5 2.5 0 0 1 4.5 3h15A2.5 2.5 0 0 1 22 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18.5v-13Zm2.7-.5 7.3 5.9L19.3 5H4.7ZM20 7.1l-7.4 6a1 1 0 0 1-1.2 0L4 7.1v11.4a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5V7.1Z',
  phone: 'M6.6 2h3.1a1 1 0 0 1 1 .8l1 4.4a1 1 0 0 1-.5 1.1L9 9.4a13 13 0 0 0 5.6 5.6l1.1-2.2a1 1 0 0 1 1.1-.5l4.4 1a1 1 0 0 1 .8 1v3.1A2.6 2.6 0 0 1 19.4 20 17.4 17.4 0 0 1 4 4.6 2.6 2.6 0 0 1 6.6 2Z',
};

// Sources that mean a brand mark was found, as opposed to one of the glyphs above.
export const BRAND_SOURCES = ['icon', 'name', 'url'];

/** Resolve a link to { path, hex, source, slug } — explicit icon, then name, then hostname. */
export function resolveIcon(link, findIcon) {
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
    const key = norm(raw);
    const icon = key ? findIcon(key) : null;
    if (icon) return { path: icon.path, hex: `#${icon.hex}`, source, slug: icon.slug };
  }

  if (scheme === 'mailto:' || /^mail(to)?$|^e?mail$/i.test(link.name ?? '')) {
    return { path: FALLBACK.mail, hex: null, source: 'builtin', slug: 'mail' };
  }
  if (scheme === 'tel:') return { path: FALLBACK.phone, hex: null, source: 'builtin', slug: 'phone' };
  return { path: FALLBACK.link, hex: null, source: 'generic', slug: 'link' };
}

/* --------------------------------------------------------------- utilities */

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Anything else — javascript:, data: — is left as literal text rather than linked.
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|[#/]|\.{1,2}\/)/i;

/**
 * The slice of Markdown a bio actually needs: [text](url), **bold**, *italic*, `code`.
 * Everything is HTML-escaped first, so a config can never inject markup — the patterns
 * below only ever match text that is already inert.
 */
export function md(src) {
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
export const plain = (s) =>
  String(s ?? '')
    .replace(/\[([^\]\n]+)]\(\s*[^\s)]+\s*\)/g, '$1')
    .replace(/[*`]/g, '');

/**
 * Brand hexes are picked for white backgrounds — GitHub's #181717 is invisible on
 * AMOLED black. Lift lightness to a readable floor, and drop unsaturated brands
 * (X, GitHub, Apple) back to the accent colour rather than showing muddy grey.
 */
export function readableOnBlack(hex, accent) {
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

export const initials = (name) =>
  String(name ?? '')
    .trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '·';

/** A black rounded square with the name's initials, as a data: URI. */
export const favicon = (name, accent) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#000"/><text x="32" y="43" font-family="Roboto, Arial, sans-serif" font-size="30" font-weight="600" fill="${accent}" text-anchor="middle">${initials(name)}</text></svg>`,
  )}`;

/**
 * Give every row a keyboard shortcut: the one pinned in config, else the first
 * free letter of its name, else a digit. Returns null when the row opts out.
 */
export function assignKeys(links) {
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

/** Everything wrong with a config, as readable sentences. Empty when it can be built. */
export function validate(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return ['The config must be a JSON object.'];
  const errors = [];
  if (!cfg.name) errors.push('"name" is required.');
  if (!Array.isArray(cfg.links) || cfg.links.length === 0) errors.push('"links" must be a non-empty array.');
  const cardDescription = cfg.meta?.socialCard?.description;
  if (typeof cardDescription === 'string' && cardDescription.length > 52) {
    errors.push('"meta.socialCard.description" must be 52 characters or fewer.');
  }
  (Array.isArray(cfg.links) ? cfg.links : []).forEach((l, i) => {
    if (!l || typeof l !== 'object') return errors.push(`links[${i}] must be an object.`);
    if (!l.url) errors.push(`links[${i}] ("${l.name ?? '?'}") is missing "url".`);
    if (!l.name && !l.label) errors.push(`links[${i}] needs a "name" or "label".`);
  });
  return errors;
}

/* ------------------------------------------------------------- social card */

const CARD_COLOR = /^#[0-9a-f]{6}$/i;
const cardColor = (value) => CARD_COLOR.test(value ?? '') ? value : null;
const truncate = (value, limit) => {
  const text = String(value ?? '');
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
};

export function socialCardOptions(cfg) {
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

/** Where the generated card will be served from, or null when the build should not make one. */
export function socialCardUrl(cfg) {
  const card = socialCardOptions(cfg);
  return card.enabled && !cfg.meta?.image ? publicAssetUrl(cfg.meta?.url, 'social-card.png') : null;
}

function cardRibbonColors(cfg, card, findIcon) {
  if (card.ribbon === 'none') return [];
  if (card.ribbon === 'custom') return (card.ribbonColors ?? []).map(cardColor).filter(Boolean);

  const accent = cfg.theme?.accent ?? '#ffffff';
  return (cfg.links ?? []).map((link) => cardColor(resolveIcon(link, findIcon)?.hex) ?? accent).filter(cardColor);
}

/**
 * The 1200×630 card as SVG. The build rasterises it to PNG, since social crawlers do not
 * reliably render SVG; `avatarHref` is an image URL (the build passes a resized data: URI).
 */
export function socialCardSvg(cfg, { findIcon, avatarHref = null }) {
  const card = socialCardOptions(cfg);
  const avatarSvg = card.showAvatar && avatarHref
    ? `<image x="936" y="72" width="224" height="224" preserveAspectRatio="xMidYMid slice" href="${esc(avatarHref)}"/>`
    : '';
  const colors = cardRibbonColors(cfg, card, findIcon);
  const ribbon = colors.length
    ? colors.map((color, i) => `<rect x="${24 + (1152 * i) / colors.length}" y="600" width="${1152 / colors.length + 1}" height="6" fill="${color}"/>`).join('')
    : '';
  const title = truncate(cfg.name || 'Links', 48);
  const description = truncate(plain(card.description ?? cfg.bio).replace(/\s+/g, ' ').trim(), 52);
  const instance = truncate(card.instance, 72);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
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
}

/* ------------------------------------------------------------------ render */

/**
 * The whole page as one HTML string. Returns the document, one report line per row for the
 * build log, and the set of brand slugs it used.
 */
export function render(cfg, { findIcon, socialImage = null }) {
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
    const icon = resolveIcon(link, findIcon);
    if (icon && BRAND_SOURCES.includes(icon.source)) used.add(icon.slug);
    const brand = theme.brandColors && icon?.hex ? readableOnBlack(icon.hex, theme.accent) : theme.accent;
    const key = keys[i];
    report.push({ name: link.label ?? link.name, slug: icon?.slug ?? '—', source: icon?.source ?? 'off', key, color: brand });

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
<link rel="icon" href="${favicon(cfg.name, theme.accent)}">
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
