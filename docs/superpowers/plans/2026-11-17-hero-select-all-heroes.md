# Hero Select "All heroes" Showcase Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the whole-roster Hero Select grid (Practice "All heroes", Gauntlet), a card click opens the showcase inspect card in a closable window, and only its Select Hero button picks.

**Architecture:** `HeroSelect` keeps every pick rule and gains `openIndex` state. `HeroShowcase.tsx` is split so its card stage plus Select Hero button (`HeroShowcaseCard`) and its key/Ancient logic (`useShowcaseNav`) are shared by the three-hero showcase and a new `HeroBrowseWindow`. The ceremony reuses its existing `splash` source, with the grid's cards as the exit set.

**Tech Stack:** React 18, TypeScript, Vitest + jsdom (`renderedText.mount`), plain CSS on the scaled stage (`--phu` units).

**Spec:** `docs/superpowers/specs/2026-11-17-hero-select-all-heroes-design.md` (read it first; its companion is `2026-11-16-hero-select-showcase-design.md`).

## Global Constraints

- Work only in the worktree `.claude/worktrees/hero-select-all-heroes`, branch `feat/hero-select-all-heroes`. Run `npm install` inside it before trusting any check. Never push to `main`; open a PR.
- Applies only when `browseShowcase = showcaseOn && browse` (DEV switch on, party home look, more than six heroes). Otherwise the screen is byte-for-byte today's.
- The grid cards, their order, columns, scroll box and hover face do not change.
- These suites stay green **without edits**: `heroShowcase.test.tsx`, `heroSelectPh.test.tsx`, `gauntlet/heroSelectGauntlet.test.tsx`, `heroPickClean.test.ts`, `heroCeremonySplash.test.tsx`, `compendiumHeroAncients.test.tsx`, `tapInspect.test.ts`, `touchInput.test.ts`, the ceremony unit tests. Note `heroShowcase.test.tsx` asserts that a Practice roster with the switch on has no `.hss-body` and no root class `hss` before any click: the window must not render until opened, and the root never gets `hss` on this path.
- Every hook in `HeroSelect` sits above the `!choices` early return.
- No `title=` attributes, no bare `cursor: pointer`, no raw `vw`/`vh`, no portal to `document.body`, no looping paint animation, no per-frame layout read. Motion is transform/opacity only and off under `prefers-reduced-motion`.
- The card does not pop on open or on a step (no `phi-in` scale); only the window fades.
- No `patchNotes.ts` entry (DEV-only). No change to the Compendium or to the three-hero showcase's look.
- Root classes on this path: `hsb` whenever `browseShowcase`, plus `hsb-open` while the window is open.

## Review Focus

1. Opening the window on a hero in the grid's second visible row or scrolled far down, then closing: focus returns to the last hero shown and the grid scrolls it into view only if it is outside the visible rows. (Task 3)
2. Pressing Escape, the X or the scrim while the ceremony is running: nothing closes and nothing re-commits. (Task 4)
3. Stepping with the arrows past either end of the roster: wraps, and the hero on show is the one Select Hero picks. (Tasks 2, 4)
4. A new offer arriving (or the offer clearing at a pick) while the window is open: the window is closed on the next offer. (Task 3)
5. Keyboard focus while the window is open: Tab cannot reach a grid card behind the scrim. (Task 3)

---

### Task 1: Split the showcase body so the card stage is reusable

**Files:**
- Modify: `packages/ui/src/hero-select/HeroShowcase.tsx`
- Modify: `packages/ui/src/hero-select/heroShowcase.css`
- Test: `packages/ui/src/hero-select/heroShowcaseCard.test.tsx` (new)

**Interfaces:**
- Produces, exported from `HeroShowcase.tsx`:

```ts
export interface ShowcaseNav {
  anc: AncientId;
  pickAncient: (a: AncientId) => void;
  step: (d: number) => void;                                   // wraps; no-op when count <= 1
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;       // Left/Right step, Up/Down Ancients; dead when busy
}
export function useShowcaseNav(count: number, selected: number, onSelect: (i: number) => void, busy: boolean): ShowcaseNav;

export interface HeroShowcaseCardProps {
  heroId: string;
  count: number;                       // arrows render only when count > 1
  nav: ShowcaseNav;
  onConfirm: () => void;
  onDenied: () => void;
  blocked: null | 'mate' | 'pending' | 'busy';
  watching: boolean;                   // no Select Hero button
  showDifficulty: boolean;
  loadout: ReturnType<typeof useLiveLoadout>;
  artRef: RefObject<HTMLDivElement>;
  children?: ReactNode;                // rendered inside .hss-stage after the next arrow (the window's X and note)
}
/** The `.hss-stage` (prev arrow, HeroInspectCard, next arrow, children) followed by the `.hss-confirm` button. */
export function HeroShowcaseCard(props: HeroShowcaseCardProps): JSX.Element;
```

- `HeroShowcase` keeps its props and markup exactly; it now calls `useShowcaseNav(n, selected, onSelect, blocked === 'busy')` and renders `<HeroShowcaseCard>` after the tiles.

- [ ] **Step 1: Write the failing test** in `heroShowcaseCard.test.tsx` (copy the mount helpers, flag setup and `host` wrapper pattern from `heroShowcase.test.tsx`, but wrap in `<div className="heroselect phhs ph-tokens hsb">`). A small harness component calls `useShowcaseNav` and renders `<div tabIndex={-1} onKeyDown={nav.onKeyDown}><HeroShowcaseCard .../></div>`.

```ts
it('renders the stage and Select Hero with no tile row', () => {
  const el = show({ heroId: 'aster', count: 3 });
  expect(el.querySelector('.hss-stage .hss-card')).not.toBeNull();
  expect(el.querySelector('.hss-confirm')!.textContent).toBe('Select Hero');
  expect(el.querySelector('.hss-tiles')).toBeNull();
});
it('arrows call onSelect with the wrapped index', () => {
  const onSelect = vi.fn();
  const el = show({ heroId: 'aster', count: 3, selected: 0, onSelect });
  click(el.querySelector('.phi-nav.is-prev')); expect(onSelect).toHaveBeenLastCalledWith(2);
  click(el.querySelector('.phi-nav.is-next')); expect(onSelect).toHaveBeenLastCalledWith(1);
});
it('children render inside the stage', () => {
  const el = show({ heroId: 'aster', count: 3, children: <i className="probe" /> });
  expect(el.querySelector('.hss-stage > .probe')).not.toBeNull();
});
it('busy: keys select nothing', () => {
  const onSelect = vi.fn();
  const el = show({ heroId: 'aster', count: 3, onSelect, blocked: 'busy' });
  keyOn(el.querySelector('[tabindex]')!, 'ArrowRight'); expect(onSelect).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run packages/ui/src/hero-select/heroShowcaseCard.test.tsx`
Expected: FAIL (`HeroShowcaseCard` / `useShowcaseNav` not exported).

- [ ] **Step 3: Extract `useShowcaseNav` and `HeroShowcaseCard`** in `HeroShowcase.tsx` by moving the existing Ancient state, `step`, `onKeyDown`, the `.hss-stage` block and the `.hss-confirm` button out of `HeroShowcase` unchanged. `HeroShowcase` keeps the tiles, the glow, the focus effects and the body element.

- [ ] **Step 4: Widen the shared CSS selectors** in `heroShowcase.css`. Every rule whose subject is `.hss-stage`, `.hss-card` (and its `.phi-*` descendants), `.phi-nav`, `.hss-confirm`, or the `hss-art-in` keyframe use changes its prefix from `.heroselect.hss` to `.heroselect:is(.hss, .hsb)`. The same for the two `.hsc-active` rules that fade `.hss-stage, .hss-confirm`. Also widen the base paint of the round re-roll plate (the `:is(.hss-reroll, .hss-reroll-gone)` plate rule, its `svg` size rule, its hover and `:focus-visible` rules) to include a new class `.hsb-x`, without its `top`/`right` position. Rules about the heading, `.hss-body`, `.hss-tiles`, tiles, the glow and `hss-snap` keep `.heroselect.hss` only.

- [ ] **Step 5: Run the new test and the untouched showcase suites**

Run: `npx vitest run packages/ui/src/hero-select packages/ui/src/compendiumHeroAncients.test.tsx`
Expected: PASS, with `heroShowcase.test.tsx` unmodified.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/hero-select
git commit -m "refactor(ui): the showcase card stage and its keys are shareable"
```

---

### Task 2: The window component

**Files:**
- Create: `packages/ui/src/hero-select/HeroBrowseWindow.tsx`
- Create: `packages/ui/src/hero-select/heroBrowseWindow.css`
- Test: `packages/ui/src/hero-select/heroBrowseWindow.test.tsx` (new)

**Interfaces:**
- Consumes: `useShowcaseNav`, `HeroShowcaseCard` (Task 1).
- Produces (default-exportable for `lazy`, named export too):

```ts
export interface HeroBrowseWindowProps {
  heroes: readonly string[];           // the grid's alphabetical ids (`shown`)
  index: number;                       // the hero on show
  onStep: (index: number) => void;     // arrows, Left / Right
  onClose: () => void;                 // X, scrim press, Escape
  onConfirm: () => void;               // Select Hero
  busy: boolean;                       // ceremony running: nothing closes, steps or confirms
  showDifficulty: boolean;
  loadout: ReturnType<typeof useLiveLoadout>;
  artRef: RefObject<HTMLDivElement>;   // the card's .phi-art, the ceremony's source
}
export function HeroBrowseWindow(props: HeroBrowseWindowProps): JSX.Element;
```

- Markup (class names are part of the interface; Tasks 3 and 4 and the tests query them):

```
div.hsb-win[role=dialog][aria-modal=true][aria-label="{hero name}"][tabIndex=-1]   ← takes focus on mount; onKeyDown
  div.hsb-scrim                                  ← onClick → onClose (unless busy)
  div.hsb-panel.hss-body                         ← pointer-events: none; its children take the pointer
    HeroShowcaseCard (blocked = busy ? 'busy' : null, watching = false, count = heroes.length)
      children: button.hsb-x[aria-label="Close"] (Icon "close" or the repo's existing X glyph)
                span.hcpractice.hsb-note "Not currently enabled in Play"   ← only when getHero(id).practiceOnly
```

- Escape calls `onClose` (unless busy) and stops propagation; other keys go to `nav.onKeyDown`.

- [ ] **Step 1: Write the failing tests** (mount inside `<div className="heroselect phhs ph-tokens hsb hsb-open">`, both flags on, heroes = `practiceHeroChoiceIds('all')` sorted by name):

```ts
it('shows the hero at index, with Select Hero, an X, and no tiles', ...)   // .phi-name text === getHero(heroes[index]).name; .hsb-x[aria-label="Close"]; no .hss-tiles
it('X, a scrim click and Escape each call onClose once and never onConfirm', ...)
it('a click on the card, an arrow or Select Hero does not call onClose', ...)
it('arrows and Left/Right call onStep with the wrapped index', ...)        // index 0, prev → heroes.length - 1; last, next → 0
it('Select Hero calls onConfirm', ...)
it('busy: X, scrim, Escape, arrows and keys call nothing; Select Hero is aria-disabled', ...)
it('a practiceOnly hero shows "Not currently enabled in Play"; another hero does not', ...)  // pick ids via HEROES.find(h => h.practiceOnly); skip-assert with expect(...).toBeDefined()
it('takes focus on mount', ...)                                             // document.activeElement === .hsb-win
it('has no title attribute anywhere', ...)                                  // el.querySelector('[title]') === null
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run packages/ui/src/hero-select/heroBrowseWindow.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `HeroBrowseWindow`** per the interface above. `useShowcaseNav(heroes.length, index, onStep, busy)`; the card is keyed by hero id as in `HeroShowcase`. Imports `./heroShowcase.css` and `./heroBrowseWindow.css`.

- [ ] **Step 4: Write `heroBrowseWindow.css`**, every rule prefixed `.heroselect.hsb`:
  - `.hsb-win`: `position: absolute; inset: 0`, above the grid and header, below the ceremony layer (check the ceremony's z-index in `heroCeremony.css`); one-shot opacity fade-in; no animation under reduced motion.
  - `.hsb-scrim`: fills the window, a static dark navy wash (darkness is the builder's; start at 0.72 alpha), no blur filter animation.
  - `.hsb-panel`: centred flex column sized so card plus button fit the 1920x1080 stage with no scroll; `pointer-events: none`, with `.hss-stage > *` and `.hss-confirm` set back to `auto`. Define `--hss-card-w` here as the showcase does.
  - `.hsb-x`: `position: absolute`, straddling the card's top-right corner with the same 14-unit overhang the re-roll uses on a tile (`calc(-14 * var(--phu))` from the card's top and right edges; compute the right offset from `--hss-card-w` as the arrow rules do). Its plate comes from the widened re-roll rules in Task 1.
  - `.hsb-note`: on the splash art's lower band (the grid card's `.hcpractice` look).
  - `.heroselect.hsb.hsc-active :is(.hsb-scrim, .hsb-x, .hsb-note)`: fade out with `transition: opacity 0.2s ease var(--hsc-header-delay, 0ms)` and `pointer-events: none`, matching the stage's existing rule.

- [ ] **Step 5: Run, expect pass**

Run: `npx vitest run packages/ui/src/hero-select/heroBrowseWindow.test.tsx && npm run lint`
Expected: PASS; lint clean (it enforces the `title` ban and stage tripwires).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/hero-select
git commit -m "feat(ui): the All heroes showcase window (card, X, scrim, Escape)"
```

---

### Task 3: Open and close the window from the grid

**Files:**
- Modify: `packages/ui/src/HeroSelect.tsx`
- Test: `packages/ui/src/hero-select/heroBrowseSelect.test.tsx` (new; model its setup on the `'Hero Select with the showcase body'` describe in `heroShowcase.test.tsx`: the `ResizeObserver` stub, `settle`, `open({ mode: 'practice', choices: practiceHeroChoiceIds('all') })`, plus `await import('./HeroBrowseWindow')` in `settle`)

**Interfaces:**
- Consumes: `HeroBrowseWindow` (Task 2), loaded with `lazy` beside the existing lazy `HeroShowcase`.
- Produces in `HeroSelect`: `browseShowcase: boolean`, `openIndex: number | null` (index into `shown`), root classes `hsb` / `hsb-open`. Task 4 uses `openIndex` and `splashArtRef`.

- [ ] **Step 1: Write the failing tests**

```ts
it('both switches on: the grid renders, no window, root has hsb and not hss', ...)       // .hsrow.browse present; .hsb-win null
it('a card click opens the window for that hero and starts no ceremony', ...)            // click the 3rd .herocard → .hsb-win present, .phi-name === that hero's name, root has hsb-open, not hsc-active
it('X closes it; so does a scrim click; so does Escape; none picks', ...)                 // .hsb-win null after each, root not hsc-active, useOwnHeroPick heroId null
it('stepping then closing returns focus to the last hero shown', ...)                     // open card 0, press next twice, Escape → document.activeElement === cards[2]
it('closing scrolls the last hero into view', ...)                                        // spy HTMLElement.prototype.scrollIntoView (define it: jsdom has none); called on that card with { block: 'nearest' }
it('while open the grid row is inert', ...)                                               // row.inert === true (or hasAttribute('inert')); false after close
it('a new offer closes the window', ...)                                                  // open, then useGame.setState({ heroChoices: [...all].reverse() }) → .hsb-win null
it('showcase switch off: a card click picks as today', ...)                               // setHeroShowcase(false) → click → root hsc-active, no .hsb-win
it('party home off: a card click picks as today', ...)
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run packages/ui/src/hero-select/heroBrowseSelect.test.tsx`
Expected: FAIL (no `.hsb-win`; the click picks).

- [ ] **Step 3: Implement in `HeroSelect.tsx`**
  - `const browseShowcase = showcaseOn && !!choices && choices.length > 6 && !watch;` derived beside `showcase`, above the early return.
  - `const [openIndex, setOpenIndex] = useState<number | null>(null);` Reset it in the existing `if (showcaseOn && offerSeen !== choices)` block on **any** offer change (not only `moved > 1`).
  - Card `onClick`: when `browseShowcase`, `sfx.pulse(); setOpenIndex(i);` instead of `onPick(id, i)`. The card's `disabled={active}` stays.
  - Root class: add `hsb` when `browseShowcase`, `hsb-open` when `openIndex !== null`.
  - Mount `<Suspense fallback={null}><HeroBrowseWindow heroes={shown} index={openIndex} onStep={setOpenIndex} onClose={closeWindow} onConfirm={onBrowseConfirm} busy={active} showDifficulty={showDifficulty} loadout={loadout} artRef={splashArtRef} /></Suspense>` inside `.heroselect`, after `.hsbox`, only when `browseShowcase && openIndex !== null`. `onBrowseConfirm` is a no-op stub in this task (Task 4 fills it).
  - `closeWindow`: no-op while `active`; otherwise remember `openIndex` in a ref and `setOpenIndex(null)`.
  - One effect keyed on `openIndex` (above the early return): set `rowRef.current.inert = openIndex !== null`; on the transition to `null`, focus `cardRefs.current[last]` with `{ preventScroll: true }` then call `scrollIntoView({ block: 'nearest' })` on it if that method exists. `block: 'nearest'` scrolls only when the card is outside the visible rows.

- [ ] **Step 4: Run, expect pass, with the untouched suites**

Run: `npx vitest run packages/ui/src/hero-select packages/ui/src/gauntlet/heroSelectGauntlet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/HeroSelect.tsx packages/ui/src/hero-select/heroBrowseSelect.test.tsx
git commit -m "feat(ui): a roster card opens the showcase window instead of picking"
```

---

### Task 4: Select Hero and the ceremony handoff

**Files:**
- Modify: `packages/ui/src/HeroSelect.tsx`
- Modify: `packages/ui/src/hero-select/HeroSelectCeremony.tsx` only if the exit set needs it (its `splash.exitEls` is already typed `MutableRefObject<(HTMLElement | null)[]>`, which `cardRefs` satisfies)
- Test: extend `packages/ui/src/hero-select/heroBrowseSelect.test.tsx`

**Interfaces:**
- Consumes: `openIndex`, `splashArtRef`, `cardRefs`, `commitPick(id, index, el)` (existing), the ceremony's `splash: { artEl, exitEls }` prop (existing).

- [ ] **Step 1: Write the failing tests**

```ts
it('Select Hero starts the ceremony for the hero on show, from the splash art', ...)
// open card 0, next once, click .hss-confirm → root hsc-active; useOwnHeroPick.getState().heroId === shown[1];
// document.querySelector('.hsc-clone.hsc-splash') not null; no .hsc-clone-card
it('Select Hero twice starts one ceremony', ...)
it('while the ceremony runs: Escape, X and a scrim click close nothing; arrows step nothing', ...)
// .hsb-win still mounted, .phi-name unchanged, heroId unchanged
it('a reset mid-ceremony restores the grid and the window', ...)
// dispatch the DEV replay path as heroShowcase.test.tsx's 'a reset mid-ceremony restores the body' does
it('switch off: the ceremony still clones .herocard.big with hsc-browse', ...)
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run packages/ui/src/hero-select/heroBrowseSelect.test.tsx`
Expected: the new tests FAIL (Select Hero does nothing).

- [ ] **Step 3: Implement**
  - `onBrowseConfirm`: `const art = splashArtRef.current; if (art && openIndex !== null) commitPick(shown[openIndex]!, openIndex, art);`
  - Ceremony mount: pass `splash` when `showcase` **or** `browseShowcase && openIndex !== null`; `exitEls` is `slotRefs` for the showcase and `cardRefs` for this path (all grid cards leave; none is the source, which the ceremony's splash branch already assumes).
  - Confirm the window sits below the ceremony layer and that the clone paints before the art hides (the existing one-rAF rule covers it).
  - If 40-plus exits misbehave, use the ceremony's existing dense-roster cap (the `exits` timing in `heroCeremonyGeometry.ts` / `heroCeremonyTiming.ts`); do not add a new rule.

- [ ] **Step 4: Run the whole UI hero-select area and the gates**

Run: `npx vitest run packages/ui/src/hero-select packages/ui/src/gauntlet packages/ui/src/versus/spectateHeroSelect.test.tsx && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src
git commit -m "feat(ui): Select Hero in the roster window plays the splash ceremony"
```

---

### Task 5: Devlog, full gates, PR

**Files:**
- Create: `docs/devlog/2026-11-17-hero-select-all-heroes.md` (format per `docs/devlog/README.md`: what shipped, that it is behind the showcase DEV switch, Mike's quoted asks, Claude's calls from the spec)

- [ ] **Step 1: Write the devlog entry.**

- [ ] **Step 2: Rebase and run every gate**

Run: `git fetch origin && git rebase origin/main && npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all green. Report the actual output.

- [ ] **Step 3: Commit, push, open the PR** (never to `main`)

```bash
git add docs/devlog/2026-11-17-hero-select-all-heroes.md
git commit -m "docs: devlog for the All heroes showcase window"
git push -u origin feat/hero-select-all-heroes
gh pr create --title "feat(ui): Hero Select All heroes opens the showcase card in a window (DEV switch)" --body "<summary, test evidence, how to view: ?heroshowcase=1 in Practice All heroes and Gauntlet>"
```

- [ ] **Step 4: Hand to Mike for the visual review.** He looks at it himself in a dev server run in a Terminal tab from this worktree, with `?heroshowcase=1`, in Practice "All heroes" and Gauntlet. Do not merge until he has seen it and `verify` is green.
