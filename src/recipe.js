// Recipe page: the servings scaler, tick-off state, and cook mode.
//
// All of it is progressive enhancement. The page is complete and readable before this
// file runs, and everything here updates existing nodes via textContent and
// aria-pressed. Nothing is built from a string.

import { formatAmount } from './scale.js';
import { registerServiceWorker, toast } from './ui.js';

/* ---------- servings scaler ---------- */

const scaler = document.getElementById('scaler');
const servingsOut = document.getElementById('servings-out');
const servesPill = document.getElementById('serves-pill');
const resetScale = document.getElementById('scaler-reset');
const ingredientButtons = Array.from(document.querySelectorAll('.ingredient'));

const baseServings = scaler ? Number(scaler.dataset.baseServings) : 0;
// "Serves" for a meal, "Makes" for a tray of biscuits. Decided at build time.
const yieldWord = scaler?.dataset.yieldWord ?? 'Serves';
let servings = baseServings;

/** Reconstruct the ingredient record the build put into data-* attributes. */
function itemFrom(button) {
  return {
    quantity: button.dataset.quantity === '' ? null : Number(button.dataset.quantity),
    unit: button.dataset.unit || null,
    item: button.dataset.item,
    note: null,
    raw: button.dataset.raw,
  };
}

function renderScale() {
  const factor = servings / baseServings;
  for (const button of ingredientButtons) {
    const amount = button.querySelector('.ing-amount');
    if (!amount || button.dataset.quantity === '') continue;
    amount.textContent = formatAmount(itemFrom(button), factor);
  }
  servingsOut.textContent = String(servings);
  if (servesPill) servesPill.textContent = `${yieldWord} ${servings}`;
  resetScale.hidden = servings === baseServings;
}

function setServings(next) {
  const clamped = Math.max(1, Math.min(100, next));
  if (clamped === servings) return;
  servings = clamped;
  renderScale();
}

if (scaler && baseServings > 0) {
  scaler.addEventListener('click', (event) => {
    const stepButton = event.target.closest('button[data-step]');
    if (stepButton) {
      setServings(servings + Number(stepButton.dataset.step));
      return;
    }
    if (event.target.closest('#scaler-reset')) setServings(baseServings);
  });
}

/* ---------- ticking off ----------
 * Ingredients and steps are both toggle buttons, so aria-pressed carries the state and
 * a screen reader announces it. Nothing is persisted: a half-ticked recipe is state
 * about right now, not about the recipe, and finding yesterday's ticks still there
 * would be worse than starting clean. */

function toggle(button) {
  const pressed = button.getAttribute('aria-pressed') === 'true';
  button.setAttribute('aria-pressed', String(!pressed));
}

for (const button of ingredientButtons) {
  button.addEventListener('click', () => toggle(button));
}

const stepButtons = Array.from(document.querySelectorAll('.step'));
const stepProgress = document.getElementById('step-progress');

function renderProgress() {
  if (!stepProgress) return;
  const done = stepButtons.filter((b) => b.getAttribute('aria-pressed') === 'true').length;
  stepProgress.textContent = `Tap a step to mark it done. ${done} of ${stepButtons.length} done.`;
}

for (const button of stepButtons) {
  button.addEventListener('click', () => {
    toggle(button);
    renderProgress();
  });
}

/* ---------- cook mode ----------
 * One step at a time in large type, with the screen held awake. The steps are read out
 * of the page rather than duplicated into a data structure. */

const dialog = document.getElementById('cook');
const openButton = document.getElementById('cook-mode');
const stepText = document.getElementById('cook-step');
const stepTime = document.getElementById('cook-step-time');
const progress = document.getElementById('cook-progress');
const awakeFlag = document.getElementById('cook-awake');
const prevButton = document.getElementById('cook-prev');
const nextButton = document.getElementById('cook-next');
const closeButton = document.getElementById('cook-close');

let current = 0;
let wakeLock = null;

const steps = stepButtons.map((button) => ({
  text: button.querySelector('.step-text')?.textContent ?? '',
  time: button.querySelector('.step-time')?.textContent.trim() ?? '',
}));

function renderStep() {
  const step = steps[current];
  if (!step) return;
  stepText.textContent = step.text;
  stepTime.textContent = step.time;
  progress.textContent = `Step ${current + 1} of ${steps.length}`;
  prevButton.disabled = current === 0;
  nextButton.textContent = current === steps.length - 1 ? 'Finished' : 'Next';
}

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    awakeFlag.hidden = false;
    wakeLock.addEventListener('release', () => {
      awakeFlag.hidden = true;
    });
  } catch {
    // Denied, unsupported, or the tab is not visible. Cook mode still works.
    awakeFlag.hidden = true;
  }
}

async function releaseWakeLock() {
  try {
    await wakeLock?.release();
  } catch {
    // Already gone.
  }
  wakeLock = null;
  awakeFlag.hidden = true;
}

openButton?.addEventListener('click', () => {
  if (!steps.length) return;
  // Pick up where the ticking got to, so cook mode and the list agree.
  const firstUndone = stepButtons.findIndex((b) => b.getAttribute('aria-pressed') !== 'true');
  current = firstUndone === -1 ? 0 : firstUndone;
  renderStep();
  dialog.showModal();
  // A modal dialog focuses its first focusable child, which here is Done. Enter would
  // then close cook mode rather than advance it, so move focus to Next.
  nextButton?.focus();
  acquireWakeLock();
});

closeButton?.addEventListener('click', () => dialog.close());

prevButton?.addEventListener('click', () => {
  if (current > 0) {
    current -= 1;
    renderStep();
  }
});

nextButton?.addEventListener('click', () => {
  // Advancing past a step marks it done, so the list reflects the cook.
  stepButtons[current]?.setAttribute('aria-pressed', 'true');
  renderProgress();
  if (current < steps.length - 1) {
    current += 1;
    renderStep();
  } else {
    dialog.close();
    toast('Nicely done.');
  }
});

// Esc closes the dialog natively, so release the lock on whichever route out is taken.
dialog?.addEventListener('close', releaseWakeLock);

// A wake lock is dropped when the tab is hidden, so take it again on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && dialog?.open && !wakeLock) acquireWakeLock();
});

// Arrow keys feel natural once you are stood at the bench.
dialog?.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight') nextButton.click();
  if (event.key === 'ArrowLeft') prevButton.click();
});

registerServiceWorker();
