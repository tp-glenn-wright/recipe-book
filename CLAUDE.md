# Recipe book

A personal recipe collection. Glenn pastes in a photo of a recipe, or a block of text,
and says something like "add this recipe". You extract it, normalise it into the schema
below, estimate the nutrition if the source does not give it, and write one JSON file.
Pushing to `main` builds a static site and publishes it to GitHub Pages.

**When Glenn pastes a recipe photo, a screenshot, a URL or a block of recipe text, use
the `recipe` skill.** It has the full procedure and a food composition reference for the
nutrition estimates. Do not freehand it; the skill exists so every recipe comes out the
same shape.

## Shape of the repo

```
recipes/<slug>.json    the only source of truth, one file per recipe
images/<slug>.jpg      dish photos, already resized and stripped of metadata
src/                   what ships to the browser: css, js, service worker
tools/                 build-time code: build, validate, security gates, templates
dist/                  generated, gitignored, never committed
```

Commands:

```
node tools/recipes.mjs check                  validate everything, then the security gates
node tools/recipes.mjs validate               schema only
node tools/recipes.mjs add-image <file> <slug>  resize a photo and strip its metadata
node tools/build.mjs                          build dist/
node --test tools/test.mjs                    tests
python3 -m http.server 8000 -d dist           preview
```

## Two hard rules

**Zero dependencies.** Everything is the Node standard library. `tools/security.mjs`
fails the build if `package.json` ever declares a dependency in any category. If one is
genuinely needed, that is a conversation to have with Glenn first, not a thing to
install.

**Recipe text is untrusted input.** It came out of a photograph via a model. It never
reaches the DOM as HTML. Build-time HTML goes through the `html` tagged template in
`tools/html.mjs`, which escapes every interpolated value; client-side code uses
`textContent` and DOM construction only. The security gate fails the build on
`innerHTML`, `insertAdjacentHTML`, `document.write`, `eval` and friends.

Two related rules that also exist for a reason:

- Every image in `images/` must be metadata-free. Phone photos carry GPS, and this repo
  is public. Always install photos with `add-image`, which re-encodes and strips them.
  Never copy a photo into `images/` by hand.
- Nothing external. No CDN, no webfont, no analytics. The Content-Security-Policy names
  `'self'` and nothing else, and the gate fails the build on an absolute URL in a `src`
  or `href`.

## The schema

One file per recipe at `recipes/<slug>.json`, where `<slug>` matches the `id` field.
Every field below is required; use `null` where the schema allows it rather than
omitting the key. Unknown fields fail validation.

```jsonc
{
  "schemaVersion": 1,
  "id": "beef-rendang",              // lowercase, hyphens, must equal the filename
  "title": "Beef Rendang",
  "description": "One or two sentences. What it is and what to watch for.",
  "image": null,                     // or the object described below
  "source": {
    "kind": "book",                  // photo book magazine url family original restaurant
    "citation": "Sri Owen, Indonesian Regional Food and Cookery",
    "url": null
  },
  "added": "2026-09-09",             // ISO date, the day it went in
  "updated": "2026-09-09",           // never earlier than added
  "cuisine": "Indonesian",           // or null. Open vocabulary, warns when new
  "course": ["main", "dinner"],      // closed vocabulary, at least one
  "mainProtein": "beef",             // closed vocabulary, "none" for baking etc
  "tags": ["slow-cook", "spicy"],    // open vocabulary, warns when new
  "rating": 5,                       // 1 to 5, or null if untried
  "difficulty": "medium",            // easy medium hard
  "prepMinutes": 30,
  "cookMinutes": 180,
  "totalMinutes": 210,               // never less than prep + cook; more if it rests
  "servings": 6,
  "servingSizeG": 250,               // grams of finished dish per serving, or null
  "equipment": ["heavy casserole"],  // may be empty
  "ingredients": [                   // at least one group
    {
      "group": "Spice paste",        // or null for an ungrouped list
      "items": [
        {
          "quantity": 6,             // a NUMBER, or null. Never "6 cloves"
          "unit": "clove",           // closed vocabulary, or null for a bare count
          "item": "garlic",          // the ingredient alone, no amount, no preparation
          "note": "peeled",          // preparation, or null
          "raw": "6 cloves garlic, peeled"  // the original line, verbatim
        }
      ]
    }
  ],
  "steps": [
    { "text": "One action per step.", "minutes": 10 }  // minutes may be null
  ],
  "notes": ["Better the next day."],  // may be empty
  "nutrition": {
    "source": "estimated",            // label calculated estimated
    "assumptions": "Required whenever source is estimated or calculated.",
    "perServing": { "kj": 2100, "kcal": 502, "proteinG": 34, "fatG": 32, "saturatedFatG": 18, "carbsG": 12, "sugarsG": 6, "fibreG": 3, "sodiumMg": 620 },
    "per100g":    { "kj": 840,  "kcal": 201, "proteinG": 13.6, "fatG": 12.8, "saturatedFatG": 7.2, "carbsG": 4.8, "sugarsG": 2.4, "fibreG": 1.2, "sodiumMg": 248 }
  }
}
```

The closed vocabularies live in `tools/vocab.mjs`. Read that file rather than guessing.
A value outside a closed list is an error; a new `tag` or `cuisine` is a warning, which
means it is allowed but you should check an existing one would not do instead. If a new
tag really is right, add it to `KNOWN_TAGS` in the same change.

## Normalisation rules

**Numbers are numbers.** `"prepMinutes": 15`, never `"15 mins"`. `"proteinG": 34`, never
`"34g"`. This is what makes sorting, filtering and the servings scaler work.

**Metric, NZ spelling.** Convert as you go: 1 cup flour is 150 g, 1 cup sugar 200 g, 1
cup rolled oats 90 g, 1 cup desiccated coconut 85 g, 1 stick butter 113 g, 1 oz 28 g, 1
lb 454 g, 1 fl oz 30 ml, 1 pint 473 ml. Oven temperatures in °C. Write "fibre", not
"fiber", and "flavour", not "flavor".

**`raw` keeps the original, the fields carry the machine-readable version.** So a tin of
coconut cream becomes `quantity: 400, unit: "ml", item: "coconut cream"` with
`raw: "1 tin (400 ml) coconut cream"`. Both are shown: `raw` is what a cook reads when
there is nothing to scale, the numbers are what the scaler multiplies.

**Units.** Use the closed list in `tools/vocab.mjs`. Two rules that come up constantly:

- A bare count takes `unit: null`, so it reads "8 shallots" rather than "8 pieces
  shallots". Use `piece` only where you would genuinely say the word: "2 pieces of star
  anise". `clove`, `stalk`, `sprig`, `head`, `can`, `sheet` all read naturally, so use
  them where they fit.
- `unit: "to taste"` takes `quantity: null`. Every other unit needs a quantity, because
  the scaler has nothing to multiply otherwise.

**Mass over volume where it matters.** For flour, sugar and other dry baking
ingredients, convert cups to grams, because volume measures of flour are unreliable.
Keep spoons as spoons.

**Steps.** One action per step, and split a wall of prose into discrete steps rather
than copying a paragraph. Put a rough duration in `minutes` where the step takes real
time; leave it null for something instant like heating the oven. Do not number the text
itself, the page numbers them.

**Slugs.** Lowercase, hyphens, ASCII, derived from the title. "Nan's Ginger Crunch"
becomes `nans-ginger-crunch`.

**Missing information.** If the source does not state servings, infer a sensible number
from the quantities and say so in `nutrition.assumptions`. If it does not state times,
estimate them from the method. Never leave a required field blank, and never invent a
citation for something you cannot attribute: use `kind: "photo"` with
`citation: null` when a photo is all there is.

## Nutrition

Nutrition is always required, so if the source gives none, estimate it. The full method
and a composition reference are in the `recipe` skill. The rules that matter:

- Fill in both `perServing` and `per100g`, and make them consistent. The validator
  divides one by the other using `servings` and `servingSizeG` and fails if they
  disagree by more than 10%. Work out `per100g` first from total mass, then multiply.
- `kj` must equal `kcal` × 4.184 within 2%. It is a fixed conversion, not an estimate.
- Set `source` honestly: `label` only if you read it off packaging or the source printed
  a nutrition panel, `calculated` if you worked it out from weighed ingredients,
  `estimated` for everything else. Estimated is the normal case and there is no shame in
  it, but the site shows the flag, so it must be true.
- `assumptions` is required for `estimated` and `calculated`. Say what you assumed:
  total cooked mass, serving size, whether the butter was salted, how much of the
  marinade actually gets eaten. This is the field that makes a guess auditable.
- `sugarsG` cannot exceed `carbsG`, and `saturatedFatG` cannot exceed `fatG`.

## Images

`image` is `null` unless there is a photo, and that is the normal case for a recipe
pasted from a book. The site renders a lettered placeholder, which looks fine.

With a photo, install it first:

```
node tools/recipes.mjs add-image ~/Desktop/IMG_1234.jpg beef-rendang
```

Then reference it:

```jsonc
"image": {
  "file": "images/beef-rendang.jpg",
  "alt": "Dark braised beef in a shallow bowl, scattered with fried shallots",
  "source": "own-photo",      // own-photo from-source ai-generated web
  "credit": null,
  "licence": null,
  "url": null
}
```

`alt` is required and is not decoration: write what is actually in the frame. For
`source: "web"` or `"ai-generated"`, `credit` and `licence` are required, and `web` also
requires `url`. If you cannot establish a licence, do not use the image. Never hotlink;
the file is downloaded, stripped and committed like any other.

## Finishing a recipe

1. Write `recipes/<slug>.json`.
2. Run `node tools/recipes.mjs check`. If it does not pass, the recipe is not added.
   Fix it rather than reporting it as done.
3. Tell Glenn what you added, and be explicit about what you guessed rather than read:
   estimated nutrition, inferred servings, assumed times. That is the part he needs to
   sanity check, and burying it is worse than not estimating at all.
4. Do not commit or push unless he asks. If he does and the branch is `main`, branch
   first.

## Style

Prose over bullets in anything user-facing. No em dashes, use a comma or a hyphen. NZ
spelling. In recipe `description` and `notes`, write like a cook talking to another
cook: what it is, what to watch for, what goes wrong. Skip "delicious", "amazing" and
"perfect".
