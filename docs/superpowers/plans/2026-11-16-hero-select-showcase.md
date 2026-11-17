# Hero Select Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second Hero Select body behind a DEV switch: three selectable hero tiles with a sliding gold glow and corner re-roll, the Compendium's inspect card (with the Ancients row) for the selected hero, and a Select Hero button that starts the ceremony from the card's splash art.

**Architecture:** `HeroSelect` keeps every pick rule and renders one of two bodies. The Compendium's `article.phi` is extracted into a shared `HeroInspectCard` used by both `PhHeroPop` and the new body. `HeroSelectCeremony` gains an optional `splash` source; without it the ceremony is exactly today's.

**Tech Stack:** React 18, TypeScript, Zustand store (`useGame`), plain CSS with the party-home tokens (`--ph-*`, `--phu`), WAAPI via the ceremony's `animateEl`, Vitest + jsdom (`renderedText.mount`).

**Spec:** `docs/superpowers/specs/2026-11-16-hero-select-showcase-design.md` (read it first; this plan argues from it).

## Global Constraints

- Work only in the worktree `.claude/worktrees/hero-select-showcase`, branch `feat/hero-select-showcase`. Run `npm install` there once before any check. Never push to `main`; PR only.
- Switch off = today's screen, byte-for-byte in behaviour. These suites must pass **unmodified**: `hero-select/heroSelectPh.test.tsx`, `hero-select/heroPickClean.test.ts`, `heroReroll.test.tsx`, `versus/spectateHeroSelect.test.tsx`, `gauntlet/heroSelectGauntlet.test.tsx`, `tapInspect.test.ts`, `touchInput.test.ts`, `compendiumHeroAncients.test.tsx`, the ceremony unit tests.
- The showcase body renders only when `useHeroShowcase() && ph && !browse`. A production build reads the switch as off.
- No raw `vw`/`vh` or viewport `@media`; no bare `cursor: pointer`; no `title=`; no looping paint animations; transform/opacity only for motion; no layout reads per frame; every `<img>` has `decoding="sync"`; portals go to `stageHost()`.
- Spring = the party home's existing one. Copy these values exactly (from `phCompendium.css` `.book-cat`): rest `transition: transform 0.16s ease-out`; hover `transition: transform 0.32s cubic-bezier(0.34, 1.9, 0.5, 1)`; active `transform: scale(0.96); transition: transform 0.08s ease-out`; all inside `@media (prefers-reduced-motion: no-preference)`. Hover scale: `1.04` for tiles, re-roll, arrows and Select Hero; `1.03` for the hero power group.
- Glow slide: `transform` only, `0.34s cubic-bezier(0.22, 1, 0.36, 1)`; snaps under reduced motion.
- Copy: button label `Select Hero`; blocked label `Taken by your teammate`; tile note `Your teammate's pick`; re-roll `aria-label` and `data-tip` are today's strings verbatim; hint `Up / Down: Ancients`.
- New tests turn on **both** flags (`setPartyHome(true)` and `setHeroShowcase(true)`) and reset both in `afterEach`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. **Select Hero pressed during the 700 ms re-roll swap of the selected slot**: the new hero is picked, and the ceremony starts from the settled art rect. (Task 4 test.)
2. **Select Hero pressed twice quickly**: one ceremony, one `lockVersusHeroPick`. (Task 4 test.)
3. **A hero with no art** (`heroPortrait` returns nothing): the card renders without an image and Select Hero still starts the ceremony (the art box's rect is the source). (Task 2 and Task 5 tests.)
4. **Versus timeout or a watched pick arriving while another tile is selected**: selection jumps to that hero, then the ceremony plays for it. (Task 4 test.)
5. **Two `HeroSelect` instances mounted (Duos own screen plus teammate view)**: arrow keys pressed with focus in one body do not move the other. (Task 3 test.)

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/ui/src/hero-select/heroShowcaseFlag.ts` (new) | The DEV switch. |
| `packages/ui/src/DevMenu.tsx` (modify ~L445) | Menu entry for the switch. |
| `packages/ui/src/HeroInspectCard.tsx` (new) | The shared `article.phi` card. |
| `packages/ui/src/MinionBook.tsx` (modify L361-423) | `PhHeroPop` renders the shared card. |
| `packages/ui/src/hero-select/HeroShowcase.tsx` (new) | Tiles, glow, card, arrows, Select Hero. Presentation only. |
| `packages/ui/src/hero-select/heroShowcase.css` (new) | All showcase styling, every selector under `.heroselect.hss`. |
| `packages/ui/src/HeroSelect.tsx` (modify) | Selection state, shared pick path, body branch, ceremony props. |
| `packages/ui/src/hero-select/HeroSelectCeremony.tsx` + `heroCeremony.css` + `heroCeremonyGeometry.ts` (modify) | The `splash` source. |
| `packages/ui/src/hero-select/heroShowcase.test.tsx` (new) | Body + integration tests. |
| `packages/ui/src/heroInspectCard.test.tsx` (new) | Shared card tests. |
| `docs/devlog/2026-11-16-hero-select-showcase.md` (new) | Devlog entry. |

---

### Task 1: The switch

**Files:**
- Create: `packages/ui/src/hero-select/heroShowcaseFlag.ts`
- Modify: `packages/ui/src/DevMenu.tsx` (next to the `partyhome` entry, ~L445)
- Test: `packages/ui/src/hero-select/heroShowcaseFlag.test.ts`

**Interfaces:**
- Produces: `heroShowcaseOn(): boolean`, `setHeroShowcase(v: boolean): void`, `useHeroShowcase(): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { heroShowcaseOn, setHeroShowcase } from './heroShowcaseFlag';
afterEach(() => setHeroShowcase(false));
it('is off by default and remembers a set', () => {
  expect(heroShowcaseOn()).toBe(false);
  setHeroShowcase(true);
  expect(heroShowcaseOn()).toBe(true);
  expect(localStorage.getItem('ascent.heroShowcase')).toBe('1');
});
```

- [ ] **Step 2: Run** `npx vitest run packages/ui/src/hero-select/heroShowcaseFlag.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement the flag.** Mirror `partyHome/partyHomeFlag.ts`: key `ascent.heroShowcase`, URL param `heroshowcase=1|0`, `useSyncExternalStore`. Differences: `if (!import.meta.env.DEV) return false;` and the default is off everywhere (read `=== '1'`).
- [ ] **Step 4: Add the DEV menu entry** `{ id: 'heroshowcase', icon: '🖼️', label: 'Hero Select: showcase layout', run: () => setHeroShowcase(!heroShowcaseOn()), live: () => heroShowcaseOn() }`, copying the neighbouring entry's other fields.
- [ ] **Step 5: Run the test.** Expected: PASS. Run `npm run typecheck`. Expected: clean.
- [ ] **Step 6: Commit** `feat(ui): DEV switch for the Hero Select showcase layout`.

---

### Task 2: Shared inspect card

**Files:**
- Create: `packages/ui/src/HeroInspectCard.tsx`
- Modify: `packages/ui/src/MinionBook.tsx:361-423`
- Test: `packages/ui/src/heroInspectCard.test.tsx`

**Interfaces:**
- Produces:

```ts
export type InspectHero = (typeof HEROES)[number];
export interface HeroInspectCardProps {
  hero: InspectHero;
  /** The splash art (the Compendium passes heroArt(id); the pick screen the equipped skin). */
  art: string | null | undefined;
  /** The Ancient on show, owned by the caller so it survives a hero change. */
  ancient: AncientId;
  onAncient: (a: AncientId) => void;
  /** Extra fact chips after the power's own (the pick screen's difficulty). */
  extraFacts?: readonly string[];
  /** Right side of the footer line, after "Up / Down: Ancients" (the Compendium's "2 / 42"). */
  counter?: string;
  /** The `.phi-art` box, for the ceremony's source rect. */
  artRef?: Ref<HTMLDivElement>;
  className?: string;
  onClick?: MouseEventHandler<HTMLElement>;
}
export function HeroInspectCard(props: HeroInspectCardProps): JSX.Element;
```

- The markup is today's `article.phi` moved verbatim (same classes, same order, `key` stays with the caller). One addition: the medallion, `.phi-pwhead` and `.phi-pwtext` keep their classes and DOM order; the existing `.phi-power` wrapper is the spring group (no new wrapper needed).
- `heroPowerFacts` stays exported from `MinionBook.tsx`; import it from there, or move it into the new file and re-export from `MinionBook.tsx` if that creates an import cycle.

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders name, vitals, power, facts and the Ancients row', () => {
  // mount <HeroInspectCard hero={getHero('aster')} art="x.webp" ancient="death" onAncient={fn} extraFacts={['Hard']} />
  expect(el.querySelector('.phi-name')!.textContent).toBe(getHero('aster').name);
  expect(el.querySelector('.phi-stat.is-hp b')!.textContent).toBe(String(getHero('aster').resolve));
  expect([...el.querySelectorAll('.phi-fact')].at(-1)!.textContent).toBe('Hard');
  expect(el.querySelectorAll('.hanc-med')).toHaveLength(6);
  expect(el.querySelector('.phi-anckeys')!.textContent).toBe('Up / Down: Ancients');
  expect(el.querySelector('.phi-count')!.textContent).not.toMatch(/\d+ \/ \d+/);
});
it('clicking an Ancient calls onAncient', () => { /* click 2nd .hanc-med → fn called with ANCIENT_IDS[1] */ });
it('renders with no art', () => { /* art={null} → no .phi-art img, .phi-name still present */ });
```

- [ ] **Step 2: Run** `npx vitest run packages/ui/src/heroInspectCard.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement `HeroInspectCard`** and make `PhHeroPop` render it with `art={heroArt(h.id)}`, `ancient={anc}`, `onAncient={setAnc}`, `counter={many ? `${at + 1} / ${heroes.length}` : undefined}`, `onClick={(e) => e.stopPropagation()}`, `key={h.id}`. `PhHeroPop` keeps the overlay, arrows, `usePhLayer`, and the window key handler.
- [ ] **Step 4: Run** `npx vitest run packages/ui/src/heroInspectCard.test.tsx packages/ui/src/compendiumHeroAncients.test.tsx`. Expected: PASS, the Compendium test unmodified.
- [ ] **Step 5: Commit** `refactor(ui): extract the Compendium hero card into HeroInspectCard`.

---

### Task 3: The showcase body

**Files:**
- Create: `packages/ui/src/hero-select/HeroShowcase.tsx`, `packages/ui/src/hero-select/heroShowcase.css`
- Test: `packages/ui/src/hero-select/heroShowcase.test.tsx` (the body section)

**Interfaces:**
- Consumes: `HeroInspectCard` (Task 2).
- Produces:

```ts
export interface HeroShowcaseProps {
  choices: readonly string[];            // hero ids, offer order
  selected: number;
  onSelect: (index: number) => void;     // tile click, arrows, Left/Right
  onConfirm: () => void;                 // Select Hero pressed and allowed
  onDenied: () => void;                  // Select Hero pressed while blocked
  /** null = allowed; 'mate' = teammate's hero; 'pending' = Versus re-roll in flight; 'busy' = ceremony running. */
  blocked: null | 'mate' | 'pending' | 'busy';
  canReroll: boolean;
  onReroll: (slot: number) => void;
  swapping: { slot: number; from: string } | null;
  mateTaken: string | null;
  watching: boolean;                     // no Select Hero button
  showDifficulty: boolean;
  loadout: ReturnType<typeof useLiveLoadout>;
  artRef: RefObject<HTMLDivElement>;     // the card's .phi-art
  slotEls: MutableRefObject<(HTMLDivElement | null)[]>; // one .hss-slot per offer
}
export function HeroShowcase(props: HeroShowcaseProps): JSX.Element;
```

- DOM (class names are fixed; tests and the ceremony read them):

```
div.hss-body  (tabIndex -1; owns keydown: Left/Right → onSelect(wrap), Up/Down → step Ancient)
  div.hss-tiles
    i.hss-glow                         (the sliding gold outline)
    div.hss-slot[.on][.taken][.swapping]   × offer   (ref → slotEls[i])
      button.hss-tile                  (aria-pressed; portrait, .hss-name, .hss-vitals with HealthMedal/ArmorMedal)
      button.hss-reroll.gtip           (only while canReroll; sibling of the tile)
  div.hss-stage
    button.phi-nav.is-prev / .is-next  (only when choices.length > 1)
    HeroInspectCard key={heroId}       (className "hss-card", artRef)
  button.hss-confirm.phk-btn.v-primary (absent when watching; aria-disabled when blocked)
```

- The Ancient on show is local state in `HeroShowcase`, seeded `lastPickedAncient()`, written through `rememberAncient`, stepped with `stepAncient`.
- Glow: a small hook in this file. On selection change and on `ResizeObserver` of `.hss-tiles`, read the selected slot's `offsetLeft` / `offsetWidth` and set `transform: translateX(px)` and `width` on `.hss-glow`; add class `glide` only when the selection index changed. No `scaleX` (a scaled outline distorts its corners), which is why `kit/slideMarker.ts` is mirrored instead of reused.
- Tile art: `heroPortrait(id, loadout)`; the swap images follow today's `.hcswap-in` / `.hcswap-out` / `.rfb-shine` pattern on the tile portrait (reuse those keyframes).
- CSS: every selector starts `.heroselect.hss`. Navy plate + gold edge from `--ph-navy` / `--ph-gild`; tile portrait foot fade as `heroSelectPh.css` L249-256; card size override `.heroselect.hss .hss-card { --phi-h: min(calc(500 * var(--phu)), 52cqh); }` as the starting value (the whole screen must fit the 1920x1080 stage with no scroll; tune by eye). Springs per Global Constraints: `.hss-tile`, `.hss-reroll`, `.phi-nav`, `.hss-confirm` at 1.04; `.hss-card .phi-power` at 1.03 with `transform-origin` at the medallion's centre so circle and text move as one. The glow tracks layout boxes, so the tile's hover scale does not move it.
- Load the component lazily from `HeroSelect` the way `HeroSelectPhSkin` is loaded, so the switch-off bundle path is unchanged.

- [ ] **Step 1: Write the failing tests** (mount `<HeroShowcase>` directly with stub handlers, offer `['aster','warden','soren']`):

```tsx
it('renders one tile per offer with name, Health and Armor; the selected slot is .on', ...);
  // 3 .hss-slot; slot[0].classList.contains('on'); .hss-name text = getHero('aster').name; tile aria-pressed="true"
it('a tile click calls onSelect with its index and never onConfirm', ...);
it('arrows and Left/Right wrap', ...);
  // selected=0, click .phi-nav.is-prev → onSelect(2); keydown ArrowRight on .hss-body with selected=2 → onSelect(0)
it('Up/Down step the Ancient on show', ...);
  // keydown ArrowDown on .hss-body → .hanc-text.is-on changes
it('keys are scoped to the body', ...);
  // mount two bodies; keydown on body A → only A's onSelect called; keydown on window → neither
it('re-roll buttons show only while canReroll and call onReroll(slot) without onSelect', ...);
it('Select Hero: allowed → onConfirm; blocked "mate" → aria-disabled, label "Taken by your teammate", onDenied', ...);
it('watching: no .hss-confirm', ...);
it('difficulty chip only when showDifficulty', ...);
it('five offers render five tiles', ...);
```

- [ ] **Step 2: Run** `npx vitest run packages/ui/src/hero-select/heroShowcase.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement `HeroShowcase.tsx` and `heroShowcase.css`.**
- [ ] **Step 4: Run the test.** Expected: PASS. Run `npm run lint`. Expected: clean (stage tripwire, title ban, hit shapes).
- [ ] **Step 5: Commit** `feat(ui): Hero Select showcase body (tiles, sliding glow, inspect card, Select Hero)`.

---

### Task 4: Wire it into HeroSelect

**Files:**
- Modify: `packages/ui/src/HeroSelect.tsx`
- Test: `packages/ui/src/hero-select/heroShowcase.test.tsx` (the integration section)

**Interfaces:**
- Consumes: `useHeroShowcase` (Task 1), `HeroShowcase` (Task 3).
- Produces (inside `HeroSelect`): `const showcase = useHeroShowcase() && ph;` `const [selected, setSelected] = useState(0);` `const splashArtRef = useRef<HTMLDivElement>(null);` `const slotRefs = useRef<(HTMLDivElement | null)[]>([]);` and `commitPick(id: string, index: number, el: HTMLElement): void`. Task 5 consumes `splashArtRef` and `slotRefs`. The root gets class `hss` when the showcase body renders.

- Refactor `onPick` into `commitPick(id, index, el)` holding today's guards and effects in today's order (watch / `ceremonyAcceptsClicks`, pending Versus re-roll, `mateTaken` → `sfx.deny`, `sfx.pulse`, `lockVersusHeroPick`, `dispatch select` with `snapshotRect(rectToStage(el.getBoundingClientRect()))`). The card's `onClick` calls it with `e.currentTarget`. The showcase's `onConfirm` calls it with `splashArtRef.current` and the selected hero.
- The Versus-timeout and watched-pick effects: when the showcase body is on, `setSelected(index)` first and measure `splashArtRef.current` on the next animation frame (so the card shows that hero before the rect is read); otherwise unchanged.
- `selected` resets to 0 when the offer changes in more than one slot (or on mount) and is kept on a single-slot change. All new hooks go **above** the `if (!choices) return null` early return.
- `blocked`: `'busy'` when the ceremony is not idle, `'pending'` when `mode === 'versus' && versusRerollPending`, `'mate'` when the selected hero is `mateTaken`, else `null`.
- Body branch: `showcase && !browse ? <HeroShowcase … /> : <div ref={rowRef} className="hsrow…">…today…</div>`.

- [ ] **Step 1: Write the failing tests** (`open()` helper as in `heroSelectPh.test.tsx`, both flags on):

```tsx
it('switch off: today\'s three .herocard.big, no .hss-body', ...);
it('switch on: .hss-body, no .herocard, first tile selected, card shows the first hero', ...);
it('clicking the second tile shows it on the card and does not start the ceremony', ...);
  // .phi-name text = getHero('warden').name; .heroselect not .hsc-active
it('Select Hero starts the ceremony for the selected hero', ...);
  // click tile 3, click .hss-confirm → .heroselect.hsc-active; .hsc-layer present
it('Select Hero twice starts one ceremony', ...);            // Review Focus 2
it('one re-roll: the controls go, the selected slot stays selected, the card shows the new hero', ...);
it('Select Hero during the swap picks the re-rolled hero', ...); // Review Focus 1
it('Practice (whole roster) still renders today\'s browse grid with the switch on', ...);
  // pendingMode 'practice', heroChoices = practiceHeroChoiceIds → .hsrow.browse, no .hss-body
it('watch mode: no Select Hero; a watched pick selects that hero and plays the ceremony', ...); // Review Focus 4
  // mount via HeroSelectWatch helpers as versus/spectateHeroSelect.test.tsx does
it('Ranked Duos: teammate\'s hero selected → Select Hero blocked, no ceremony', ...);
```

- [ ] **Step 2: Run the test file.** Expected: the integration tests FAIL.
- [ ] **Step 3: Implement the wiring** as described under Interfaces.
- [ ] **Step 4: Run** `npx vitest run packages/ui/src/hero-select packages/ui/src/heroReroll.test.tsx packages/ui/src/versus/spectateHeroSelect.test.tsx packages/ui/src/gauntlet/heroSelectGauntlet.test.tsx`. Expected: PASS, no existing test edited.
- [ ] **Step 5: Commit** `feat(ui): Hero Select renders the showcase body behind the switch`.

---

### Task 5: Ceremony from the splash art

**Files:**
- Modify: `packages/ui/src/hero-select/HeroSelectCeremony.tsx`, `packages/ui/src/hero-select/heroCeremony.css`, `packages/ui/src/hero-select/heroCeremonyGeometry.ts`, `packages/ui/src/HeroSelect.tsx` (the `<HeroSelectCeremony>` call), `packages/ui/src/hero-select/heroShowcase.css`
- Test: `packages/ui/src/hero-select/heroCeremonyGeometry.test.ts` (extend), `packages/ui/src/hero-select/heroShowcase.test.tsx`

**Interfaces:**
- Consumes: `splashArtRef`, `slotRefs` (Task 4).
- Produces:

```ts
// HeroSelectCeremony Props, new optional field
splash?: {
  /** The inspect card's .phi-art box: hidden under the clone one frame after commit, restored on cleanup. */
  artEl: RefObject<HTMLElement>;
  /** Elements that leave along exit vectors at the dismiss beat (the tile slots). */
  exitEls: MutableRefObject<(HTMLElement | null)[]>;
};
// heroCeremonyGeometry.ts
/** Where the splash clone settles: a square of the destination's width at its top-left, so the art lands
 *  where the card path's portrait frame lands and the final portrait is today's size. */
export function splashDest(dest: RectSnapshot): RectSnapshot;
```

- With `splash` absent, no line of today's behaviour changes (`cardEls` path).
- With `splash` present:
  - Commit effect: snapshot `exitEls` (all of them; none is the source) instead of the other cards; hide `artEl` one rAF later; restore on cleanup.
  - The clone renders `div.hsc-clone.hsc-splash` at `source`, containing a `div` (the `frameRef` target) with the art `img` (`decoding="sync"`, `object-fit: cover`, the card's right-edge mask `linear-gradient(90deg, #000 68%, transparent 100%)`). No `.herocard` markup.
  - Focus travel: `focusKeyframes(source, splashDest(dest))`.
  - Materializing is unchanged: it measures `frameRef`, and `artCrop` / `portraitBoundsOf` take it from there. `hsc-chrome-out` on the splash clone fades the mask edge out with the same timing as the card chrome.
  - `cloneW` / `cardZoom` / `.hsrow.browse` / `.hcdiff` reads are skipped.
- `heroShowcase.css`: `.heroselect.hss.hsc-active :is(.hss-stage, .hss-confirm) { opacity: 0; pointer-events: none; transition: opacity 0.2s ease var(--hsc-header-delay, 0ms); }` and `.heroselect.hss.hsc-active .hss-glow { opacity: 0; }`. The tile slots leave by the ceremony's exit vectors.
- `HeroSelect` passes `splash={{ artEl: splashArtRef, exitEls: slotRefs }}` only when the showcase body is rendered.

- [ ] **Step 1: Write the failing tests**

```ts
// heroCeremonyGeometry.test.ts
it('splashDest is a square of the destination width at its top-left', () => {
  expect(splashDest({ left: 100, top: 50, width: 300, height: 393, right: 400, bottom: 443 }))
    .toMatchObject({ left: 100, top: 50, width: 300, height: 300 });
});
```
```tsx
// heroShowcase.test.tsx
it('the ceremony clones the splash art, not a hero card', ...);
  // after Select Hero: .hsc-clone.hsc-splash present, .hsc-clone-card absent, clone img src = the card's art src
it('a reset mid-ceremony restores the body', ...);
  // set a new offer → no .hsc-layer, splash art box style.visibility === '', tiles present
it('a hero with no art still starts the ceremony', ...); // Review Focus 3
it('switch off: the ceremony still clones .herocard.big', ...);
```

- [ ] **Step 2: Run** `npx vitest run packages/ui/src/hero-select`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `splashDest`, the `splash` prop, the clone branch and the CSS.
- [ ] **Step 4: Run** `npx vitest run packages/ui/src/hero-select`. Expected: PASS including `heroPickClean.test.ts` unmodified.
- [ ] **Step 5: Commit** `feat(ui): the hero ceremony can start from the showcase card's splash art`.

---

### Task 6: Gates, devlog, PR

**Files:**
- Create: `docs/devlog/2026-11-16-hero-select-showcase.md` (follow `docs/devlog/README.md`)

- [ ] **Step 1:** `git fetch origin && git rebase origin/main`; resolve; re-run Task 4 and 5 test commands.
- [ ] **Step 2:** Run `npm run typecheck && npm run lint && npm test && npm run build:web`. Expected: all green. Report the output.
- [ ] **Step 3:** Write the devlog entry: what the switch is (`?heroshowcase=1`, DEV menu), what is shared (`HeroInspectCard`), the ceremony's `splash` source, what version one leaves out (Practice / Gauntlet grid, phone layout, players). No `patchNotes.ts` entry (nothing player-facing ships). No registry rule (a feature, not a bug fix).
- [ ] **Step 4:** `git diff --stat origin/main` and read the diff; confirm no existing test file changed.
- [ ] **Step 5:** Commit, `git push -u origin feat/hero-select-showcase`, `gh pr create`, `gh pr merge --auto --squash`. Do not merge by hand before `verify` is green. Tell Mike the folder and `?heroshowcase=1` so he can judge the look and the handoff himself.
