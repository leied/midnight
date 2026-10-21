/**
 * Read access to the simple-icons package, used only when a mark isn't committed yet
 * (build.mjs) or when the launch page bundles its editor's icon set (launch/build.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { norm } from './render.mjs';

const require = createRequire(import.meta.url);

/**
 * Load the package, or return null when it isn't installed. The result answers
 * `slugFor(key)` for a normalised name and `mark(slug)` with the entry icons/icons.json stores.
 */
export function loadSimpleIcons() {
  let data, dir;
  try {
    data = require('simple-icons/icons.json');
    dir = path.resolve(path.dirname(require.resolve('simple-icons/icons.json')), '../icons');
  } catch {
    return null;
  }

  // slug wins over title, title over alias — so "X" resolves to X, not to something aliased "X".
  const index = new Map();
  const add = (k, slug) => { if (k && !index.has(k)) index.set(k, slug); };
  for (const i of data) add(norm(i.slug), i.slug);
  for (const i of data) add(norm(i.title), i.slug);
  for (const i of data) {
    const a = i.aliases ?? {};
    for (const n of [...(a.aka ?? []), ...(a.old ?? []), ...(a.dup ?? []).map((d) => d.title)]) add(norm(n), i.slug);
  }

  const bySlug = new Map(data.map((i) => [i.slug, i]));
  // The package does not export its own package.json, so read it off the resolved path.
  const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(dir), 'package.json'), 'utf8'));

  return {
    version: manifest.version,
    count: data.length,
    slugFor: (key) => index.get(key) ?? null,
    /** { title, hex, keys, path } for a slug, or null when the package has no such mark. */
    mark(slug) {
      const file = path.join(dir, `${slug}.svg`);
      const d = bySlug.has(slug) && fs.existsSync(file) && /\sd="([^"]+)"/.exec(fs.readFileSync(file, 'utf8'));
      if (!d) return null;
      return {
        title: bySlug.get(slug).title,
        hex: bySlug.get(slug).hex,
        // Every name that resolves here, so renaming a row later still hits the committed copy.
        keys: [...index].filter(([, s]) => s === slug).map(([key]) => key).sort(),
        path: d[1],
      };
    },
  };
}
