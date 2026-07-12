# CSS Ward (glassy bubble) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the persistent Ward (Divine Shield) signifier as a CSS layer glued to the card so it stays put through drag + lunge and vanishes exactly with the sim's `.dscard` class, retiring the fragile per-frame-tracked Pixi bubble; keep Pixi only for the gold shatter burst on break and the yellow drag/drop sparkles.

**Architecture:** The Ward look moves from a separate Pixi canvas (chased by `getBoundingClientRect` each frame in `Recruit.tsx syncShields`) to a compositor-only CSS layer on `.card.dscard` (mirrors the existing `.venomcard` keyword glow). The Pixi break burst is extracted into a rect-addressable `pixiFx.shatterAt(...)` so it no longer needs a live bubble to read coords from, and the drag/drop sparkles are re-driven from the drag lifecycle. Ward only — Reborn's blue aura stays on Pixi.

**Tech Stack:** React + Zustand (`packages/ui`), CSS (`styles.css`), PixiJS v8 (`pixiFx.ts`), GSAP lunge timeline (`choreo/`), Vitest.

**Spec:** [docs/superpowers/specs/2026-07-12-css-ward-glassy-bubble-design.md](../specs/2026-07-12-css-ward-glassy-bubble-design.md)

**Branch:** work continues on `fix/ward-break-at-impact` (already contains the `onImpactAuras` contact hook this plan reuses). Supersedes PR #346.

---

## File structure

- **Create:** `apps/web/public/fx/ward-css-preview.html` — standalone look-tuning rig (card + CSS ward + dials + live CSS export).
- **Modify:** `packages/ui/src/styles.css` — the CSS ward layer on `.card.dscard` (+ the shared `kwglow` breathing pulse already exists).
- **Modify:** `packages/ui/src/pixiFx.ts` — extract `shatterAt(cx,cy,w,h,kind)` from `breakShield`; add `wardPlaceSparkle(cx,cy,w,h)` + `wardDragSparkle(cx,cy,w,h)` (repackaged from the retired `shieldPop`/mini path).
- **Modify:** `packages/ui/src/choreo/channels/aura.ts` — `breakShieldAura`/`burstDeathAuras` shield case call `shatterAt(rect)` instead of `breakShield(uid)`.
- **Modify:** `packages/ui/src/useCombatReplay.ts` — pass the card rect into the shatter (both the `onImpactAuras` contact path and the generic non-attack `onShieldBreak`).
- **Modify:** `packages/ui/src/Recruit.tsx` — drop `'shield'` from the Pixi registration in `syncShields`; fire `wardPlaceSparkle` on drop + `wardDragSparkle` while dragging a DS card.
- **Modify tests:** `packages/ui/src/pixiFx.aura.test.ts`, `packages/ui/src/choreo/channels/aura.test.ts`.
- **Docs:** `docs/devlog.md`, `docs/roadmap.md`, `README.md`.

---

## Task 1: Preview rig — dial in the glassy CSS ward (LOOK GATE)

**Files:**
- Create: `apps/web/public/fx/ward-css-preview.html`

This is an owner-interactive look gate — no automated test. Build the rig, then iterate the CSS with the owner until the ward reads like today's glassy shader bubble. The approved CSS block is the input to Task 2.

- [ ] **Step 1: Build the rig.** Create `apps/web/public/fx/ward-css-preview.html`: a cream-background page (`background:#f6ecd9`) with a single game-styled card mock — an arched tile ~150px wide using the game's `--arch-radius: 48% 48% 20% 20% / 35% 35% 14% 14%` on a `.archbox`, a placeholder sprite, and the three corner badges — and a `.wardlayer` element inside it carrying the CSS-under-test. Add range-slider dials that write CSS custom properties live: `--ward-base-alpha`, `--ward-tint` (hue), `--ward-highlight-alpha`, `--ward-highlight-y` (top-bias of the dome highlight), `--ward-rim-width`, `--ward-rim-alpha`, `--ward-inset-glow`, `--ward-outset-glow`, `--ward-breathe-min` (breathing opacity floor), `--ward-breathe-s` (period). Start from a real gold glassy attempt (radial base + top highlight + inset rim + outer glow):

```html
<style>
  .archbox { position: relative; width: 150px; aspect-ratio: 3/4; border-radius: var(--arch-radius); overflow: visible; }
  .wardlayer, .wardlayer::before { position: absolute; inset: -6px; border-radius: var(--arch-radius); pointer-events: none; }
  .wardlayer {
    /* glassy dome: a radial base tint + a top-biased highlight, all inside the arch */
    background:
      radial-gradient(120% 80% at 50% var(--ward-highlight-y, 24%),
        rgba(255,246,205, var(--ward-highlight-alpha, 0.55)) 0%,
        rgba(255,214,90, var(--ward-base-alpha, 0.28)) 42%,
        rgba(240,176,32, calc(var(--ward-base-alpha, 0.28) * 0.5)) 70%,
        rgba(240,176,32, 0) 100%);
    box-shadow:
      inset 0 0 0 var(--ward-rim-width, 2px) rgba(255,236,150, var(--ward-rim-alpha, 0.85)),  /* rim/edge light */
      inset 0 0 14px 3px rgba(255,220,110, var(--ward-inset-glow, 0.5)),                        /* inner dome glow */
      0 0 12px 3px rgba(240,176,32, var(--ward-outset-glow, 0.45));                             /* outer aura */
  }
  .wardlayer::before {
    content: ''; box-shadow: 0 0 16px 5px rgba(255,220,110,0.6);
    animation: kwglow var(--ward-breathe-s, 2.6s) ease-in-out infinite; will-change: opacity;
  }
  @keyframes kwglow { 0%,100% { opacity: var(--ward-breathe-min, 0.55); } 50% { opacity: 1; } }
</style>
```

Add a "Copy CSS" button that serializes the current custom-property values into a `.card.compact.dscard` rule string.

- [ ] **Step 2: Load it.** Run the dev server (`npm run dev -w apps/web -- --port 5199 --strictPort`) and open `http://localhost:5199/fx/ward-css-preview.html`. Confirm the dome renders over the arched card and every slider updates it live.

- [ ] **Step 3: Iterate with the owner.** Adjust dials until the owner approves the glassy look. Capture the final custom-property values (the "Copy CSS" output).

- [ ] **Step 4: Commit the rig.**

```bash
git add apps/web/public/fx/ward-css-preview.html
git commit -m "feat(fx): ward CSS preview rig (glassy-bubble look tuning)"
```

---

## Task 2: Bake the approved CSS ward onto the card (additive)

Add the CSS ward to `.card.compact.dscard` using the values approved in Task 1. Do NOT retire the Pixi bubble yet — this step is additive so we can confirm the CSS layer renders correctly on a real card before removing anything.

**Files:**
- Modify: `packages/ui/src/styles.css` (near the `.venomcard` block, ~line 592)

- [ ] **Step 1: Add the CSS ward rule.** Paste the approved dome CSS onto `.card.compact.dscard`, following the `.venomcard` pattern (a static `box-shadow` + a `::before` breathing the opacity of a static shadow — compositor-only, no animated paint props). Use the Task 1 values; the block below is the starting shape (replace the numbers with the approved ones):

```css
/* Ward (Divine Shield): a glassy gold dome glued to the card — persists through drag + lunge, vanishes with
   `.dscard`. Compositor-only (static shadows/gradients; only opacity animates). Replaces the old Pixi bubble. */
.card.compact.dscard { z-index: 4; }
.card.compact.dscard .art::after {
  content: ''; position: absolute; inset: 0; border-radius: var(--arch-radius); pointer-events: none; z-index: 3;
  background: radial-gradient(120% 80% at 50% 24%,
    rgba(255,246,205,0.55) 0%, rgba(255,214,90,0.28) 42%, rgba(240,176,32,0.14) 70%, rgba(240,176,32,0) 100%);
  box-shadow:
    inset 0 0 0 2px rgba(255,236,150,0.85),
    inset 0 0 14px 3px rgba(255,220,110,0.5),
    0 0 12px 3px rgba(240,176,32,0.45);
}
.card.compact.dscard::before {
  content: ''; position: absolute; inset: 0; border-radius: var(--arch-radius); pointer-events: none;
  box-shadow: 0 0 16px 5px rgba(255,220,110,0.6); animation: kwglow 2.6s ease-in-out infinite; will-change: opacity;
}
```

- [ ] **Step 2: Live check (additive).** With the dev server running, open the game, get a warded card (any Mech, or a hero power that grants a Ward). Confirm the CSS dome shows on the card **in the shop, on the board, while dragging, and through the attack lunge** (the old Pixi bubble also still shows — expected, we remove it next). Screenshot for the owner.

- [ ] **Step 3: Commit.**

```bash
git add packages/ui/src/styles.css
git commit -m "feat(fx): CSS ward dome on .dscard (additive; Pixi bubble still present)"
```

---

## Task 3: Extract `shatterAt` — a rect-addressable ward shatter (no bubble needed)

The break burst currently lives inside `breakShield`, which reads the bubble's stored coords. Extract the burst body into `shatterAt(cx,cy,w,h,kind)` so a caller can fire it from an explicit card rect once the bubble is gone. `breakShield` keeps working (for Reborn) by destroying its bubble then delegating to `shatterAt`.

**Files:**
- Modify: `packages/ui/src/pixiFx.ts` (`breakShield`, ~line 1281)
- Test: `packages/ui/src/pixiFx.aura.test.ts`

- [ ] **Step 1: Write the failing test.** In `pixiFx.aura.test.ts`, assert the new method exists and is a safe no-op before the WebGL app is ready (mirrors the existing setShield test — `this.ready` is false in jsdom):

```ts
it('shatterAt is a no-op when the pixi app is not ready (headless test env)', () => {
  expect(() => pixiFx.shatterAt(100, 100, 80, 100, 'shield')).not.toThrow();
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `npx vitest run packages/ui/src/pixiFx.aura.test.ts`
Expected: FAIL — `pixiFx.shatterAt is not a function`.

- [ ] **Step 3: Extract `shatterAt`.** In `pixiFx.ts`, split `breakShield` into (a) the bubble teardown and (b) the burst. Move the burst body (the CRACK / SHOCKWAVE / SHRAPNEL / ENERGY-MOTES spawns after the `this.ready` guard, plus the reborn early-return) into a new public method; have `breakShield` delegate:

```ts
breakShield(uid: string, kind: AuraKind = 'shield'): void {
  const key = auraKey(kind, uid);
  const b = this.shields.get(key);
  if (!b) return;
  const { cx, cy, w, h } = b;
  b.shader.destroy();
  b.container.destroy({ children: true });
  this.shields.delete(key);
  this.shatterAt(cx, cy, w, h, kind);
}

/** The break burst at an explicit rect (no persistent bubble needed) — gold shards for a Ward, wispy spirit
 *  release for Reborn. Fired by the CSS-ward break path (the card rect) and by `breakShield` (bubble coords). */
shatterAt(cx: number, cy: number, w: number, h: number, kind: AuraKind = 'shield'): void {
  if (!this.ready) return;
  if (kind === 'reborn') { this.rebornShatter(cx, cy, w, h); return; }
  const rad = Math.max(w, h) * 0.5 * AURA[kind].margin;
  // …(the existing CRACK / SHOCKWAVE / SHRAPNEL / ENERGY-MOTES spawn blocks, verbatim)…
}
```

(Keep every spawn block byte-for-byte; only the wrapper/signature changes.)

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npx vitest run packages/ui/src/pixiFx.aura.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/ui/src/pixiFx.ts packages/ui/src/pixiFx.aura.test.ts
git commit -m "refactor(fx): extract pixiFx.shatterAt from breakShield (rect-addressable)"
```

---

## Task 4: Break the ward via `shatterAt(rect)` instead of the bubble

Re-point the aura channel's shield break at `shatterAt` with an explicit rect, so it no longer depends on a live bubble. `breakShieldAura` gains a rect param; `burstDeathAuras` passes the dying unit's rect for the shield case.

**Files:**
- Modify: `packages/ui/src/choreo/channels/aura.ts`
- Modify: `packages/ui/src/useCombatReplay.ts`
- Test: `packages/ui/src/choreo/channels/aura.test.ts`

- [ ] **Step 1: Write the failing test.** In `aura.test.ts`, assert `breakShieldAura` forwards its rect to `pixiFx.shatterAt` (mock `pixiFx`):

```ts
it('breakShieldAura fires the gold shatter at the given rect (not via a bubble)', () => {
  const spy = vi.spyOn(pixiFx, 'shatterAt').mockImplementation(() => {});
  breakShieldAura({ cx: 200, cy: 150, w: 80, h: 100 });
  expect(spy).toHaveBeenCalledWith(200, 150, 80, 100, 'shield');
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `npx vitest run packages/ui/src/choreo/channels/aura.test.ts`
Expected: FAIL — `breakShieldAura` takes a uid / `shatterAt` not called.

- [ ] **Step 3: Update `aura.ts`.** Change the shield break to a rect-driven shatter:

```ts
/** A Ward was consumed → shatter it at the unit's rect (the persistent bubble is CSS now, so there's no Pixi
 *  bubble to read coords from). */
export function breakShieldAura(rect: { cx: number; cy: number; w: number; h: number } | null): void {
  if (rect) pixiFx.shatterAt(rect.cx, rect.cy, rect.w, rect.h, 'shield');
  sfx.shieldBreak();
}
```

And in `burstDeathAuras`, replace the shield line (a dying warded unit) to shatter at the passed rect. It already receives `_tauntRect`; rename/extend to a real `rect` and use it for the shield case (fall back to no-op if null):

```ts
export function burstDeathAuras(uid: string, rect: { cx: number; cy: number; w: number; h: number } | null = null): void {
  const el = document.querySelector<HTMLElement>(`.unit[data-uid="${uid}"] .card.dscard`);
  if (el) { pixiFx.shatterAt(rect?.cx ?? 0, rect?.cy ?? 0, rect?.w ?? 0, rect?.h ?? 0, 'shield'); sfx.shieldBreak(); }
  if (pixiFx.hasAura(uid, 'reborn')) { pixiFx.breakShield(uid, 'reborn'); sfx.rebornShatter(); }
  if (tauntFx.hasAura(uid, 'taunt')) tauntFx.clearShield(uid, 'taunt');
}
```

> NOTE for the implementer: `hasAura(uid,'shield')` no longer works once the bubble is retired (Task 5), so the shield burst must key off the DOM `.dscard` marker + the passed rect, as above. Verify the `rect` is non-null at every `burstDeathAuras` call site in `useCombatReplay.ts` (they already compute `rectOf(uid)`); if a call passes null, thread the rect through.

- [ ] **Step 4: Update `useCombatReplay.ts`.** The `onImpactAuras` contact path (from #346) and the generic `onShieldBreak` must now pass a **card rect**, not a uid. Replace the wardTargets/breakWards block in the attack layout effect:

```ts
// Wards this exchange consumed → shatter each at its unit's rect, AT the lunge contact (onImpactAuras).
const wardTargets: string[] = [];
for (let i = cur.start; i < cur.end; i++) { const e = events[i]; if (e?.type === 'shield') wardTargets.push(e.target); }
const rectFor = (uid: string) => { const r = findEl(uid)?.getBoundingClientRect(); return r ? { cx: r.left + r.width/2, cy: r.top + r.height/2, w: r.width, h: r.height } : null; };
const breakWards = wardTargets.length ? () => { for (const t of wardTargets) breakShieldAura(rectFor(t)); } : undefined;
```

And in the beat-boundary cue effect, `onShieldBreak` (line ~697) changes to shatter at the unit rect:

```ts
onShieldBreak: (uid) => breakShieldAura(rectOf(uid)),
```

(`rectOf` already exists in that effect and returns `{cx,cy,w,h}|null`.)

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `npx vitest run packages/ui/src/choreo/channels/aura.test.ts && npm run typecheck`
Expected: PASS + typecheck clean.

- [ ] **Step 6: Commit.**

```bash
git add packages/ui/src/choreo/channels/aura.ts packages/ui/src/useCombatReplay.ts packages/ui/src/choreo/channels/aura.test.ts
git commit -m "feat(fx): shatter the ward at the unit rect (CSS ward has no Pixi bubble)"
```

---

## Task 5: Retire the persistent Pixi ward bubble; re-drive the drag/drop sparkles

Stop registering the `'shield'` kind on the Pixi canvas (Reborn stays). Then re-fire the yellow sparkles from the drag lifecycle so dragging/placing a warded card still sparkles.

**Files:**
- Modify: `packages/ui/src/Recruit.tsx` (`AURA_CFGS` filter in `syncShields`; drag lifecycle)
- Modify: `packages/ui/src/pixiFx.ts` (`wardPlaceSparkle`, `wardDragSparkle`)

- [ ] **Step 1: Add the sparkle entry points to `pixiFx.ts`.** Repackage the retired `shieldPop` (inward coalesce) as a public `wardPlaceSparkle`, and add a light single-shot `wardDragSparkle` (a few drifting gold sparks) for the drag trail:

```ts
/** Placement coalesce for a warded card dropped into a slot — a bright flash + sparkles rushing inward
 *  (the inverse of the break's outward shrapnel). Decoupled from the retired persistent bubble. */
wardPlaceSparkle(cx: number, cy: number, w: number, h: number): void {
  if (!this.ready) return;
  const rad = Math.max(w, h) * 0.5 * AURA.shield.margin;
  // …(the existing `shieldPop` central-flash + inward-sparkle spawns, verbatim, kind fixed to 'shield')…
}

/** A light trailing sparkle emitted while a warded card is dragged (a few gold sparks drifting off it). */
wardDragSparkle(cx: number, cy: number, w: number, h: number): void {
  if (!this.ready) return;
  for (let i = 0; i < 3; i++) {
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 80;
    this.spawn(this.sparkTex!, {
      x: cx + (Math.random() - 0.5) * w * 0.5, y: cy + (Math.random() - 0.5) * h * 0.5,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.6,
      life: 340 + Math.random() * 260, fromScale: 0.5 + Math.random() * 0.4, toScale: 0.05,
      spin: 0, tint: 0xffe9a8, blend: 'add', peakAlpha: 0.9,
    });
  }
}
```

- [ ] **Step 2: Drop `'shield'` from the Pixi registration in `syncShields`.** In `Recruit.tsx`, filter the shield kind out of the aura loop so no ward bubble is created/tracked/cleared (Reborn stays). The simplest surgical change — skip the shield cfg in PASS 1:

```ts
for (const cfg of AURA_CFGS) {
  if (cfg.kind === 'shield') continue; // Ward is CSS now (styles.css .dscard); Pixi only fires its break/sparkles
  // …unchanged…
}
```

Also skip shield in the dragged-card branch and leave PASS 2/4 clears (they'll simply never see a shield key). Confirm no `setShield(..., 'shield')` call remains reachable.

- [ ] **Step 3: Fire the drop coalesce.** In the drop-detection effect (the `prevDragActiveRef` true → `active` false transition, ~line 639), if the dragged card carried DS, fire `wardPlaceSparkle` at the drop centre. Read the dropped card's rect after it settles:

```ts
useEffect(() => {
  const active = drag?.active ?? false;
  if (prevDragActiveRef.current && !active) {
    settleUntilRef.current = performance.now() + 450;
    const d = dragRef.current;
    if (d?.view?.keywords?.includes('DS')) {
      const el = document.querySelector<HTMLElement>(`[data-uid="${d.uid}"] .card.dscard .archbox`);
      const r = el?.getBoundingClientRect();
      if (r) pixiFx.wardPlaceSparkle(r.left + r.width/2, r.top + r.height/2, r.width, r.height);
    }
  }
  prevDragActiveRef.current = active;
}, [drag?.active]);
```

- [ ] **Step 4: Fire the drag trail.** In the per-frame follow loop (`tick`, ~line 647), when a warded card is being dragged, emit a throttled `wardDragSparkle` at the drag position. Throttle to ~every 5th frame so it's a light trail, not a firehose:

```ts
const dragSparkleCtrRef = useRef(0);
// inside tick(), after syncShields():
const d = dragRef.current;
if (d?.active && d.view?.keywords?.includes('DS') && (dragSparkleCtrRef.current++ % 5 === 0)) {
  pixiFx.wardDragSparkle(d.x - d.ox + d.w/2, d.y - d.oy + d.h/2, d.w, d.h);
}
```

- [ ] **Step 5: Live check.** With the dev server running: (a) a warded card shows ONLY the CSS dome now (no doubled Pixi bubble); (b) dragging it keeps the dome on the card AND emits the yellow trailing sparkles; (c) dropping it fires the inward coalesce; (d) in combat the dome rides the lunge and vanishes at contact with the gold shatter; (e) a warded unit that dies bursts its ward. Screenshot (a)–(c) for the owner.

- [ ] **Step 6: Commit.**

```bash
git add packages/ui/src/Recruit.tsx packages/ui/src/pixiFx.ts
git commit -m "feat(fx): retire persistent Pixi ward bubble; drag/drop sparkles from the drag lifecycle"
```

---

## Task 6: Gate, docs, PR

**Files:**
- Modify: `docs/devlog.md`, `docs/roadmap.md`, `README.md`

- [ ] **Step 1: Full gate.**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all green.

- [ ] **Step 2: Update the docs.** Prepend a `docs/devlog.md` entry (what changed + why: CSS ward glued to the card, Pixi bubble retired, break via `shatterAt(rect)`, drag/drop sparkles re-driven; note it supersedes the #346 approach and how it was verified). Move the roadmap's "Ward shatter timing" note to reflect the CSS rework shipped, and add a follow-up line for "Reborn aura → same CSS treatment" under B0. Update the README **Recent changes** top bullet.

- [ ] **Step 3: Commit the docs.**

```bash
git add docs/devlog.md docs/roadmap.md README.md
git commit -m "docs: CSS ward (glassy bubble) — devlog + roadmap + README"
```

- [ ] **Step 4: Push + update the PR.** Push the branch; retitle/rewrite PR #346 to describe the CSS ward rework (or open a fresh PR and close #346). Report CI status.

```bash
git push
```

---

## Self-review notes

- **Spec coverage:** rig (T1) → CSS ward (T2) → retire Pixi bubble (T5) → break burst (T3/T4) → drag/drop sparkles (T5) → verification/docs (T5/T6). All spec components covered.
- **Reborn untouched:** `breakShield(uid,'reborn')` and its `setShield` registration stay; only `'shield'` is filtered in `syncShields` and only the shield break re-points to `shatterAt`.
- **Type consistency:** `shatterAt(cx,cy,w,h,kind)` is the single new signature used by `breakShield`, `breakShieldAura`, and `burstDeathAuras`; `breakShieldAura` takes a `{cx,cy,w,h}|null` rect everywhere it's called.
- **Assumption flagged:** the drag trail (T5 S4) is the interpretation of "yellow sparkles" = mini-trail + drop coalesce; trim on the live check if the owner meant only the drop coalesce.
