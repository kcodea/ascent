# Dwarven Ale shop-cast FX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each of the five Set-2 Dwarven Ale shop spells its own bespoke cast FX, fired from the point the card is released.

**Architecture:** A new `spellCast` recruit-moment kind carries the release point; a `spellCastMoment(cardId, point)` builder + a point-anchored branch in `runRecruitMomentCues` fire the per-card bound def at the `cursor` anchor. The cast site in `Recruit.tsx` emits the moment and suppresses the generic spark for bound spells. Then five defs are authored in the workbench's pinned-cursor scenario and bound per ale. Entirely presentation-layer — no sim/content changes.

**Tech Stack:** React + Zustand UI (`@game/ui`), the FX def/binding/cue system under `packages/ui/src/fx` + `packages/ui/src/choreo`, the FX workbench (pinned-cursor scenario), Vitest.

## Global Constraints

- **Presentation only.** Touch `packages/ui/**` only. No `packages/sim/**`, `packages/content/**`, or `packages/core/**` changes (Mike's ownership seam). `applyCastEffects` attribution stays `sourceCardId: ''`.
- **Performance.** No per-frame `getBoundingClientRect`; one-shot FX only, no looping paint-property animation (see CLAUDE.md north star).
- **Ales:** `wo_mine` (Golden), `wo_reinforcement` (Reinforcing), `wo_champion` (Champion's), `wo_health` (Defensive), `wo_attack` (Bloody) — all untargeted (released "up"), cost 2, tier 3.
- **Origin anchor** is `cursor` (the live pointer / release point) — `fx/anchors.ts` `FX_ANCHOR_IDS`.
- **Gates before done:** `npm run typecheck && npm run lint && npm test && npm run build:web` all green.

---

### Task 1: Register the `spellCast` recruit-moment kind (builder + cue branch)

Make `spellCast` a bindable kind that carries a point and fires a point-anchored def, satisfying both binding-validation tests.

**Files:**
- Modify: `packages/ui/src/choreo/recruitMoments.ts` (add kind + `spellCastMoment` builder + `point` field)
- Modify: `packages/ui/src/choreo/recruitMoments.test.ts` (extend the emitter invariant)
- Modify: `packages/ui/src/choreo/recruitCues.ts` (add the `spellCast` branch)
- Test: `packages/ui/src/choreo/recruitMoments.test.ts`

**Interfaces:**
- Produces: `spellCastMoment(cardId: string, point: { x: number; y: number }): RecruitMoment` — returns `{ kind: 'spellCast', sourceCardId: cardId, recipients: [], point }`.
- Produces: `RecruitMoment.point?: { x: number; y: number }` (optional; only `spellCast` sets it).
- Produces: `'spellCast'` added to `RecruitMomentKind` and `RECRUIT_MOMENT_KINDS`.
- Consumes (in cue branch): `bindingFor(cardId, 'spellCast')` (existing, `choreo/bindings.ts`), `playDef` (existing, `fx/playDef.ts`).

- [ ] **Step 1: Write the failing test — the builder's shape**

In `recruitMoments.test.ts`, add:

```ts
it('a spellCast names its card as the source and carries the release point', () => {
  const m = spellCastMoment('wo_mine', { x: 120, y: 340 });
  expect(m).toEqual({ kind: 'spellCast', sourceCardId: 'wo_mine', recipients: [], point: { x: 120, y: 340 } });
});
```

Also extend the existing emitter-coverage test (`recruitMoments.test.ts` ~line 154, `produced` set) to include the new kind:

```ts
      shoutMoment('a', 'dw_pimm').kind,
      spellCastMoment('wo_mine', { x: 0, y: 0 }).kind,
```

And add `spellCastMoment` to the import from `./recruitMoments` at the top of the test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/ui/src/choreo/recruitMoments.test.ts`
Expected: FAIL — `spellCastMoment` is not exported / `'spellCast'` not in `RECRUIT_MOMENT_KINDS`.

- [ ] **Step 3: Implement the kind, field, and builder**

In `recruitMoments.ts`:
- Add `| 'spellCast'` to the `RecruitMomentKind` union (with a doc line: "A tavern spell was cast; anchored at the release `point`, keyed by the spell's card id.").
- Add `'spellCast'` to `RECRUIT_MOMENT_KINDS`.
- Add to `interface RecruitMoment`: `/** spellCast only: the release point (page coords) the effect fires from — the `cursor` anchor. */ point?: { x: number; y: number };`
- Add the builder (next to `shoutMoment`):

```ts
/** A `spellCast` moment: a tavern spell cast, anchored at the release `point` and keyed by the spell's card
 *  id so each spell resolves its own binding. `recipients` is empty — the anchor is the raw point, not a unit. */
export function spellCastMoment(cardId: string, point: { x: number; y: number }): RecruitMoment {
  return { kind: 'spellCast', sourceCardId: cardId, recipients: [], point };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/ui/src/choreo/recruitMoments.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the point-anchored cue branch**

In `recruitCues.ts`, at the top of `runRecruitMomentCues` (alongside the `shopRubied` early-return), add:

```ts
  // A tavern spell cast — ONE fire at the release point, anchored to `cursor`, keyed by the spell's card id.
  // No cascade, no DOM measure: the anchor is the point carried on the moment.
  if (moment.kind === 'spellCast') return runSpellCastFire(moment, ctx);
```

And the helper (mirrors `runShopRubiedSpan`'s shape):

```ts
function runSpellCastFire(moment: RecruitMoment, _ctx: RecruitCueContext): () => void {
  const binding = bindingFor(moment.sourceCardId ?? null, 'spellCast');
  const pt = moment.point;
  if (!binding || !pt) return () => {};
  const camera = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  playDef(binding.def, { source: pt, target: pt, cursor: pt, camera }, { uids: { source: moment.sourceCardId ?? null, target: moment.sourceCardId ?? null } });
  if (binding.sfx !== undefined) sfx[binding.sfx]?.();
  return () => {};
}
```

- [ ] **Step 6: Run the full choreo suite + typecheck**

Run: `npx vitest run packages/ui/src/choreo/ && npm run typecheck`
Expected: PASS (including `bindings.test.ts`'s known-kind check, now that `spellCast` is in `RECRUIT_MOMENT_KINDS`).

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/choreo/recruitMoments.ts packages/ui/src/choreo/recruitMoments.test.ts packages/ui/src/choreo/recruitCues.ts
git commit -m "feat(fx): spellCast recruit moment — point-anchored cast FX kind"
```

---

### Task 2: Fire the moment at the cast site + suppress the generic spark (proven with one ale)

Wire the release-point emission into `Recruit.tsx`, suppress the stock spark for bound spells, and bind ONE ale to a placeholder def to prove the whole path end-to-end in a live cast.

**Files:**
- Modify: `packages/ui/src/Recruit.tsx` (the spell-cast branches in `applyDrop`, ~4239 targeted / ~4243 untargeted)
- Modify: `packages/ui/src/fx/defs/bindings.json` — add `cards.wo_mine.spellCast` → a placeholder def (reuse an existing def id, e.g. `spell-cast`, so the registry test passes)

**Interfaces:**
- Consumes: `spellCastMoment` (Task 1), `runRecruitMomentCues` (already imported in `Recruit.tsx`), `bindingFor` (already imported).

- [ ] **Step 1: Add a bound-spell helper + emission at the untargeted cast branch**

In `Recruit.tsx`, at the untargeted `up` spell branch (~4242-4245), replace the unconditional `castSparks` with a binding-gated fork:

```ts
if (up) {
  dispatch({ type: 'play', uid: d.uid });
  fireSpellCastFx(d.view.cardId, { x, y });   // authored def if bound; else the generic spark
  return true;
}
```

Add the helper near `castSparks` (~4064):

```ts
// A tavern spell cast plays its AUTHORED def from the release point (the `cursor` anchor) when one is bound,
// and SUPPRESSES the generic spark for it — the same "authored replaces stock" rule the buff/Karwind paths
// follow. Unbound spells keep today's spark (Yazzus re-fire included).
const fireSpellCastFx = (cardId: string, pt: { x: number; y: number }): void => {
  if (bindingFor(cardId, 'spellCast')) {
    runRecruitMomentCues(spellCastMoment(cardId, pt), {
      cardIdOf: () => null, measure: () => null,
    });
    return;
  }
  castSparks(() => fireSpark(pt.x, pt.y), cardId);
};
```

- [ ] **Step 2: Apply the same gate to the targeted cast branch**

At the targeted branch (~4238-4240), keep the targeted spark for unbound spells but let a bound spell play its authored def from the release point:

```ts
dispatch({ type: 'play', uid: d.uid, targetUid });
if (bindingFor(d.view.cardId, 'spellCast')) fireSpellCastFx(d.view.cardId, { x, y });
else castSparks(() => sparkAtUid(targetUid, x, y), d.view.cardId);
return true;
```

(Add `spellCastMoment` to the `./choreo/recruitMoments` import in `Recruit.tsx`.)

- [ ] **Step 3: Bind one ale to a placeholder def**

In `packages/ui/src/fx/defs/bindings.json`, under `cards`, add (keys stay sorted):

```json
"wo_mine": { "spellCast": { "def": "spell-cast" } }
```

- [ ] **Step 4: Typecheck + the binding registry/known-kind tests**

Run: `npm run typecheck && npx vitest run packages/ui/src/choreo/bindings.test.ts`
Expected: PASS — `spell-cast` resolves in the registry and `spellCast` is a known kind.

- [ ] **Step 5: Live verify (dev server)**

Start the dev server, start a Set-2 run, buy + cast **Golden Ale** in the shop, and confirm:
1. The `spell-cast` def fires **at the point you released the card** (not a fixed spot).
2. The generic spark does **not** also fire for Golden Ale (no double FX).
3. Cast any *other* spell (e.g. Ruby Shipment) — its generic spark still fires unchanged.

Note in the commit message which port/run proved it.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/Recruit.tsx packages/ui/src/fx/defs/bindings.json
git commit -m "feat(fx): fire authored cast FX at the release point for bound tavern spells"
```

---

### Task 3: Author the five ale defs + bind them (workbench loop)

Author each bespoke def in the workbench's **pinned-cursor scenario** (so what's authored is what fires from the release point), agreeing each look on a cheap preview with Mike before wiring the full def, then bind all five. This task is the visual authoring loop, not a code TDD cycle — its "test" is the live cast.

**Files:**
- Create: `packages/ui/src/fx/defs/ale-golden.json`, `ale-reinforcing.json`, `ale-champion.json`, `ale-defensive.json`, `ale-bloody.json` (authored via the workbench Save, not hand-written)
- Modify: `packages/ui/src/fx/defs/bindings.json` — bind each ale to its def (replace the Task-2 placeholder on `wo_mine`)

**Per-ale look intent (settled on preview first, then authored):**
- `wo_mine` → **ale-golden**: amber froth burst, gold coins spraying outward.
- `wo_reinforcement` → **ale-reinforcing**: a muster/forge shimmer — a body-summoning glint.
- `wo_champion` → **ale-champion**: one heavy, weighty impact spike.
- `wo_health` → **ale-defensive**: green shield-motes blooming upward.
- `wo_attack` → **ale-bloody**: red slash arcs / crimson spatter.

- [ ] **Step 1: Open the workbench in the pinned-cursor scenario**

Serve the workbench from the authoring worktree; select the **pinned-cursor** scenario so every layer authored is `cursor`-anchored and previews at the pointer.

- [ ] **Step 2: For each ale — agree the look on a cheap preview, then author + Save**

For each of the five (one at a time):
1. Sketch the look cheaply and get Mike's sign-off on the motif before building the full def (per our FX workflow — don't wire a full trail he hasn't agreed to).
2. Author the def with `cursor`-anchored layers; Save (writes the `ale-*.json` def).
3. Bind the ale's `spellCast` to the new def in the workbench (`cards.<id>.spellCast`).
4. Live-cast that ale in the shop; confirm it fires from the release point and reads as its axis.

- [ ] **Step 3: Confirm all five bindings + no placeholder remains**

Verify `bindings.json` has `wo_mine`/`wo_reinforcement`/`wo_champion`/`wo_health`/`wo_attack` each bound to its `ale-*` def (the `spell-cast` placeholder on `wo_mine` is replaced), and no `fx-draft` leaked in.

- [ ] **Step 4: Full gates**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all green.

- [ ] **Step 5: Update docs + publish**

Prepend a `docs/devlog.md` entry (what changed, why, how verified), move the item out of `docs/roadmap.md`, refresh the README "Recent changes". Then use the FX publish flow (`npm run fx:publish -- "feat(fx): Dwarven Ale shop-cast FX"`) to open the PR.

---

## Notes for the executor

- **The workbench Save writes real files** under `packages/ui/src/fx/defs/`; do not hand-author the `ale-*.json` unless iterating on an already-Saved def.
- **Suppression rule:** binding `spellCast` on a card IS the statement "I've authored this cast" — that's why the generic spark stops for bound spells only. Never suppress it globally.
- **Only `wo_*` ales are in scope.** Other Set-2 tavern spells (Ruby Shipment, Veinstorm, etc.) keep the generic spark.
