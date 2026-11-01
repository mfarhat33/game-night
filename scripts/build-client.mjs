// Builds the browser app into dist/: app.js (one small bundle), app.css (with self-hosted fonts), index.html.
import { build, transform } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'fonts'), { recursive: true });

// IBM Plex Sans Arabic (SIL Open Font License), Arabic and Latin subsets, two weights, woff2 only.
const fontDir = join(root, 'node_modules', '@fontsource', 'ibm-plex-sans-arabic');
let fontCss = '';
for (const weight of [400, 700]) {
  const css = readFileSync(join(fontDir, `${weight}.css`), 'utf8');
  for (const subset of ['arabic', 'latin']) {
    const range = new RegExp(`${subset}-${weight}-normal\\.woff2[^}]*?unicode-range:\\s*([^;]+);`, 's').exec(css)?.[1];
    if (!range) throw new Error(`font subset ${subset} ${weight} not found`);
    const file = `plex-${subset}-${weight}.woff2`;
    copyFileSync(join(fontDir, 'files', `ibm-plex-sans-arabic-${subset}-${weight}-normal.woff2`), join(dist, 'fonts', file));
    fontCss += `@font-face{font-family:'Plex Arabic';font-style:normal;font-display:swap;font-weight:${weight};src:url(/fonts/${file}) format('woff2');unicode-range:${range}}\n`;
  }
}
copyFileSync(join(fontDir, 'LICENSE'), join(dist, 'fonts', 'LICENSE.txt'));

const css = await transform(fontCss + readFileSync(join(root, 'public', 'style.css'), 'utf8'), { loader: 'css', minify: true, target: ['chrome64', 'safari15'] });
writeFileSync(join(dist, 'app.css'), css.code);

const js = await build({
  entryPoints: [join(root, 'src', 'client', 'main.ts')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2018', 'chrome64', 'safari15'],
  outfile: join(dist, 'app.js'),
  metafile: true,
  logLevel: 'warning',
});
for (const f of ['index.html', 'favicon.svg']) copyFileSync(join(root, 'public', f), join(dist, f));
writeFileSync(join(dist, '_headers'), '/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n');
const bytes = Object.values(js.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(`client: app.js ${(bytes / 1024).toFixed(1)} KB, app.css ${(css.code.length / 1024).toFixed(1)} KB`);
