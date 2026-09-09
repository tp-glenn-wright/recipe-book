// Controlled vocabularies for the recipe schema.
//
// CLOSED lists fail validation on an unknown value. They exist where a free-for-all
// would break filtering or scaling.
// OPEN lists only warn, so the vocabulary can grow, but you see it happening rather
// than ending up with both "slow-cook" and "slowcook".

/** Units usable in ingredient quantities. Closed. */
export const UNITS = [
  'g', 'kg', 'ml', 'l',
  'tsp', 'tbsp', 'cup',
  'clove', 'piece', 'slice', 'sprig', 'stalk', 'bunch', 'head',
  'can', 'packet', 'sheet',
  'pinch', 'handful', 'to taste',
];

/** Grams per unit, for nutrition estimation and for per-100g reconciliation. Approximate. */
export const UNIT_GRAMS = {
  g: 1, kg: 1000, ml: 1, l: 1000,
  tsp: 5, tbsp: 15, cup: 240,
  pinch: 0.5, handful: 30,
};

/** Primary protein, used as a dedicated filter facet. Closed. */
export const MAIN_PROTEINS = [
  'beef', 'lamb', 'pork', 'chicken', 'duck', 'turkey', 'venison', 'goat',
  'fish', 'seafood',
  'egg', 'dairy',
  'tofu', 'tempeh', 'legume', 'nut', 'grain',
  'none',
];

/** Course. Closed. A recipe may sit in more than one. */
export const COURSES = [
  'breakfast', 'brunch', 'lunch', 'dinner',
  'starter', 'main', 'side', 'salad', 'soup',
  'dessert', 'baking', 'bread',
  'sauce', 'condiment', 'dressing', 'stock',
  'drink', 'snack',
];

/** Difficulty. Closed. */
export const DIFFICULTIES = ['easy', 'medium', 'hard'];

/** Where the nutrition numbers came from. Closed, and it matters. */
export const NUTRITION_SOURCES = ['label', 'calculated', 'estimated'];

/** Where the recipe itself came from. Closed. */
export const SOURCE_KINDS = ['photo', 'book', 'magazine', 'url', 'family', 'original', 'restaurant'];

/** Where a dish image came from. Closed. Licensing depends on this. */
export const IMAGE_SOURCES = ['own-photo', 'from-source', 'ai-generated', 'web'];

/** Tags. OPEN: a new value warns rather than fails. */
export const KNOWN_TAGS = [
  'quick', 'make-ahead', 'freezer-friendly', 'one-pot', 'no-cook',
  'slow-cook', 'pressure-cooker', 'air-fryer', 'bbq', 'oven', 'stovetop',
  'vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'nut-free', 'low-carb', 'high-protein',
  'spicy', 'comfort-food', 'crowd-pleaser', 'weeknight', 'weekend-project',
  'kids', 'leftovers', 'budget', 'special-occasion',
];

/** Cuisines. OPEN. */
export const KNOWN_CUISINES = [
  'New Zealand', 'Australian', 'British', 'French', 'Italian', 'Spanish', 'Portuguese',
  'Greek', 'Turkish', 'Middle Eastern', 'Moroccan', 'North African', 'West African',
  'American', 'Mexican', 'Peruvian', 'Brazilian', 'Caribbean',
  'Chinese', 'Japanese', 'Korean', 'Thai', 'Vietnamese', 'Malaysian', 'Indonesian',
  'Indian', 'Sri Lankan', 'Pakistani', 'Filipino',
  'Nordic', 'German', 'Polish', 'Russian', 'Pacific',
];

/** Nutrient fields required in both perServing and per100g. */
export const NUTRIENTS = [
  'kj', 'kcal', 'proteinG', 'fatG', 'saturatedFatG',
  'carbsG', 'sugarsG', 'fibreG', 'sodiumMg',
];

/** Human labels for the nutrition panel, in NZ nutrition information panel order.
 *  `sub: true` rows are indented under the row above, as on a printed panel. */
export const NUTRIENT_LABELS = [
  { key: 'kj', label: 'Energy', unit: 'kJ' },
  { key: 'kcal', label: 'Energy', unit: 'kcal', sub: true },
  { key: 'proteinG', label: 'Protein', unit: 'g' },
  { key: 'fatG', label: 'Fat, total', unit: 'g' },
  { key: 'saturatedFatG', label: 'Saturated', unit: 'g', sub: true },
  { key: 'carbsG', label: 'Carbohydrate', unit: 'g' },
  { key: 'sugarsG', label: 'Sugars', unit: 'g', sub: true },
  { key: 'fibreG', label: 'Dietary fibre', unit: 'g' },
  { key: 'sodiumMg', label: 'Sodium', unit: 'mg' },
];
