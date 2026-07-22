# Hand-card backplate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give hand cards an ornate stone/gold backplate that frames the existing oval portrait and glass info panel, travels with the card while dragged from hand, and dissolves when the card is played to the board.

**Architecture:** Presentation-only. A new fixed-size `.cardplate` element renders behind the card's existing children at `z-index: 0`; nothing in the current layout moves. Long rules text shrinks via character-count buckets computed by a pure function — no DOM measurement. The dissolve ships as a placeholder in this plan; the authored effect is a separate phase.

**Tech Stack:** React 18 + TypeScript, plain CSS in `packages/ui/src/styles.css`, Vitest for the pure logic, existing `pixiFx` for dust.

**Spec:** [`docs/superpowers/specs/2026-07-21-hand-card-backplate-design.md`](../specs/2026-07-21-hand-card-backplate-design.md)

---

## Scope note — what is NOT in this plan

**Phase 2 (the authored dissolve effect) is deliberately excluded.** The owner asked to build that as its own pass with its own preview rig. This plan ships a *placeholder* exit so the plate doesn't pop out of existence: one CSS keyframe plus the existing `pixiFx.dust()` call. The swap surface is one CSS class (`.cardplate.dissolving`) and one call site (`platePuff()`), both created here.

## Testing reality

This repo has 73 test files, but they cover **pure modules** (`cardText`, `choreo/*`, audio config) — there is no React render-testing setup. So:

- **Task 1 is genuine TDD** — the text-bucket function is pure and gets real tests.
- **Tasks 2–6 are presentation.** They are verified by typecheck/lint/build plus concrete live DOM checks, which are spelled out per task. Do not invent React render tests; there is no harness for them and adding one is out of scope.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `apps/web/public/frames/cardplate.png` | create | The plate art (copied from `C:\Users\micha\Desktop\Reference Art\cardplate.png`, 1023×1537) |
| `packages/ui/src/cardPlateConfig.ts` | create | Tunable config + the pure `plateTextBucket()` function. Mirrors `glowConfig.ts` exactly. |
| `packages/ui/src/cardPlateConfig.test.ts` | create | Tests for `plateTextBucket()` |
| `packages/ui/src/CardPlateTuner.tsx` | create | Dev-only 🂠 tuner panel |
| `packages/ui/src/Card.tsx` | modify | `plated` prop, `.cardplate` element, bucket class |
| `packages/ui/src/Recruit.tsx` | modify | Pass `plated` at 2 call sites; `platePuff()` on play |
| `packages/ui/src/styles.css` | modify | `.cardplate` geometry, text buckets, dissolve keyframe |
| `packages/ui/src/DevMenu.tsx` | modify | Register the tuner |
| `docs/devlog.md`, `docs/roadmap.md`, `README.md` | modify | Required by CLAUDE.md on every commit |

---

### Task 1: The plate config module + text buckets

**Files:**
- Create: `packages/ui/src/cardPlateConfig.ts`
- Test: `packages/ui/src/cardPlateConfig.test.ts`

Character-count thresholds are derived from the measured corpus (273 card texts: median 59, p90 96, max 187 static / ~230 with live values folded in).

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/cardPlateConfig.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { plateTextBucket, PLATE_BUCKETS, getCardPlateConfig } from './cardPlateConfig';

describe('plateTextBucket', () => {
  it('returns the largest size for short text', () => {
    expect(plateTextBucket('Taunt.')).toBe('s');
    expect(plateTextBucket('')).toBe('s');
  });

  it('steps down as text lengthens', () => {
    const short = plateTextBucket('Taunt.');                          // 6
    const med = plateTextBucket('x'.repeat(80));                      // between s and l
    const long = plateTextBucket('x'.repeat(130));
    const xlong = plateTextBucket('x'.repeat(200));
    expect([short, med, long, xlong]).toEqual(['s', 'm', 'l', 'xl']);
  });

  it('is monotonic — longer text never gets a LARGER font bucket', () => {
    const order = PLATE_BUCKETS.map((b) => b.id);
    let prev = 0;
    for (let n = 0; n <= 300; n += 1) {
      const idx = order.indexOf(plateTextBucket('x'.repeat(n)));
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });

  it('treats undefined/null text as empty', () => {
    expect(plateTextBucket(undefined)).toBe('s');
  });

  it('clamps anything past the last threshold to the smallest bucket', () => {
    expect(plateTextBucket('x'.repeat(5000))).toBe('xl');
  });

  it('honours tuned thresholds from the config', () => {
    const cfg = getCardPlateConfig();
    expect(cfg.bucketM).toBeGreaterThan(0);
    expect(cfg.bucketL).toBeGreaterThan(cfg.bucketM);
    expect(cfg.bucketXl).toBeGreaterThan(cfg.bucketL);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/ui && npx vitest run src/cardPlateConfig.test.ts`
Expected: FAIL — `Failed to resolve import "./cardPlateConfig"`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/cardPlateConfig.ts`:

```ts
/**
 * Tunable geometry + text sizing for the HAND CARD BACKPLATE — the ornate stone/gold card body that frames a
 * hand card's oval portrait and glass info panel, and dissolves when the card is played to the board.
 *
 * The plate is STATIC: always the same size, never stretched. (A nine-sliced plate was prototyped and rejected —
 * the art's greek-key tabs sit at ~51% height, dead centre of the stretch band, so no slice inset protects them
 * from the measured 40% vertical stretch range. See the design spec.) Because the plate can't grow, long rules
 * text SHRINKS to fit instead, via `plateTextBucket()`.
 *
 * Held in one mutable, localStorage-persisted config so it can be dialed by eye via the DEV 🂠 Card Plate tuner
 * (`CardPlateTuner.tsx`). Values reflect to `--plate-*` CSS vars on :root. The SHIPPED defaults live BOTH here
 * and as the CSS fallbacks in styles.css (`var(--plate-scale, …)`), so production renders correctly without
 * importing this module — when a value is dialed in, "Copy values" grabs the JSON and the CSS fallbacks must be
 * updated to match. Keeping the two in sync is mandatory; three silent drifts have been caused by missing it.
 */
export interface CardPlateConfig {
  /** Plate WIDTH as a multiple of the compact card width (--ccw). >1 = the border sits outside the card. */
  scale: number;
  /** Plate vertical offset from the top of the card, in px × --u. Negative lifts the plate up. */
  top: number;
  /** Corner radius of the plate's clipping box (px × --u). Cosmetic — the art has its own painted corners. */
  radius: number;
  /** Text bucket thresholds — character counts at which the rules-text font steps DOWN a size. */
  bucketM: number;
  bucketL: number;
  bucketXl: number;
  /** Placeholder dissolve — duration (ms). */
  puffMs: number;
  /** Placeholder dissolve — how much the plate scales up as it fades (1 = no growth). */
  puffScale: number;
  /** Placeholder dissolve — density multiplier passed to pixiFx.dust(). */
  puffDust: number;
}

const DEFAULTS: CardPlateConfig = {
  scale: 1.18,
  top: -14,
  radius: 10,
  // Derived from the measured corpus (median 59 / p90 96 / max 187 static, ~230 with live values folded in).
  // Conservative by design: character count is a proxy for WRAPPED height, and long-word text wraps taller
  // than short-word text at the same length. Dial these in the tuner if a specific card lands wrong.
  bucketM: 70,
  bucketL: 110,
  bucketXl: 160,
  puffMs: 320,
  puffScale: 1.06,
  puffDust: 1.5,
};

/** Font-size buckets, LARGEST first. `id` is appended to a `.plate-txt-` class on the card. */
export const PLATE_BUCKETS = [
  { id: 's', em: 1 },
  { id: 'm', em: 0.92 },
  { id: 'l', em: 0.84 },
  { id: 'xl', em: 0.76 },
] as const;

export type PlateBucketId = (typeof PLATE_BUCKETS)[number]['id'];

/**
 * Pick a rules-text font bucket from the text's LENGTH — a pure function, deliberately NOT a DOM measurement.
 *
 * The obvious implementation (render, read `scrollHeight`, step down until it fits) is a layout read per card
 * per render on the hand, which re-renders constantly — precisely the `getBoundingClientRect`-per-frame
 * anti-pattern named in docs/performance.md. This is O(1), memoizable and deterministic.
 *
 * Pass the LIVE card text (values already folded in), not the static def text — a card printing "+6/+6
 * (2 more)" is longer than its printed base rate.
 */
export function plateTextBucket(text: string | undefined | null): PlateBucketId {
  const n = text ? text.length : 0;
  if (n < cfg.bucketM) return 's';
  if (n < cfg.bucketL) return 'm';
  if (n < cfg.bucketXl) return 'l';
  return 'xl';
}

export const PLATE_RANGES: Record<keyof CardPlateConfig, [number, number, number]> = {
  scale: [1, 1.6, 0.005],
  top: [-80, 40, 1],
  radius: [0, 40, 1],
  bucketM: [20, 140, 1],
  bucketL: [40, 200, 1],
  bucketXl: [60, 280, 1],
  puffMs: [80, 1200, 10],
  puffScale: [1, 1.5, 0.01],
  puffDust: [0, 4, 0.1],
};

export const PLATE_DESC: Record<keyof CardPlateConfig, string> = {
  scale: 'Plate WIDTH as a multiple of the card width. >1 pushes the ornate border outside the card.',
  top: 'Plate vertical offset from the top of the card. Negative lifts it up.',
  radius: 'Corner radius of the plate box. Cosmetic — the art paints its own corners.',
  bucketM: 'Character count at which rules text steps down to the MEDIUM font size.',
  bucketL: 'Character count at which rules text steps down to the SMALL font size.',
  bucketXl: 'Character count at which rules text steps down to the SMALLEST font size.',
  puffMs: 'Placeholder dissolve duration (ms).',
  puffScale: 'How much the plate grows as it fades. 1 = fades in place.',
  puffDust: 'Dust density multiplier for the dissolve puff.',
};

export const PLATE_KEYS = Object.keys(DEFAULTS) as (keyof CardPlateConfig)[];

const KEY = 'ascent.cardplate';
let cfg: CardPlateConfig = (() => {
  // DEV-ONLY localStorage override: a tuner's saved tweaks must never beat the shipped DEFAULTS in a
  // production build (they did, for dragFeel + layoutConfig — owner report 2026-07-21, fixed in #615).
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<CardPlateConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getCardPlateConfig(): CardPlateConfig {
  return cfg;
}

/** Reflect the tuned plate values onto :root so the pure-CSS rules pick them up live. */
export function applyCardPlateVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--plate-scale', String(cfg.scale));
  root.setProperty('--plate-top', `${cfg.top}px`);
  root.setProperty('--plate-radius', `${cfg.radius}px`);
  root.setProperty('--plate-puff-ms', `${cfg.puffMs}ms`);
  root.setProperty('--plate-puff-scale', String(cfg.puffScale));
  for (const b of PLATE_BUCKETS) root.setProperty(`--plate-txt-${b.id}`, String(b.em));
}

export function setCardPlateValue(key: keyof CardPlateConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  applyCardPlateVars();
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

export function resetCardPlateConfig(): void {
  cfg = { ...DEFAULTS };
  applyCardPlateVars();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

applyCardPlateVars();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/ui && npx vitest run src/cardPlateConfig.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/cardPlateConfig.ts packages/ui/src/cardPlateConfig.test.ts
git commit -m "feat(ui): card-plate config + pure text-size bucketing"
```

---

### Task 2: Copy the plate art in

**Files:**
- Create: `apps/web/public/frames/cardplate.png`

- [ ] **Step 1: Copy the asset**

```bash
cp "/c/Users/micha/Desktop/Reference Art/cardplate.png" apps/web/public/frames/cardplate.png
```

- [ ] **Step 2: Verify it landed and is the expected image**

```bash
python -c "
import struct
d=open('apps/web/public/frames/cardplate.png','rb').read(33)
w,h=struct.unpack('>II',d[16:24]); print(w,h)
"
```
Expected: `1023 1537`

- [ ] **Step 3: Commit**

```bash
git add apps/web/public/frames/cardplate.png
git commit -m "chore(ui): add cardplate.png (hand-card backplate art)"
```

---

### Task 3: Render the plate in `Card.tsx`

**Files:**
- Modify: `packages/ui/src/Card.tsx`

The plate is the **first child** of `.card` so tree order puts it behind every sibling, and `.card.plated` gets `isolation: isolate` (Task 4) so its `z-index: 0` can't escape into neighbouring cards.

- [ ] **Step 1: Add the art const beside the existing frame consts**

After the `SPELL_FRAME_SRC` block (currently `Card.tsx:37-38`), add:

```ts
// HAND CARD BACKPLATE — the ornate stone/gold card body behind a card in hand (and on the dragged copy).
// Same load pattern as the frames above: BASE_URL-relative (root-absolute 404s on itch's CDN sub-path) with a
// module-level availability flag flipped on the first 404, so a missing asset degrades to today's look.
const CARD_PLATE_SRC = `${import.meta.env.BASE_URL}frames/cardplate.png`;
let cardPlateAvailable = true;
```

- [ ] **Step 2: Add the import**

Add to the import block at the top of `Card.tsx`:

```ts
import { plateTextBucket } from './cardPlateConfig';
```

- [ ] **Step 3: Add the `plated` prop**

In the props type (ends at `Card.tsx:263`), add before the closing `}`:

```ts
  /** Render the ornate card BACKPLATE behind this card — the full card body used in hand and on the card
   *  dragged out of hand. Board / shop / combat cards are never plated. */
  plated?: boolean;
```

And add `plated,` to the destructured parameter list (alongside `locked,` / `lockLabel,` at `Card.tsx:191-192`).

- [ ] **Step 4: Add the availability state + bucket, next to the existing frame state**

Beside `const [sframeOk, setSframeOk] = useState(stdFrameAvailable);` (`Card.tsx:337`):

```ts
  const [plateOk, setPlateOk] = useState(cardPlateAvailable);
  const usePlate = !!plated && plateOk;
  // Size the rules text from the LIVE text string (values already folded in), never by measuring the DOM.
  const txtBucket = plateTextBucket(shownText);
```

> `shownText` already exists in this component and is the live, term-renamed rules text used by the drawer at `Card.tsx:620`. Confirm the identifier before relying on it; if it is defined *below* this point, move this line down to just above the `return`.

- [ ] **Step 5: Add the class names**

In the className template literal (`Card.tsx:344`), append before the closing backtick:

```
${usePlate ? ` plated plate-txt-${txtBucket}` : ''}
```

- [ ] **Step 6: Render the plate element as the FIRST child**

Immediately after the opening `>` of the root div (`Card.tsx:376`), *before* the `buffFloat` block:

```tsx
      {/* Backplate — the ornate card body behind everything, on hand + dragged-from-hand cards only. FIRST
          child so tree order paints it behind every sibling; `.card.plated` isolates so its z-index can't
          escape into neighbouring cards. `<img>` rather than a CSS background so a 404 is detectable. */}
      {usePlate && (
        <img
          className="cardplate"
          src={CARD_PLATE_SRC}
          alt=""
          aria-hidden="true"
          draggable={false}
          onError={() => { cardPlateAvailable = false; setPlateOk(false); }}
        />
      )}
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/Card.tsx
git commit -m "feat(ui): render the card backplate behind plated cards"
```

---

### Task 4: Plate geometry + text buckets in `styles.css`

**Files:**
- Modify: `packages/ui/src/styles.css`

Every value carries a **CSS fallback matching the TS `DEFAULTS`** — production never imports `cardPlateConfig.ts`, so the fallback is what ships.

- [ ] **Step 1: Add the plate block**

Add a new section near the "AUTHORED FRAMES" block:

```css
/* ============================ HAND CARD BACKPLATE ============================
   The ornate stone/gold card body behind a card in hand (and on the dragged copy). STATIC size — never
   stretched (the art's greek-key tabs sit mid-edge and smear under vertical stretch), so long rules text
   shrinks instead via the `.plate-txt-*` buckets below.
   Geometry is driven by --plate-* vars; the FALLBACKS here must mirror DEFAULTS in cardPlateConfig.ts,
   because production doesn't import that module. */
.card.plated {
  /* Contain the plate's z-index so it can't paint behind a NEIGHBOURING card. Safe here specifically because
     plated cards only ever live in the hand / on the drag layer — never in combat, so there is no per-swing
     GSAP lunge for a new stacking context to fight. */
  isolation: isolate;
}
.card.plated .cardplate {
  position: absolute;
  z-index: 0;                       /* behind every sibling; tree order already puts it first */
  left: 50%;
  top: var(--plate-top, -14px);
  width: calc(var(--ccw) * var(--plate-scale, 1.18));
  /* Source art is 1023x1537 → height = width x 1.5024. Locked, never stretched. */
  height: calc(var(--ccw) * var(--plate-scale, 1.18) * 1.5024);
  transform: translateX(-50%);
  border-radius: var(--plate-radius, 10px);
  pointer-events: none;
  user-select: none;
}

/* Rules-text size buckets — picked by character count in plateTextBucket(), applied as a class on the card.
   `em` values mirror PLATE_BUCKETS in cardPlateConfig.ts. */
.card.plated.plate-txt-s  .drawer .desc { font-size: 1em; }
.card.plated.plate-txt-m  .drawer .desc { font-size: 0.92em; }
.card.plated.plate-txt-l  .drawer .desc { font-size: 0.84em; }
.card.plated.plate-txt-xl .drawer .desc { font-size: 0.76em; }

/* Placeholder dissolve — PHASE 1 ONLY. The authored effect replaces this rule and the platePuff() call site;
   nothing else depends on it. One-shot, transform/opacity only (compositor-only, no paint properties). */
.card .cardplate.dissolving {
  animation: platepuff var(--plate-puff-ms, 320ms) ease-out forwards;
}
@keyframes platepuff {
  from { opacity: 1; transform: translateX(-50%) scale(1); }
  to   { opacity: 0; transform: translateX(-50%) scale(var(--plate-puff-scale, 1.06)); }
}
```

- [ ] **Step 2: Verify in the running app**

Start the dev server (`npm run dev`), open the game, reach a shop phase with a card in hand.

Run in the browser console:
```js
const c = document.querySelector('.row.hand .card.plated');
const p = c && c.querySelector('.cardplate');
console.log({
  plated: !!c,
  plateImgLoaded: p ? p.naturalWidth : null,     // expect 1023
  bucketClass: c && [...c.classList].find(x => x.startsWith('plate-txt-')),
  plateRect: p && p.getBoundingClientRect(),
});
```
Expected: `plated: true`, `plateImgLoaded: 1023`, a `plate-txt-*` class present, and a plate rect taller than the card.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/styles.css
git commit -m "feat(ui): backplate geometry + rules-text size buckets"
```

---

### Task 5: Wire the two call sites in `Recruit.tsx`

**Files:**
- Modify: `packages/ui/src/Recruit.tsx` (hand row ~`:3522`, drag card ~`:3642`)

- [ ] **Step 1: Plate the hand row**

In the hand `run.hand.map` render, add `plated` alongside the existing `forceFull` (`Recruit.tsx:3537`):

```tsx
                forceFull
                plated
```

- [ ] **Step 2: Plate the dragged card**

`.dragcard` renders a **fresh** `<Card>`, not a clone — so the prop must be passed here too. At `Recruit.tsx:3642`:

```tsx
          <Card card={drag.view} forceFull={drag.source === 'hand'} plated={drag.source === 'hand'} />
```

- [ ] **Step 3: Leave the combat hand-grant cards unplated**

The `replay.handGrantsShown` render at `Recruit.tsx:3544` renders hand cards *during combat*. Leave it alone — plated cards must never enter combat (the `isolation: isolate` safety argument in Task 4 depends on it).

- [ ] **Step 4: Verify both surfaces live**

With the dev server running, in a shop phase:
```js
// 1. hand cards plated
console.log('hand plated:', document.querySelectorAll('.row.hand .card.plated').length,
            'of', document.querySelectorAll('.row.hand .card').length);
```
Then pick up a hand card and, mid-drag, run:
```js
console.log('drag plated:', !!document.querySelector('.dragcard .card.plated'));
```
Expected: hand count matches total; drag plated `true`.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/Recruit.tsx
git commit -m "feat(ui): plate hand cards and the card dragged from hand"
```

---

### Task 6: Placeholder dissolve on play

**Files:**
- Modify: `packages/ui/src/Recruit.tsx` (beside `puffOnBoard`, ~`:3064`; play path ~`:3199`)

`.dragcard` unmounts the instant `setDrag(null)` runs (`Recruit.tsx:1958`), so the dissolving plate can't live there — it rides the **destination board card**, exactly as `puffOnBoard` already does.

**Spell scoping (deviation from the spec, discovered during planning):** the spec says spells dissolve plate-and-card together on cast. But `castingSpell` (`Recruit.tsx:1377`) *unmounts `.dragcard` entirely* once a targeted spell is dragged above the play floor — the aim line replaces the card. So for targeted spells **there is no plate on screen at cast time** and nothing to dissolve; the existing cast sparks carry that moment. This task therefore wires the dissolve for the **minion play path only**, which is the case the owner actually described. Untargeted-spell dissolve is left for phase 2, when the authored effect exists and can be judged against the cast sparks.

- [ ] **Step 1: Add `platePuff` beside `puffOnBoard`**

Immediately after the `puffOnBoard` function (after `Recruit.tsx:3084`):

```tsx
  // PLACEHOLDER dissolve for the hand-card backplate (phase 1). Starts on RELEASE and runs on its own clock,
  // deliberately NOT bounded by the ~200ms FLIP flight — a dissolve clamped to the flight reads as a blink.
  // The dragged card is already unmounted by here, so the plate that dissolves is the one on the DESTINATION
  // board card; we tag it, let the CSS one-shot run, then drop the class.
  // Phase 2 replaces the `.dissolving` rule and this body with the authored effect; nothing else depends on it.
  const platePuff = (uid: string): void => {
    const cfg = getCardPlateConfig();
    window.requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-zone="warband"] .row.warband .card[data-uid="${uid}"] .cardplate`);
      if (!el) return;
      el.classList.add('dissolving');
      const card = el.closest<HTMLElement>('.card');
      const r = card?.getBoundingClientRect();
      if (r) pixiFx.dust(r.left + r.width / 2, r.top + r.height / 2, r.width, r.height, 1, cfg.puffDust);
      window.setTimeout(() => el.classList.remove('dissolving'), cfg.puffMs + 60);
    });
  };
```

- [ ] **Step 2: Add the import**

Add to the imports at the top of `Recruit.tsx`:

```ts
import { getCardPlateConfig } from './cardPlateConfig';
```

- [ ] **Step 3: Call it on the hand→board play path**

At `Recruit.tsx:3199-3207`, add the `platePuff` call beside the existing `puffOnBoard`:

```tsx
    if (d.source === 'hand' && !d.view.spell) {
      if (run.board.length >= CONFIG.boardMax) return false;
      const to = prevWarbandGapRef.current >= 0 ? prevWarbandGapRef.current : warbandIndexAt(cx);
      playWithSummonDelay({ type: 'play', uid: d.uid, toIndex: to });
      platePuff(d.uid);           // plate dissolves during the flight (starts now, own clock)
      puffOnBoard(d.uid);         // dust around the minion where it lands (waits for the Flip)
      return true;
    }
```

- [ ] **Step 4: Verify the board card is never left plated**

The board `<Card>` is rendered without `plated`, so the plate element does not exist on it — meaning `platePuff` will find nothing. **This is the one real risk in this task.** Verify empirically: with the dev server running, drag a minion from hand onto the board and immediately run:

```js
console.log('plate on board card:', document.querySelectorAll('[data-zone="warband"] .cardplate').length);
```

If this logs `0`, the placeholder cannot work as written — the plate must instead be rendered on the board card for one beat. In that case, implement the fallback below before continuing.

- [ ] **Step 5: Fallback if Step 4 logs 0 — a detached ghost plate**

Render the dissolving plate as a standalone fixed-position element rather than relying on the board card. Replace the `platePuff` body with:

```tsx
  const platePuff = (uid: string): void => {
    const cfg = getCardPlateConfig();
    const src = document.querySelector<HTMLElement>('.dragcard .cardplate');
    const r = src?.getBoundingClientRect();
    if (!r) return;
    const ghost = src!.cloneNode(true) as HTMLElement;
    ghost.classList.add('dissolving', 'plateghost');
    ghost.style.cssText += `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;transform:none;z-index:114;pointer-events:none;`;
    document.body.appendChild(ghost);
    pixiFx.dust(r.left + r.width / 2, r.top + r.height / 2, r.width, r.height, 1, cfg.puffDust);
    window.setTimeout(() => ghost.remove(), cfg.puffMs + 60);
  };
```

And add to `styles.css` beside the plate block:

```css
/* Detached dissolving plate — cloned out of the drag card at release so it survives .dragcard unmounting. */
.cardplate.plateghost {
  animation: platepuffghost var(--plate-puff-ms, 320ms) ease-out forwards;
}
@keyframes platepuffghost {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(var(--plate-puff-scale, 1.06)); }
}
```

> Note this must be captured **before** `setDrag(null)` runs. `applyDrop` is called at `Recruit.tsx:1949`, and `setDrag(null)` at `:1958` — so a call inside `applyDrop` is still in time. Confirm the `.dragcard` node is still in the DOM at that moment.

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/Recruit.tsx packages/ui/src/styles.css
git commit -m "feat(ui): placeholder backplate dissolve when a minion is played"
```

---

### Task 7: The 🂠 Card Plate dev tuner

**Files:**
- Create: `packages/ui/src/CardPlateTuner.tsx`
- Modify: `packages/ui/src/DevMenu.tsx`

Follows the established panel shape (`sfxmix` classes + `useDraggablePanel`), matching `GlowTuner.tsx`. All `CardPlateConfig` values are numeric, so there is no colour-picker branch.

- [ ] **Step 1: Write `CardPlateTuner.tsx`**

Create `packages/ui/src/CardPlateTuner.tsx`:

```tsx
import { useState } from 'react';
import {
  PLATE_KEYS,
  PLATE_RANGES,
  PLATE_DESC,
  getCardPlateConfig,
  resetCardPlateConfig,
  setCardPlateValue,
  type CardPlateConfig,
} from './cardPlateConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the HAND CARD BACKPLATE (`cardPlateConfig.ts`). Dials the plate's geometry
 * (width × card width, vertical offset, corner radius), the rules-text shrink thresholds, and the placeholder
 * dissolve. Values persist to localStorage and apply LIVE via `--plate-*` CSS vars.
 *
 * The text-bucket sliders are character counts, not sizes: lower them to make text shrink SOONER. They're
 * conservative by default because character count is a proxy for wrapped height — long-word text wraps taller
 * than short-word text at the same length.
 *
 * "Copy" grabs the JSON to paste back as the shipped defaults in `cardPlateConfig.ts` — and those MUST be
 * mirrored into the CSS `var(--plate-*, …)` fallbacks in styles.css, because production doesn't import this
 * module and renders from the fallback. Panel-only: opened from the Dev Tuning Menu; dev-only, so it's
 * stripped from production.
 */
const LABELS: Record<keyof CardPlateConfig, string> = {
  scale: 'plate · width',
  top: 'plate · y offset',
  radius: 'plate · corner radius',
  bucketM: 'text · shrink at (m)',
  bucketL: 'text · shrink at (l)',
  bucketXl: 'text · shrink at (xl)',
  puffMs: 'dissolve · duration',
  puffScale: 'dissolve · growth',
  puffDust: 'dissolve · dust',
};

export function CardPlateTuner() {
  const [cfg, setCfg] = useState<CardPlateConfig>(getCardPlateConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('cardplate');

  const set = (k: keyof CardPlateConfig, v: number): void => {
    setCardPlateValue(k, v);
    setCfg({ ...getCardPlateConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getCardPlateConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetCardPlateConfig(); setCfg({ ...getCardPlateConfig() }); };

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Card Plate <span>dev · live · hand cards</span></div>
      {PLATE_KEYS.map((k) => {
        const [min, max, step] = PLATE_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={PLATE_DESC[k]}>{LABELS[k]}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register it in `DevMenu.tsx`**

Add the import beside the others (near `Card.tsx`'s sibling tuner imports, ~line 31):

```ts
import { CardPlateTuner } from './CardPlateTuner';
```

And add an entry to the tuner list, next to the other card-presentation tuners (near `{ key: 'glow', label: '🔆 Hover Glow', C: GlowTuner },`):

```ts
  { key: 'cardplate', label: '🂠 Card Plate', C: CardPlateTuner },
```

- [ ] **Step 4: Verify the tuner mounts and drives the plate**

With the dev server running, open the dev menu, click **🂠 Card Plate**, and drag the **Plate width** slider. The plate on hand cards should resize live.

Console check:
```js
console.log(getComputedStyle(document.documentElement).getPropertyValue('--plate-scale'));
```
Expected: reflects the slider value.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/CardPlateTuner.tsx packages/ui/src/DevMenu.tsx
git commit -m "feat(ui): 🂠 Card Plate dev tuner"
```

---

### Task 8: Full verification + docs + PR

**Files:**
- Modify: `docs/devlog.md`, `docs/roadmap.md`, `README.md`

- [ ] **Step 1: Run the full gate**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all four PASS. Report the actual output — do not claim green without it.

> If this worktree has not had `npm install` run in it, typecheck/build will resolve `@game/*` to the main checkout's branch and give a false red. Run `npm install` in the worktree first.

- [ ] **Step 2: Confirm against the PROD build, not dev**

Run: `npm run build:web && npx vite preview --outDir apps/web/dist`

Open the preview, reach a shop phase, and confirm: hand cards are plated, the plate renders at the CSS-fallback geometry (production does **not** import `cardPlateConfig.ts`), and dragging a minion to the board dissolves the plate. This is the check that catches a TS-default ↔ CSS-fallback drift.

- [ ] **Step 3: Prepend the devlog entry**

Add to the top of `docs/devlog.md`, dated `2026-07-21`, covering: the backplate on hand + dragged cards, the static-not-nine-sliced decision and why (greek-key tabs at mid-edge vs a measured 40% stretch range), character-count text buckets instead of DOM measurement and why (per-render layout read on the hand), the placeholder dissolve and that phase 2 authors the real one, and the new 🂠 tuner. Note verification: unit tests for the bucket function, live DOM checks, prod-build confirmation.

- [ ] **Step 4: Update the roadmap**

In `docs/roadmap.md`, add under **Now** or **Next**: *"Hand-card backplate phase 2 — author the plate dissolve effect in its own preview rig and replace the placeholder."* Also note the follow-up: *"Re-tune the hand row for the taller plated card (handY / handGap / handPop)."*

- [ ] **Step 5: Update the README**

Add a line under **Recent changes** summarising the backplate.

- [ ] **Step 6: Commit the docs**

```bash
git add docs/devlog.md docs/roadmap.md README.md
git commit -m "docs: devlog + roadmap for the hand-card backplate"
```

- [ ] **Step 7: Rebase and push**

```bash
git fetch origin
git rebase origin/main
npm run typecheck && npm run lint && npm test && npm run build:web
git push -u origin feat/hand-card-backplate
```

- [ ] **Step 8: Open the PR**

```bash
"/c/Program Files/GitHub CLI/gh.exe" pr create --title "feat(ui): hand-card backplate" --body "$(cat <<'EOF'
Cards in hand now render an ornate stone/gold **backplate** — the card body framing the existing oval
portrait and glass info panel. The plate travels with the card while it's dragged out of hand, and
dissolves when the minion is played to the board, leaving the bare oval token.

### Decisions worth knowing

**The plate is static — never stretched.** A nine-sliced plate was prototyped against the real art first.
The measured stretch range across the card corpus was 214px → 299px (~40% vertical), and the art's
greek-key tabs sit at ~51% height — dead centre of the stretch band — so no choice of slice inset protects
them. Static keeps the art pixel-exact.

**Long rules text shrinks instead, via character-count buckets — not DOM measurement.** Measuring
(`scrollHeight` → step down until it fits) would be a layout read per card per render on the hand, which
re-renders constantly; that's the anti-pattern named in `docs/performance.md`. `plateTextBucket()` is a
pure O(1) function of the live text string. Tradeoff: character count is a proxy for wrapped height, so the
buckets run slightly conservative — thresholds are tuner knobs.

**The layout didn't have to move.** Because the plate is fixed-size, `.drawer` keeps `position: absolute`
and its anchored-top behaviour from #570, and the plate is just a fixed element behind everything. No DOM
restructure, so the FLIP and rect-measurement code in `Recruit.tsx` is untouched.

### Scope

Plated: hand cards + the `.dragcard` copy when dragging from hand. Not plated: shop, board, combat,
Discover, the hover popup.

**The dissolve here is a placeholder** (one CSS keyframe + the existing `pixiFx.dust()`). The authored
effect is phase 2, to be built in its own preview rig; the swap surface is one CSS class and one call site.

Targeted spells don't get a dissolve: `castingSpell` already unmounts `.dragcard` and replaces it with the
aim line, so there's no plate on screen at cast time. The existing cast sparks carry that moment.

### Verification

`npm run typecheck && npm run lint && npm test && npm run build:web` all green. `plateTextBucket()` has unit
tests. Plate + dissolve confirmed live in the DOM, and confirmed against the **prod build** — which is what
catches a TS-default ↔ CSS-fallback drift, since production renders from the CSS fallbacks.

### Follow-up

Hand cards are taller now, so the hand row wants re-tuning by eye (`handY`, `handGap`, probably `handPop`).
Shipped with sensible starting values.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

> **Do not merge.** Branch protection requires a review Claude cannot satisfy — the owner merges.

---

## Post-merge, owner-driven

The plate makes hand cards taller than they are today, so **the hand row will need re-tuning by eye**: `handY`, `handGap` (📐 Scale & Layout) and probably `handPop` (🎴 Drag Feel). Ship the defaults, let the owner dial, then bake the exported values into **both** the TS defaults and the CSS fallbacks — the double-source rule.
