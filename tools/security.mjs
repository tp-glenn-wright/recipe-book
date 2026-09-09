#!/usr/bin/env node
// Security gates. Zero dependencies.
//
// Four things are enforced here, each because of a specific risk rather than a
// checklist:
//
//   1. Dependency gate. This project has no dependencies. Adding one has to be a
//      deliberate act with a commit behind it, not something that arrives with a
//      convenience install. It is also what makes `npm audit` a meaningful pass.
//   2. Unsafe DOM gate. Recipe text comes out of a photograph via a model, so it is
//      untrusted. If it reaches the page as HTML there is a script injection path.
//   3. Image metadata gate. Phone photos carry GPS. This repo is public.
//   4. Built output gate. Confirms the CSP actually shipped, that nothing inline or
//      external crept into the HTML, and that no absolute origin is referenced.
//
// Note: this file is excluded from the unsafe DOM scan, because it necessarily
// contains the forbidden patterns as literals. It is therefore the one file where a
// reviewer should read the code rather than trust the gate.

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { inspect } from './exif.mjs';

const ESC = String.fromCharCode(27);
const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColour ? `${ESC}[${code}m${s}${ESC}[0m` : s);
const red = (s) => c(31, s);
const green = (s) => c(32, s);
const dim = (s) => c(2, s);

/* Two files are exempt from the unsafe DOM scan, and both for the same reason: they
 * contain the forbidden patterns as data rather than as code that runs against a page.
 * security.mjs holds the pattern list, and test.mjs asserts that the list catches them.
 * Neither ships to the browser nor builds a page. They are therefore the two files a
 * reviewer should read rather than trust the gate on. */
const SCAN_EXEMPT = [/(?:^|[\\/])security\.mjs$/, /(?:^|[\\/])test\.mjs$/, /\.test\.mjs$/];

/** Patterns that turn a string into executable code or markup. Exported for tests. */
export const UNSAFE_PATTERNS = [
  { pattern: /\.innerHTML\s*=/, name: 'innerHTML assignment', why: 'parses untrusted recipe text as HTML. Use textContent.' },
  { pattern: /\.outerHTML\s*=/, name: 'outerHTML assignment', why: 'parses untrusted recipe text as HTML. Build nodes instead.' },
  { pattern: /insertAdjacentHTML/, name: 'insertAdjacentHTML', why: 'parses untrusted recipe text as HTML. Use insertAdjacentElement.' },
  { pattern: /document\.write/, name: 'document.write', why: 'parses a string as HTML and blocks parsing.' },
  { pattern: /\beval\s*\(/, name: 'eval', why: 'executes a string as code.' },
  { pattern: /new\s+Function\s*\(/, name: 'new Function', why: 'executes a string as code.' },
  { pattern: /\b(?:setTimeout|setInterval)\s*\(\s*['"`]/, name: 'string-form timer', why: 'executes a string as code.' },
  { pattern: /dangerouslySetInnerHTML/, name: 'dangerouslySetInnerHTML', why: 'parses untrusted content as HTML.' },
];

/** Recursively list files under a directory, skipping dot-directories. */
async function walk(dir, filter = () => true) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full, filter)));
    else if (filter(full)) found.push(full);
  }
  return found;
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function dependencyGate() {
  const failures = [];
  const pkgRaw = await readFile('package.json', 'utf8').catch(() => null);
  if (pkgRaw) {
    let pkg;
    try {
      pkg = JSON.parse(pkgRaw);
    } catch (err) {
      failures.push(`package.json is not valid JSON: ${err.message}`);
      return failures;
    }
    const fields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'bundledDependencies', 'bundleDependencies'];
    for (const field of fields) {
      const value = pkg[field];
      const names = Array.isArray(value) ? value : Object.keys(value ?? {});
      if (names.length) {
        failures.push(
          `package.json declares ${field}: ${names.join(', ')}. This project is zero-dependency by design. ` +
          'If the dependency is genuinely needed, remove this gate in the same commit and say why in the message.',
        );
      }
    }
  }

  const lockRaw = await readFile('package-lock.json', 'utf8').catch(() => null);
  if (lockRaw) {
    try {
      const lock = JSON.parse(lockRaw);
      const installed = Object.keys(lock.packages ?? {}).filter((k) => k !== '');
      if (installed.length) {
        failures.push(`package-lock.json contains ${installed.length} installed package(s): ${installed.slice(0, 5).join(', ')}${installed.length > 5 ? ', ...' : ''}`);
      }
    } catch (err) {
      failures.push(`package-lock.json is not valid JSON: ${err.message}`);
    }
  }

  for (const lock of ['yarn.lock', 'pnpm-lock.yaml', 'bun.lockb']) {
    if (await exists(lock)) failures.push(`${lock} exists. This project uses npm and has no dependencies.`);
  }

  return failures;
}

async function unsafeDomGate() {
  const failures = [];
  const files = [
    ...(await walk('src', (f) => /\.(js|mjs|html|css)$/.test(f))),
    ...(await walk('tools', (f) => /\.mjs$/.test(f))),
  ].filter((f) => !SCAN_EXEMPT.some((pattern) => pattern.test(path.normalize(f))));

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const lines = source.split('\n');
    for (const { pattern, name, why } of UNSAFE_PATTERNS) {
      lines.forEach((line, i) => {
        if (pattern.test(line)) {
          failures.push(`${file}:${i + 1} uses ${name}, which ${why}`);
        }
      });
    }
  }
  return failures;
}

async function imageMetadataGate() {
  const failures = [];
  const images = await walk('images');
  for (const file of images) {
    if (!/\.(jpe?g|png)$/i.test(file)) {
      failures.push(`${file} is not a JPEG or PNG. Convert it with "node tools/recipes.mjs add-image" so it can be inspected.`);
      continue;
    }
    const buf = await readFile(file);
    let result;
    try {
      result = inspect(buf);
    } catch (err) {
      failures.push(`${file} cannot be inspected: ${err.message}`);
      continue;
    }
    for (const finding of result.findings) {
      const gps = finding.hasGps ? ' and it contains GPS coordinates' : '';
      failures.push(
        `${file} carries ${finding.kind} metadata (${finding.bytes} bytes)${gps}. ` +
        'Reinstall it with "node tools/recipes.mjs add-image <file> <slug>", which strips metadata.',
      );
    }
  }
  return failures;
}

// Only two shapes are allowed: an external module, and a JSON-LD data block.
const ALLOWED_SCRIPT = /^<script(?:\s+src="[^"]*"|\s+type="(?:module|application\/ld\+json)"|\s+defer|\s+async|\s+crossorigin)*\s*>$/i;

async function builtOutputGate() {
  const failures = [];
  if (!(await exists('dist'))) return { skipped: 'dist/ not built yet', failures };
  const pages = await walk('dist', (f) => f.endsWith('.html'));
  if (!pages.length) failures.push('dist/ exists but contains no HTML. Did the build fail?');

  for (const page of pages) {
    const source = await readFile(page, 'utf8');

    if (!/http-equiv="Content-Security-Policy"/.test(source)) {
      failures.push(`${page} has no Content-Security-Policy meta tag.`);
    }

    // Inline event handlers would need script-src 'unsafe-inline' to run, so their
    // presence means either dead markup or a CSP about to be loosened.
    //
    // Attribute values are blanked out first. Escaped recipe text can legitimately
    // contain the characters ` onload=` inside a quoted value, where it is inert;
    // scanning the raw tag would flag that as a handler and be wrong.
    for (const tag of source.match(/<[a-z][^>]*>/gi) ?? []) {
      const withoutValues = tag.replace(/="[^"]*"/g, '=""').replace(/='[^']*'/g, "=''");
      const handler = withoutValues.match(/\son([a-z]+)\s*=/i);
      if (handler) failures.push(`${page} has an inline ${handler[1]} handler: ${tag.slice(0, 80)}`);
    }

    // Only external scripts and JSON-LD data blocks are permitted.
    for (const tag of source.match(/<script[^>]*>/gi) ?? []) {
      if (!ALLOWED_SCRIPT.test(tag)) {
        failures.push(`${page} has a script tag that is neither external nor JSON-LD: ${tag}`);
      }
    }

    // Every asset must be first-party. No CDN, no font host, no analytics.
    for (const match of source.matchAll(/\b(src|href)="([^"]*)"/gi)) {
      const value = match[2];
      if (/^(?:https?:)?\/\//i.test(value)) {
        failures.push(`${page} references an external origin in ${match[1]}="${value}". Everything must be first-party so the CSP can stay closed.`);
      }
    }
  }
  return failures;
}

const GATES = [
  ['dependencies', dependencyGate],
  ['unsafe DOM', unsafeDomGate],
  ['image metadata', imageMetadataGate],
  ['built output', builtOutputGate],
];

/** Run every gate. Returns 0 if all pass, 1 otherwise. */
export async function runGates() {
  let failed = 0;
  for (const [name, gate] of GATES) {
    const result = await gate();
    const failures = Array.isArray(result) ? result : result.failures;
    const skipped = Array.isArray(result) ? null : result.skipped;
    if (failures.length) {
      failed += failures.length;
      console.log(`  ${red('FAIL')} ${name}`);
      for (const failure of failures) console.log(`         ${failure}`);
    } else if (skipped) {
      console.log(`  ${dim(`skip ${name} (${skipped})`)}`);
    } else {
      console.log(`  ${green('pass')} ${name}`);
    }
  }
  if (failed) {
    console.log(`\n${red('FAIL')} ${failed} security finding${failed === 1 ? '' : 's'}`);
    return 1;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await runGates());
}
