/**
 * Builds the launch page — launch/page.html with style.css, editor.js, lib/render.mjs and a
 * bundled set of brand marks inlined — into one self-contained launch/dist/index.html.
 *
 * The live editor runs lib/render.mjs unchanged, so its preview is the page build.mjs writes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../lib/render.mjs';
import { loadSimpleIcons } from '../lib/simple-icons.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const OUT_DIR = path.join(here, 'dist');
const RENDERER = path.join(root, 'lib', 'render.mjs');
const SOURCES = ['page.html', 'style.css', 'editor.js', 'demo.json'].map((f) => path.join(here, f));

const REPO = 'https://github.com/leied/midnight';

// The brands the editor resolves without the full Simple Icons set: the ones people link to most.
// A real build searches every brand, so this only limits the preview.
const BRANDS = [
  'github', 'gitlab', 'codeberg', 'x', 'bluesky', 'mastodon', 'threads', 'instagram', 'facebook',
  'tiktok', 'youtube', 'twitch', 'vimeo', 'discord', 'telegram', 'whatsapp', 'signal', 'snapchat',
  'reddit', 'pinterest', 'tumblr', 'spotify', 'applemusic', 'soundcloud', 'bandcamp', 'youtubemusic',
  'lastdotfm', 'patreon', 'kofi', 'buymeacoffee', 'paypal', 'cashapp', 'gumroad', 'etsy', 'shopify',
  'substack', 'medium', 'devdotto', 'hashnode', 'ghost', 'wordpress', 'rss', 'dribbble', 'behance',
  'figma', 'stackoverflow', 'npm', 'steam', 'itchdotio', 'letterboxd', 'goodreads', 'strava',
  'producthunt', 'matrix', 'cloudflare', 'notion', 'linktree',
];

/** JSON that is safe inside a <script> element. */
const scriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

/** JavaScript source that is safe inside a <script> element. */
const scriptSafe = (src) => src.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

/**
 * lib/render.mjs as an expression evaluating to its exports. It has no imports by design,
 * so dropping the `export` keywords and returning the names is all bundling takes.
 */
function inlineRenderer() {
  const src = fs.readFileSync(RENDERER, 'utf8');
  if (/^\s*import\s/m.test(src)) throw new Error('lib/render.mjs must not import anything — the launch page inlines it.');
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  return `(() => {\n${src.replace(/^export\s+/gm, '')}\nreturn { ${names.join(', ')} };\n})()`;
}

function bundleIcons() {
  const pkg = loadSimpleIcons();
  if (!pkg) throw new Error('simple-icons is not installed. Run `pnpm install`, then build the launch page again.');
  const icons = {};
  for (const slug of BRANDS) {
    const mark = pkg.mark(slug);
    if (!mark) throw new Error(`simple-icons ${pkg.version} has no "${slug}" — remove it from BRANDS in launch/build.mjs.`);
    icons[slug] = mark;
  }
  return { icons, pkg };
}

function build() {
  const read = (f) => fs.readFileSync(path.join(here, f), 'utf8');
  const demo = JSON.parse(read('demo.json'));
  const { icons, pkg } = bundleIcons();

  const lookup = new Map();
  for (const [slug, icon] of Object.entries(icons)) for (const k of icon.keys) if (!lookup.has(k)) lookup.set(k, slug);
  const findIcon = (k) => (lookup.has(k) ? { slug: lookup.get(k), ...icons[lookup.get(k)] } : null);

  // Figures quoted on the page come from rendering the demo, so they cannot drift from the code.
  const { html: demoPage } = M.render(demo, { findIcon, socialImage: M.socialCardUrl(demo) });
  const pageBytes = Buffer.byteLength(demoPage);
  const shortcutScript = /<script>([\s\S]*?)<\/script>/.exec(demoPage)?.[1] ?? '';

  const values = {
    repo: REPO,
    favicon: M.favicon('Midnight', '#ffffff'),
    size: `${Math.round(pageBytes / 1024)} kB`,
    sizeExact: `${(pageBytes / 1024).toFixed(1)} kB`,
    scriptBytes: String(Buffer.byteLength(shortcutScript.trim())),
    brandCount: pkg.count.toLocaleString('en-US'),
    bundledCount: String(BRANDS.length),
    mdSpecimen: M.md('**Bold**, *italic*, `code` and [links](#editor).'),
    cardSpecimen: M.socialCardSvg(demo, { findIcon }),
    css: read('style.css'),
    script: scriptSafe(`(() => {
const M = ${inlineRenderer()};
const ICONS = ${scriptJson(icons)};
const DEMO = ${scriptJson(demo)};
${read('editor.js')}
})();`),
  };

  const icon = (slug) => {
    if (!icons[slug]) throw new Error(`launch/page.html uses {{icon:${slug}}}, which is not in BRANDS.`);
    return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${M.esc(icons[slug].path)}"/></svg>`;
  };
  const brand = (slug) => {
    if (!icons[slug]) throw new Error(`launch/page.html uses {{brand:${slug}}}, which is not in BRANDS.`);
    return M.readableOnBlack(`#${icons[slug].hex}`, '#ffffff');
  };

  // One pass, so inlined CSS and scripts are never scanned for placeholders themselves.
  const html = read('page.html').replace(/\{\{\s*([\w-]+)(?::([\w-]+))?\s*\}\}/g, (_, key, arg) => {
    if (key === 'icon') return icon(arg);
    if (key === 'brand') return brand(arg);
    if (!(key in values)) throw new Error(`launch/page.html has an unknown placeholder {{${key}}}.`);
    return values[key];
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);
  console.log(`\n  launch → launch/dist/index.html  (${(Buffer.byteLength(html) / 1024).toFixed(1)} kB, ${BRANDS.length} brands bundled)\n`);
}

const run = () => {
  try { build(); } catch (error) { console.error(`\n  ${error.message}\n`); process.exitCode = 1; }
};
run();

if (process.argv.includes('--watch')) {
  console.log('  watching launch/ and lib/render.mjs …\n');
  let t;
  for (const file of [...SOURCES, RENDERER]) {
    fs.watch(file, () => { clearTimeout(t); t = setTimeout(run, 60); });
  }
}
