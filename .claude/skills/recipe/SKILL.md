---
name: recipe
description: Add or update a recipe in this repo from a photo, screenshot, pasted text or URL. Extracts the recipe, normalises it into the project schema with standardised metric quantities and tags, estimates nutrition when the source gives none, installs and strips the metadata from any photo, then validates. Use whenever Glenn pastes a recipe image or recipe text, or says "add this recipe", "here's a new recipe", "put this in the recipe book", or asks to fix or update a recipe that is already in there.
---

# Adding a recipe

The point of this skill is that every recipe comes out the same shape, so the site stays
consistent and the filters keep working. Read `CLAUDE.md` for the schema; this file is
the procedure.

## 1. Work out what you have been given

A photo of a cookbook page, a phone screenshot, a block of pasted text, a URL, or a
photo of handwriting. Also work out whether there is more than one recipe in the frame,
which happens with cookbook spreads. If there are two, ask which one he wants rather
than picking, unless he has already said.

If part of the source is genuinely unreadable, say so and ask. Do not fill a gap with a
plausible-looking quantity. A wrong number in a recipe is worse than a question.

## 2. Transcribe before you normalise

Write out the ingredients and method as they actually appear, verbatim, before
converting anything. This is what goes in each ingredient's `raw` field, and doing it
first stops detail being lost in the conversion. Keep the original phrasing even where
it is loose: "1 tin coconut cream", "a good handful of coriander", "butter, for
greasing".

## 3. Decide new or update

The slug comes from the title: lowercase, hyphens, ASCII. Check whether
`recipes/<slug>.json` already exists.

- New recipe: `added` and `updated` are both today.
- Updating one: keep the original `added`, set `updated` to today, and keep the existing
  `rating` unless he has said otherwise.

## 4. Normalise the ingredients

Every rule is in `CLAUDE.md` under "Normalisation rules". The ones that catch people
out:

- `quantity` is a number or null, never a string. `unit` comes from the closed list in
  `tools/vocab.mjs`.
- A bare count takes `unit: null`, so it reads "8 shallots". Only use `piece` where you
  would say the word out loud.
- Split preparation out of the ingredient name: `item: "garlic"`, `note: "peeled"`, not
  `item: "peeled garlic"`. The scaler shows the item name, and the note reads as an
  aside after it.
- Cups of flour, sugar and other dry baking staples convert to grams. Spoons stay
  spoons.
- Group the ingredients when the recipe does, or when it has a clear paste, marinade or
  topping. A single ungrouped list uses `group: null`.

## 5. Split the method into steps

One action per step. Break a paragraph into the actions it actually contains. Put a
duration in `minutes` where the step takes real time, null where it does not. Do not
number the text; the page does that.

## 6. Times, servings and serving size

`prepMinutes` and `cookMinutes` from the source where stated, otherwise estimated from
the method. `totalMinutes` is at least their sum, and more when there is resting,
marinating or chilling, which is the point of having it separate.

`servings` from the source, or inferred from the quantities. `servingSizeG` is grams of
*finished* dish per serving, which means you need the finished mass, which you need for
the nutrition anyway.

## 7. Nutrition

Always required. If the source printed a panel, use it and set `source: "label"`.
Otherwise estimate, and set `source: "estimated"`.

Read `references/composition.md` for per-100g values and cooking loss factors. The
method:

1. Multiply each ingredient's mass by its per-100g values to get its contribution.
   Ignore anything that contributes nothing, like water, and anything not actually
   eaten, like a poaching liquid that gets discarded.
2. Sum the contributions for the whole recipe.
3. Estimate the finished mass, applying a cooking loss factor from the reference.
4. `per100g` = totals ÷ finished mass × 100.
5. `servingSizeG` = finished mass ÷ `servings`, rounded sensibly.
6. `perServing` = `per100g` × `servingSizeG` ÷ 100.
7. `kj` = `kcal` × 4.184, for both blocks.
8. Sanity check: 4×protein + 4×carbs + 9×fat should land within about 15% of the kcal.
   If it does not, a macro is wrong.

Write `assumptions` properly. Total cooked mass, serving size, salted or unsalted
butter, whether the marinade counts. It is the field that makes the guess auditable, and
the site shows it.

## 8. The photo, if there is one

Only if Glenn provides a dish photo or asks you to find one. A recipe with
`"image": null` renders a lettered placeholder and looks fine, so do not go hunting for
an image unprompted.

```
node tools/recipes.mjs add-image <source-file> <slug>
```

That resizes to 1600px on the long edge, re-encodes, strips every metadata segment and
verifies none survived. Never copy a file into `images/` by hand: phone photos carry GPS
and this repo is public, and `sips` on its own writes Exif and IPTC blocks back in.

For an image from the web, `credit`, `licence` and `url` are all required, and the file
is downloaded and committed rather than hotlinked. If you cannot establish the licence,
do not use it.

## 9. Write, validate, report

Write `recipes/<slug>.json`, then:

```
node tools/recipes.mjs check
```

If that does not pass, the recipe is not added. Fix it. Warnings about a new tag or
cuisine are fine, but read them: an existing tag is usually better than a new one, and
if the new one is right, add it to `KNOWN_TAGS` in `tools/vocab.mjs` in the same change.

Then tell Glenn what went in, and separately and explicitly, what you guessed rather
than read. Estimated nutrition, inferred servings, assumed times, an assumed cooked
mass. That is the part worth his attention, and leading with "done" while burying the
guesses is the failure mode to avoid here.

Do not commit or push unless he asks.

## Handling a few specific cases

**A recipe with no method, just ingredients.** Ask. Do not invent a method.

**A recipe in imperial with no metric.** Convert, and note in `assumptions` that the
quantities were converted, because cup-to-gram conversions for flour vary by up to 15%
depending on how it is scooped.

**A recipe that makes a component, like a spice paste or a stock.** That is a real
recipe. Use `course: ["sauce"]` or `["stock"]` and `mainProtein: "none"`, and set
servings to however many portions the component yields.

**A baking recipe.** `mainProtein: "none"`, `course: ["baking"]` plus whatever else
fits, and `servings` is the number of biscuits or slices, not the number of people. The
serving size is then one biscuit, which is what makes the per-serving nutrition useful.

**He asks you to fix a recipe already in there.** Read the existing file first, keep
`added` and `rating`, change only what he asked about, and run `check` afterwards.
