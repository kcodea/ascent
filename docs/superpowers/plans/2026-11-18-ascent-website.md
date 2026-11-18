# ASCENT Website (Landing Page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fast, static, one-page public site for ASCENT that sells what makes the game different, looks like the game's title screen, and offers a free Windows download.

**Architecture:** A new workspace app, `apps/site`, built with Vite as plain HTML + CSS + a little TypeScript. `index.html` is hand-authored and is the single source of truth for structure and copy; tests load it into jsdom and assert on it. Game art is copied from the game's own folders at build time by a manifest-driven script, so there is one source. The site imports no game runtime code.

**Tech Stack:** Vite 6, TypeScript 5, Vitest 2 + jsdom (all already in the root `package.json`), Cloudflare Pages via `wrangler` (already used by `workers/versus`), Playwright + ffmpeg-static as dev-only capture tools (Task 8 only).

**Spec:** `docs/superpowers/specs/2026-11-18-ascent-website-design.md` (owner-approved 2026-11-18). Read it first. The layout guide is the throwaway mockup `.superpowers/brainstorm/6650-1794976101/content/page-story.html` (git-ignored; exists only on Mike's machine, and its wording, colours and rune text are NOT final).

## Global Constraints

- Work in a dedicated worktree off latest `origin/main` under `.claude/worktrees/`, on branch `feat/ascent-website`; run `npm install` inside it before trusting any check. PR into `main`; never push to `main`; squash-merge only after `verify` is green.
- First commit on the branch adds the spec and this plan (both are currently uncommitted in the primary checkout; copy them in).
- `apps/site` must not import `@game/ui`, `@game/sim`, `@game/core`, `@game/content` or any `packages/**` source. Art files are copied, never imported as modules.
- The site's CSS lives only in `apps/site`; nothing in `packages/ui` or `apps/web` changes.
- Fonts: Outfit (titles, UI) and Nunito Sans (body). Colours: tokens from `DESIGN.md` plus the title-screen night palette. Desktop cursor: the gauntlet SVGs from `apps/web/public/cursors/`, in the URL form (`cursor: url('/art/cursors/gauntlet_open.svg') 6 2, pointer`), never a bare keyword cursor on a control.
- No `title=` attribute, SVG `<title>` child, or `el.title =` anywhere (ESLint `banTitleTooltips` covers TS; the HTML is checked by a test in Task 2).
- Looping animation uses `transform` / `opacity` only.
- Download URL, verbatim: `https://github.com/kcodea/ascent/releases/latest/download/ASCENT-Setup.exe`.
- The page never says the game is never played live, never says "never pay to win", and never explains what an auto-battler is.
- Art on the page: only things a player can already see in the live game. No Secret-rarity cosmetics, no cards from sets not yet live.
- Copy voice: plain, player-level (what the player sees, never how it is built); terms follow the rename table in `docs/GAME-RULES.md`. No em dashes in page copy.
- **Never deploy to the production address without Mike's explicit go for that deploy.** `npm run site:preview` is allowed; `npm run site:deploy` is not, until he says so each time. Ship Ascent (`npm run ship`) is untouched and unrelated.
- Before claiming done: `npm run typecheck && npm run lint && npm test && npm run build:web && npm run build:site`, and report the result.
- This is new non-gameplay work: no `patchNotes.ts` entry. Write one devlog file `docs/devlog/2026-11-18-ascent-website.md` in the final task.

## Review Focus

1. **A phone or Mac visitor taps Download.** They must not receive an `.exe` as if it will work: the button reads as Windows-only and offers "copy link". Pinned by `platform.test.ts` (Task 5).
2. **A capture file is missing or fails to load.** The slot must show its still poster, never an empty box or a broken-video icon. Pinned by `site.test.ts` "every capture slot has a poster image" (Task 3) and `captures.test.ts` (Task 6).
3. **A visitor has reduced motion on.** No video autoplays; posters show instead. Pinned by `captures.test.ts` (Task 6).
4. **A game art file is renamed or deleted in `packages/ui` or `apps/web`.** The site build must fail loudly, not ship a broken image. Pinned by `artManifest.test.ts` (Task 2).
5. **A narrow phone screen (360px wide).** No horizontal scroll, and the six Ancients and five chests stay legible. Not unit-testable; Task 4's verification step checks it in the browser at 360, 768 and 1440 wide.

---

## File Structure

```
apps/site/
  package.json            @game/site; scripts: dev, build, preview, sync-art
  tsconfig.json           DOM lib, strict, noEmit
  vite.config.ts          root = apps/site, build.outDir = dist
  index.html              ALL structure + copy (source of truth)
  .gitignore              public/art/  dist/
  README.md               how to run, deploy rules, the capture slot list
  scripts/sync-art.mjs    copies ART_MANIFEST entries into public/art/
  scripts/capture.mjs     Task 8 only: records clips from the game dev server
  public/captures/        <slot>.jpg posters (committed), <slot>.webm/.mp4 clips
  public/share.jpg        social share image (1200x630)
  src/artManifest.ts      ART_MANIFEST + DENIED_ART
  src/download.ts         INSTALLER_URL
  src/platform.ts         detectPlatform()
  src/captures.ts         CAPTURE_SLOTS, initCaptures()
  src/main.ts             wires platform + captures + copy-link on DOMContentLoaded
  src/styles/tokens.css   colour, type, spacing variables
  src/styles/base.css     reset, body, typography, Gem button, cursor
  src/styles/sections.css one block per page section
  src/*.test.ts           vitest (already matched by ALL_TESTS 'apps/**/*.test.ts')
scripts/site-deploy.mjs   preview / production deploy wrapper
```

Root `package.json` gains: `dev:site`, `build:site`, `typecheck:site`, `site:preview`, `site:deploy`; `typecheck` chains `typecheck:site`. `.github/workflows/ci.yml` `checks` job gains `typecheck:site` and `build:site`.

---

### Task 1: Scaffold `apps/site` and wire it into the repo's checks

**Files:**
- Create: `apps/site/package.json`, `apps/site/tsconfig.json`, `apps/site/vite.config.ts`, `apps/site/index.html` (a bare `<h1>ASCENT</h1>` for now), `apps/site/.gitignore`, `apps/site/src/main.ts` (empty module), `apps/site/src/download.ts`
- Modify: root `package.json` (scripts), `.github/workflows/ci.yml` (the `checks` job, beside `build:web`)
- Test: `apps/site/src/download.test.ts`, `apps/site/src/boundary.test.ts`

**Interfaces:**
- Produces: `export const INSTALLER_URL: string` in `src/download.ts`; npm scripts `dev:site` (`npm run dev -w apps/site`), `build:site` (`npm run build -w apps/site`), `typecheck:site` (`tsc -p apps/site/tsconfig.json --noEmit`).

- [ ] **Step 1: Write the failing tests**

```ts
// download.test.ts
import { INSTALLER_URL } from './download';
it('points at the stable installer link Ship Ascent maintains', () => {
  expect(INSTALLER_URL).toBe('https://github.com/kcodea/ascent/releases/latest/download/ASCENT-Setup.exe');
});

// boundary.test.ts — walk apps/site (skip node_modules, dist, public) and read every .ts/.html/.css/.mjs
it('imports no game runtime code', () => {
  for (const { path, text } of siteFiles())
    expect(text, path).not.toMatch(/from\s+['"](@game\/|.*packages\/)/);
});
```

- [ ] **Step 2: Run** `npx vitest run apps/site` — Expected: FAIL (module not found).
- [ ] **Step 3: Create the files.** `package.json` name `@game/site`, `"private": true`, `"type": "module"`, scripts `dev: vite`, `build: vite build`, `preview: vite preview` (the `sync-art` hook is added in Task 2). `tsconfig.json`: `strict`, `noEmit`, `lib: ["ES2022","DOM","DOM.Iterable"]`, `include: ["src","scripts","vite.config.ts"]`. Add the three root scripts and append `&& npm run typecheck:site` to root `typecheck`. In `ci.yml` add `- run: npm run typecheck:site` and `- run: npm run build:site` after `build:web`.
- [ ] **Step 4: Run** `npx vitest run apps/site && npm run typecheck:site && npm run build:site` — Expected: PASS, and `apps/site/dist/index.html` exists.
- [ ] **Step 5: Commit** `chore(site): scaffold apps/site and gate it in CI` (include the spec and plan docs in this first commit).

### Task 2: Art pipeline (one source for game art)

**Files:**
- Create: `apps/site/src/artManifest.ts`, `apps/site/scripts/sync-art.mjs`
- Modify: `apps/site/package.json` (`sync-art` script; `predev` and `prebuild` run it)
- Test: `apps/site/src/artManifest.test.ts`

**Interfaces:**
- Produces: `export const ART_MANIFEST: Record<string, string>` mapping a site path under `public/art/` to a repo-relative source path; `export const DENIED_ART: RegExp[]`. Pages reference art as `/art/<key>`.

Manifest entries (key ← source):
- `hero.webp` ← `apps/web/public/homescreen.webp`
- `crest.png` ← `apps/web/public/frames/title-logo.png`
- `forge-bg.webp` ← `apps/web/public/runeforgebg2.webp`
- `cursors/gauntlet_default.svg`, `cursors/gauntlet_open.svg` ← `apps/web/public/cursors/…`
- `ancients/{bonds,death,fortune,genesis,time,war}.webp` ← `packages/ui/src/art/ancients/…`
- `ranks/{bronze,silver,gold,platinum,diamond,ascendant}.webp` ← `packages/ui/src/art/ranks/…`
- `chests/standard.webp` ← `apps/web/public/collection/crate_body.webp`; `chests/{rare,epic,legendary,ancient}.webp` ← `apps/web/public/collection/chest_<tier>_body.webp`
- `end-button.webp` ← `apps/web/public/frames/end_button.webp` (reference for the Gem button look)

`DENIED_ART`: `/secret/i`, and any path under a `Skins/` folder whose rarity folder is not one of Common, Rare, Epic, Legendary, Ancient.

- [ ] **Step 1: Write the failing tests**

```ts
it('every manifest source exists in the repo', () => {
  for (const [key, src] of Object.entries(ART_MANIFEST)) expect(existsSync(resolve(REPO, src)), `${key} <- ${src}`).toBe(true);
});
it('no manifest source matches a denied pattern', () => {
  for (const src of Object.values(ART_MANIFEST)) for (const re of DENIED_ART) expect(src).not.toMatch(re);
});
it('has all six Ancients and all five chest tiers', () => {
  for (const a of ['bonds','death','fortune','genesis','time','war']) expect(ART_MANIFEST).toHaveProperty(`ancients/${a}.webp`);
  for (const c of ['standard','rare','epic','legendary','ancient']) expect(ART_MANIFEST).toHaveProperty(`chests/${c}.webp`);
});
```

- [ ] **Step 2: Run** `npx vitest run apps/site/src/artManifest.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the manifest, and `sync-art.mjs`: for each entry copy source → `apps/site/public/art/<key>` (create folders; skip when the destination is newer); exit non-zero naming the entry if a source is missing. Keep the manifest data in `src/artManifest.json`; `artManifest.ts` re-exports it typed, and the `.mjs` script reads the JSON directly (a plain Node script cannot import the TS file).
- [ ] **Step 4: Run** the test, then `npm run build:site` and confirm `apps/site/dist/art/crest.png` exists; `git status` shows no `public/art` files (ignored).
- [ ] **Step 5: Commit** `feat(site): manifest-driven art sync from the game's folders`.

### Task 3: Page structure and copy (`index.html`)

**Files:**
- Modify: `apps/site/index.html`
- Test: `apps/site/src/site.test.ts` (`// @vitest-environment jsdom`; reads `index.html` from disk into `document`)

**Interfaces:**
- Produces, for Tasks 4 to 6: section ids in this order: `top`, `async`, `runeforge`, `ancients`, `tracking`, `earn`, `modes`, `get`. Download controls: `<a data-download href=INSTALLER_URL>` (exactly two: in `#top` and `#get`), each followed by `<p data-download-note>` and `<button data-copy-link hidden>`. Capture slots: `<figure data-capture="<slot>">` containing `<img data-poster src="/captures/<slot>.jpg" alt="…" width height loading="lazy">`. Slot ids: `discover-timer`, `gold-fuse`, `rearrange`, `save-continue` (all in `#async`), `runeforge` (`#runeforge`), `ancient-select` (`#ancients`), `career-chart` (`#tracking`), `chest-opening` (`#earn`). Mode stills: `<img data-mode="versus|duos|gauntlet">` in `#modes`.

Copy decisions (draft wording is the builder's; these facts are fixed by the spec):
- `#top`: `<h1>` "The auto-battler that waits for you." (working headline), one line of pitch, button text "Download free", note "Windows, free to play".
- `[data-download-note]` under each button: one sentence saying Windows will show an "unknown publisher" warning on first install because the installer is not signed yet, and to choose "More info", then "Run anyway".
- `#async`: four items, in this order: the timer stops during Discovers, the Runeforge and Ancient select; the Gold Fuse (turn timer does not start until you have spent a set amount of Gold); rearrange your board after your time is up; save and quit, return where you left off.
- `#runeforge`: four runes offered, you take one, it lasts the whole run. Do not print invented rune names or effects; any rune named must be a real rune with its real text from `packages/content`.
- `#ancients`: each hero has six Ancients; earn 16 points (1 per shop roll, 2 per completed combat round); Discover three of the six; the one you choose changes your hero power for the rest of the game. Six portraits with names Bonds, Death, Fortune, Genesis, Time, War.
- `#tracking`: Career page, rating over time, placements, opening a past game to see its board and runes, the ladder medals Bronze to Ascendant.
- `#earn`: earned by playing; higher placement earns more; "free to earn and unlock, always" (the owner's promise); five chest tiers Standard, Rare, Epic, Legendary, Ancient.
- `#modes`: heading "Other game modes"; Versus (live head-to-head), Duos (2v2 tag-team), Gauntlet (single-player stages, each a 10-round duel against one hand-built opponent). One line each. Visibly smaller than the sections above.
- `<head>`: `<title>`, meta description, `og:title`, `og:description`, `og:image` = `/share.jpg`, `twitter:card` = `summary_large_image`, Google Fonts link for Outfit 500/700/800/900 and Nunito Sans 400/600/700 with `display=swap`.

- [ ] **Step 1: Write the failing tests**

```ts
it('sections appear in the approved order', () => {
  expect([...document.querySelectorAll('main > section, header#top, footer#get')].map(e => e.id))
    .toEqual(['top','async','runeforge','ancients','tracking','earn','modes','get']);
});
it('has exactly two download links, both to the installer', () => {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('a[data-download]')];
  expect(links).toHaveLength(2);
  for (const a of links) expect(a.getAttribute('href')).toBe(INSTALLER_URL);
});
it('each download link has the unsigned-installer note beside it', () => {
  for (const a of document.querySelectorAll('a[data-download]'))
    expect(a.parentElement!.querySelector('[data-download-note]')!.textContent).toMatch(/unknown publisher/i);
});
it('every capture slot has a poster image with alt text', () => {
  const slots = ['discover-timer','gold-fuse','rearrange','save-continue','runeforge','ancient-select','career-chart','chest-opening'];
  for (const s of slots) {
    const img = document.querySelector<HTMLImageElement>(`figure[data-capture="${s}"] img[data-poster]`)!;
    expect(img.getAttribute('src')).toBe(`/captures/${s}.jpg`);
    expect(img.alt.length).toBeGreaterThan(10);
  }
});
it('the Ancients section states the real rule', () => {
  const t = document.querySelector('#ancients')!.textContent!;
  expect(t).toMatch(/16 points/); expect(t).toMatch(/hero power/i);
  expect(document.querySelectorAll('#ancients img[data-ancient]')).toHaveLength(6);
});
it('names all three other modes', () => {
  expect([...document.querySelectorAll('#modes img[data-mode]')].map(i => i.getAttribute('data-mode')))
    .toEqual(['versus','duos','gauntlet']);
});
it('never makes a banned claim or uses a native tooltip', () => {
  const t = document.body.textContent!;
  expect(t).not.toMatch(/pay to win/i);
  expect(t).not.toMatch(/never (played )?live|always offline/i);
  expect(t).not.toMatch(/what is an auto-?battler/i);
  expect(t).not.toContain('—');
  expect(document.querySelectorAll('[title], svg title')).toHaveLength(0);
});
it('has share metadata', () => {
  expect(document.querySelector('meta[property="og:image"]')!.getAttribute('content')).toBe('/share.jpg');
  expect(document.querySelector('meta[name="description"]')!.getAttribute('content')!.length).toBeGreaterThan(50);
});
```

- [ ] **Step 2: Run** `npx vitest run apps/site/src/site.test.ts` — Expected: FAIL.
- [ ] **Step 3: Write `index.html`** to the interfaces and copy decisions above. `<header id="top">`, six `<section>`s inside `<main>`, `<footer id="get">`. Every section: an eyebrow label, one `<h2>`, at most two sentences of lede, then its capture figure(s) or art.
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit** `feat(site): page structure and first-draft copy`.

### Task 4: Look and layout (the game's style, responsive)

**Files:**
- Create: `apps/site/src/styles/tokens.css`, `base.css`, `sections.css` (imported from `src/main.ts`)
- Create (placeholder stills so the page is never empty): `apps/site/public/captures/<slot>.jpg` × 8, `apps/site/public/captures/mode-{versus,duos,gauntlet}.jpg`, `apps/site/public/share.jpg`, each composed from manifest art (for example the forge background for `runeforge.jpg`, the chest row for `chest-opening.jpg`)
- Test: `apps/site/src/styles.test.ts`

**Interfaces:**
- Consumes: section ids and `data-*` hooks from Task 3; `/art/*` from Task 2.
- Produces: class `.gem` (the download button), `.is-windows` / `.is-other` / `.is-mobile` on `<html>` are styled here and set in Task 5.

Design decisions:
- Tokens: night `#0d1220`, panel `#141b2e`, line `#2a3550`, struck-gold `#c8922e`, struck-gold-light `#e6b45a`, text `#efe7db`, muted `#a9b3c6` (the title-screen night palette plus the `DESIGN.md` golds). Type scale and spacing as CSS variables; no literal colours outside `tokens.css`.
- `#top`: full-bleed `/art/hero.webp` with a bottom fade into night; crest above the headline.
- `.gem`: rebuild the game's Gem plate in CSS (blue gem face, gold rim, dark outer rim, top highlight) using `/art/end-button.webp` as the visual reference; no studs, no new blue. Hover and focus-visible states; `cursor: url('/art/cursors/gauntlet_open.svg') 6 2, pointer`. `body` uses the default gauntlet.
- `#async`: 2×2 grid of items, each = capture figure + text; one column under 760px.
- `#runeforge`: forge background behind the section; `#ancients`: six portraits in a row, 3×2 under 760px, 2×3 under 420px; `#earn`: five chests in a row, wrapping; `#modes`: three small cards in a row at a reduced type size.
- Breakpoints by `min-width` media queries (ordinary viewport units ARE allowed here; the game's stage rules do not apply to the site).
- Motion: at most a gentle crest float and button glow, `transform`/`opacity` only, inside `@media (prefers-reduced-motion: no-preference)`.

- [ ] **Step 1: Write the failing test**

```ts
it('looping animations touch only transform and opacity', () => {
  for (const { name, body } of keyframesIn(allSiteCss()))
    for (const prop of propertiesIn(body)) expect(['transform','opacity'], `${name}: ${prop}`).toContain(prop);
});
it('no literal colours outside tokens.css', () => {
  for (const f of ['base.css','sections.css']) expect(read(f)).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
});
it('no bare keyword cursor on controls', () => {
  expect(allSiteCss()).not.toMatch(/cursor:\s*pointer\s*;/);
});
```

- [ ] **Step 2: Run** `npx vitest run apps/site/src/styles.test.ts` — Expected: FAIL.
- [ ] **Step 3: Write the three stylesheets and the placeholder stills.**
- [ ] **Step 4: Run** the test, then verify in the browser: `npm run dev:site`, open the page, and check at 1440, 768 and 360 wide that there is no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`), every image loads, and the Ancients and chests stay legible. Fix what is wrong before continuing. Take one screenshot at each width for the PR.
- [ ] **Step 5: Commit** `feat(site): the game's look, responsive layout, placeholder stills`.

### Task 5: Download behaviour by platform

**Files:**
- Create: `apps/site/src/platform.ts`; Modify: `apps/site/src/main.ts`
- Test: `apps/site/src/platform.test.ts`

**Interfaces:**
- Produces: `export type Platform = 'windows' | 'other-desktop' | 'mobile'`; `export function detectPlatform(ua: string, maxTouchPoints: number): Platform`; `export function applyPlatform(doc: Document, p: Platform): void`.

Behaviour: `windows` → nothing changes. `other-desktop` and `mobile` → `<html>` gets `is-other` or `is-mobile`; each `a[data-download]` keeps its `href` but its label becomes "Windows only for now"; each `[data-copy-link]` is un-hidden and, on click, copies the page URL (`location.origin + location.pathname`) with `navigator.clipboard.writeText`, then shows "Link copied" in the button for 2 seconds; if the clipboard call rejects, the button text becomes the URL itself so it can be selected by hand. iPadOS reports a Mac UA with `maxTouchPoints > 1` and must count as `mobile`.

- [ ] **Step 1: Write the failing tests**

```ts
it.each([
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36', 0, 'windows'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15', 0, 'other-desktop'],
  ['Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/131.0', 0, 'other-desktop'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', 5, 'mobile'],
  ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36', 5, 'mobile'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15', 5, 'mobile'],
  ['', 0, 'other-desktop'],
])('detectPlatform(%s, %i) is %s', (ua, touch, want) => expect(detectPlatform(ua, touch)).toBe(want));

// @vitest-environment jsdom, with index.html loaded
it('non-Windows visitors see a Windows-only label and a copy-link button', () => {
  applyPlatform(document, 'mobile');
  for (const a of document.querySelectorAll('a[data-download]')) expect(a.textContent).toMatch(/Windows only/i);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-copy-link]')) expect(b.hidden).toBe(false);
});
it('Windows visitors see the page unchanged', () => {
  applyPlatform(document, 'windows');
  expect(document.querySelector('a[data-download]')!.textContent).toMatch(/Download free/i);
  expect(document.querySelector<HTMLButtonElement>('[data-copy-link]')!.hidden).toBe(true);
});
it('falls back to showing the URL when the clipboard is refused', async () => {
  Object.assign(navigator, { clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
  applyPlatform(document, 'mobile');
  const b = document.querySelector<HTMLButtonElement>('[data-copy-link]')!;
  b.click(); await Promise.resolve(); await Promise.resolve();
  expect(b.textContent).toContain(location.origin);
});
```

- [ ] **Step 2: Run** `npx vitest run apps/site/src/platform.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** both functions and call `applyPlatform(document, detectPlatform(navigator.userAgent, navigator.maxTouchPoints))` from `main.ts` on `DOMContentLoaded`.
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit** `feat(site): platform-aware download button`.

### Task 6: Capture slots (poster first, video when it helps)

**Files:**
- Create: `apps/site/src/captures.ts`; Modify: `apps/site/src/main.ts`, `apps/site/README.md`
- Test: `apps/site/src/captures.test.ts` (jsdom)

**Interfaces:**
- Produces: `export const CAPTURE_SLOTS: readonly string[]` (the eight ids from Task 3); `export const CLIPS: ReadonlySet<string>` (slots that have a recorded clip; **empty in this task**, filled in Task 8); `export function initCaptures(doc: Document, opts: { reducedMotion: boolean; observe: (el: Element, onVisible: () => void) => void }): void`.

Behaviour: for each `figure[data-capture]` whose slot is in `CLIPS`, when it first becomes visible and `reducedMotion` is false, insert a `<video muted loop playsinline autoplay preload="none" poster="/captures/<slot>.jpg">` with `<source>` for `/captures/<slot>.webm` then `/captures/<slot>.mp4`, and hide the poster `<img>` only on the video's `playing` event. On the video's `error` event (or the last source's), remove the video and leave the poster. Slots not in `CLIPS`, and all slots under reduced motion, are left as posters. `main.ts` passes an `IntersectionObserver`-backed `observe` with `rootMargin: '200px'`.

- [ ] **Step 1: Write the failing tests**

```ts
const visibleNow = (el: Element, cb: () => void) => cb();
it('leaves every slot as a poster when no clips exist', () => {
  initCaptures(document, { reducedMotion: false, observe: visibleNow });
  expect(document.querySelectorAll('video')).toHaveLength(0);
});
it('reduced motion never inserts a video', () => {
  withClips(['runeforge'], () => {
    initCaptures(document, { reducedMotion: true, observe: visibleNow });
    expect(document.querySelectorAll('video')).toHaveLength(0);
  });
});
it('a slot with a clip gets a muted looping video and keeps its poster until playing', () => {
  withClips(['runeforge'], () => {
    initCaptures(document, { reducedMotion: false, observe: visibleNow });
    const fig = document.querySelector('figure[data-capture="runeforge"]')!;
    const v = fig.querySelector('video')!;
    expect(v.muted && v.loop).toBe(true);
    expect(fig.querySelector<HTMLImageElement>('img[data-poster]')!.hidden).toBe(false);
    v.dispatchEvent(new Event('playing'));
    expect(fig.querySelector<HTMLImageElement>('img[data-poster]')!.hidden).toBe(true);
  });
});
it('a clip that fails to load is removed and the poster stays', () => {
  withClips(['runeforge'], () => {
    initCaptures(document, { reducedMotion: false, observe: visibleNow });
    const fig = document.querySelector('figure[data-capture="runeforge"]')!;
    fig.querySelector('video')!.dispatchEvent(new Event('error'));
    expect(fig.querySelector('video')).toBeNull();
    expect(fig.querySelector<HTMLImageElement>('img[data-poster]')!.hidden).toBe(false);
  });
});
it('every capture slot has a committed poster file', () => {
  for (const s of CAPTURE_SLOTS) expect(existsSync(resolve(SITE, 'public/captures', `${s}.jpg`)), s).toBe(true);
});
it('every clip listed has both video files on disk', () => {
  for (const s of CLIPS) for (const ext of ['webm','mp4']) expect(existsSync(resolve(SITE, 'public/captures', `${s}.${ext}`)), `${s}.${ext}`).toBe(true);
});
```

(`withClips` is a test helper that temporarily adds ids to a mutable copy of `CLIPS`; export a `__setClipsForTest` hook from `captures.ts` for it.)

- [ ] **Step 2: Run** `npx vitest run apps/site/src/captures.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**, and write `apps/site/README.md`: how to run and build; the deploy rule (preview freely, production only on Mike's go); and a table of the eight capture slots plus three mode stills, each with what it must show (copied from the spec's capture list) so re-recording after a UI change is a known chore.
- [ ] **Step 4: Run** the test — Expected: PASS. Then `npm run typecheck:site && npm run lint`.
- [ ] **Step 5: Commit** `feat(site): capture slots with poster fallback and reduced-motion support`.

### Task 7: Preview deploy on Cloudflare Pages, PR, and owner review

**Files:**
- Create: `scripts/site-deploy.mjs`, `docs/devlog/2026-11-18-ascent-website.md`
- Modify: root `package.json` (`site:preview`, `site:deploy`), `apps/site/package.json` (`wrangler` devDependency pinned to `4.149.0`, matching `workers/versus`)
- Test: `scripts/site-deploy.test.mjs` is NOT added (root vitest globs do not cover `scripts/`); put the pure function in `apps/site/src/deployPlan.ts` with `apps/site/src/deployPlan.test.ts`.

**Interfaces:**
- Produces: `export function deployPlan(argv: string[]): { branch: 'preview' | 'main'; args: string[] } | { error: string }`. `site:preview` = `node scripts/site-deploy.mjs`; `site:deploy` = `node scripts/site-deploy.mjs --production`.

Decisions: Cloudflare Pages project name `ascent-site`. The script runs `npm run build:site`, then `npx wrangler pages deploy apps/site/dist --project-name ascent-site --branch <branch>`. Production requires BOTH `--production` and `--owner-approved`; without the second it prints "Production deploys need Mike's explicit go for this deploy. Re-run with --owner-approved only after he has said so." and exits 2. It needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`; if either is missing it exits 2 naming the variable. Cloudflare Web Analytics: enable it on the Pages project in the dashboard (one toggle, no code); note it in the README. If the existing token lacks Pages permission, stop and tell Mike which permission to add (Account → Cloudflare Pages → Edit); do not create tokens.

- [ ] **Step 1: Write the failing tests**

```ts
it('defaults to a preview deploy', () => expect(deployPlan([])).toMatchObject({ branch: 'preview' }));
it('refuses production without the owner flag', () => expect(deployPlan(['--production'])).toHaveProperty('error'));
it('allows production with both flags', () => expect(deployPlan(['--production','--owner-approved'])).toMatchObject({ branch: 'main' }));
it('always targets the ascent-site project and the built dist', () => {
  const p = deployPlan([]) as { args: string[] };
  expect(p.args).toEqual(['pages','deploy','apps/site/dist','--project-name','ascent-site','--branch','preview']);
});
```

- [ ] **Step 2: Run** `npx vitest run apps/site/src/deployPlan.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `deployPlan`, the wrapper script, the two npm scripts, and the devlog entry (what shipped, the owner decisions from the spec, the deploy rule).
- [ ] **Step 4: Run the full gate:** `npm run typecheck && npm run lint && npm test && npm run build:web && npm run build:site` — Expected: all green. Report the output.
- [ ] **Step 5: Run** `npm run site:preview` and record the preview URL it prints. Open it and confirm the page loads, both download buttons point at the installer, and there are no console errors.
- [ ] **Step 6: Commit** `feat(site): preview and production deploy script`, push the branch, `gh pr create`, arm `gh pr merge --auto --squash`, and wait for `verify`.
- [ ] **Step 7: Hand to Mike:** the preview URL, the three width screenshots, and the list of copy he should edit (headline, each section's lede, the Windows warning note). **Stop here for his review.** Apply his copy edits as follow-up commits. Do not run `site:deploy`.

### Task 8: Record the real captures (separate PR, after Task 7 merges)

**Files:**
- Create: `apps/site/scripts/capture.mjs`; `apps/site/public/captures/<slot>.webm` + `.mp4` for each recorded slot; replace the placeholder `<slot>.jpg` posters and the three `mode-*.jpg` stills with real frames; replace `public/share.jpg`
- Modify: `apps/site/src/captures.ts` (`CLIPS`), `apps/site/package.json` (devDependencies `playwright`, `ffmpeg-static`)
- Test: the existing `captures.test.ts` ("every clip listed has both video files on disk")

**Interfaces:**
- Consumes: `CAPTURE_SLOTS`, `CLIPS` from Task 6.

Decisions:
- Record from the game's own dev server (`npm run dev`, run in a Terminal tab, in this worktree) at a 1920×1080 viewport with Playwright's `recordVideo`, 1x game speed.
- Each clip: 4 to 8 seconds, loops cleanly, cropped to the part of the screen that shows the moment (not the whole board when the subject is one panel), exported with ffmpeg to `webm` (VP9) and `mp4` (H.264, `+faststart`), no audio track, at most 1280px wide and at most 1.5 MB per file. The poster is the clip's first frame as a JPEG at the same crop.
- What each slot shows (from the spec): `discover-timer` a Discover open with the turn timer visibly frozen; `gold-fuse` the Gold Fuse filling as Gold is spent, then the timer starting; `rearrange` a minion being dragged to a new slot after the turn's time is up; `save-continue` Save & Quit, then the title screen's Continue; `runeforge` a four-rune offer and one being bought; `ancient-select` the three-of-six Ancient Discover and a pick; `career-chart` the Career chart with a game pinned, its board and runes showing; `chest-opening` a chest opening through to the reward. Mode stills: one representative screen each of Versus, Duos and Gauntlet.
- Use only live-set cards and non-Secret cosmetics in frame. Use a fresh test account or God Mode / Sandbox / the Scene Builder to reach each moment; do not record Mike's own account.
- A slot that cannot be recorded cleanly keeps its still and stays out of `CLIPS`; list any such slot in the PR description. A still is acceptable; a bad clip is not.

- [ ] **Step 1:** Write `capture.mjs` with one named routine per slot (`node apps/site/scripts/capture.mjs <slot>`), writing raw video to a temp folder and the three encoded files into `public/captures/`.
- [ ] **Step 2:** Record each slot; watch every clip once at full size and check the loop point, the crop and the file size against the limits above.
- [ ] **Step 3:** Add each recorded slot id to `CLIPS`.
- [ ] **Step 4: Run** `npx vitest run apps/site && npm run build:site` — Expected: PASS; then check total `dist/` size and that the page's first load (HTML + CSS + JS + hero + crest, no clips) stays under 1 MB.
- [ ] **Step 5:** `npm run site:preview`, confirm on the preview URL that clips play when scrolled to, posters show first, and reduced motion shows posters only.
- [ ] **Step 6: Commit** `feat(site): real game captures`, PR, auto-merge on green `verify`. Send Mike the new preview URL. **Production deploy still waits for his explicit go.**

---

## Self-review notes

- Spec coverage: every page section (Tasks 3, 4), the look (4), download + non-Windows handling + Windows warning (3, 5), captures with fallback and reduced motion (6, 8), art limits and single source (2), no runtime imports (1), hosting + preview-only rule + analytics (7), sharing metadata (3), CI gate (1). Login/stats, compendium, mailing list are non-goals and have no task.
- The spec's "built so a section can later swap its capture for a live piece" is met by each section being a self-contained `<section>` with its own `figure[data-capture]`; no task adds a live piece.
