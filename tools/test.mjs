// Test suite. Run with: node --test tools/
//
// Uses the built-in test runner, so there is nothing to install. The tests that matter
// most are the security ones: an escaping helper or a metadata stripper that silently
// stops working is worse than not having one, because the gate still reports a pass.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { html, raw, render, escapeHtml, jsonLd } from './html.mjs';
import { inspect, strip } from './exif.mjs';
import { validateRecipe } from './validate.mjs';
import { UNSAFE_PATTERNS } from './security.mjs';
import { roundQuantity, formatQuantity, formatIngredient, formatAmount, pluraliseUnit } from '../src/scale.js';

// ---------------------------------------------------------------------------
// HTML escaping. Recipe text comes from a photo via a model, so this is the
// boundary between untrusted content and the page.
// ---------------------------------------------------------------------------

describe('html escaping', () => {
  const payload = '<img src=x onerror="alert(1)">';

  test('escapes interpolated values', () => {
    assert.equal(render(html`<p>${payload}</p>`), '<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>');
  });

  test('escapes every character that matters', () => {
    assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  });

  test('escapes inside quoted attributes', () => {
    const out = render(html`<a title="${'" onmouseover="alert(1)'}">x</a>`);
    assert.ok(!out.includes('onmouseover="alert'), out);
  });

  test('nests without double escaping', () => {
    assert.equal(render(html`<div>${html`<b>${'a&b'}</b>`}</div>`), '<div><b>a&amp;b</b></div>');
  });

  test('joins arrays', () => {
    assert.equal(render(html`${['a', '<b>'].map((x) => html`<li>${x}</li>`)}`), '<li>a</li><li>&lt;b&gt;</li>');
  });

  test('renders nullish as empty, but keeps zero', () => {
    assert.equal(render(html`[${null}${undefined}${false}${0}]`), '[0]');
  });

  test('raw() is the only bypass', () => {
    assert.equal(render(html`${raw('<em>ok</em>')}`), '<em>ok</em>');
  });

  test('jsonLd cannot break out of a script element', () => {
    const out = render(jsonLd({ evil: '</script><script>alert(1)</script>' }));
    assert.ok(!out.includes('</script'), out);
    assert.ok(out.includes('\\u003c/script\\u003e'), out);
  });

  test('jsonLd escapes the JS-illegal line separators', () => {
    const out = render(jsonLd({ s: `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c` }));
    assert.ok(!out.includes(String.fromCharCode(0x2028)));
    assert.ok(!out.includes(String.fromCharCode(0x2029)));
  });
});

// ---------------------------------------------------------------------------
// Image metadata. The fixtures are real files carrying real metadata, including a
// GPS IFD, because this is the gate that stops the repo publishing a home address.
// They deliberately live outside images/ so the metadata gate does not flag them.
// ---------------------------------------------------------------------------

describe('image metadata', () => {
  const jpeg = readFileSync(new URL('./fixtures/with-metadata.jpg', import.meta.url));
  const png = readFileSync(new URL('./fixtures/with-metadata.png', import.meta.url));

  test('detects JPEG Exif, IPTC and GPS', () => {
    const { format, findings } = inspect(jpeg);
    assert.equal(format, 'jpeg');
    const kinds = findings.map((f) => f.kind);
    assert.ok(kinds.includes('exif'), kinds.join(','));
    assert.ok(kinds.includes('iptc'), kinds.join(','));
    assert.ok(findings.some((f) => f.hasGps), 'GPS not detected in JPEG fixture');
  });

  test('detects PNG text and eXIf GPS', () => {
    const { format, findings } = inspect(png);
    assert.equal(format, 'png');
    assert.deepEqual(findings.map((f) => f.kind).sort(), ['png-eXIf', 'png-tEXt']);
    assert.ok(findings.some((f) => f.hasGps), 'GPS not detected in PNG fixture');
  });

  test('stripping leaves no metadata in either format', () => {
    assert.deepEqual(inspect(strip(jpeg)).findings, []);
    assert.deepEqual(inspect(strip(png)).findings, []);
  });

  test('stripping preserves the image structure', () => {
    const out = strip(jpeg);
    assert.equal(out.readUInt16BE(0), 0xffd8, 'lost the JPEG start marker');
    assert.equal(out.readUInt16BE(out.length - 2), 0xffd9, 'lost the JPEG end marker');
    assert.ok(out.length < jpeg.length, 'nothing was removed');

    const pngOut = strip(png);
    assert.ok(pngOut.subarray(0, 8).equals(png.subarray(0, 8)), 'lost the PNG signature');
    assert.ok(pngOut.includes(Buffer.from('IDAT')), 'lost the PNG image data');
    assert.ok(pngOut.includes(Buffer.from('IEND')), 'lost the PNG end chunk');
  });

  test('stripping is idempotent', () => {
    assert.ok(strip(strip(jpeg)).equals(strip(jpeg)));
  });

  test('refuses a format it cannot inspect', () => {
    assert.throws(() => inspect(Buffer.from('GIF89a not really')), /unsupported image format/);
    assert.throws(() => strip(Buffer.from('GIF89a not really')), /unsupported image format/);
  });
});

// ---------------------------------------------------------------------------
// The unsafe DOM patterns, checked against the constructs they exist to catch.
// ---------------------------------------------------------------------------

describe('unsafe DOM patterns', () => {
  const shouldMatch = [
    'node.innerHTML = recipe.title;',
    'el.outerHTML = x;',
    'el.insertAdjacentHTML("beforeend", s);',
    'document.write(s);',
    'eval(userInput);',
    'const f = new Function("return 1");',
    'setTimeout("doThing()", 10);',
    '<div dangerouslySetInnerHTML={{ __html: s }} />',
  ];
  const shouldNotMatch = [
    'node.textContent = recipe.title;',
    'const html = renderCard(recipe);',
    'setTimeout(() => refresh(), 10);',
    'el.append(document.createTextNode(text));',
    'const evaluated = score(recipe);',
  ];

  for (const line of shouldMatch) {
    test(`flags: ${line}`, () => {
      assert.ok(UNSAFE_PATTERNS.some((p) => p.pattern.test(line)), 'not flagged');
    });
  }
  for (const line of shouldNotMatch) {
    test(`allows: ${line}`, () => {
      const hit = UNSAFE_PATTERNS.find((p) => p.pattern.test(line));
      assert.ok(!hit, `false positive from ${hit?.name}`);
    });
  }
});

// ---------------------------------------------------------------------------
// Schema validation.
// ---------------------------------------------------------------------------

/** A recipe that must pass cleanly. Every rejection test mutates a copy of this. */
function baseRecipe() {
  return {
    schemaVersion: 1,
    id: 'beef-rendang',
    title: 'Beef Rendang',
    description: 'Slow-cooked dry curry, deeply spiced, better the next day.',
    image: null,
    source: { kind: 'book', citation: 'Sri Owen, Indonesian Regional Cooking', url: null },
    added: '2026-09-09',
    updated: '2026-09-09',
    cuisine: 'Indonesian',
    course: ['main'],
    mainProtein: 'beef',
    tags: ['slow-cook', 'spicy', 'gluten-free'],
    rating: 4,
    difficulty: 'medium',
    prepMinutes: 30,
    cookMinutes: 180,
    totalMinutes: 210,
    servings: 6,
    servingSizeG: 250,
    equipment: ['heavy casserole'],
    ingredients: [
      {
        group: 'Spice paste',
        items: [
          { quantity: 6, unit: 'clove', item: 'garlic', note: 'peeled', raw: '6 cloves garlic, peeled' },
          { quantity: 400, unit: 'ml', item: 'coconut cream', note: null, raw: '1 tin coconut cream' },
        ],
      },
    ],
    steps: [{ text: 'Blitz the paste ingredients to a smooth puree.', minutes: 10 }],
    notes: ['Freezes well for three months.'],
    nutrition: {
      source: 'estimated',
      assumptions: '1.5 kg chuck yielding roughly 1.1 kg cooked, six 250 g servings.',
      perServing: { kj: 2100, kcal: 502, proteinG: 34, fatG: 32, saturatedFatG: 18, carbsG: 12, sugarsG: 6, fibreG: 3, sodiumMg: 620 },
      per100g: { kj: 840, kcal: 201, proteinG: 13.6, fatG: 12.8, saturatedFatG: 7.2, carbsG: 4.8, sugarsG: 2.4, fibreG: 1.2, sodiumMg: 248 },
    },
  };
}

const FILE = 'beef-rendang.json';
const check = (mutate) => {
  const recipe = baseRecipe();
  mutate(recipe);
  return validateRecipe(recipe, FILE);
};

describe('validation accepts a correct recipe', () => {
  test('no errors and no warnings', () => {
    const report = validateRecipe(baseRecipe(), FILE);
    assert.deepEqual(report.errors, [], JSON.stringify(report.errors, null, 2));
    assert.deepEqual(report.warnings, [], JSON.stringify(report.warnings, null, 2));
  });
});

describe('validation rejects', () => {
  const rejections = [
    ['a quantity written as a string', (r) => { r.ingredients[0].items[0].quantity = '6 cloves'; }, /must be a number.*not the string/],
    ['a unit outside the vocabulary', (r) => { r.ingredients[0].items[0].unit = 'dollop'; }, /must be one of/],
    ['a unit with no quantity to scale', (r) => { r.ingredients[0].items[0].quantity = null; }, /is required when unit is/],
    ['an id that does not match the filename', (r) => { r.id = 'something-else'; }, /must match the filename/],
    ['an id that is not a slug', (r) => { r.id = 'Beef Rendang'; }, /lowercase hyphenated slug/],
    ['an unknown top-level field', (r) => { r.calories = 500; }, /is not part of the schema/],
    ['a missing nutrition block', (r) => { delete r.nutrition; }, /is required.*estimate it from the ingredients/],
    ['estimated nutrition with no assumptions', (r) => { r.nutrition.assumptions = null; }, /is required when nutrition.source/],
    ['per100g inconsistent with perServing', (r) => { r.nutrition.per100g.proteinG = 30; }, /is inconsistent with per100g/],
    ['kJ that does not match kcal', (r) => { r.nutrition.perServing.kj = 900; }, /does not match kcal/],
    ['sugars exceeding carbohydrate', (r) => { r.nutrition.perServing.sugarsG = 20; }, /cannot exceed carbohydrate/],
    ['saturated fat exceeding total fat', (r) => { r.nutrition.perServing.saturatedFatG = 40; }, /cannot exceed total fat/],
    ['an unknown nutrient field', (r) => { r.nutrition.perServing.cholesterolMg = 40; }, /is not a known nutrient field/],
    ['a total shorter than prep plus cook', (r) => { r.totalMinutes = 60; }, /cannot be less than prep \+ cook/],
    ['duplicate tags', (r) => { r.tags.push('spicy'); }, /contains duplicates/],
    ['a tag that is not a slug', (r) => { r.tags.push('Slow Cook'); }, /lowercase hyphenated slug/],
    ['an update date before the added date', (r) => { r.updated = '2026-01-01'; }, /cannot be before added/],
    ['a malformed date', (r) => { r.added = '09/09/2026'; }, /must be an ISO date/],
    ['no steps', (r) => { r.steps = []; }, /must be a non-empty array/],
    ['no ingredients', (r) => { r.ingredients = []; }, /must be a non-empty array/],
    ['no course', (r) => { r.course = []; }, /must be a non-empty array/],
    ['a course outside the vocabulary', (r) => { r.course = ['elevenses']; }, /must be one of/],
    ['a protein outside the vocabulary', (r) => { r.mainProtein = 'unicorn'; }, /must be one of/],
    ['a rating out of range', (r) => { r.rating = 9; }, /must be at most 5/],
    ['zero servings', (r) => { r.servings = 0; }, /must be at least 1/],
    ['the wrong schema version', (r) => { r.schemaVersion = 2; }, /must be 1/],
    ['an image path outside images/', (r) => { r.image = { file: 'photos/x.jpg', alt: 'x', source: 'own-photo', credit: null, licence: null, url: null }; }, /must sit under images\//],
    ['a web image with no licence', (r) => { r.image = { file: 'images/x.jpg', alt: 'x', source: 'web', credit: 'Someone', licence: null, url: 'https://example.com' }; }, /licence.*is required/],
    ['a web image with no provenance url', (r) => { r.image = { file: 'images/x.jpg', alt: 'x', source: 'web', credit: 'Someone', licence: 'CC BY 4.0', url: null }; }, /is required when image.source is "web"/],
    ['an image with no alt text', (r) => { r.image = { file: 'images/x.jpg', alt: '', source: 'own-photo', credit: null, licence: null, url: null }; }, /must not be blank/],
  ];

  for (const [name, mutate, expected] of rejections) {
    test(name, () => {
      const report = check(mutate);
      assert.ok(report.errors.length > 0, 'expected at least one error');
      const messages = report.errors.map((e) => `${e.field} ${e.message}`).join('\n');
      assert.match(messages, expected);
    });
  }
});

describe('validation warns without failing', () => {
  const warnings = [
    ['a new tag', (r) => { r.tags.push('umami-bomb'); }, /is new/],
    ['a new cuisine', (r) => { r.cuisine = 'Faroese'; }, /is new/],
    ['no serving size, so the two bases cannot be cross-checked', (r) => { r.servingSizeG = null; }, /cannot be cross-checked/],
  ];
  for (const [name, mutate, expected] of warnings) {
    test(name, () => {
      const report = check(mutate);
      assert.deepEqual(report.errors, [], JSON.stringify(report.errors));
      assert.match(report.warnings.map((w) => `${w.field} ${w.message}`).join('\n'), expected);
    });
  }

  test('macros that cannot produce the stated energy', () => {
    // 34 g protein, 12 g carbs and 5 g fat comes to roughly 229 kcal, not 502. This is
    // the check that catches a macro dropped, doubled or written into the wrong field.
    const report = check((r) => {
      r.nutrition.perServing.fatG = 5;
      r.nutrition.perServing.saturatedFatG = 3;
      r.nutrition.per100g.fatG = 2;
      r.nutrition.per100g.saturatedFatG = 1.2;
    });
    assert.deepEqual(report.errors, [], JSON.stringify(report.errors));
    assert.match(report.warnings.map((w) => w.message).join('\n'), /away from its macros/);
  });
});

// ---------------------------------------------------------------------------
// Scaling. The reason quantities are numbers rather than strings.
// ---------------------------------------------------------------------------

describe('scaling', () => {
  test('rounds mass to something measurable', () => {
    assert.equal(roundQuantity(933.3, 'g'), 935);
    assert.equal(roundQuantity(42.4, 'g'), 42);
    assert.equal(roundQuantity(3.3, 'g'), 3.25);
    assert.equal(roundQuantity(0.44, 'g'), 0.44);
  });

  test('rounds spoons to eighths, then quarters', () => {
    assert.equal(roundQuantity(0.51, 'tsp'), 0.5);
    assert.equal(roundQuantity(0.7, 'tsp'), 0.75);
    assert.equal(roundQuantity(4.3, 'tbsp'), 4.25);
  });

  test('rounds counted things to halves and never to zero', () => {
    assert.equal(roundQuantity(1.4, null), 1.5);
    assert.equal(roundQuantity(0.2, 'clove'), 0.5);
    assert.equal(roundQuantity(2.6, 'piece'), 2.5);
  });

  test('formats familiar fractions as glyphs', () => {
    assert.equal(formatQuantity(1.5, 'cup'), '1½');
    assert.equal(formatQuantity(0.75, 'tsp'), '¾');
    assert.equal(formatQuantity(0.25, 'tsp'), '¼');
    assert.equal(formatQuantity(2, 'cup'), '2');
  });

  test('formats every eighth a spoon measure can land on', () => {
    const eighths = [
      [0.125, '⅛'], [0.25, '¼'], [0.375, '⅜'], [0.5, '½'],
      [0.625, '⅝'], [0.75, '¾'], [0.875, '⅞'],
    ];
    for (const [value, glyph] of eighths) {
      assert.equal(formatQuantity(value, 'tbsp'), glyph, `${value} tbsp`);
      assert.equal(formatQuantity(1 + value, 'tbsp'), `1${glyph}`, `1+${value} tbsp`);
    }
  });

  test('scaling 2 tbsp by 23/24 reads as a fraction, not a decimal', () => {
    const item = { quantity: 2, unit: 'tbsp', item: 'golden syrup', note: null, raw: '2 tbsp golden syrup' };
    assert.equal(formatIngredient(item, 23 / 24).text, '1⅞ tbsp golden syrup');
  });

  test('formats mass as plain numbers, not fractions', () => {
    assert.equal(formatQuantity(1.5, 'g'), '1.5');
    assert.equal(formatQuantity(935, 'g'), '935');
  });

  test('pluralises words but not metric abbreviations', () => {
    assert.equal(pluraliseUnit('cup', 2), 'cups');
    assert.equal(pluraliseUnit('clove', 1), 'clove');
    assert.equal(pluraliseUnit('bunch', 3), 'bunches');
    assert.equal(pluraliseUnit('g', 400), 'g');
    assert.equal(pluraliseUnit('tbsp', 3), 'tbsp');
  });

  test('steps grams up to kilograms past 1000', () => {
    const item = { quantity: 1200, unit: 'g', item: 'beef chuck', note: null, raw: '1.2 kg beef chuck' };
    assert.equal(formatAmount(item, 1), '1.2 kg');
    assert.equal(formatAmount(item, 2), '2.4 kg');
    assert.equal(formatAmount(item, 0.5), '600 g');
  });

  test('steps millilitres up to litres past 1000', () => {
    const item = { quantity: 400, unit: 'ml', item: 'coconut cream', note: null, raw: '400 ml coconut cream' };
    assert.equal(formatAmount(item, 1), '400 ml');
    assert.equal(formatAmount(item, 3), '1.2 l');
  });

  test('an item with no unit reads as a bare count', () => {
    const item = { quantity: 8, unit: null, item: 'shallots', note: 'peeled', raw: '8 shallots, peeled' };
    assert.equal(formatAmount(item, 1), '8');
    assert.equal(formatIngredient(item, 1).text, '8 shallots');
  });

  test('doubles an ingredient line', () => {
    const item = { quantity: 400, unit: 'g', item: 'chuck steak', note: 'diced', raw: '400 g chuck steak, diced' };
    assert.deepEqual(formatIngredient(item, 2), { text: '800 g chuck steak', note: 'diced' });
  });

  test('halves a spoon measure into a fraction', () => {
    const item = { quantity: 1.5, unit: 'tsp', item: 'ground cumin', note: null, raw: '1½ tsp ground cumin' };
    assert.equal(formatIngredient(item, 0.5).text, '¾ tsp ground cumin');
  });

  test('leaves unquantified lines exactly as written', () => {
    const item = { quantity: null, unit: 'to taste', item: 'sea salt', note: null, raw: 'sea salt, to taste' };
    assert.equal(formatIngredient(item, 4).text, 'sea salt, to taste');
  });

  test('scaling by one is a no-op on the numbers', () => {
    const item = { quantity: 6, unit: 'clove', item: 'garlic', note: null, raw: '6 cloves garlic' };
    assert.equal(formatIngredient(item, 1).text, '6 cloves garlic');
  });
});
