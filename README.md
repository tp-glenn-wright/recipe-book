# Recipe book

A personal recipe collection. Photograph a recipe, paste it into Claude Code in this
repo, and it becomes a page on a static site. Push to `main` and it publishes.

No dependencies, no framework, no build tooling beyond the Node standard library. That
is a deliberate choice: this should still work in three years with no attention paid to
it, and the only way to guarantee that is to have nothing in it that can rot.

## Adding a recipe

Open this repo in Claude Code, paste in a photo or the text, and say "add this recipe".
It reads the source, normalises it into the schema, estimates the nutrition if the
source gives none, writes `recipes/<slug>.json` and validates it. It will tell you what
it guessed rather than read, which is the part worth checking.

Then commit and push, and the site rebuilds itself.

If there is a photo of the dish:

```sh
node tools/recipes.mjs add-image ~/Desktop/IMG_1234.jpg beef-rendang
```

That resizes it, re-encodes it and strips every metadata segment. Do not copy photos
into `images/` by hand, for reasons under Security below.

## Commands

```sh
node tools/recipes.mjs check     # validate every recipe, then the security gates
node tools/recipes.mjs validate  # schema only
node tools/build.mjs             # build dist/
node --test tools/test.mjs       # tests
npm run serve                    # build, then serve dist/ on :8000
```

## How it is put together

`recipes/*.json` is the only source of truth. One file per recipe, matching the schema
documented in `CLAUDE.md`. Quantities are numbers with the unit in the field name, never
strings like `"400g"`, which is what makes sorting, filtering and the servings scaler
work.

The build renders a full HTML page per recipe, plus an index that already contains every
recipe card with its facets in `data-` attributes. Filtering is then a matter of
toggling `hidden` on nodes that are already there, so there is no fetch and nothing to
wait for on a phone. With JavaScript off you still get the whole readable list, and
every recipe page still reads.

```
recipes/            source of truth
images/             dish photos, resized and metadata-free
src/                what ships to the browser: css, js, fonts, service worker
tools/              build, validate, security gates, templates, tests
dist/               generated, gitignored
.github/workflows/  ci.yml gates, deploy.yml publishes
```

## Styling

`src/tokens.css` is the TracPlus design system as issued, lifted verbatim from the
Claude Design canvas so it can be diffed when the canvas changes. `src/style.css` is
this site's use of it, and any deviation lives there rather than being edited into the
token file. An `--rb-*` layer between the two names what each colour is *for* and points
at the brand tokens, so a colour change happens in one place.

**Colour is the canvas palette exactly, light only.** The canvas defines no dark mode
and matching the design was the priority, so there isn't one.

That has a contrast consequence, recorded here rather than left unstated. Measured
against `#E8EFF6`, the lightest surface text sits on, four values fall below WCAG AA,
which is 4.5:1 for normal text:

| token | value | ratio | used for |
|---|---|---|---|
| `--text-secondary` | `#808285` | 3.54:1 | secondary body text |
| `--text-tertiary` | `#A0A4A8` | 2.32:1 | ingredient notes, card meta |
| `--color-ink-blue` | `#2A93D5` | 3.11:1 | the 12px uppercase group labels |
| `--color-blue` | `#3192CF` | 3.15:1 | links, and white labels on the button fill |

The white-on-blue button pairing is 3.42:1. If it ever wants fixing, the accessible
variants that keep the same hue are `#5A5C5F`, `#6B6C6F`, `#2172A6` and `#2672A2`, and
the navy already passes at 7.94:1, so the system has a compliant option. That is a
change to make in the design system rather than only here.

The one remaining deviation is type size: body text is 16px weight 400 rather than the
system's 14px weight 300, and ingredient rows are 16px rather than 15.5px. The system is
built for a dense console read at desk distance; this gets read at arm's length on a
bench. The canvas itself already used 15.5px and 17px for content.

The canvas has no media queries, so the responsive layout is this project's work, built
from the canvas tokens: everything stacks below 60rem, and the two-column body with
inline step time chips appears above it.

Fonts are self-hosted: Figtree 600/700 and Open Sans 400/600, latin subset, 123 kB
total, extracted from the design bundle so they are byte-identical to what the canvas
used. Both families are open-licensed (OFL), and self-hosting is what lets the CSP stay
at `font-src 'self'` with no external request.

## Setting up GitHub Pages

Once, in the repo settings:

1. **Pages**: set the source to **GitHub Actions**. Do not pick a branch; the deploy
   workflow uploads an artefact.
2. **Code security**: turn on secret scanning and push protection, Dependabot alerts,
   and CodeQL default setup for JavaScript. All free on a public repo, and all
   configured here rather than as workflow files, so there is less YAML to maintain.

Then push to `main`. The deploy workflow runs the tests and the security gates before it
publishes, so a failing gate means the site does not update.

## Security

Four things are enforced, each for a specific reason rather than as a checklist. They
live in `tools/security.mjs` and run in CI.

**Recipe text is untrusted input.** It came out of a photograph via a language model. If
it reached the page as HTML there would be a script injection path into the site. All
build-time HTML goes through the auto-escaping `html` tagged template in
`tools/html.mjs`, client-side code uses `textContent` and DOM construction only, and the
gate fails the build on `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval` and
similar. A `Content-Security-Policy` meta tag on every page allows `'self'` and nothing
else, which is why there is no CDN and no webfont.

**Phone photos carry GPS.** A picture of dinner taken at home has the coordinates of the
house in its Exif, and this repo is public. `tools/exif.mjs` parses JPEG segments and
PNG chunks, strips every metadata block, and reports whether a GPS IFD was present. The
gate then fails the build if anything in `images/` still carries metadata, so a photo
committed by hand cannot slip through. Worth knowing: `sips` on its own is not
sufficient, it writes its own Exif and IPTC blocks on the way out.

**GitHub Actions is the only supply chain here.** With no npm dependencies it is the
only third-party code in the pipeline. Only first-party `actions/*` are used, each
pinned to a full commit SHA rather than a tag, because a tag can be moved. Workflows
default to `contents: read`, and the Pages write scopes exist only in the deploy job.
Dependabot watches the actions ecosystem so the pins move deliberately.

**Dependency drift.** The gate fails if `package.json` declares a dependency in any
category, or if a lockfile appears with entries beyond the root. Adding one becomes a
deliberate act with a commit behind it, and it is what makes `npm audit` a meaningful
clean result rather than a formality.

Two things this does not cover, stated plainly rather than left implied:

- **Clickjacking.** `frame-ancestors` is ignored when delivered in a meta tag, and
  GitHub Pages cannot set response headers, so the site can be framed. For a recipe book
  with no login and no actions to trigger, there is nothing to hijack.
- **`form-action 'self'`** is in the policy so the search field on a recipe page can
  submit back to the index without JavaScript. It is a GET form to our own origin and
  posts nothing.
- **Search engines.** Every page carries `<meta name="robots" content="noindex,
  nofollow">`, which is what actually keeps this out of search results. The `robots.txt`
  in `dist/` is only honoured at a domain root, so on a `github.io/recipe-book/` project
  page it does nothing. It is generated for the day this moves to a custom domain.
  Either way, the repo is public, so treat everything in it as public.

## Two seed recipes

`anzac-biscuits` and `beef-rendang` came with the site so there was something to render.
Both say so in their notes. Delete them once your own recipes are in.
