/**
 * Response headers for a static-assets Worker, written as dist/_headers. Cloudflare reads the
 * file at deploy time and applies it to every response; it is never served itself.
 * https://developers.cloudflare.com/workers/static-assets/headers/
 */
import crypto from 'node:crypto';

/** CSP source for each inline <script> in a page, so only those exact scripts may run. */
export const scriptHashes = (html) =>
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`,
  );

/**
 * The `_headers` file for a one-document site. `csp` maps directive → sources and is added to
 * the baseline: nothing loads unless a directive allows it, and no page can frame this one.
 * An empty source list becomes 'none'.
 */
export function headersFile(csp) {
  const policy = {
    'default-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    'frame-ancestors': ["'none'"],
    ...csp,
  };
  const value = Object.entries(policy).map(([k, v]) => `${k} ${v.length ? v.join(' ') : "'none'"}`).join('; ');
  return `/*
  Content-Security-Policy: ${value}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()
`;
}
