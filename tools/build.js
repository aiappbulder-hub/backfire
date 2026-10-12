// Bundles the game into a single self-contained HTML file.
//
//   node tools/build.js
//
// Produces two files in dist/:
//   backfire.html  — a complete document you can open straight from disk
//   embed.html     — the same page without the outer document tags, for hosts
//                    that supply their own <!doctype>/<head>/<body> skeleton
//
// The modules are concatenated in dependency order with their import/export
// keywords stripped, which works because no two of them declare the same name.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// Dependency order: rng → data → engine → ui → main.
const MODULES = [
  'src/js/rng.js',
  'src/js/data.js',
  'src/js/engine.js',
  'src/js/ui.js',
  'src/js/main.js',
];

/** Strip ES module syntax so the files can share one classic script scope. */
function stripModuleSyntax(source) {
  return (
    source
      // import { a, b } from './x.js';  (including multi-line forms)
      .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
      // export { a, b };  (re-export blocks)
      .replace(/^export\s*\{[\s\S]*?\};?[ \t]*$/gm, '')
      // export function foo / export const bar
      .replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm, '')
      .trim()
  );
}

const bundle = MODULES.map((path) => {
  const code = stripModuleSyntax(read(path));
  return `/* ---- ${path} ---- */\n${code}`;
}).join('\n\n');

const css = read('src/css/styles.css');
const html = read('index.html');

// Pull the markup out of index.html and drop the tags we are replacing.
const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
if (!bodyMatch) throw new Error('could not find <body> in index.html');
const body = bodyMatch[1]
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .trim();

const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
const title = titleMatch ? titleMatch[1].trim() : 'Backfire';

const description =
  "A pandemic strategy game where humanity's response is your weapon — arm a trap before its trigger exists.";

const head = `<title>${title}</title>
<meta name="description" content="${description}" />
<style>
${css}
</style>`;

// Host-supplied skeleton: head content, markup and script, no outer tags.
const inner = `${head}

${body}

<script>
${bundle}
</script>
`;

const standalone = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    ${head.split('\n').join('\n    ')}
  </head>
  <body>
    ${body.split('\n').join('\n    ')}
    <script>
${bundle}
    </script>
  </body>
</html>
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/backfire.html'), standalone);
writeFileSync(join(root, 'dist/embed.html'), inner);

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)}KB`;
console.log(`dist/backfire.html  ${kb(standalone)}  (open directly from disk)`);
console.log(`dist/embed.html     ${kb(inner)}  (no outer document tags)`);
