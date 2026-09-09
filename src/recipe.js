// Recipe page: the servings scaler and cook mode.
//
// Both are progressive enhancement. The page is complete and readable before this file
// runs, and everything here updates existing nodes via textContent.

import { formatAmount } from './scale.js';
import { registerServiceWorker, toast } from './ui.js';

/* ---------- servings scaler ---------- */

const scaler = document.getElementById('scaler');
const servingsOut = document.getElementById('servings-out');
const servesPill = document.getElementById('serves-pill');
const resetScale = document.getElementById('scaler-reset');
const ingredientItems = Array.from(document.querySelectorAll('.ingredients-list li'));

const baseServings = scaler ? Number(scaler.dataset.baseServings) : 0;
// "Serves" for a meal, "Makes" for a tray of biscuits. Decided at build time.
const yieldWord = scaler?.dataset.yieldWord ?? 'Serves';
let servings = baseServings;

/** Reconstruct the ingredient record the build put into data-* attributes. */
function itemFrom(li) {
  return {
    quantity: li.dataset.quantity === '' ? null : Number(li.dataset.quantity),
    unit: li.dataset.unit || null,
    item: li.dataset.item,
    note: null,
    raw: li.dataset.raw,
  };
}

function renderScale() {
  const factor = servings / baseServings;
  for (const li of ingredientItems) {
    const amount = li.querySelector('.ing-amount');
    if (!amount || li.dataset.quantity === '') continue;
    amount.textContent = formatAmount(itemFrom(li), factor);
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
    const button = event.target.closest('button[data-step]');
    if (button) {
      setServings(servings + Number(button.dataset.step));
      return;
    }
    if (event.target.closest('#scaler-reset')) setServings(baseServings);
  });
}

/* ---------- cook mode ----------
 * One step at a time in large type, with the screen held awake. The steps are read
 * out of the page rather than duplicated into a data structure. */

const dialog = document.getElementById('cook');
const openButton = document.getElementById('cook-mode');
const stepNodes = Array.from(document.querySelectorAll('#steps li'));
const stepText = document.getElementById('cook-step');
const stepTime = document.getElementById('cook-step-time');
const progress = document.getElementById('cook-progress');
const awakeFlag = document.getElementById('cook-awake');
const prevButton = document.getElementById('cook-prev');
const nextButton = document.getElementById('cook-next');
const closeButton = document.getElementById('cook-close');

let current = 0;
let wakeLock = null;

const steps = stepNodes.map((li) => ({
  text: li.querySelector('p')?.textContent ?? '',
  time: li.querySelector('.step-time')?.textContent ?? '',
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

function openCookMode() {
  if (!steps.length) return;
  current = 0;
  renderStep();
  dialog.showModal();
  acquireWakeLock();
}

openButton?.addEventListener('click', openCookMode);
closeButton?.addEventListener('click', () => dialog.close());
prevButton?.addEventListener('click', () => {
  if (current > 0) {
    current -= 1;
    renderStep();
  }
});
nextButton?.addEventListener('click', () => {
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

// Swiping and arrow keys both feel natural once you are stood at the bench.
dialog?.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight') nextButton.click();
  if (event.key === 'ArrowLeft') prevButton.click();
});

registerServiceWorker();
