/**
 * Midnight — builds a single self-contained AMOLED link-in-bio page from config.json.
 *
 * The page itself is rendered by lib/render.mjs; this script supplies the icons, the social
 * card and the files. Brand marks come from Simple Icons (CC0-1.0). Every mark a build
 * actually uses is copied into icons/icons.json and committed, so the page — and any later
 * build or deploy — needs nothing fetched or installed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { headersFile, scriptHashes } from './lib/headers.mjs';
import { BRAND_SOURCES, render, socialCardOptions, socialCardSvg, socialCardUrl, validate } from './lib/render.mjs';
import { loadSimpleIcons } from './lib/simple-icons.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(root, 'dist');
const CONFIG = path.join(root, 'config.json');
const ICONS = path.join(root, 'icons', 'icons.json');
const SOCIAL_CARD = path.join(OUT_DIR, 'social-card.png');

/* ---------------------------------------------------------------- icon set */

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
const iconPackage = () => (pkg === undefined ? (pkg = loadSimpleIcons()) : pkg);

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

  const slug = p.slugFor(k);
  const mark = slug && p.mark(slug);
  if (!mark) { lookup.set(k, null); return null; }

  vendored[slug] = mark;
  for (const key of mark.keys) if (!lookup.has(key)) lookup.set(key, slug);
  return { slug, ...mark };
}

/* ------------------------------------------------------------- social card */

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
  const generatedUrl = socialCardUrl(cfg);
  if (!generatedUrl) return meta.image || cfg.avatar || null;

  const avatar = socialCardOptions(cfg).showAvatar ? await cardAvatar(cfg.avatar) : null;
  const svg = socialCardSvg(cfg, {
    findIcon,
    avatarHref: avatar && `data:image/png;base64,${avatar.toString('base64')}`,
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(SOCIAL_CARD);
  return generatedUrl;
}

/* ------------------------------------------------------------------- build */

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
  const errors = validate(cfg);
  if (errors.length) {
    console.error('\n  config.json is invalid:\n' + errors.map((e) => `    · ${e}`).join('\n') + '\n');
    process.exit(1);
  }
  const socialImage = await writeSocialCard(cfg);
  const { html, report, used } = render(cfg, { findIcon, socialImage });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);
  // Only the shortcut script may run; the avatar may be any https: image.
  fs.writeFileSync(path.join(OUT_DIR, '_headers'), headersFile({
    'script-src': scriptHashes(html),
    'style-src': ["'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'https:'],
  }));
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
    console.log(`  ${'●○○'[BRAND_SOURCES.includes(r.source) ? 0 : r.source === 'builtin' ? 1 : 2]} ${hint} ${String(r.name).padEnd(pad)}  ${String(r.slug).padEnd(12)}${note[r.source]}`);
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
