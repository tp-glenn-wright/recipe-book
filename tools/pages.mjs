// HTML page templates, rendered at build time.
//
// Two things worth knowing about the shape of the output:
//
//   1. The index page ships every recipe card already rendered, each carrying data-*
//      attributes for its facets and a normalised search blob. Filtering is then a
//      matter of toggling `hidden` on nodes that already exist, so there is no fetch,
//      nothing to wait for on a phone, and the full list still reads with JavaScript
//      off.
//   2. Nothing is interpolated into HTML except through the html`` tag, which escapes
//      by default. Recipe text originates in a photograph read by a model, so it is
//      untrusted input.

import { html, raw, render, jsonLd, escapeHtml } from './html.mjs';
import { NUTRIENT_LABELS } from './vocab.mjs';
import { formatIngredient, formatAmount } from '../src/scale.js';

const SITE_TITLE = 'Recipe Book';

/* Everything is first-party, so the policy can name 'self' and nothing else. The only
 * concession is data: for images, which the placeholder icons use. */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  // frame-ancestors is deliberately absent: it is ignored when delivered in a meta
  // tag, and GitHub Pages cannot set response headers. Browsers log a warning if you
  // include it anyway. See README for what that leaves uncovered.
].join('; ');

/** "3 h 30" reads faster than "210 min" once you are past an hour. */
export function formatMinutes(total) {
  if (!total) return null;
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes ? `${hours} h ${minutes}` : `${hours} h`;
}

/** Fold accents and case so "puree" finds "purée". Mirrored in src/app.js. */
export function normalise(text) {
  return String(text)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Biscuits and cakes are made, not served, and the count means items not people. */
export function yieldWord(recipe) {
  const baked = ['baking', 'bread', 'snack', 'dessert'];
  return recipe.course.some((course) => baked.includes(course)) ? 'Makes' : 'Serves';
}
const tagLabel = (tag) => titleCase(tag.replace(/-/g, ' '));

/** Every word worth matching on, flattened once at build time. */
function searchBlob(recipe) {
  const parts = [
    recipe.title,
    recipe.description,
    recipe.cuisine,
    recipe.mainProtein,
    ...recipe.course,
    ...recipe.tags.map(tagLabel),
    ...recipe.equipment,
    ...recipe.ingredients.flatMap((g) => [g.group, ...g.items.map((i) => `${i.item} ${i.note ?? ''}`)]),
    recipe.source.citation,
  ];
  return normalise(parts.filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();
}

function layout({ title, description, root, bodyClass, script, head = '', body }) {
  return render(html`<!doctype html>
<html lang="en-NZ">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="theme-color" content="#a8411b" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#16140f" media="(prefers-color-scheme: dark)">
<link rel="stylesheet" href="${root}assets/style.css">
<link rel="manifest" href="${root}manifest.webmanifest">
<link rel="icon" href="${root}assets/icon-192.png" sizes="192x192" type="image/png">
<link rel="apple-touch-icon" href="${root}assets/icon-180.png">
${raw(head)}
</head>
<body class="${bodyClass}" data-root="${root}">
${body}
<script src="${root}assets/${script}" type="module"></script>
</body>
</html>
`);
}

/* ---------------------------------------------------------------- index ---- */

function card(recipe) {
  const href = `recipes/${recipe.id}/`;
  const kcal = recipe.nutrition.perServing.kcal;
  const protein = recipe.nutrition.perServing.proteinG;
  const media = recipe.image
    ? html`<img src="${recipe.image.file}" alt="${recipe.image.alt}" loading="lazy" decoding="async" width="600" height="375">`
    : html`<span class="card-placeholder" aria-hidden="true">${recipe.title.trim().charAt(0).toUpperCase()}</span>`;

  return html`<li class="card"
    data-id="${recipe.id}"
    data-title="${normalise(recipe.title)}"
    data-protein="${recipe.mainProtein}"
    data-cuisine="${recipe.cuisine ?? ''}"
    data-course="${recipe.course.join(' ')}"
    data-tags="${recipe.tags.join(' ')}"
    data-time="${recipe.totalMinutes}"
    data-kcal="${kcal}"
    data-protein-g="${protein}"
    data-added="${recipe.added}"
    data-rating="${recipe.rating ?? 0}"
    data-search="${searchBlob(recipe)}">
  <a class="card-link" href="${href}">
    <span class="card-media">${media}</span>
    <span class="card-body">
      <h2 class="card-title">${recipe.title}</h2>
      <span class="card-desc">${recipe.description}</span>
      <ul class="card-meta">
        <li>${formatMinutes(recipe.totalMinutes)}</li>
        <li>${Math.round(kcal)} kcal</li>
        <li>${Math.round(protein)} g protein</li>
      </ul>
    </span>
  </a>
</li>`;
}

function chipGroup(legend, name, values, labeller = tagLabel) {
  if (!values.length) return '';
  return html`<fieldset class="facet" data-facet="${name}">
  <legend>${legend}</legend>
  <div class="chips">
    ${values.map((value) => html`<button type="button" class="chip" data-value="${value}" aria-pressed="false">${labeller(value)}</button>`)}
  </div>
</fieldset>`;
}

export function renderIndex(recipes) {
  const sorted = [...recipes].sort((a, b) => (b.added === a.added ? a.title.localeCompare(b.title) : b.added.localeCompare(a.added)));
  const distinct = (fn) => [...new Set(sorted.flatMap(fn).filter(Boolean))].sort();
  const proteins = distinct((r) => [r.mainProtein]);
  const cuisines = distinct((r) => [r.cuisine]);
  const courses = distinct((r) => r.course);
  const tags = distinct((r) => r.tags);
  const maxTime = Math.max(60, ...sorted.map((r) => r.totalMinutes));
  const maxProtein = Math.max(10, ...sorted.map((r) => Math.ceil(r.nutrition.perServing.proteinG)));
  const count = sorted.length;

  const body = html`<div class="wrap">
<header class="site-header">
  <h1 class="site-title">${SITE_TITLE}</h1>
  <p class="site-count">${count} ${count === 1 ? 'recipe' : 'recipes'}</p>
  <button type="button" class="offline btn-quiet" id="offline" hidden>Save for offline</button>
</header>

<div class="controls">
  <div class="search-row">
    <label class="visually-hidden" for="q">Search recipes</label>
    <input class="search" id="q" type="search" placeholder="Search recipes or ingredients" autocomplete="off" enterkeyhint="search" spellcheck="false">
    <button type="button" class="filters-toggle" id="filters-toggle" aria-expanded="false" aria-controls="facets">Filters<span class="count" id="filter-count"></span></button>
  </div>

  <div class="facets" id="facets" hidden>
    ${chipGroup('Protein', 'protein', proteins)}
    ${chipGroup('Course', 'course', courses)}
    ${chipGroup('Cuisine', 'cuisine', cuisines, (v) => v)}
    ${chipGroup('Tag', 'tags', tags)}
    <div class="facet">
      <span class="facet-label" id="time-label">Ready within</span>
      <div class="slider-row">
        <input type="range" id="max-time" min="15" max="${maxTime}" step="15" value="${maxTime}" aria-labelledby="time-label">
        <output for="max-time" id="max-time-out">any</output>
      </div>
    </div>
    <div class="facet">
      <span class="facet-label" id="protein-label">Protein per serving</span>
      <div class="slider-row">
        <input type="range" id="min-protein" min="0" max="${maxProtein}" step="5" value="0" aria-labelledby="protein-label">
        <output for="min-protein" id="min-protein-out">any</output>
      </div>
    </div>
    <div class="facet">
      <span class="facet-label" id="sort-label">Sort by</span>
      <div class="facet-row">
        <select id="sort" aria-labelledby="sort-label">
          <option value="added">Recently added</option>
          <option value="title">Name</option>
          <option value="time">Quickest</option>
          <option value="protein">Most protein</option>
          <option value="rating">Highest rated</option>
        </select>
        <button type="button" class="btn-quiet" id="reset">Clear</button>
      </div>
    </div>
  </div>
</div>

<p class="result-count" id="result-count" role="status">${count} ${count === 1 ? 'recipe' : 'recipes'}</p>

<ul class="cards" id="cards">
${sorted.map(card)}
</ul>

<p class="empty" id="empty" hidden>Nothing matches that. Try clearing a filter.</p>

<footer class="site-footer">
  <p>${count} ${count === 1 ? 'recipe' : 'recipes'}. Add another by asking Claude in the repo.</p>
</footer>
</div>
<p class="toast" id="toast" role="status" hidden></p>`;

  return layout({
    title: SITE_TITLE,
    description: `A personal collection of ${count} ${count === 1 ? 'recipe' : 'recipes'}.`,
    root: '',
    bodyClass: 'page-index',
    script: 'app.js',
    body,
  });
}

/* --------------------------------------------------------------- recipe ---- */

const SOURCE_FLAG = {
  label: 'From the label',
  calculated: 'Calculated from ingredients',
  estimated: 'Estimated',
};

function nutritionSection(recipe) {
  const { nutrition, servingSizeG } = recipe;
  const perServingHeader = servingSizeG ? `Per serving (${servingSizeG} g)` : 'Per serving';

  return html`<section class="section" id="nutrition">
  <div class="section-head"><h2>Nutrition</h2></div>
  <p class="nutrition-source">
    <span class="flag" data-source="${nutrition.source}">${SOURCE_FLAG[nutrition.source]}</span>
    ${nutrition.source === 'estimated'
      ? 'Worked out from the ingredients rather than measured, so treat it as a guide.'
      : 'Taken from the source rather than estimated.'}
  </p>
  <table class="nutrition-table">
    <thead>
      <tr><th scope="col">Nutrient</th><th scope="col">${perServingHeader}</th><th scope="col">Per 100 g</th></tr>
    </thead>
    <tbody>
      ${NUTRIENT_LABELS.map((row) => html`<tr${raw(row.sub ? ' class="sub"' : '')}>
        <th scope="row">${row.label}</th>
        <td>${formatNutrient(nutrition.perServing[row.key], row.unit)}</td>
        <td>${formatNutrient(nutrition.per100g[row.key], row.unit)}</td>
      </tr>`)}
    </tbody>
  </table>
  ${nutrition.assumptions
    ? html`<details class="nutrition-assumptions">
        <summary>What this assumes</summary>
        <p>${nutrition.assumptions}</p>
      </details>`
    : ''}
</section>`;
}

function formatNutrient(value, unit) {
  if (value === null || value === undefined) return '';
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${unit}`;
}

function ingredientsSection(recipe) {
  return html`<section class="section" id="ingredients">
  <div class="section-head">
    <h2>Ingredients</h2>
    <div class="scaler" id="scaler" data-base-servings="${recipe.servings}" data-yield-word="${yieldWord(recipe)}">
      <span class="scaler-label">${yieldWord(recipe)}</span>
      <button type="button" data-step="-1" aria-label="Fewer servings">&minus;</button>
      <output id="servings-out" aria-live="polite">${recipe.servings}</output>
      <button type="button" data-step="1" aria-label="More servings">+</button>
      <button type="button" class="reset" id="scaler-reset" hidden>Reset</button>
    </div>
  </div>
  ${recipe.ingredients.map((group) => html`<div class="ingredient-group">
    ${group.group ? html`<h3>${group.group}</h3>` : ''}
    <ul class="ingredients-list">
      ${group.items.map((item) => {
        const line = formatIngredient(item, 1);
        const amount = formatAmount(item, 1);
        return html`<li
          data-quantity="${item.quantity ?? ''}"
          data-unit="${item.unit ?? ''}"
          data-item="${item.item}"
          data-raw="${item.raw}">
          <span class="ing-amount">${amount}</span>
          <span class="ing-text">${amount ? item.item : line.text}${item.note ? html`<span class="ing-note">, ${item.note}</span>` : ''}</span>
        </li>`;
      })}
    </ul>
  </div>`)}
</section>`;
}

function methodSection(recipe) {
  return html`<section class="section" id="method">
  <div class="section-head">
    <h2>Method</h2>
    <button type="button" class="btn-primary" id="cook-mode">Cook mode</button>
  </div>
  <ol class="steps" id="steps">
    ${recipe.steps.map((step) => html`<li>
      <p>${step.text}</p>
      ${step.minutes ? html`<span class="step-time">${formatMinutes(step.minutes)}</span>` : ''}
    </li>`)}
  </ol>
</section>`;
}

function sourceLine(recipe) {
  const { kind, citation, url } = recipe.source;
  const described = citation
    ? html`${citation}`
    : html`${{ photo: 'Photographed', family: 'Family recipe', original: 'Original', restaurant: 'From a restaurant' }[kind] ?? kind}`;
  // Outbound links are deliberately not rendered as anchors: the CSP forbids external
  // subresources, and a bare URL keeps provenance visible without inviting a click
  // into something that may have rotted.
  return html`<p class="source-line">Source: ${described}${url ? html` <span class="pill">${url}</span>` : ''}</p>`;
}

/** schema.org Recipe, so the page is importable into a recipe manager. */
function structuredData(recipe) {
  const iso = (minutes) => (minutes ? `PT${Math.floor(minutes / 60)}H${minutes % 60}M` : undefined);
  return {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: recipe.title,
    description: recipe.description,
    datePublished: recipe.added,
    recipeCategory: recipe.course,
    recipeCuisine: recipe.cuisine ?? undefined,
    keywords: recipe.tags.join(', '),
    recipeYield: `${recipe.servings} servings`,
    prepTime: iso(recipe.prepMinutes),
    cookTime: iso(recipe.cookMinutes),
    totalTime: iso(recipe.totalMinutes),
    tool: recipe.equipment.length ? recipe.equipment : undefined,
    image: recipe.image ? `../../${recipe.image.file}` : undefined,
    recipeIngredient: recipe.ingredients.flatMap((g) => g.items.map((i) => i.raw)),
    recipeInstructions: recipe.steps.map((step, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      text: step.text,
    })),
    nutrition: {
      '@type': 'NutritionInformation',
      servingSize: recipe.servingSizeG ? `${recipe.servingSizeG} g` : undefined,
      calories: `${Math.round(recipe.nutrition.perServing.kcal)} kcal`,
      proteinContent: `${recipe.nutrition.perServing.proteinG} g`,
      fatContent: `${recipe.nutrition.perServing.fatG} g`,
      saturatedFatContent: `${recipe.nutrition.perServing.saturatedFatG} g`,
      carbohydrateContent: `${recipe.nutrition.perServing.carbsG} g`,
      sugarContent: `${recipe.nutrition.perServing.sugarsG} g`,
      fiberContent: `${recipe.nutrition.perServing.fibreG} g`,
      sodiumContent: `${recipe.nutrition.perServing.sodiumMg} mg`,
    },
  };
}

export function renderRecipe(recipe) {
  const root = '../../';
  const pills = [
    formatMinutes(recipe.totalMinutes),
    recipe.cuisine,
    // "None" is not worth a pill on a baking recipe.
    recipe.mainProtein === 'none' ? null : titleCase(recipe.mainProtein),
    titleCase(recipe.difficulty),
  ].filter(Boolean);

  const body = html`<div class="wrap page-recipe">
<a class="back" href="${root}">All recipes</a>

<header class="recipe-header">
  <h1>${recipe.title}</h1>
  <p class="recipe-desc">${recipe.description}</p>
  <ul class="recipe-meta">
    <li class="pill" id="serves-pill">${yieldWord(recipe)} ${recipe.servings}</li>
    ${pills.map((pill) => html`<li class="pill">${pill}</li>`)}
    ${recipe.rating ? html`<li class="pill pill-accent">${'\u2605'.repeat(recipe.rating)}</li>` : ''}
  </ul>
</header>

${recipe.image
    ? html`<figure class="recipe-figure">
        <img src="${root}${recipe.image.file}" alt="${recipe.image.alt}" width="1600" height="1000" decoding="async">
        ${recipe.image.credit ? html`<figcaption>${recipe.image.credit}${recipe.image.licence ? html` (${recipe.image.licence})` : ''}</figcaption>` : ''}
      </figure>`
    : ''}

${ingredientsSection(recipe)}
${methodSection(recipe)}
${nutritionSection(recipe)}

${recipe.notes.length
    ? html`<section class="section" id="notes">
        <div class="section-head"><h2>Notes</h2></div>
        <ul class="notes-list">${recipe.notes.map((note) => html`<li>${note}</li>`)}</ul>
      </section>`
    : ''}

<section class="section" id="source">
  ${sourceLine(recipe)}
  ${recipe.equipment.length ? html`<p class="source-line">Equipment: ${recipe.equipment.join(', ')}</p>` : ''}
</section>
</div>

<dialog class="cook" id="cook" aria-label="Cook mode">
  <div class="cook-inner">
    <div class="cook-top">
      <p class="cook-progress" id="cook-progress"></p>
      <span class="cook-awake" id="cook-awake" hidden>Screen kept on</span>
      <button type="button" class="btn-quiet" id="cook-close">Done</button>
    </div>
    <div class="cook-body">
      <p class="cook-step" id="cook-step"></p>
      <p class="cook-step-time" id="cook-step-time"></p>
    </div>
    <div class="cook-nav">
      <button type="button" id="cook-prev">Back</button>
      <button type="button" class="btn-primary" id="cook-next">Next</button>
    </div>
  </div>
</dialog>
<p class="toast" id="toast" role="status" hidden></p>`;

  const head = render(html`<script type="application/ld+json">
${jsonLd(structuredData(recipe))}
</script>`);

  return layout({
    title: `${recipe.title} | ${SITE_TITLE}`,
    description: recipe.description,
    root,
    bodyClass: 'page-recipe-body',
    script: 'recipe.js',
    head,
    body,
  });
}

/** 404 that still gets you home. */
export function renderNotFound() {
  return layout({
    title: `Not found | ${SITE_TITLE}`,
    description: 'That recipe does not exist.',
    root: '',
    bodyClass: 'page-index',
    script: 'app.js',
    body: html`<div class="wrap">
  <header class="site-header"><h1 class="site-title">Not found</h1></header>
  <p class="empty">That recipe does not exist. <a href="./">Back to all recipes</a>.</p>
</div>`,
  });
}

export { escapeHtml };
