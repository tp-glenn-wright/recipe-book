// App icons, generated rather than checked in, so there is no binary asset to keep in
// step with the palette. A plate seen from above: warm ground, cream rim, cream centre.

import { renderPng } from './png.mjs';

const ACCENT = [168, 65, 27];
const CREAM = [250, 244, 235];

/** Signed distance helpers, all in normalised 0..1 space. */
const dist = (x, y) => Math.hypot(x - 0.5, y - 0.5);

function roundedSquareAlpha(x, y, radius) {
  // Signed distance to a rounded square filling the canvas.
  const dx = Math.abs(x - 0.5) - (0.5 - radius);
  const dy = Math.abs(y - 0.5) - (0.5 - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - radius;
  return outside <= 0 ? 255 : 0;
}

function shade(x, y) {
  const ground = roundedSquareAlpha(x, y, 0.22);
  if (!ground) return [0, 0, 0, 0];
  const r = dist(x, y);
  const onRim = r > 0.275 && r < 0.335;
  const inCentre = r < 0.205;
  if (onRim || inCentre) return [...CREAM, 255];
  return [...ACCENT, 255];
}

/** Sizes: 192 and 512 for the web manifest, 180 for iOS home screen. */
export const ICON_SIZES = [180, 192, 512];

export function renderIcon(size) {
  return renderPng(size, shade);
}
