#!/usr/bin/env node
// Recipe management CLI. Zero dependencies.
//
//   node tools/recipes.mjs validate            check every recipe against the schema
//   node tools/recipes.mjs add-image <f> <id>  resize, strip metadata, install a photo
//   node tools/recipes.mjs check               validate plus the security gates
//
// The agent runs `check` before reporting a recipe added. If it does not pass, the
// recipe is not added.

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { loadRecipes, checkImagesExist, IMAGES_DIR } from './validate.mjs';
import { inspect, strip } from './exif.mjs';

const run = promisify(execFile);
const ESC = String.fromCharCode(27);
const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColour ? `${ESC}[${code}m${s}${ESC}[0m` : s);
const red = (s) => c(31, s);
const yellow = (s) => c(33, s);
const green = (s) => c(32, s);
const dim = (s) => c(2, s);
const bold = (s) => c(1, s);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function printReports(reports) {
  let errors = 0;
  let warnings = 0;
  for (const report of reports) {
    errors += report.errors.length;
    warnings += report.warnings.length;
    if (!report.errors.length && !report.warnings.length) continue;
    console.log(`\n${bold(report.file)}`);
    for (const { field, message } of report.errors) {
      console.log(`  ${red('error')}  ${field ? `${bold(field)} ` : ''}${message}`);
    }
    for (const { field, message } of report.warnings) {
      console.log(`  ${yellow('warn')}   ${field ? `${bold(field)} ` : ''}${message}`);
    }
  }
  return { errors, warnings };
}

async function validate() {
  const { recipes, reports } = await loadRecipes();
  await checkImagesExist(recipes, reports);
  const { errors, warnings } = printReports(reports);
  console.log('');
  if (errors) {
    console.log(`${red('FAIL')} ${plural(errors, 'error')}, ${plural(warnings, 'warning')} across ${plural(reports.length, 'recipe')}`);
    return 1;
  }
  const tail = warnings ? `, ${yellow(plural(warnings, 'warning'))}` : '';
  console.log(`${green('OK')} ${plural(reports.length, 'recipe')} valid${tail}`);
  return 0;
}

/** Long edge in pixels. Big enough for a tablet at 2x, small enough to stay in git. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 82;

async function addImage(sourceFile, slug) {
  if (!sourceFile || !slug) {
    console.error('usage: node tools/recipes.mjs add-image <source-image> <recipe-slug>');
    return 2;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    console.error(red(`"${slug}" is not a valid slug: lowercase letters, digits and hyphens only`));
    return 2;
  }

  const original = await readFile(sourceFile);
  const before = inspect(original);
  const target = path.join(IMAGES_DIR, `${slug}.jpg`);
  const temp = path.join(IMAGES_DIR, `.${slug}.tmp.jpg`);
  await mkdir(IMAGES_DIR, { recursive: true });

  // sips resizes and re-encodes, but it writes its own Exif and IPTC blocks on the way
  // out, so the strip pass below is doing real work rather than being defensive.
  try {
    await run('sips', [
      '-Z', String(MAX_EDGE),
      '-s', 'format', 'jpeg',
      '-s', 'formatOptions', String(JPEG_QUALITY),
      sourceFile, '--out', temp,
    ]);

    const resized = await readFile(temp);
    const cleaned = strip(resized);
    const after = inspect(cleaned);

    if (after.findings.length) {
      console.error(red('refusing to install the image: metadata survived stripping'));
      console.error(after.findings);
      return 1;
    }

    await writeFile(target, cleaned);

    const removed = [...new Set([...before.findings, ...inspect(resized).findings].map((f) => f.kind))];
    const hadGps = before.findings.some((f) => f.hasGps);
    const kb = (b) => `${(b / 1024).toFixed(0)} kB`;

    console.log(`${green('installed')} ${target}`);
    console.log(`  ${dim(`${kb(original.length)} to ${kb(cleaned.length)}, long edge capped at ${MAX_EDGE}px`)}`);
    console.log(`  ${dim(`metadata removed: ${removed.length ? removed.join(', ') : 'none present'}`)}`);
    if (hadGps) {
      console.log(`  ${yellow('note')} the original carried GPS coordinates. They are gone from the copy in ${IMAGES_DIR}/, but the source file still has them.`);
    }
    console.log(`\nNow reference it in recipes/${slug}.json:`);
    console.log(dim(`  "image": { "file": "${target}", "alt": "...", "source": "own-photo", "credit": null, "licence": null, "url": null }`));
    return 0;
  } finally {
    await rm(temp, { force: true });
  }
}

async function check() {
  const validateCode = await validate();
  console.log(`\n${bold('security gates')}`);
  const { runGates } = await import('./security.mjs');
  const securityCode = await runGates();
  return validateCode || securityCode;
}

const [command, ...args] = process.argv.slice(2);
const commands = {
  validate,
  'add-image': () => addImage(args[0], args[1]),
  check,
};

if (!commands[command]) {
  console.error('usage: node tools/recipes.mjs <validate | add-image <file> <slug> | check>');
  process.exit(2);
}
process.exit(await commands[command]());
