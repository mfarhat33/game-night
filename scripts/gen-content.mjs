// Bundles content JSON into src/server/generated/content.json at build time.
// Reads content/packs/<lang>/<game>.json and content/trivia/<lang>/<topic>.json.
// For any file that is missing, empty or invalid, falls back to test/fixtures/content/ (same layout).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['ar', 'en'];

// Required fields per content kind (see "Content schema" in docs/GAMES.md).
const REQUIRED = {
  spy: { id: 'string', place: 'string', pack: 'string', roles: 'array' },
  charades: { id: 'string', word: 'string' },
  taboo: { id: 'string', word: 'string', banned: 'array' },
  wordgrid: { id: 'string', word: 'string' },
  draw: { id: 'string', word: 'string' },
  trivia: { id: 'string', q: 'string', options: 'array', answer: 'number' },
};

function valid(kind, item) {
  const req = REQUIRED[kind];
  if (!item || typeof item !== 'object') return false;
  if (!req) return true;
  for (const [k, t] of Object.entries(req)) {
    const v = item[k];
    if (t === 'array' ? !Array.isArray(v) || v.length === 0 : typeof v !== t) return false;
  }
  if (kind === 'trivia' && (item.options.length !== 4 || item.answer < 0 || item.answer > 3)) return false;
  return true;
}

function readDir(base, sub, lang, kindOf) {
  const dir = join(base, sub, lang);
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const name = f.slice(0, -5);
    try {
      const raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (!Array.isArray(raw)) throw new Error('not an array');
      const kind = kindOf(name);
      const seen = new Set();
      const items = raw.filter((it) => valid(kind, it) && !seen.has(it.id) && seen.add(it.id));
      if (items.length < raw.length) console.warn(`content: ${sub}/${lang}/${f}: dropped ${raw.length - items.length} invalid or duplicate items`);
      if (items.length) out[name] = items;
    } catch (e) {
      console.warn(`content: ${sub}/${lang}/${f}: skipped (${e.message})`);
    }
  }
  return out;
}

const result = { packs: {}, trivia: {}, sources: {} };
for (const [sub, kindOf] of [['packs', (n) => n], ['trivia', () => 'trivia']]) {
  for (const lang of LANGS) {
    const real = readDir(join(root, 'content'), sub, lang, kindOf);
    const fix = readDir(join(root, 'test', 'fixtures', 'content'), sub, lang, kindOf);
    const merged = {};
    for (const name of new Set([...Object.keys(fix), ...Object.keys(real)])) {
      merged[name] = real[name] ?? fix[name];
      result.sources[`${sub}/${lang}/${name}`] = real[name] ? 'content' : 'fixture';
    }
    result[sub][lang] = merged;
  }
}

const outDir = join(root, 'src', 'server', 'generated');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'content.json'), JSON.stringify(result));
const summary = Object.entries(result.sources).map(([k, v]) => `${k}:${v}`).join(' ');
console.log(`content: ${summary || 'none'}`);
