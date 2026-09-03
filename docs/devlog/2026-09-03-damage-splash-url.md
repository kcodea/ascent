# The damage-number burst was missing in every shipped build

**Owner report 2026-09-03 (playing the packaged exe):** the yellow burst PNG behind the white combat damage
number never showed. Every damage number, not just killing blows.

## The mechanism

The burst (PR #1268, 2026-08-27) is a `::before` on `.float.dmg` whose `background` reads the
`--dmg-splash-img` custom property, pushed from `floatConfig.ts` so the dev tuner can pick between two PNGs.
That value was built as `url('${import.meta.env.BASE_URL}fx/damage-splash-2.png')` — the documented, tested
way to reference a public asset so it survives itch.io's CDN sub-path.

In a production build `BASE_URL` is `./`. And Chromium resolves a **relative `url()` inside a custom
property against the stylesheet that consumes the variable**, not the page. The sheet lives in `assets/`,
so the browser requested `assets/fx/damage-splash-2.png` — which does not exist. Proven by serving the exact
production bundle and reading the pseudo-element's computed background: `…/assets/fx/damage-splash-2.png`,
404. The PNG sat one folder up the whole time.

Dev never showed it because its base is `/`, already absolute. The existing `publicAssetPaths.test.ts`
guard passed because the path *did* carry `BASE_URL` — it guards the first trap (root-absolute literals),
and this is a second one with the opposite shape.

## The fix

`publicAssetCssUrl(relPath)` resolves the path against `document.baseURI` before wrapping it in `url()`,
so the variable holds an absolute URL in every environment: dev, the itch sub-path, and the desktop
shell's `app://ascent/` scheme. Two tests pin it (itch-style and `app://` base URIs), and the asset-path
sweep now also flags a `url('${BASE_URL}…')` literal anywhere in the UI source, pointing at the helper.

## Anything else affected?

Swept every JS-built `url(` and every CSS variable set from code. The card-plate wire mask uses the same
relative base but as a plain **inline style**, which resolves against the page — verified against the
production bundle, 200. The Opponents Backplate and Runeforge Backdrop tuners build root-absolute URLs, but
only inject CSS while the dev panel is mounted; players run the baked `styles.css` rules, which Vite rewrites.
