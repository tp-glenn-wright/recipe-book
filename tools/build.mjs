#!/usr/bin/env node
// Build the static site into dist/.
//
// There is no bundler and no dependency tree. The build reads the recipe files,
// validates them, renders one HTML page per recipe plus an index with every card
// already in the markup, copies the assets, generates the icons, and stamps the
// service worker with a version derived from the content hash of everything it just
// wrote. That version is what invalidates the offline cache on deploy, which is why
// asset filenames stay stable and readable.

import { rm, mkdir, writeFile, readFile, cp, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { loadRecipes, checkImagesExist, IMAGES_DIR } from './validate.mjs';
import { renderIndex, renderRecipe, renderNotFound } from './pages.mjs';
import { ICON_SIZES, renderIcon } from './icons.mjs';

const DIST = 'dist';
const SRC = 'src';
const BROWSER_SCRIPTS = ['app.js', 'recipe.js', 'scale.js', 'ui.js'];

/* Self-hosted from the design bundle, latin subset only. The CSP allows font-src
 * 'self' and nothing else, so these have to ship with the site. */
const FONTS = [
  'figtree-600.woff2',
  'figtree-700.woff2',
  'open-sans-400.woff2',
  'open-sans-600.woff2',
];

const ESC = String.fromCharCode(27);
const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColour ? `${ESC}[${code}m${s}${ESC}[0m` : s);
const red = (s) => c(31, s);
const green = (s) => c(32, s);
const dim = (s) => c(2, s);

/** Files written, so the version hash covers the actual output. */
const written = [];

async function emit(relativePath, contents) {
  const full = path.join(DIST, relativePath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, contents);
  written.push({ path: relativePath, bytes: Buffer.byteLength(contents) });
}

/** Every URL the service worker may cache, relative to the site root. */
function urlsFor(recipes, images) {
  const shell = [
    './',
    './404.html',
    './manifest.webmanifest',
    './assets/tokens.css',
    './assets/style.css',
    ...FONTS.map((font) => `./assets/fonts/${font}`),
    ...BROWSER_SCRIPTS.map((f) => `./assets/${f}`),
    ...ICON_SIZES.map((size) => `./assets/icon-${size}.png`),
  ];
  const rest = [
    ...recipes.map((r) => `./recipes/${r.id}/`),
    ...images.map((file) => `./${IMAGES_DIR}/${file}`),
  ];
  return { shell, all: [...shell, ...rest] };
}

async function main() {
  const { recipes, reports } = await loadRecipes();
  await checkImagesExist(recipes, reports);

  const errors = reports.flatMap((r) => r.errors.map((e) => `${r.file}: ${e.field} ${e.message}`));
  const warnings = reports.flatMap((r) => r.warnings.map((w) => `${r.file}: ${w.field} ${w.message}`));
  if (errors.length) {
    console.error(red(`build refused: ${errors.length} validation error(s)`));
    for (const error of errors) console.error(`  ${error}`);
    console.error('\nRun "node tools/recipes.mjs validate" for the full report.');
    return 1;
  }
  for (const warning of warnings) console.log(`${dim('warn')} ${warning}`);

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  // Pages. The index carries every card, so it works before any script runs.
  await emit('index.html', renderIndex(recipes));
  await emit('404.html', renderNotFound());
  for (const recipe of recipes) {
    // The whole list goes in so each page can render the pill strip and prev/next.
    await emit(path.join('recipes', recipe.id, 'index.html'), renderRecipe(recipe, recipes));
  }

  // Assets. Stable filenames, because the service worker version is what busts caches.
  // tokens.css is the design system as issued; style.css is this site's use of it.
  await emit('assets/tokens.css', await readFile(path.join(SRC, 'tokens.css')));
  await emit('assets/style.css', await readFile(path.join(SRC, 'style.css')));
  for (const font of FONTS) {
    await emit(`assets/fonts/${font}`, await readFile(path.join(SRC, 'fonts', font)));
  }
  for (const script of BROWSER_SCRIPTS) {
    await emit(`assets/${script}`, await readFile(path.join(SRC, script)));
  }
  for (const size of ICON_SIZES) {
    await emit(`assets/icon-${size}.png`, renderIcon(size));
  }

  // Images, copied as-is. They were resized and stripped on the way into images/.
  const images = (await readdir(IMAGES_DIR).catch(() => []))
    .filter((f) => !f.startsWith('.'));
  for (const file of images) {
    const contents = await readFile(path.join(IMAGES_DIR, file));
    await emit(path.join(IMAGES_DIR, file), contents);
  }

  await emit('manifest.webmanifest', JSON.stringify({
    name: 'Recipe Book',
    short_name: 'Recipes',
    description: 'A personal collection of recipes.',
    start_url: './',
    scope: './',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f0f6fb',
    theme_color: '#135487',
    icons: [
      { src: './assets/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: './assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: './assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2));

  // GitHub Pages runs Jekyll unless told not to, which would swallow some paths.
  await emit('.nojekyll', '');

  // Only effective at a domain root, so on a project page the meta robots tag in every
  // page is what actually keeps this out of search results. Written anyway for the day
  // this moves to a custom domain.
  await emit('robots.txt', 'User-agent: *\nDisallow: /\n');

  // Version stamp: hash everything written so far, so any content change rolls the
  // offline cache exactly once.
  const hash = createHash('sha256');
  for (const file of [...written].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path);
    hash.update(await readFile(path.join(DIST, file.path)));
  }
  const version = hash.digest('hex').slice(0, 12);

  const { shell, all } = urlsFor(recipes, images);
  const swSource = (await readFile(path.join(SRC, 'sw.js'), 'utf8'))
    .replace('__VERSION__', version)
    .replace('__SHELL__', JSON.stringify(shell, null, 2))
    .replace('__ALL_URLS__', JSON.stringify(all, null, 2));
  if (swSource.includes('__VERSION__') || swSource.includes('__SHELL__') || swSource.includes('__ALL_URLS__')) {
    console.error(red('build refused: a service worker placeholder was not substituted'));
    return 1;
  }
  await emit('sw.js', swSource);

  const totalBytes = written.reduce((sum, f) => sum + f.bytes, 0);
  console.log(`${green('built')} ${written.length} files, ${(totalBytes / 1024).toFixed(0)} kB total`);
  console.log(`  ${dim(`${recipes.length} recipe page(s), version ${version}`)}`);
  console.log(`  ${dim(`preview with: python3 -m http.server 8000 -d ${DIST}`)}`);
  return 0;
}

process.exit(await main());
