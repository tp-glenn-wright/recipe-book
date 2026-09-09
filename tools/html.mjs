// Auto-escaping HTML construction.
//
// Recipe text is extracted from photographs by a model, which makes it untrusted
// input. This module is the only sanctioned way to build HTML in this repo, and it
// escapes every interpolated value by default. Unescaped output requires an explicit
// raw() call, which greps trivially in review.
//
// tools/security.mjs fails the build if HTML is assembled any other way.

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape a value for interpolation into HTML text or a quoted attribute. */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Marker for pre-escaped markup. Wrapping a value in this bypasses escaping. */
class RawHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

/**
 * Assert that a string is already safe markup.
 * Only ever call this on markup produced by html`` itself, or on a literal you wrote
 * by hand in this repo. Never on anything derived from a recipe file.
 */
export function raw(value) {
  return new RawHtml(String(value));
}

function interpolate(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof RawHtml) return value.value;
  if (Array.isArray(value)) return value.map(interpolate).join('');
  return escapeHtml(value);
}

/** Tagged template that escapes every interpolated value. Returns RawHtml so it nests. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += interpolate(values[i]) + strings[i + 1];
  }
  return new RawHtml(out);
}

/** Render a top-level html`` result to a string for writing to disk. */
export function render(node) {
  if (node instanceof RawHtml) return node.value;
  return interpolate(node);
}

/**
 * Serialise an object for embedding in a <script type="application/ld+json"> block.
 * Escapes the sequences that could break out of a script element, plus the line
 * separators that are legal in JSON but not in JavaScript string literals.
 */
export function jsonLd(object) {
  const json = JSON.stringify(object, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return raw(json);
}

/** Escape a value for use inside a data-* attribute used by client-side filtering. */
export function attr(value) {
  return escapeHtml(value === null || value === undefined ? '' : String(value));
}
