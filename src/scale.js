// Ingredient scaling.
//
// Lives in its own module so it can be unit tested in Node while also running in the
// browser. Pure functions, no DOM, no imports.
//
// This is the payoff for storing quantities as numbers rather than strings like "2g":
// changing the serving count rescales the whole ingredient list.

/* Every eighth is covered, because roundQuantity snaps spoon measures to eighths and
 * "1.88 tbsp" is not a thing anyone measures. Thirds are here for cup measures. */
const VULGAR = [
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [3 / 8, '⅜'],
  [1 / 2, '½'],
  [5 / 8, '⅝'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
  [7 / 8, '⅞'],
];

/** Units measured by count rather than mass or volume, so halves read better than decimals. */
const COUNTED = new Set([null, 'piece', 'clove', 'slice', 'sprig', 'stalk', 'bunch', 'head', 'can', 'packet', 'sheet']);

/** Units where cooks think in familiar fractions. */
const FRACTIONAL = new Set(['tsp', 'tbsp', 'cup']);

/** Units that take a plural. Metric abbreviations never do: it is 400 g, not 400 gs. */
const PLURALS = {
  cup: 'cups', clove: 'cloves', piece: 'pieces', slice: 'slices', sprig: 'sprigs',
  stalk: 'stalks', head: 'heads', can: 'cans', packet: 'packets', sheet: 'sheets',
  handful: 'handfuls', bunch: 'bunches', pinch: 'pinches',
};

/** Pluralise a unit for a given amount, so it reads as a recipe rather than as data. */
export function pluraliseUnit(unit, amount) {
  if (!unit) return unit;
  return amount > 1 && PLURALS[unit] ? PLURALS[unit] : unit;
}

/**
 * Round a scaled quantity to something a cook would actually measure.
 * Coarser as the number gets bigger, because 5 g on 400 g does not matter and
 * 0.25 tsp on 0.5 tsp does.
 */
export function roundQuantity(value, unit) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (COUNTED.has(unit ?? null)) {
    return value < 1 ? Math.max(0.5, Math.round(value * 2) / 2) : Math.round(value * 2) / 2;
  }
  if (FRACTIONAL.has(unit)) {
    if (value < 3) return Math.max(1 / 8, Math.round(value * 8) / 8);
    return Math.round(value * 4) / 4;
  }
  if (value >= 100) return Math.round(value / 5) * 5;
  if (value >= 10) return Math.round(value);
  if (value >= 1) return Math.round(value * 4) / 4;
  return Math.round(value * 100) / 100;
}

/** Scale then round in one step. */
export function scaleQuantity(quantity, factor, unit) {
  if (quantity === null || quantity === undefined) return null;
  return roundQuantity(quantity * factor, unit ?? null);
}

/** Render a number the way a recipe would print it, using fractions where they read better. */
export function formatQuantity(value, unit) {
  if (value === null || value === undefined) return '';
  if (Number.isInteger(value)) return String(value);

  const whole = Math.floor(value);
  const remainder = value - whole;
  const useFractions = FRACTIONAL.has(unit) || COUNTED.has(unit ?? null);

  if (useFractions) {
    for (const [fraction, glyph] of VULGAR) {
      if (Math.abs(remainder - fraction) < 0.01) {
        return whole ? `${whole}${glyph}` : glyph;
      }
    }
  }
  // Two decimal places at most, and no trailing zeroes.
  return String(Number(value.toFixed(2)));
}

/**
 * Format just the amount part of an ingredient, e.g. "800 g" or "1½ cups".
 * Shared by the build templates and the in-page scaler so the two cannot drift.
 */
export function formatAmount(item, factor = 1) {
  const scaled = scaleQuantity(item.quantity, factor, item.unit);
  if (scaled === null) return '';

  // Nobody writes 1200 g on a shopping list. Step up to the larger unit past 1000.
  const stepUp = { g: 'kg', ml: 'l' }[item.unit];
  if (stepUp && scaled >= 1000) {
    const larger = Number((scaled / 1000).toFixed(2));
    return `${larger} ${stepUp}`;
  }

  const unit = pluraliseUnit(item.unit, scaled);
  const amount = formatQuantity(scaled, item.unit);
  return unit && unit !== 'to taste' ? `${amount} ${unit}` : amount;
}

/**
 * Format one ingredient line at a given scale factor.
 * Falls back to the original wording when there is no quantity to scale, so lines like
 * "salt, to taste" survive untouched.
 */
export function formatIngredient(item, factor = 1) {
  const scaled = scaleQuantity(item.quantity, factor, item.unit);
  if (scaled === null) {
    // Nothing numeric to scale. The raw line is the most faithful thing to show.
    return { text: item.raw, note: null };
  }
  const amount = formatQuantity(scaled, item.unit);
  const unitWord = pluraliseUnit(item.unit, scaled);
  const unit = unitWord && unitWord !== 'to taste' ? ` ${unitWord}` : '';
  const suffix = item.unit === 'to taste' ? ', to taste' : '';
  return {
    text: `${amount}${unit} ${item.item}${suffix}`.replace(/\s+/g, ' ').trim(),
    note: item.note ?? null,
  };
}

/** Scale a nutrition block. Per-serving figures do not change when servings change. */
export function scaleServings(recipe, targetServings) {
  const factor = targetServings / recipe.servings;
  return { factor, servings: targetServings };
}
