/**
 * The launch page's live editor and keyboard shortcuts.
 *
 * launch/build.mjs wraps this file in a function that provides:
 *   M      the exports of lib/render.mjs, the same renderer build.mjs uses
 *   ICONS  { slug: { title, hex, keys, path } }, the brand marks bundled for the editor
 *   DEMO   the config the editor starts with
 */

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/* --------------------------------------------------------- page shortcuts */

// The hero rows work like a Midnight page: press a row's key to follow it.
const shortcuts = new Map($$('a[data-key]').map((a) => [a.dataset.key, a]));
addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
  const a = shortcuts.get(e.key.toLowerCase());
  if (!a) return;
  e.preventDefault();
  const cap = document.querySelector(`.keycap[data-key="${a.dataset.key}"]`);
  for (const el of [a, cap]) el?.classList.add('hit');
  setTimeout(() => { for (const el of [a, cap]) el?.classList.remove('hit'); }, 200);
  a.click();
});

/* ------------------------------------------------------------------ icons */

const lookup = new Map();
for (const [slug, icon] of Object.entries(ICONS)) {
  for (const k of icon.keys) if (!lookup.has(k)) lookup.set(k, slug);
}
const findIcon = (k) => (lookup.has(k) ? { slug: lookup.get(k), ...ICONS[lookup.get(k)] } : null);

/* ------------------------------------------------------------- formatting */

const isPlain = (v) => v === null || typeof v !== 'object';

/** JSON with two-space indents, keeping short rows — a link, a colour list — on one line. */
function format(value, indent = '') {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const one = `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
    if (value.every(isPlain) && indent.length + one.length <= 80) return one;
    return `[\n${value.map((v) => inner + formatItem(v, inner)).join(',\n')}\n${indent}]`;
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

function formatItem(value, indent) {
  if (isObject(value) && Object.keys(value).length && Object.values(value).every(isPlain)) {
    const one = `{ ${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`;
    if (indent.length + one.length <= 110) return one;
  }
  return format(value, indent);
}

/* ------------------------------------------------------------ highlighting */

const TOKEN = /("(?:[^"\\]|\\.)*"?)(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;

function highlight(line) {
  let out = '';
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    const [whole, str, colon, num, word, punct] = m;
    out += escHtml(line.slice(last, m.index));
    if (str !== undefined) {
      out += `<span class="${colon ? 't-key' : 't-str'}">${escHtml(str)}</span>`;
      if (colon) out += `<span class="t-punct">${colon}</span>`;
    } else if (num !== undefined) out += `<span class="t-num">${num}</span>`;
    else if (word !== undefined) out += `<span class="t-word">${word}</span>`;
    else out += `<span class="t-punct">${punct}</span>`;
    last = m.index + whole.length;
  }
  return out + escHtml(line.slice(last));
}

/* ----------------------------------------------------------------- editor */

const ta = $('#config');
const code = $('.code');
const statusEl = $('#status');
const logEl = $('#log');
const previewCol = $('#preview');
const DEFAULT = `${format(DEMO)}\n`;
const STORAGE = 'midnight:launch-config';

const saved = {
  get() { try { return localStorage.getItem(STORAGE); } catch { return null; } },
  set(text) {
    try { text === DEFAULT ? localStorage.removeItem(STORAGE) : localStorage.setItem(STORAGE, text); } catch { /* private mode */ }
  },
};

let errorLine = -1;
let changed = null; // [from, to) lines to flash after a quick edit

function paint() {
  code.innerHTML = ta.value.split('\n').map((line, i) => {
    let cls = 'ln';
    if (i === errorLine) cls += ' ln-error';
    if (changed && i >= changed[0] && i < changed[1]) cls += ' ln-changed';
    return `<div class="${cls}">${highlight(line) || '<br>'}</div>`;
  }).join('');
  changed = null;
  // The textarea never needs to scroll — the cell grows instead — but browsers can still nudge
  // it while revealing the caret, which would misalign it from the highlighted copy.
  ta.scrollTop = 0;
  ta.scrollLeft = 0;
}
ta.addEventListener('scroll', () => { ta.scrollTop = 0; ta.scrollLeft = 0; });

/** Line index a JSON.parse message points at, or -1. Chrome and Firefox both report one. */
function jsonErrorLine(message, text) {
  const line = /line (\d+)/i.exec(message);
  if (line) return Number(line[1]) - 1;
  const at = /position (\d+)/i.exec(message);
  return at ? text.slice(0, Number(at[1])).split('\n').length - 1 : -1;
}

function check(text) {
  let cfg;
  try {
    cfg = JSON.parse(text);
  } catch (e) {
    // The line goes in the heading, so drop each engine's own position suffix.
    const message = e.message
      .replace(/^JSON\.parse:\s*/, '')
      .replace(/\s+(in JSON )?at position \d+.*$|\s+at line \d+ column \d+ of the JSON data$/, '')
      .replace(/\s+/g, ' ')
      .replace(/^\w/, (c) => c.toUpperCase());
    return { kind: 'json', cfg: undefined, errors: [message], line: jsonErrorLine(e.message, text) };
  }
  return { kind: 'config', cfg, errors: M.validate(cfg), line: -1 };
}

function setStatus({ kind, errors, line }) {
  let text = 'Builds';
  let cls = 'status is-ok';
  if (errors.length) {
    cls = 'status is-bad';
    text = kind === 'json' ? (line >= 0 ? `JSON error on line ${line + 1}` : 'JSON error') : `${errors.length} config error${errors.length > 1 ? 's' : ''}`;
  }
  // Only touch the live region when the state changes, so typing isn't announced.
  if (statusEl.textContent !== text) statusEl.textContent = text;
  statusEl.className = cls;
}

let renderTimer;
function update({ immediate = false } = {}) {
  const result = check(ta.value);
  errorLine = result.line;
  paint();
  setStatus(result);
  syncEdits(isObject(result.cfg) ? result.cfg : null);

  clearTimeout(renderTimer);
  if (result.errors.length) {
    showErrors(result);
    return;
  }
  renderTimer = setTimeout(() => build(result.cfg), immediate ? 0 : 120);
}

/* ------------------------------------------------------------------ build */

let lastGood = null;

function build(cfg) {
  let out;
  try {
    // Same social image the build would link: its generated card, else meta.image or the avatar.
    const socialImage = M.socialCardUrl(cfg) ?? (cfg.meta?.image || cfg.avatar || null);
    out = M.render(cfg, { findIcon, socialImage });
  } catch (e) {
    showErrors({ kind: 'crash', errors: [e.message], line: -1 });
    return;
  }
  lastGood = out.html;
  previewCol.classList.remove('is-stale');
  showLog(out);
  showPage(out.html);
  showCard(cfg);
  saved.set(ta.value);
}

const NOTE = {
  icon: 'brand icon, pinned in config',
  name: 'brand icon, matched on name',
  url: 'brand icon, matched on domain',
  builtin: 'built-in glyph',
  generic: 'generic glyph — no brand icon matched',
  off: 'icon disabled',
};

/** The same report `pnpm build` prints, with each brand's dot in the colour its row uses. */
function showLog({ html, report }) {
  const kb = (new TextEncoder().encode(html).length / 1024).toFixed(1);
  const pad = Math.max(...report.map((r) => String(r.name ?? '').length), 4);
  const rows = report.map((r) => {
    const dot = M.BRAND_SOURCES.includes(r.source)
      ? `<span style="color:${escHtml(r.color)}">●</span>`
      : '<span class="faint">○</span>';
    const key = r.key ? `[${escHtml(r.key)}]` : '[ ]';
    return `${dot} ${key} ${escHtml(String(r.name).padEnd(pad))}  ${escHtml(String(r.slug).padEnd(12))}<span class="faint">${NOTE[r.source]}</span>`;
  });
  logEl.innerHTML = `<span class="log-head">midnight → dist/index.html  (${kb} kB)</span>\n\n${rows.join('\n')}`;
}

function showErrors({ kind, errors, line }) {
  const head = {
    json: `config.json is not valid JSON${line >= 0 ? ` (line ${line + 1})` : ''}:`,
    config: 'config.json is invalid:',
    crash: 'The build failed:',
  }[kind];
  logEl.innerHTML = `<span class="log-error">${head}</span>\n${errors.map((e) => `  · ${escHtml(e)}`).join('\n')}${
    lastGood ? '\n\n<span class="faint">The preview shows the last version that built.</span>' : ''
  }`;
  previewCol.classList.add('is-stale');
}

/* ---------------------------------------------------------------- preview */

// Two frames, so the next page loads out of sight and swaps in without a flash.
const frames = $$('.screen iframe');
let front = -1;
let ticket = 0;
let previewScroll = 0;

/**
 * Preview-only additions: links open in a new tab instead of replacing the frame, and the
 * scroll position is reported back so the next rebuild opens where you were.
 */
function forPreview(html) {
  const withBase = html.replace('<head>', '<head>\n<base target="_blank">');
  const at = withBase.lastIndexOf('</body>');
  const keepScroll = `<script>scrollTo(0, ${Math.round(previewScroll)}); addEventListener('scroll', () => parent.postMessage({ midnightScroll: scrollY }, '*'), { passive: true });<\/script>\n`;
  return withBase.slice(0, at) + keepScroll + withBase.slice(at);
}

function showPage(html) {
  const back = frames[front === 0 ? 1 : 0];
  const mine = ++ticket;
  back.onload = () => {
    if (mine !== ticket) return;
    back.classList.add('front');
    frames[front]?.classList.remove('front');
    front = frames.indexOf(back);
  };
  back.srcdoc = forPreview(html);
}

addEventListener('message', (e) => {
  if (front >= 0 && e.source === frames[front].contentWindow && typeof e.data?.midnightScroll === 'number') {
    previewScroll = e.data.midnightScroll;
  }
});

const cardEl = $('#card');
const cardNote = $('#card-note');

function showCard(cfg) {
  const url = M.socialCardUrl(cfg);
  if (url) {
    cardEl.innerHTML = M.socialCardSvg(cfg, { findIcon, avatarHref: cfg.avatar || null });
    cardNote.innerHTML = `Written to <code>dist/social-card.png</code> on every build and shared as <code>${escHtml(url)}</code>.`;
    return;
  }
  cardEl.innerHTML = '';
  cardNote.innerHTML = !M.socialCardOptions(cfg).enabled
    ? 'No card: <code>meta.socialCard.enabled</code> is false.'
    : cfg.meta?.image
      ? 'No card: <code>meta.image</code> is set, so the page shares that image instead.'
      : 'No card yet. Add <code>meta.url</code>, the address the page will live at, and the build draws one.';
}

const views = $$('[data-view]');
const panels = $$('[data-panel]');
const previewHelp = $('#preview-help');
const HELP = {
  page: previewHelp.innerHTML,
  card: 'What a link to your page looks like when it’s shared.',
};
for (const button of views) {
  button.addEventListener('click', () => {
    for (const b of views) b.setAttribute('aria-pressed', String(b === button));
    for (const p of panels) p.hidden = p.dataset.panel !== button.dataset.view;
    previewHelp.innerHTML = HELP[button.dataset.view];
  });
}

/* ------------------------------------------------------------ quick edits */

const ACCENTS = ['#ffffff', '#7cf2c4', '#ffc56b', '#b9a5ff'];
const theme = (cfg) => (isObject(cfg.theme) ? cfg.theme : (cfg.theme = {}));
const discordAt = (cfg) => (Array.isArray(cfg.links) ? cfg.links.findIndex((l) => isObject(l) && M.norm(l.name ?? '') === 'discord') : -1);

// Each one edits the parsed config, then the text is rewritten — so you see which field it was.
const EDITS = {
  accent: {
    apply(cfg) {
      const i = ACCENTS.indexOf(String(cfg.theme?.accent ?? '#ffffff').toLowerCase());
      theme(cfg).accent = ACCENTS[(i + 1) % ACCENTS.length];
    },
  },
  pill: {
    pressed: (cfg) => (cfg.theme?.radius ?? '999px') === '999px',
    apply(cfg) { theme(cfg).radius = this.pressed(cfg) ? '14px' : '999px'; },
  },
  brandColors: {
    pressed: (cfg) => cfg.theme?.brandColors !== false,
    apply(cfg) { theme(cfg).brandColors = !this.pressed(cfg); },
  },
  keys: {
    pressed: (cfg) => cfg.theme?.keys !== false,
    apply(cfg) { theme(cfg).keys = !this.pressed(cfg); },
  },
  discord: {
    pressed: (cfg) => discordAt(cfg) >= 0,
    apply(cfg) {
      const i = discordAt(cfg);
      if (i >= 0) return void cfg.links.splice(i, 1);
      const links = Array.isArray(cfg.links) ? cfg.links : (cfg.links = []);
      // Join the first group, so the new row lands among the other social links.
      const group = links[0]?.group;
      let at = 0;
      while (at < links.length && links[at]?.group === group) at++;
      links.splice(at, 0, { name: 'Discord', url: 'https://discord.gg/jane', ...(group ? { group } : {}) });
    },
  },
};

const editButtons = $$('[data-edit]');
const swatch = $('.swatch');

function syncEdits(cfg) {
  for (const button of editButtons) {
    button.disabled = !cfg;
    const { pressed } = EDITS[button.dataset.edit];
    if (cfg && pressed) button.setAttribute('aria-pressed', String(pressed(cfg)));
  }
  const accent = String(cfg?.theme?.accent ?? '#ffffff');
  swatch.style.setProperty('--swatch', CSS.supports('color', accent) ? accent : '#ffffff');
}

for (const button of editButtons) {
  button.addEventListener('click', () => {
    const { cfg } = check(ta.value);
    if (!isObject(cfg)) return;
    EDITS[button.dataset.edit].apply(cfg);
    replaceText(`${format(cfg)}\n`);
  });
}

/** Lines [from, to) of `next` that differ from `prev`, found by trimming the shared ends. */
function changedLines(prev, next) {
  const a = prev.split('\n');
  const b = next.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return [start, b.length - end];
}

const codeScroll = $('.code-scroll');

function replaceText(next) {
  if (next === ta.value) return;
  changed = changedLines(ta.value, next);
  const first = changed[0];
  ta.value = next;
  update({ immediate: true });
  revealLine(first);
}

/** On narrow screens the editor scrolls inside its own box; bring a changed line into it. */
function revealLine(i) {
  const line = code.children[Math.min(i, code.children.length - 1)];
  if (!line || codeScroll.scrollHeight <= codeScroll.clientHeight) return;
  const box = codeScroll.getBoundingClientRect();
  const at = line.getBoundingClientRect();
  if (at.top < box.top || at.bottom > box.bottom) codeScroll.scrollTop += at.top - box.top - codeScroll.clientHeight / 3;
}

/* ------------------------------------------------------------------ typing */

/** Insert through the browser's editing commands where possible, so Ctrl+Z still works. */
function insert(text, start = ta.selectionStart, end = ta.selectionEnd) {
  ta.setSelectionRange(start, end);
  if (!document.execCommand('insertText', false, text)) {
    ta.setRangeText(text, start, end, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function indent(outdent) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const multiline = value.slice(s, e).includes('\n');
  if (!outdent && !multiline) return insert('  ');

  const from = value.lastIndexOf('\n', s - 1) + 1;
  // A selection ending at the start of a line doesn't include that line.
  const lastEnd = value.indexOf('\n', e > s && value[e - 1] === '\n' ? e - 1 : e);
  const to = lastEnd === -1 ? value.length : lastEnd;
  const block = value.slice(from, to);
  const next = block.split('\n').map((l) => (outdent ? l.replace(/^ {1,2}/, '') : `  ${l}`)).join('\n');
  if (next === block) return;
  insert(next, from, to);
  if (multiline) ta.setSelectionRange(from, from + next.length);
  else {
    const caret = Math.max(from, s + next.length - block.length);
    ta.setSelectionRange(caret, caret);
  }
}

/** Enter keeps the line's indentation, and steps in after an opening bracket. */
function newline() {
  const { selectionStart: s, value } = ta;
  let e = ta.selectionEnd;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const pad = /^[ \t]*/.exec(value.slice(lineStart, s))[0];
  const opens = /[{[]\s*$/.test(value.slice(lineStart, s));
  const closer = /^[ \t]*[}\]]/.exec(value.slice(e));
  if (opens && closer) {
    e += closer[0].length - 1;
    insert(`\n${pad}  \n${pad}`, s, e);
    const caret = s + pad.length + 3;
    ta.setSelectionRange(caret, caret);
  } else {
    insert(`\n${pad}${opens ? '  ' : ''}`, s, e);
  }
}

// Tab indents, which would trap keyboard users — so Esc releases the next Tab to the browser.
let tabReleased = false;
ta.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { tabReleased = true; return; }
  const released = tabReleased;
  tabReleased = false;
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  if (e.key === 'Tab' && !released) { e.preventDefault(); indent(e.shiftKey); }
  else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); newline(); }
});

/* ---------------------------------------------------------------- toolbar */

function flashLabel(button, text) {
  button.dataset.label ??= button.textContent;
  button.textContent = text;
  clearTimeout(button.flashTimer);
  button.flashTimer = setTimeout(() => { button.textContent = button.dataset.label; }, 1600);
}

async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    flashLabel(button, 'Copied');
  } catch {
    flashLabel(button, 'Copy failed');
  }
}

$('#copy').addEventListener('click', (e) => copy(ta.value, e.currentTarget));
for (const button of $$('[data-copy]')) button.addEventListener('click', () => copy(button.dataset.copy, button));

// Reset keeps the previous text for a few seconds, so an accidental click is one click to undo.
const resetButton = $('#reset');
let undoText = null;
let undoTimer;
function clearUndo() {
  undoText = null;
  clearTimeout(undoTimer);
  resetButton.textContent = 'Reset';
}
resetButton.addEventListener('click', () => {
  if (undoText !== null) {
    const text = undoText;
    clearUndo();
    replaceText(text);
    return;
  }
  if (ta.value === DEFAULT) return;
  undoText = ta.value;
  replaceText(DEFAULT);
  resetButton.textContent = 'Undo reset';
  undoTimer = setTimeout(clearUndo, 6000);
});

$('#download').addEventListener('click', () => {
  if (!lastGood) return;
  const url = URL.createObjectURL(new Blob([lastGood], { type: 'text/html' }));
  Object.assign(document.createElement('a'), { href: url, download: 'index.html' }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

ta.addEventListener('input', () => { clearUndo(); update(); });

ta.value = saved.get() ?? DEFAULT;
update({ immediate: true });
