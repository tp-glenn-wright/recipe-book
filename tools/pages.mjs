// HTML page templates, rendered at build time.
//
// Styling follows the TracPlus design canvas (see src/tokens.css). Two things about
// the shape of the output are worth knowing:
//
//   1. The index ships every recipe card already rendered, each carrying data-*
//      attributes for its facets and a pre-normalised search blob. Filtering then
//      toggles `hidden` on nodes that already exist, so there is no fetch, nothing to
//      wait for on a phone, and the full list still reads with JavaScript off.
//   2. Nothing is interpolated into HTML except through the html`` tag, which escapes
//      by default. Recipe text originates in a photograph read by a model, so it is
//      untrusted input.

import { html, raw, render, jsonLd, escapeHtml } from './html.mjs';
import { NUTRIENT_LABELS } from './vocab.mjs';
import { formatIngredient, formatAmount } from '../src/scale.js';

const SITE_TITLE = 'Recipe Book';

/* Everything is first-party, so the policy names 'self' and nothing else. Two
 * concessions: data: for images, which the placeholder art uses, and form-action
 * 'self' so the search box on a recipe page can submit back to the index without
 * JavaScript.
 *
 * frame-ancestors is deliberately absent: it is ignored in a meta tag, and GitHub
 * Pages cannot set response headers. See README. */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
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
const tagLabel = (tag) => titleCase(tag.replace(/-/g, ' '));

/** Biscuits and cakes are made, not served, and the count means items not people. */
export function yieldWord(recipe) {
  const baked = ['baking', 'bread', 'snack', 'dessert'];
  return recipe.course.some((course) => baked.includes(course)) ? 'Makes' : 'Serves';
}

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

/* ---------------------------------------------------------------- icons ----
 * Inline SVG, because the CSP allows no external requests and an icon font would be
 * another 40 kB for a dozen glyphs. Stroke colour is inherited from currentColor. */

const icon = (paths, size = 18) => html`<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}"
  fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
  aria-hidden="true" focusable="false">${raw(paths)}</svg>`;

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.2-3.2"></path>',
  filter: '<path d="M3 6h18M6 12h12M10 18h4"></path>',
  clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
  cook: '<path d="M4 20h16"></path><path d="M5 15h14a7 7 0 0 0-14 0Z"></path><path d="M12 5v3"></path>',
  left: '<path d="m14 6-6 6 6 6"></path>',
  right: '<path d="m10 6 6 6-6 6"></path>',
  minus: '<path d="M5 12h14"></path>',
  plus: '<path d="M12 5v14"></path><path d="M5 12h14"></path>',
  download: '<path d="M12 4v11"></path><path d="m7 11 5 5 5-5"></path><path d="M5 20h14"></path>',
};

/* --------------------------------------------------------------- layout ---- */

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
<meta name="theme-color" content="#135487">
<link rel="preload" href="${root}assets/fonts/figtree-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${root}assets/fonts/open-sans-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${root}assets/tokens.css">
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

/**
 * Site header. The search field is a real GET form pointing at the index, so on a
 * recipe page it navigates to /?q=term and the index reads the query out of the URL.
 * That works with JavaScript off, which is why form-action 'self' is in the CSP.
 */
function siteHeader({ root, count, live }) {
  return html`<header class="site-header">
  <div class="header-inner">
    <a class="brand" href="${root || './'}">
      <span class="brand-dot" aria-hidden="true"></span>
      <span class="brand-name">${SITE_TITLE}</span>
    </a>

    <form class="search-form" action="${root || './'}" method="get" role="search">
      <span class="search-icon" aria-hidden="true">${icon(ICONS.search)}</span>
      <label class="visually-hidden" for="q">Search recipes</label>
      <input class="search" id="q" name="q" type="search" placeholder="Search recipes"
        autocomplete="off" enterkeyhint="search" spellcheck="false">
    </form>

    <div class="header-actions">
      ${live
        ? html`<button type="button" class="btn btn-quiet filters-toggle" id="filters-toggle" aria-expanded="false" aria-controls="facets">
            ${icon(ICONS.filter, 16)}Filters<span class="count" id="filter-count"></span>
          </button>
          <button type="button" class="btn btn-quiet offline-btn" id="offline" hidden>${icon(ICONS.download, 16)}Save offline</button>`
        : html`<a class="btn btn-quiet" href="${root}">All ${count} recipes</a>`}
    </div>
  </div>
</header>`;
}

/* ---------------------------------------------------------------- index ---- */

function card(recipe) {
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
  <a class="card-link" href="recipes/${recipe.id}/">
    <span class="card-media">${media}</span>
    <span class="card-body">
      <span class="card-kicker">${[recipe.course[0], recipe.cuisine].filter(Boolean).map(titleCase).join(' · ')}</span>
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
  <legend class="facet-label">${legend}</legend>
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
  const plural = count === 1 ? 'recipe' : 'recipes';

  const body = html`${siteHeader({ root: '', count, live: true })}

<div class="facets-wrap">
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
        <button type="button" class="btn btn-quiet" id="reset">Clear</button>
      </div>
    </div>
  </div>
</div>

<main class="wrap index-main">
  <p class="result-count" id="result-count" role="status">${count} ${plural}</p>
  <ul class="cards" id="cards">
${sorted.map(card)}
  </ul>
  <p class="empty" id="empty" hidden>Nothing matches that. Try clearing a filter.</p>
</main>

<footer class="site-footer wrap">
  <p>${count} ${plural}. Add another by asking Claude in the repo.</p>
</footer>
<p class="toast" id="toast" role="status" hidden></p>`;

  return layout({
    title: SITE_TITLE,
    description: `A personal collection of ${count} ${plural}.`,
    root: '',
    bodyClass: 'page-index',
    script: 'app.js',
    body,
  });
}

/* --------------------------------------------------------------- recipe ---- */

const SOURCE_FLAG = {
  label: 'From the label',
  calculated: 'Calculated',
  estimated: 'Estimated',
};

function formatNutrient(value, unit) {
  if (value === null || value === undefined) return '';
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${unit}`;
}

function hero(recipe) {
  const kicker = [recipe.course[0], recipe.cuisine].filter(Boolean).map(titleCase).join(' · ');
  const chips = [
    `${yieldWord(recipe)} ${recipe.servings}`,
    formatMinutes(recipe.totalMinutes),
    recipe.cuisine,
    recipe.mainProtein === 'none' ? null : titleCase(recipe.mainProtein),
    titleCase(recipe.difficulty),
  ].filter(Boolean);

  return html`<section class="hero">
  <div class="hero-inner">
    <div class="hero-main">
      <p class="eyebrow"><span class="eyebrow-bar" aria-hidden="true"></span>${kicker}</p>
      <h1>${recipe.title}</h1>
      <p class="hero-blurb">${recipe.description}</p>
    </div>
    <ul class="hero-meta">
      <li class="meta-chip" id="serves-pill">${yieldWord(recipe)} ${recipe.servings}</li>
      ${chips.slice(1).map((chip) => html`<li class="meta-chip">${chip}</li>`)}
      ${recipe.rating ? html`<li class="meta-chip meta-chip-rating">${'★'.repeat(recipe.rating)}</li>` : ''}
    </ul>
  </div>
</section>`;
}

/** The other recipes, as a scrolling strip. Real links, so it works without script. */
function pillRow(recipe, all) {
  if (all.length < 2) return '';
  return html`<nav class="pill-row" aria-label="Recipes">
  <ul>
    ${all.map((other) => html`<li>
      <a class="pill${other.id === recipe.id ? ' is-current' : ''}" href="../${other.id}/"${other.id === recipe.id ? raw(' aria-current="page"') : ''}>
        <span class="pill-name">${other.title}</span>
        <span class="pill-time">${formatMinutes(other.totalMinutes)}</span>
      </a>
    </li>`)}
  </ul>
</nav>`;
}

function ingredientsPanel(recipe) {
  return html`<aside class="panel ingredients-panel">
  <div class="panel-head">
    <h2>Ingredients</h2>
    <div class="scaler" id="scaler" data-base-servings="${recipe.servings}" data-yield-word="${yieldWord(recipe)}">
      <span class="scaler-label">${yieldWord(recipe)}</span>
      <button type="button" class="scaler-btn" data-step="-1" aria-label="Fewer servings">${icon(ICONS.minus, 16)}</button>
      <output id="servings-out" aria-live="polite">${recipe.servings}</output>
      <button type="button" class="scaler-btn" data-step="1" aria-label="More servings">${icon(ICONS.plus, 16)}</button>
      <button type="button" class="btn btn-quiet scaler-reset" id="scaler-reset" hidden>Reset</button>
    </div>
  </div>

  <div class="panel-body">
    ${recipe.ingredients.map((group) => html`<div class="ingredient-group">
      ${group.group ? html`<h3 class="group-label">${group.group}</h3>` : ''}
      <ul class="ingredients-list">
        ${group.items.map((item) => {
          const line = formatIngredient(item, 1);
          const amount = formatAmount(item, 1);
          return html`<li>
            <button type="button" class="ingredient" aria-pressed="false"
              data-quantity="${item.quantity ?? ''}"
              data-unit="${item.unit ?? ''}"
              data-item="${item.item}"
              data-raw="${item.raw}">
              <span class="ing-amount">${amount}</span>
              <span class="ing-text">${amount ? item.item : line.text}${item.note ? html`<span class="ing-note">, ${item.note}</span>` : ''}</span>
            </button>
          </li>`;
        })}
      </ul>
    </div>`)}

    ${recipe.equipment.length
      ? html`<div class="equipment">
          <p class="equipment-label">Equipment</p>
          <p>${recipe.equipment.join(', ')}</p>
        </div>`
      : ''}
  </div>
</aside>`;
}

function methodSection(recipe) {
  return html`<main class="method">
  <div class="section-head">
    <h2>Method</h2>
    <button type="button" class="btn btn-primary" id="cook-mode">${icon(ICONS.cook)}Cook mode</button>
  </div>
  <p class="step-progress" id="step-progress">Tap a step to mark it done. 0 of ${recipe.steps.length} done.</p>
  <ol class="steps" id="steps">
    ${recipe.steps.map((step, index) => html`<li>
      <button type="button" class="step" aria-pressed="false">
        <span class="step-number">${index + 1}</span>
        <span class="step-text">${step.text}</span>
        ${step.minutes ? html`<span class="step-time">${icon(ICONS.clock, 14)}${formatMinutes(step.minutes)}</span>` : ''}
      </button>
    </li>`)}
  </ol>
</main>`;
}

function nutritionSection(recipe) {
  const { nutrition, servingSizeG } = recipe;
  const servingLabel = servingSizeG ? `Per serving (${servingSizeG} g)` : 'Per serving';
  const estimated = nutrition.source === 'estimated';

  return html`<section class="nutrition">
  <div class="section-head">
    <h2>Nutrition</h2>
    <span class="basis-chip" data-source="${nutrition.source}">${SOURCE_FLAG[nutrition.source]}</span>
  </div>
  <div class="table-scroll">
    <table class="nutrition-table">
      <thead>
        <tr><th scope="col">Nutrient</th><th scope="col">${servingLabel}</th><th scope="col">Per 100 g</th></tr>
      </thead>
      <tbody>
        ${NUTRIENT_LABELS.map((row) => html`<tr${raw(row.sub ? ' class="sub"' : '')}>
          <th scope="row">${row.label}</th>
          <td class="figure">${formatNutrient(nutrition.perServing[row.key], row.unit)}</td>
          <td class="figure figure-soft">${formatNutrient(nutrition.per100g[row.key], row.unit)}</td>
        </tr>`)}
      </tbody>
    </table>
  </div>
  <p class="nutrition-foot">${estimated
    ? 'Estimated. Worked out from the ingredients rather than measured, so treat it as a guide.'
    : 'Taken from the source rather than estimated.'}</p>
</section>`;
}

function sourceLine(recipe) {
  const { kind, citation, url } = recipe.source;
  const described = citation
    ? html`${citation}`
    : html`${{ photo: 'Photographed', family: 'Family recipe', original: 'Original', restaurant: 'From a restaurant' }[kind] ?? kind}`;
  // Outbound links are deliberately not anchors: the CSP forbids external subresources,
  // and a bare URL keeps provenance visible without inviting a click into something
  // that may have rotted.
  return html`<p>Source: ${described}${url ? html` <span class="url">${url}</span>` : ''}</p>`;
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

export function renderRecipe(recipe, allRecipes = []) {
  if (!Array.isArray(allRecipes)) {
    // Spreading a string here would quietly produce a pager full of single characters.
    throw new TypeError('renderRecipe expects the recipe list as its second argument');
  }
  const root = '../../';
  const all = [...allRecipes].sort((a, b) => a.title.localeCompare(b.title));
  const index = all.findIndex((r) => r.id === recipe.id);
  const previous = index > 0 ? all[index - 1] : null;
  const next = index >= 0 && index < all.length - 1 ? all[index + 1] : null;

  const pager = all.length > 1
    ? html`<div class="pager">
        ${previous
          ? html`<a class="pager-btn" href="../${previous.id}/" rel="prev" aria-label="Previous recipe, ${previous.title}">${icon(ICONS.left, 20)}</a>`
          : html`<span class="pager-btn is-disabled" aria-hidden="true">${icon(ICONS.left, 20)}</span>`}
        <span class="pager-count">${index + 1} of ${all.length}</span>
        ${next
          ? html`<a class="pager-btn" href="../${next.id}/" rel="next" aria-label="Next recipe, ${next.title}">${icon(ICONS.right, 20)}</a>`
          : html`<span class="pager-btn is-disabled" aria-hidden="true">${icon(ICONS.right, 20)}</span>`}
      </div>`
    : '';

  const body = html`<header class="site-header">
  <div class="header-inner">
    <a class="brand" href="${root}">
      <span class="brand-dot" aria-hidden="true"></span>
      <span class="brand-name">${SITE_TITLE}</span>
    </a>
    <form class="search-form" action="${root}" method="get" role="search">
      <span class="search-icon" aria-hidden="true">${icon(ICONS.search)}</span>
      <label class="visually-hidden" for="q">Search recipes</label>
      <input class="search" id="q" name="q" type="search" placeholder="Search recipes"
        autocomplete="off" enterkeyhint="search" spellcheck="false">
    </form>
    <div class="header-actions">${pager}</div>
  </div>
  ${pillRow(recipe, all)}
</header>

${hero(recipe)}

<div class="recipe-body wrap">
  ${ingredientsPanel(recipe)}
  ${methodSection(recipe)}
</div>

<div class="recipe-lower wrap">
  ${nutritionSection(recipe)}
  <div class="aside-stack">
    ${recipe.nutrition.assumptions
      ? html`<div class="assumptions">
          <h3>What this assumes</h3>
          <p>${recipe.nutrition.assumptions}</p>
        </div>`
      : ''}
    ${recipe.notes.length
      ? html`<div class="notes-block">
          <h2>Notes</h2>
          <ul class="notes-list">${recipe.notes.map((note) => html`<li><span class="note-dot" aria-hidden="true"></span><span>${note}</span></li>`)}</ul>
        </div>`
      : ''}
  </div>
</div>

<footer class="recipe-footer wrap">
  ${sourceLine(recipe)}
  ${next ? html`<a class="btn btn-primary" href="../${next.id}/" rel="next">Next recipe ${icon(ICONS.right, 16)}</a>` : ''}
</footer>

<dialog class="cook" id="cook" aria-label="Cook mode">
  <div class="cook-inner">
    <div class="cook-top">
      <div class="cook-heading">
        <p class="cook-label">Cook mode</p>
        <p class="cook-title">${recipe.title}</p>
      </div>
      <p class="cook-progress" id="cook-progress"></p>
      <span class="cook-awake" id="cook-awake" hidden>Screen kept on</span>
      <button type="button" class="btn btn-quiet" id="cook-close">Done</button>
    </div>
    <div class="cook-body">
      <p class="cook-step" id="cook-step"></p>
      <p class="cook-step-time" id="cook-step-time"></p>
    </div>
    <div class="cook-nav">
      <button type="button" class="btn" id="cook-prev">${icon(ICONS.left, 18)}Back</button>
      <button type="button" class="btn btn-primary" id="cook-next">Next${icon(ICONS.right, 18)}</button>
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
    bodyClass: 'page-recipe',
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
    body: html`${siteHeader({ root: '', count: 0, live: false })}
<main class="wrap index-main">
  <p class="empty">That recipe does not exist. <a href="./">Back to all recipes</a>.</p>
</main>`,
  });
}

export { escapeHtml };
