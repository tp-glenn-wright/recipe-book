// Recipe schema validation.
//
// This is the contract. A recipe that passes here is guaranteed to render, scale and
// filter correctly, which is what lets the agent write recipe files unsupervised.
//
// Errors fail the build. Warnings do not, and exist for the open vocabularies (tags,
// cuisine) and for sanity checks that are indicative rather than certain, such as
// whether the stated energy matches the macros.

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  UNITS, MAIN_PROTEINS, COURSES, DIFFICULTIES, NUTRITION_SOURCES,
  SOURCE_KINDS, IMAGE_SOURCES, KNOWN_TAGS, KNOWN_CUISINES, NUTRIENTS,
} from './vocab.mjs';

export const RECIPES_DIR = 'recipes';
export const IMAGES_DIR = 'images';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const TOP_LEVEL_FIELDS = new Set([
  'schemaVersion', 'id', 'title', 'description', 'image', 'source',
  'added', 'updated', 'cuisine', 'course', 'mainProtein', 'tags',
  'rating', 'difficulty', 'prepMinutes', 'cookMinutes', 'totalMinutes',
  'servings', 'servingSizeG', 'equipment', 'ingredients', 'steps',
  'notes', 'nutrition',
]);

/** Collects findings against dotted field paths so messages point at the problem. */
class Report {
  constructor(file) {
    this.file = file;
    this.errors = [];
    this.warnings = [];
  }
  error(field, message) {
    this.errors.push({ field, message });
  }
  warn(field, message) {
    this.warnings.push({ field, message });
  }
  get ok() {
    return this.errors.length === 0;
  }
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
const isStr = (v) => typeof v === 'string';
const nonEmptyStr = (v) => isStr(v) && v.trim().length > 0;

function checkString(r, field, value, { max = 500, required = true, nullable = false } = {}) {
  if (value === null || value === undefined) {
    if (required && !nullable) r.error(field, 'is required');
    return false;
  }
  if (!isStr(value)) return r.error(field, `must be a string, got ${typeof value}`), false;
  if (required && value.trim() === '') return r.error(field, 'must not be blank'), false;
  if (value.length > max) return r.error(field, `must be at most ${max} characters, got ${value.length}`), false;
  return true;
}

function checkNumber(r, field, value, { min = 0, max = Infinity, integer = false, nullable = false } = {}) {
  if (value === null || value === undefined) {
    if (!nullable) r.error(field, 'is required');
    return false;
  }
  if (!isNum(value)) {
    // The single most common mistake is a unit-bearing string like "2g" or "15 mins".
    const hint = isStr(value) ? ` — write it as a number, not the string ${JSON.stringify(value)}` : '';
    return r.error(field, `must be a number, got ${typeof value}${hint}`), false;
  }
  if (integer && !isInt(value)) return r.error(field, `must be a whole number, got ${value}`), false;
  if (value < min) return r.error(field, `must be at least ${min}, got ${value}`), false;
  if (value > max) return r.error(field, `must be at most ${max}, got ${value}`), false;
  return true;
}

function checkEnum(r, field, value, allowed, { nullable = false } = {}) {
  if (value === null || value === undefined) {
    if (!nullable) r.error(field, `is required, one of: ${allowed.join(', ')}`);
    return false;
  }
  if (!allowed.includes(value)) {
    return r.error(field, `must be one of: ${allowed.join(', ')} — got ${JSON.stringify(value)}`), false;
  }
  return true;
}

function checkDate(r, field, value) {
  if (!checkString(r, field, value, { max: 10 })) return false;
  if (!ISO_DATE.test(value)) return r.error(field, `must be an ISO date, YYYY-MM-DD, got ${JSON.stringify(value)}`), false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return r.error(field, `is not a real date: ${value}`), false;
  return true;
}

function checkNutrients(r, field, block) {
  if (!isObject(block)) {
    r.error(field, 'must be an object with the nutrient fields');
    return false;
  }
  let ok = true;
  for (const key of NUTRIENTS) {
    if (!checkNumber(r, `${field}.${key}`, block[key], { min: 0 })) ok = false;
  }
  for (const key of Object.keys(block)) {
    if (!NUTRIENTS.includes(key)) r.error(`${field}.${key}`, 'is not a known nutrient field');
  }
  if (!ok) return false;

  if (block.sugarsG > block.carbsG + 0.01) {
    r.error(`${field}.sugarsG`, `cannot exceed carbohydrate (${block.sugarsG} > ${block.carbsG})`);
    ok = false;
  }
  if (block.saturatedFatG > block.fatG + 0.01) {
    r.error(`${field}.saturatedFatG`, `cannot exceed total fat (${block.saturatedFatG} > ${block.fatG})`);
    ok = false;
  }

  // kJ to kcal is a fixed conversion, so a mismatch is a mistake rather than an estimate.
  if (block.kcal > 0) {
    const expectedKj = block.kcal * 4.184;
    const drift = Math.abs(block.kj - expectedKj) / expectedKj;
    if (drift > 0.1) {
      r.error(`${field}.kj`, `does not match kcal: ${block.kj} kJ vs ${Math.round(expectedKj)} kJ expected from ${block.kcal} kcal`);
      ok = false;
    } else if (drift > 0.02) {
      r.warn(`${field}.kj`, `is ${(drift * 100).toFixed(1)}% off the kcal conversion (expected ~${Math.round(expectedKj)} kJ)`);
    }
  }

  // Atwater check. Inexact because of fibre, polyols and alcohol, so warn only, but it
  // reliably catches transposed macros.
  const fromMacros = 4 * block.proteinG + 4 * block.carbsG + 9 * block.fatG;
  if (block.kcal > 20 && fromMacros > 20) {
    const drift = Math.abs(block.kcal - fromMacros) / fromMacros;
    if (drift > 0.2) {
      r.warn(`${field}.kcal`, `is ${(drift * 100).toFixed(0)}% away from its macros (4P + 4C + 9F = ${Math.round(fromMacros)} kcal). Check for transposed values.`);
    }
  }
  return ok;
}

function checkIngredients(r, groups) {
  if (!Array.isArray(groups) || groups.length === 0) {
    r.error('ingredients', 'must be a non-empty array of ingredient groups');
    return;
  }
  groups.forEach((group, gi) => {
    const gp = `ingredients[${gi}]`;
    if (!isObject(group)) return void r.error(gp, 'must be an object with group and items');
    if (group.group !== null && !checkString(r, `${gp}.group`, group.group, { max: 80, nullable: true })) return;
    if (!Array.isArray(group.items) || group.items.length === 0) {
      return void r.error(`${gp}.items`, 'must be a non-empty array');
    }
    group.items.forEach((item, ii) => {
      const ip = `${gp}.items[${ii}]`;
      if (!isObject(item)) return void r.error(ip, 'must be an object');
      for (const key of Object.keys(item)) {
        if (!['quantity', 'unit', 'item', 'note', 'raw'].includes(key)) {
          r.error(`${ip}.${key}`, 'is not a known ingredient field');
        }
      }
      checkNumber(r, `${ip}.quantity`, item.quantity, { min: 0, nullable: true });
      checkEnum(r, `${ip}.unit`, item.unit, UNITS, { nullable: true });
      checkString(r, `${ip}.item`, item.item, { max: 120 });
      checkString(r, `${ip}.note`, item.note, { max: 200, nullable: true, required: false });
      checkString(r, `${ip}.raw`, item.raw, { max: 300 });
      // A quantity with no unit is fine ("2 onions"), but a unit with no quantity is not,
      // because the scaler has nothing to multiply.
      if (item.unit !== null && item.unit !== 'to taste' && item.quantity === null) {
        r.error(`${ip}.quantity`, `is required when unit is "${item.unit}"`);
      }
    });
  });
}

function checkSteps(r, steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    r.error('steps', 'must be a non-empty array');
    return;
  }
  steps.forEach((step, si) => {
    const sp = `steps[${si}]`;
    if (!isObject(step)) return void r.error(sp, 'must be an object with text and minutes');
    for (const key of Object.keys(step)) {
      if (!['text', 'minutes'].includes(key)) r.error(`${sp}.${key}`, 'is not a known step field');
    }
    checkString(r, `${sp}.text`, step.text, { max: 800 });
    checkNumber(r, `${sp}.minutes`, step.minutes, { min: 0, max: 2880, nullable: true });
  });
}

function checkImage(r, image) {
  if (image === null) return; // A recipe with no photo is normal and renders a placeholder.
  if (!isObject(image)) return void r.error('image', 'must be null or an object');
  for (const key of Object.keys(image)) {
    if (!['file', 'alt', 'source', 'credit', 'licence', 'url'].includes(key)) {
      r.error(`image.${key}`, 'is not a known image field');
    }
  }
  if (checkString(r, 'image.file', image.file, { max: 200 })) {
    if (!image.file.startsWith(`${IMAGES_DIR}/`)) {
      r.error('image.file', `must sit under ${IMAGES_DIR}/, got ${JSON.stringify(image.file)}`);
    }
    if (image.file.includes('..') || path.isAbsolute(image.file)) {
      r.error('image.file', 'must be a relative path inside the repo');
    }
  }
  // Alt text is not decoration. Screen readers and the offline fallback both use it.
  checkString(r, 'image.alt', image.alt, { max: 300 });
  checkEnum(r, 'image.source', image.source, IMAGE_SOURCES);
  if (image.source === 'web' || image.source === 'ai-generated') {
    for (const key of ['credit', 'licence']) {
      if (!nonEmptyStr(image[key])) {
        r.error(`image.${key}`, `is required when image.source is "${image.source}" — an image whose licence you cannot state does not go on a public site`);
      }
    }
    if (image.source === 'web' && !nonEmptyStr(image.url)) {
      r.error('image.url', 'is required when image.source is "web", so the provenance is recorded');
    }
  }
}

/** Validate one parsed recipe. `filename` is used to check the id matches. */
export function validateRecipe(recipe, filename) {
  const r = new Report(filename);
  if (!isObject(recipe)) {
    r.error('', 'file must contain a JSON object');
    return r;
  }

  for (const key of Object.keys(recipe)) {
    if (!TOP_LEVEL_FIELDS.has(key)) {
      r.error(key, `is not part of the schema. Known fields: ${[...TOP_LEVEL_FIELDS].join(', ')}`);
    }
  }

  if (recipe.schemaVersion !== 1) {
    r.error('schemaVersion', `must be 1, got ${JSON.stringify(recipe.schemaVersion)}`);
  }

  if (checkString(r, 'id', recipe.id, { max: 80 })) {
    if (!SLUG.test(recipe.id)) {
      r.error('id', `must be a lowercase hyphenated slug, got ${JSON.stringify(recipe.id)}`);
    }
    const expected = path.basename(filename, '.json');
    if (recipe.id !== expected) {
      r.error('id', `must match the filename: expected ${JSON.stringify(expected)}, got ${JSON.stringify(recipe.id)}`);
    }
  }

  checkString(r, 'title', recipe.title, { max: 120 });
  checkString(r, 'description', recipe.description, { max: 400 });
  checkImage(r, recipe.image);

  if (!isObject(recipe.source)) {
    r.error('source', 'must be an object with kind, citation and url');
  } else {
    checkEnum(r, 'source.kind', recipe.source.kind, SOURCE_KINDS);
    checkString(r, 'source.citation', recipe.source.citation, { max: 300, nullable: true, required: false });
    checkString(r, 'source.url', recipe.source.url, { max: 500, nullable: true, required: false });
  }

  const addedOk = checkDate(r, 'added', recipe.added);
  const updatedOk = checkDate(r, 'updated', recipe.updated);
  if (addedOk && updatedOk && recipe.updated < recipe.added) {
    r.error('updated', `cannot be before added (${recipe.updated} < ${recipe.added})`);
  }

  if (recipe.cuisine !== null && checkString(r, 'cuisine', recipe.cuisine, { max: 60, nullable: true })) {
    if (!KNOWN_CUISINES.includes(recipe.cuisine)) {
      r.warn('cuisine', `${JSON.stringify(recipe.cuisine)} is new. Add it to KNOWN_CUISINES in tools/vocab.mjs if it is a keeper.`);
    }
  }

  if (!Array.isArray(recipe.course) || recipe.course.length === 0) {
    r.error('course', `must be a non-empty array, one or more of: ${COURSES.join(', ')}`);
  } else {
    recipe.course.forEach((c, i) => checkEnum(r, `course[${i}]`, c, COURSES));
  }

  checkEnum(r, 'mainProtein', recipe.mainProtein, MAIN_PROTEINS);
  checkEnum(r, 'difficulty', recipe.difficulty, DIFFICULTIES);

  if (!Array.isArray(recipe.tags)) {
    r.error('tags', 'must be an array, possibly empty');
  } else {
    recipe.tags.forEach((t, i) => {
      if (!checkString(r, `tags[${i}]`, t, { max: 40 })) return;
      if (!SLUG.test(t)) r.error(`tags[${i}]`, `must be a lowercase hyphenated slug, got ${JSON.stringify(t)}`);
      else if (!KNOWN_TAGS.includes(t)) {
        r.warn(`tags[${i}]`, `${JSON.stringify(t)} is new. Add it to KNOWN_TAGS in tools/vocab.mjs, or reuse an existing tag, so the list does not fragment.`);
      }
    });
    const dupes = recipe.tags.filter((t, i) => recipe.tags.indexOf(t) !== i);
    if (dupes.length) r.error('tags', `contains duplicates: ${[...new Set(dupes)].join(', ')}`);
  }

  checkNumber(r, 'rating', recipe.rating, { min: 1, max: 5, integer: true, nullable: true });
  const prepOk = checkNumber(r, 'prepMinutes', recipe.prepMinutes, { min: 0, max: 10080, integer: true });
  const cookOk = checkNumber(r, 'cookMinutes', recipe.cookMinutes, { min: 0, max: 10080, integer: true });
  const totalOk = checkNumber(r, 'totalMinutes', recipe.totalMinutes, { min: 1, max: 20160, integer: true });
  if (prepOk && cookOk && totalOk) {
    const hands = recipe.prepMinutes + recipe.cookMinutes;
    if (recipe.totalMinutes < hands) {
      r.error('totalMinutes', `cannot be less than prep + cook (${recipe.totalMinutes} < ${hands})`);
    } else if (recipe.totalMinutes > hands * 3 && recipe.totalMinutes - hands > 120) {
      r.warn('totalMinutes', `is much larger than prep + cook (${recipe.totalMinutes} vs ${hands}). Fine if there is resting or marinating time, otherwise check it.`);
    }
  }

  const servingsOk = checkNumber(r, 'servings', recipe.servings, { min: 1, max: 200, integer: true });
  const sizeOk = checkNumber(r, 'servingSizeG', recipe.servingSizeG, { min: 1, max: 5000, nullable: true });

  if (!Array.isArray(recipe.equipment)) r.error('equipment', 'must be an array, possibly empty');
  else recipe.equipment.forEach((e, i) => checkString(r, `equipment[${i}]`, e, { max: 80 }));

  if (!Array.isArray(recipe.notes)) r.error('notes', 'must be an array, possibly empty');
  else recipe.notes.forEach((n, i) => checkString(r, `notes[${i}]`, n, { max: 600 }));

  checkIngredients(r, recipe.ingredients);
  checkSteps(r, recipe.steps);

  if (!isObject(recipe.nutrition)) {
    r.error('nutrition', 'is required. If the source gives none, estimate it from the ingredients and set source to "estimated".');
  } else {
    for (const key of Object.keys(recipe.nutrition)) {
      if (!['source', 'assumptions', 'perServing', 'per100g'].includes(key)) {
        r.error(`nutrition.${key}`, 'is not a known nutrition field');
      }
    }
    checkEnum(r, 'nutrition.source', recipe.nutrition.source, NUTRITION_SOURCES);
    if (recipe.nutrition.source === 'estimated' || recipe.nutrition.source === 'calculated') {
      if (!nonEmptyStr(recipe.nutrition.assumptions)) {
        r.error('nutrition.assumptions', `is required when nutrition.source is "${recipe.nutrition.source}", so the guesswork is visible rather than implied`);
      }
    }
    checkString(r, 'nutrition.assumptions', recipe.nutrition.assumptions, { max: 600, nullable: true, required: false });

    const psOk = checkNutrients(r, 'nutrition.perServing', recipe.nutrition.perServing);
    const p100Ok = checkNutrients(r, 'nutrition.per100g', recipe.nutrition.per100g);

    // The two bases must describe the same food. This is the check that catches a model
    // filling in per100g by eye instead of dividing.
    if (psOk && p100Ok && sizeOk && servingsOk && recipe.servingSizeG) {
      const factor = recipe.servingSizeG / 100;
      for (const key of NUTRIENTS) {
        const expected = recipe.nutrition.per100g[key] * factor;
        const actual = recipe.nutrition.perServing[key];
        if (expected < 1 && actual < 1) continue;
        const drift = Math.abs(actual - expected) / Math.max(expected, 1);
        if (drift > 0.1) {
          r.error(
            `nutrition.perServing.${key}`,
            `is inconsistent with per100g: ${actual} vs ${expected.toFixed(1)} expected from ${recipe.nutrition.per100g[key]} per 100 g at a ${recipe.servingSizeG} g serving`,
          );
        } else if (drift > 0.05) {
          r.warn(`nutrition.perServing.${key}`, `is ${(drift * 100).toFixed(1)}% off the per100g figure`);
        }
      }
    } else if (psOk && p100Ok && !recipe.servingSizeG) {
      r.warn('servingSizeG', 'is null, so perServing and per100g cannot be cross-checked. Set it if you can.');
    }
  }

  return r;
}

/** Read and parse every recipe file. Parse failures come back as reports, not throws. */
export async function loadRecipes(dir = RECIPES_DIR) {
  const entries = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const recipes = [];
  const reports = [];
  for (const filename of entries) {
    const full = path.join(dir, filename);
    let parsed;
    try {
      parsed = JSON.parse(await readFile(full, 'utf8'));
    } catch (err) {
      const r = new Report(filename);
      r.error('', `is not valid JSON: ${err.message}`);
      reports.push(r);
      continue;
    }
    const report = validateRecipe(parsed, filename);
    reports.push(report);
    if (report.ok) recipes.push(parsed);
  }
  return { recipes, reports };
}

/** Confirm every referenced image is actually on disk. Filesystem checks live here so
 *  validateRecipe stays pure and testable. */
export async function checkImagesExist(recipes, reports) {
  for (const recipe of recipes) {
    if (!recipe.image?.file) continue;
    const report = reports.find((r) => r.file === `${recipe.id}.json`);
    try {
      const info = await stat(recipe.image.file);
      if (!info.isFile()) report?.error('image.file', `${recipe.image.file} is not a file`);
    } catch {
      report?.error('image.file', `${recipe.image.file} does not exist on disk`);
    }
  }
}
