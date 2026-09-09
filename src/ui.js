// Shared browser helpers: service worker registration, the offline control, and toasts.
//
// Both pages import this. Nothing here touches innerHTML.

/** The site root relative to the current page, stamped into body by the build. */
export function root() {
  return document.body.dataset.root ?? '';
}

let toastTimer = null;

/** Brief status message. Uses textContent, so message content is never parsed. */
export function toast(message, ms = 2800) {
  const element = document.getElementById('toast');
  if (!element) return;
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.hidden = true;
  }, ms);
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  // file:// has no service worker support, and there is no point warning about it.
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
  try {
    return await navigator.serviceWorker.register(`${root()}sw.js`, { scope: root() || './' });
  } catch (error) {
    console.warn('service worker registration failed', error);
    return null;
  }
}

/**
 * Warm the cache for the whole book, for cooking somewhere with no signal.
 * The worker reports progress back so the button can say something truthful.
 */
export function wireOfflineButton(button) {
  if (!button || !('serviceWorker' in navigator)) return;
  button.hidden = false;

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'cache-all-done') return;
    const { cached, total } = event.data;
    button.disabled = false;
    button.textContent = 'Saved for offline';
    toast(cached === total
      ? `All ${total} files saved. The book works with no signal now.`
      : `Saved ${cached} of ${total} files. Try again on a better connection.`);
  });

  button.addEventListener('click', async () => {
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active;
    if (!worker) {
      toast('Still setting up. Try again in a moment.');
      return;
    }
    button.disabled = true;
    button.textContent = 'Saving...';
    toast('Downloading the whole book...');
    worker.postMessage({ type: 'cache-all' });
  });
}
