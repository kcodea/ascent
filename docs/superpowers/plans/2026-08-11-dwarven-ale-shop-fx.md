# Dwarven Ale shop-cast FX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each of the five Set-2 Dwarven Ale shop spells its own bespoke cast FX, fired from the point the card is released.

**Architecture:** A new `spellCast` recruit-moment kind carries the release point; a `spellCastMoment(cardId, point, recipients?)` builder + a branch in `runRecruitMomentCues` fire the per-card bound def. Point-only ales (Golden, Reinforcing) fire once at the `cursor`; the three BUFF ales fire the def once per buffed minion, all simultaneously, travelling cursor→minion, and suppress the generic buff pop for those minions (Task 4). The cast site in `Recruit.tsx` emits the moment and suppresses the generic spark for bound spells. Defs are authored in the workbench and bound per ale. Entirely presentation-layer — no sim/content changes.

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

### Task 4: Buff ales — shoot the def cursor→target(s) and suppress the generic pop

**Design change (owner, 2026-08-11):** the three BUFF ales (Champion's `wo_champion`, Defensive `wo_health`, Bloody `wo_attack`) no longer fire a single point burst at the cursor. Instead the bound def fires **once per buffed minion, all simultaneously**, each travelling **from the cursor (source) to that minion (target)** and erupting on impact — and the game's generic buff-tendril pop is **suppressed** for those minions (the ale def owns their visual). Golden (`wo_mine`) and Reinforcing (`wo_reinforcement`) are unchanged (point fire at the cursor). No sim change — the buffed uids come from `recruitBuffFx`, and the cursor origin is UI-supplied.

**Files:**
- Modify: `packages/ui/src/choreo/recruitMoments.ts` (recipients arg on the builder)
- Modify: `packages/ui/src/choreo/recruitMoments.test.ts` (recipients test)
- Modify: `packages/ui/src/choreo/recruitCues.ts` (`runSpellCastFire` fan-out)
- Modify: `packages/ui/src/Recruit.tsx` (read buffed uids, real measure, suppression ref + filter)

**Interfaces:**
- Consumes: `spellCastMoment`, `runRecruitMomentCues`, `bindingFor`, `restingCenterOf`, `runRef`, `useGame` (all already present).
- Produces: `spellCastMoment(cardId, point, recipients?: RecruitRecipient[])` — `recipients` defaults to `[]` (existing 2-arg callers unaffected; the Task-1 shape test still passes).

- [ ] **Step 1: Extend the builder + its test**

In `recruitMoments.ts`, change the signature to `spellCastMoment(cardId: string, point: { x: number; y: number }, recipients: RecruitRecipient[] = [])` returning `{ kind: 'spellCast', sourceCardId: cardId, recipients, point }`. Add a test in `recruitMoments.test.ts`:

```ts
it('carries recipients when the cast buffed minions (trail targets)', () => {
  const m = spellCastMoment('wo_champion', { x: 10, y: 20 }, [{ uid: 'm1', count: 1 }]);
  expect(m).toEqual({ kind: 'spellCast', sourceCardId: 'wo_champion', recipients: [{ uid: 'm1', count: 1 }], point: { x: 10, y: 20 } });
});
```

Run: `npx vitest run packages/ui/src/choreo/recruitMoments.test.ts` — the new test passes AND the Task-1 point-only test (which passes 2 args → `recipients: []`) still passes.

- [ ] **Step 2: Fan out in the cue branch**

Replace `runSpellCastFire` in `recruitCues.ts` with:

```ts
function runSpellCastFire(moment: RecruitMoment, ctx: RecruitCueContext): () => void {
  const binding = bindingFor(moment.sourceCardId ?? null, 'spellCast');
  const pt = moment.point;
  if (!binding || !pt) return () => {};
  const camera = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const src = moment.sourceCardId ?? null;
  // No targets → a single fire at the release point (Golden / Reinforcing).
  if (moment.recipients.length === 0) {
    playDef(binding.def, { source: pt, target: pt, cursor: pt, camera }, { uids: { source: src, target: src } });
    if (binding.sfx !== undefined) sfx[binding.sfx]?.();
    return () => {};
  }
  // Targets (buff ales) → one fire per buffed minion, ALL AT ONCE, each travelling cursor→minion. The buffed
  // cards re-rendered this commit (stat change), so measure inside one rAF for post-layout geometry.
  const raf = requestAnimationFrame(() => {
    for (const r of moment.recipients) {
      const c = ctx.measure(r.uid);
      if (!c) continue; // minion left the DOM (sold/tripled) before paint — skip it cleanly
      playDef(binding.def, { source: pt, target: c, cursor: pt, camera }, { uids: { source: src, target: r.uid } });
    }
    if (binding.sfx !== undefined) sfx[binding.sfx]?.(); // one sound for the volley, not one per target
  });
  return () => cancelAnimationFrame(raf);
}
```

- [ ] **Step 3: Cast site — read buffed uids, pass a real measure, claim suppression**

In `Recruit.tsx`, add a component-level ref near the other FX refs (e.g. beside `prevFxSeq`):

```ts
// The buffed minions an ale cast is visualizing this action, so the generic buff tendril is suppressed for
// them (same rule as `rubyOwned` below). Keyed by `recruitFxSeq` so it only applies to that one action.
const spellCastOwnedRef = useRef<{ seq: number; uids: Set<string> }>({ seq: -1, uids: new Set() });
```

Replace the `fireSpellCastFx` helper (from Task 2) with:

```ts
const fireSpellCastFx = (cardId: string, pt: { x: number; y: number }): void => {
  if (!bindingFor(cardId, 'spellCast')) { castSparks(() => fireSpark(pt.x, pt.y), cardId); return; }
  const st = useGame.getState().run;
  // The minions this cast buffed THIS action are the trail targets (leftmost / 3 randoms); distinct uids.
  const targets = Array.from(new Set(st.recruitBuffFx.map((e) => e.targetUid)));
  if (targets.length > 0) spellCastOwnedRef.current = { seq: st.recruitFxSeq, uids: new Set(targets) };
  runRecruitMomentCues(spellCastMoment(cardId, pt, targets.map((uid) => ({ uid, count: 1 }))), {
    cardIdOf: (uid) => runRef.current.board.find((c) => c.uid === uid)?.cardId ?? null,
    measure: (uid) => { const el = document.querySelector<HTMLElement>(`[data-uid="${uid}"]`); return el ? restingCenterOf(el) : null; },
  });
};
```

- [ ] **Step 4: Suppress the generic pop for ale-owned minions**

In the buff-FX replay effect (`Recruit.tsx`, the `useEffect` on `[run.recruitFxSeq]` ~line 3032), extend the existing `rubyOwned` filter to also drop ale-owned uids:

```ts
    const rubyOwned = new Set((run.rubyLandedFx ?? []).map((l) => l.uid));
    const aleOwned = spellCastOwnedRef.current.seq === run.recruitFxSeq ? spellCastOwnedRef.current.uids : new Set<string>();
    const owned = (rubyOwned.size > 0 || aleOwned.size > 0) ? new Set<string>([...rubyOwned, ...aleOwned]) : null;
    const events = owned ? run.recruitBuffFx.filter((e) => !owned.has(e.targetUid)) : run.recruitBuffFx;
    if (events.length === 0) return;
    replayBuffFxEvents(events);
```

- [ ] **Step 5: Gates**

Run: `npm run typecheck && npx vitest run packages/ui/src/choreo/ && npm run lint`
Expected: green. (The cue-branch + Recruit.tsx changes are DOM/timer integration — not unit-tested, consistent with the rest of `recruitCues.ts`; they are live-verified by Mike.)

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/choreo/recruitMoments.ts packages/ui/src/choreo/recruitMoments.test.ts packages/ui/src/choreo/recruitCues.ts packages/ui/src/Recruit.tsx
git commit -m "feat(fx): buff ales shoot the bound def cursor→target(s), suppress the generic pop"
```

- [ ] **Step 7: Live verify (Mike)**

With a buff ale bound to a source→target def: cast Champion's (one trail to the leftmost) and Defensive/Bloody (three trails at once to the buffed minions); confirm each travels from the cursor, erupts on the minion, all simultaneous, and the generic buff pop is gone on those minions. Other buff sources (a Shout, a rune) keep their normal pop.

---

### Task 5: Edward Keg-hands echo — buff-ale volley re-fires from Edward

**Design (owner, 2026-08-12):** `dw_edward` (Edward Keg-hands) makes Dwarven Ales trigger **twice** (**three times** gilded) — a run-wide multiplier inside `spellCasts()` (`packages/sim/src/recruit.ts:816`). The sim already re-runs the buff, but the FX dedupes targets so the repeat is invisible. When a buff ale is cast with Edward on board, re-fire the SAME cursor→minion fan-out **from Edward's card** as the source: **1** extra volley for ×2, **2** for ×3 (gilded), each **80ms** after the last (base cursor volley at t=0, echoes at +80/+160ms). UI-only — Edward's uid + gilded state come from `run.board`.

**Files:**
- Modify: `packages/ui/src/Recruit.tsx` (`fireSpellCastFx` — add the Edward echo after the base volley)

**Interfaces:** Consumes existing `runRecruitMomentCues`, `spellCastMoment`, `restingCenterOf`, `runRef`, `useGame`, `spellCastOwnedRef` — all already in scope. No new exports.

- [ ] **Step 1: Add the echo-delay constant**

Add a module-scope const near the other FX timing constants in `Recruit.tsx`:

```ts
/** Delay between the cursor volley and each Edward Keg-hands echo of a buff-ale cast (owner-set 2026-08-12). */
const SPELLCAST_EDWARD_ECHO_MS = 80;
```

- [ ] **Step 2: Re-fire the fan-out from Edward in `fireSpellCastFx`**

Replace the body of `fireSpellCastFx` (currently ~`Recruit.tsx:4083-4093`) with:

```ts
const fireSpellCastFx = (cardId: string, pt: { x: number; y: number }): void => {
  if (!bindingFor(cardId, 'spellCast')) { castSparks(() => fireSpark(pt.x, pt.y), cardId); return; }
  const st = useGame.getState().run;
  // The minions this cast buffed THIS action are the trail targets (leftmost / 3 randoms); distinct uids.
  const targets = Array.from(new Set(st.recruitBuffFx.map((e) => e.targetUid)));
  if (targets.length > 0) spellCastOwnedRef.current = { seq: st.recruitFxSeq, uids: new Set(targets) };
  const recipients = targets.map((uid) => ({ uid, count: 1 }));
  const ctx = {
    cardIdOf: (uid: string) => runRef.current.board.find((c) => c.uid === uid)?.cardId ?? null,
    measure: (uid: string) => { const el = document.querySelector<HTMLElement>(`[data-uid="${uid}"]`); return el ? restingCenterOf(el) : null; },
  };
  // Base volley: from the cursor (release point).
  runRecruitMomentCues(spellCastMoment(cardId, pt, recipients), ctx);
  // EDWARD KEG-HANDS echo: Edward (`dw_edward`) makes Ales trigger twice (three times gilded) — the sim already
  // re-ran the buff, but we dedupe the targets, so the repeat would be invisible. Re-fire the SAME fan-out from
  // Edward's card: 1 extra volley for ×2, 2 for ×3 (gilded), each 80ms after the last. Gated on `recipients`
  // (only buff ales have minion targets) — and Edward only multiplies Ales, and only Ales carry a spellCast
  // binding, so recipients + Edward ⟺ an Ale Edward doubled. Edward's position is measured at echo time (inside
  // the timeout), so it survives Edward himself being re-rendered by the buff.
  const edwards = targets.length > 0 ? st.board.filter((c) => c.cardId === 'dw_edward') : [];
  const echoes = edwards.length > 0 ? (edwards.some((e) => e.golden) ? 2 : 1) : 0;
  const edwardUid = edwards[0]?.uid;
  for (let i = 1; i <= echoes; i++) {
    window.setTimeout(() => {
      const el = edwardUid ? document.querySelector<HTMLElement>(`[data-uid="${edwardUid}"]`) : null;
      if (!el) return; // Edward left the board (sold/tripled) before the echo — skip cleanly
      runRecruitMomentCues(spellCastMoment(cardId, restingCenterOf(el), recipients), ctx);
    }, i * SPELLCAST_EDWARD_ECHO_MS);
  }
};
```

- [ ] **Step 3: Gates**

Run the FULL suite (a scoped run misses `fx/directCalls.test.ts`): `npm run typecheck && npm run lint && npm test && npm run build:web`. All green. (The change is DOM/timer integration in `Recruit.tsx` — not unit-tested, consistent with the rest of the cast-site wiring; live-verified by Mike. Note `spellCastMoment`/`runSpellCastFire` are UNCHANGED, so `DYNAMIC_CALL_SITES` does not move — no new `playDef` sites are added.)

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/Recruit.tsx
git commit -m "feat(fx): buff-ale volley echoes from Edward Keg-hands (×2/×3), 80ms apart"
```

- [ ] **Step 5: Live verify (Mike)**

Board with Edward + 3 friendlies: cast a buff ale, confirm the cursor volley fires, then a second volley from Edward's card ~80ms later; gild Edward and confirm a third volley (+160ms). Without Edward, only the cursor volley (unchanged).

---

## Notes for the executor

- **The workbench Save writes real files** under `packages/ui/src/fx/defs/`; do not hand-author the `ale-*.json` unless iterating on an already-Saved def.
- **Suppression rule:** binding `spellCast` on a card IS the statement "I've authored this cast" — that's why the generic spark stops for bound spells only. Never suppress it globally.
- **Only `wo_*` ales are in scope.** Other Set-2 tavern spells (Ruby Shipment, Veinstorm, etc.) keep the generic spark.
