// Index page: search, facets and sorting.
//
// Every card is already in the DOM, rendered at build time with its facets in data-*
// attributes and a pre-normalised search blob. So this file never fetches anything and
// never builds markup: it toggles `hidden` and sets CSS `order`. With JavaScript off
// the full list still reads, which is the point of rendering server side.

import { registerServiceWorker, wireOfflineButton } from './ui.js';

const cards = Array.from(document.querySelectorAll('.card'));
const input = document.getElementById('q');
const facetsPanel = document.getElementById('facets');
const filtersToggle = document.getElementById('filters-toggle');
const filterCount = document.getElementById('filter-count');
const maxTimeInput = document.getElementById('max-time');
const maxTimeOut = document.getElementById('max-time-out');
const minProteinInput = document.getElementById('min-protein');
const minProteinOut = document.getElementById('min-protein-out');
const sortSelect = document.getElementById('sort');
const resetButton = document.getElementById('reset');
const resultCount = document.getElementById('result-count');
const emptyState = document.getElementById('empty');

/* Facet semantics, chosen for how you actually narrow a list:
 *   protein, course, cuisine  OR within the group   (beef or lamb)
 *   tags                      AND within the group  (quick and vegetarian) */
const OR_FACETS = ['protein', 'course', 'cuisine'];
const AND_FACETS = ['tags'];

const state = {
  text: '',
  selected: { protein: new Set(), course: new Set(), cuisine: new Set(), tags: new Set() },
  maxTime: maxTimeInput ? Number(maxTimeInput.max) : Infinity,
  minProtein: 0,
  sort: 'added',
};

/** Must fold the same way as normalise() in tools/pages.mjs. */
function normalise(text) {
  return String(text).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function tokens(card, facet) {
  return (card.dataset[facet] ?? '').split(' ').filter(Boolean);
}

function matches(card) {
  const blob = card.dataset.search ?? '';
  for (const term of state.text.split(/\s+/).filter(Boolean)) {
    if (!blob.includes(term)) return false;
  }
  for (const facet of OR_FACETS) {
    const chosen = state.selected[facet];
    if (!chosen.size) continue;
    if (!tokens(card, facet).some((value) => chosen.has(value))) return false;
  }
  for (const facet of AND_FACETS) {
    const chosen = state.selected[facet];
    if (!chosen.size) continue;
    const present = new Set(tokens(card, facet));
    for (const value of chosen) if (!present.has(value)) return false;
  }
  if (Number(card.dataset.time) > state.maxTime) return false;
  if (Number(card.dataset.proteinG) < state.minProtein) return false;
  return true;
}

const COMPARATORS = {
  added: (a, b) => b.dataset.added.localeCompare(a.dataset.added) || byTitle(a, b),
  title: byTitle,
  time: (a, b) => Number(a.dataset.time) - Number(b.dataset.time) || byTitle(a, b),
  protein: (a, b) => Number(b.dataset.proteinG) - Number(a.dataset.proteinG) || byTitle(a, b),
  rating: (a, b) => Number(b.dataset.rating) - Number(a.dataset.rating) || byTitle(a, b),
};

function byTitle(a, b) {
  return a.dataset.title.localeCompare(b.dataset.title);
}

function activeFilters() {
  let count = 0;
  for (const set of Object.values(state.selected)) count += set.size;
  if (maxTimeInput && state.maxTime < Number(maxTimeInput.max)) count += 1;
  if (state.minProtein > 0) count += 1;
  return count;
}

function apply() {
  let visible = 0;
  for (const card of cards) {
    const show = matches(card);
    card.hidden = !show;
    if (show) visible += 1;
  }

  const order = cards.filter((card) => !card.hidden).sort(COMPARATORS[state.sort] ?? COMPARATORS.added);
  order.forEach((card, index) => {
    card.style.order = String(index);
  });

  resultCount.textContent = visible === cards.length
    ? `${cards.length} ${cards.length === 1 ? 'recipe' : 'recipes'}`
    : `${visible} of ${cards.length}`;
  emptyState.hidden = visible !== 0;

  const count = activeFilters();
  filterCount.textContent = count ? ` (${count})` : '';
  resetButton.disabled = count === 0 && state.text === '';

  writeUrl();
}

/* Filter state lives in the URL, so a narrowed list can be bookmarked or sent to
 * someone, and the back button behaves. */
function writeUrl() {
  const params = new URLSearchParams();
  if (state.text) params.set('q', state.text);
  for (const [facet, set] of Object.entries(state.selected)) {
    if (set.size) params.set(facet, [...set].join(','));
  }
  if (maxTimeInput && state.maxTime < Number(maxTimeInput.max)) params.set('time', String(state.maxTime));
  if (state.minProtein > 0) params.set('protein', String(state.minProtein));
  if (state.sort !== 'added') params.set('sort', state.sort);
  const query = params.toString();
  history.replaceState(null, '', query ? `?${query}` : location.pathname);
}

function readUrl() {
  const params = new URLSearchParams(location.search);
  state.text = normalise(params.get('q') ?? '');
  if (input) input.value = params.get('q') ?? '';

  for (const facet of Object.keys(state.selected)) {
    const values = (params.get(facet) ?? '').split(',').filter(Boolean);
    state.selected[facet] = new Set(values);
    for (const button of document.querySelectorAll(`[data-facet="${facet}"] .chip`)) {
      button.setAttribute('aria-pressed', String(values.includes(button.dataset.value)));
    }
  }

  if (maxTimeInput) {
    const time = Number(params.get('time'));
    state.maxTime = Number.isFinite(time) && time > 0 ? time : Number(maxTimeInput.max);
    maxTimeInput.value = String(state.maxTime);
  }
  if (minProteinInput) {
    const protein = Number(params.get('protein'));
    state.minProtein = Number.isFinite(protein) && protein > 0 ? protein : 0;
    minProteinInput.value = String(state.minProtein);
  }
  const sort = params.get('sort');
  if (sort && COMPARATORS[sort]) {
    state.sort = sort;
    if (sortSelect) sortSelect.value = sort;
  }
  if (activeFilters() > 0 && facetsPanel) showFacets(true);
  syncSliderLabels();
}

function syncSliderLabels() {
  if (maxTimeInput && maxTimeOut) {
    const isMax = state.maxTime >= Number(maxTimeInput.max);
    const hours = Math.floor(state.maxTime / 60);
    const minutes = state.maxTime % 60;
    maxTimeOut.textContent = isMax
      ? 'any'
      : hours ? `${hours} h${minutes ? ` ${minutes}` : ''}` : `${minutes} min`;
  }
  if (minProteinInput && minProteinOut) {
    minProteinOut.textContent = state.minProtein > 0 ? `${state.minProtein} g or more` : 'any';
  }
}

function showFacets(show) {
  facetsPanel.hidden = !show;
  filtersToggle.setAttribute('aria-expanded', String(show));
}

/* ---------- wiring ---------- */

let debounce = null;
input?.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    state.text = normalise(input.value.trim());
    apply();
  }, 120);
});

filtersToggle?.addEventListener('click', () => showFacets(facetsPanel.hidden));

for (const group of document.querySelectorAll('[data-facet]')) {
  const facet = group.dataset.facet;
  group.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    const value = chip.dataset.value;
    const set = state.selected[facet];
    const pressed = set.has(value);
    if (pressed) set.delete(value);
    else set.add(value);
    chip.setAttribute('aria-pressed', String(!pressed));
    apply();
  });
}

maxTimeInput?.addEventListener('input', () => {
  state.maxTime = Number(maxTimeInput.value);
  syncSliderLabels();
  apply();
});

minProteinInput?.addEventListener('input', () => {
  state.minProtein = Number(minProteinInput.value);
  syncSliderLabels();
  apply();
});

sortSelect?.addEventListener('change', () => {
  state.sort = sortSelect.value;
  apply();
});

resetButton?.addEventListener('click', () => {
  state.text = '';
  if (input) input.value = '';
  for (const facet of Object.keys(state.selected)) state.selected[facet].clear();
  for (const chip of document.querySelectorAll('.chip')) chip.setAttribute('aria-pressed', 'false');
  if (maxTimeInput) {
    state.maxTime = Number(maxTimeInput.max);
    maxTimeInput.value = maxTimeInput.max;
  }
  if (minProteinInput) {
    state.minProtein = 0;
    minProteinInput.value = '0';
  }
  state.sort = 'added';
  if (sortSelect) sortSelect.value = 'added';
  syncSliderLabels();
  apply();
});

// "/" focuses search, the one keyboard shortcut worth having on a desktop.
document.addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.metaKey || event.ctrlKey) return;
  if (document.activeElement === input) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  event.preventDefault();
  input?.focus();
});

readUrl();
apply();
wireOfflineButton(document.getElementById('offline'));
registerServiceWorker();
