# Buff Descend — a rain-down FX for Deathrattle buff-others

**Date:** 2026-07-11
**Status:** design approved (owner sign-off 2026-07-11)
**Siblings:** [`2026-07-10-buff-tendril-design.md`](2026-07-10-buff-tendril-design.md) (source→target beam) and
[`2026-07-11-buff-pulse-design.md`](2026-07-11-buff-pulse-design.md) (in-place self-buff blast). Descend is the
third member: a source-less rain-down for **Deathrattle** buff-others.

## Problem

A tendril flies **from the source unit's on-screen card**. A **Deathrattle** buff-other (e.g. Sergeant —
`onDeath` → `deathrattleBuffAllHealth`) usually fires when its source is dead and already dropped from the board,
so `findEl(source)` is `null` and the tendril handler's `if (!sEl || !tEl) continue` **silently skips** it — these
buffs show **nothing** today (floats are suppressed for all buffs). And a Deathrattle can even be **proc'd while
the source is still alive** (`undead:20` re-fires its own Deathrattle on a Battlecry via
`battlecryTriggeredOwnDeathrattle`), where a source→target tendril would be *semantically wrong* — a Deathrattle
is conceptually an "on death" effect, so it should read as raining down onto each recipient, not shooting from a
living caster.

**So the routing is by TRIGGER, not by liveness:** every Deathrattle-that-buffs-others uses descend, dead source
or alive.

Affected cards (all combat Deathrattle buff-others, all currently FX-less): **Sergeant**
(`deathrattleBuffAllHealth`), `deathrattleBuffAll`, `deathrattleBuffImps`, `deathrattleBuffTribeByTally`, plus any
future card on the `deathrattleBuff*` factories.

## Goal

For **each** ally buffed by a Deathrattle buff-other, a short energy tendril **drops from just above that ally's
card into its center** and triggers a **pulse** on landing, with the ally's badge flashing to its new value on the
impact. No source→target beam. Fully preset-driven with a live tuning rig, like tendril and pulse.

## Non-goals (this pass)

- Per-tribe descend presets (ships one `default`; per-tribe is a follow-up, same as pulse).
- Any change to the living-source tendril or the self-buff pulse behavior.
- Any simulation change. **Presentation-only** — `simulate()` and the event log are untouched.
- The separate on-attack-buffer tendril gap (living source absorbed into `attackExchange`) — unrelated.

## Architecture

Third sibling of the tendril/pulse systems. Four pieces. Note the routing lives **inside the existing
`onBuffCasts` handler** — no new choreo channel, cue, or `CueContext` callback.

### 1. Trigger detection & in-handler routing

`groupBuffCasts` (`choreo/channels/buffCast.ts`) is **unchanged** — it still returns every buff-other
(`source ≠ target`) grouped per (source, target). The split happens in the replay's `onBuffCasts` handler
(`useCombatReplay.ts`), which already resolves each cast's source card and has `CARD_INDEX` + `findEl` +
`pixiFx`:

```
for each cast (source → target, summed delta):
  if isDeathrattleBuffer(cast.source):   pixiFx.descend(targetCenter, descendCfg)   // rain-down
  else:                                  pixiFx.buffTendril(sourceCenter, targetCenter, tendrilCfg)
  // both then hold the target's old badge value and flash it to the new value on the strike/landing
```

**`isDeathrattleBuffer(sourceUid)`** — the source's card has an `onDeath` effect whose `do` is a known
buff-others Deathrattle factory. A small UI-side set names them (verified against the current card set; must be
extended when a new `deathrattleBuff*`-style combat buff-other factory is added):

```
DEATHRATTLE_BUFF_FACTORIES = {
  'deathrattleBuffTribe', 'deathrattleBuffTribeByTally', 'deathrattleBuffAll',
  'deathrattleBuffAllHealth', 'deathrattleBuffImps', 'deathrattleBuffRandom', 'deathrattleBuffAllRandomStat',
}
isDeathrattleBuffer(uid) = CARD_INDEX[cardIds.get(uid)]?.effects
  ?.some(e => e.on === 'onDeath' && DEATHRATTLE_BUFF_FACTORIES.has(e.do))
```

This reuses the exact `CARD_INDEX[...].effects?.some(...)` pattern the replay already uses for the Deathrattle
skull-shatter ([useCombatReplay.ts:680](../../../packages/ui/src/useCombatReplay.ts)). **Verified today:** no card
has both a non-onDeath buff-other AND an onDeath buff-other, so a Deathrattle-buffer's buff-others are *all* from
its Deathrattle — the routing is unambiguous. (If such a dual card is ever added, its Start-of-Combat buffs would
also descend; noted as a known edge, resolvable later with a sim-level event annotation.)

### 2. Renderer — `pixiFx.descend(x, y, cfg)`

`(x, y)` = the target card's center. Composes existing primitives with **no changes** to `buffTendril`/`pulse`:
- Reuses the ribbon-draw helpers (`sampleTendril` / `buildRibbonPoly` / `rebuildRibbon`) to draw a short vertical
  tapered ribbon from `(x, y − startHeight)` down to `(x, y)`, revealed over `dropMs`.
- On landing (drop head reaches center), fires the pulse (reusing the pulse's ring/flash/spark spawn logic) at
  `(x, y)` from the preset's embedded `pulse` config.
- Tracked in a small `descends` state array advanced in the `update` ticker — same lifecycle as `tendrils` /
  `pulses` (create → advance → strike-once latch → retract/fade → splice). Cleanup in `clearParticles` / `detach`.

### 3. Presets — `descendPresets.ts`

```ts
export interface DescendPresetCfg {
  blend: 'add' | 'normal' | 'screen';
  // drop (the descending ribbon)
  startHeight: number;   // px above the card center the drop begins
  dropMs: number; curve: number; wobbleAmp: number; wobbleFreq: number; retractMs: number;
  baseWidth: number; tipWidth: number; coreAlpha: number; glowWidth: number; glowAlpha: number;
  colorCore: string; colorGlow: string;
  // landing blast — the full pulse config, reused (defaults to the tuned gold self-buff pulse)
  pulse: PulsePresetCfg;
}
```

`DESCEND_PRESETS` registry (starts `default`-only) + `descendPreset(cardId, tribe)` resolver (card → tribe →
`default`, most-specific wins), identical shape to `buffPreset`/`pulsePreset`. Reusing `PulsePresetCfg` for the
landing keeps the pulse fully tunable and DRY.

### 4. Badge + float

Reuses the existing `statHold` / `statFlash` machinery: hold the target's pre-buff value during the drop, then
release + flash the changed badge(s) to the new value on the landing pulse (hold ≈ `dropMs`). This is the same
per-target hold/flash the tendril handler already does — descend just times it to `dropMs` instead of the
tendril's `travelMs`. Floats are already suppressed for every buff, so descend **adds** a visual where there is
none today.

### 5. Editor rig — `apps/web/public/fx/buff-descend-preview.html`

A self-contained clone of the tendril/pulse rigs: cream board, a card marker, the drop dials
(`startHeight`/`dropMs`/`curve`/`wobble`/`retractMs`/widths/alphas/colors) + the full pulse dial-set + a `blend`
dropdown, a Fire button + auto-repeat, and a live `DescendPresetCfg` JSON export. The owner tunes; the JSON is
baked into `descendPresets.ts` (generated from the JSON to avoid transcription drift).

## Data flow

```
combat log ──▶ compileMoments ──▶ buffWave moment ──▶ buffCast channel ──▶ groupBuffCasts (all buff-others)
                                                                              │  onBuffCasts handler splits:
                                                                              ├─ isDeathrattleBuffer(src) ─▶ pixiFx.descend(target)   (drop → pulse)
                                                                              └─ else                     ─▶ pixiFx.buffTendril(src→target)
badge: statHold (pre-buff) ─(dropMs / travelMs)─▶ statFlash + tick to new value on the landing/strike
```

Every combat buff is now a directed FX: self → pulse, Deathrattle-other → descend, other → tendril.

## Testing / verification

- **Unit** `descendPresets.test.ts`: resolver (card → tribe → default; stale → default); every preset has all
  `DescendPresetCfg` fields incl. a complete embedded `pulse`.
- **Unit** for `isDeathrattleBuffer` (or the classifier module it lives in): true for `sergeant` / a
  `deathrattleBuffImps` card; false for a Start-of-Combat buffer (e.g. `kennelmaster`) and a non-buff Deathrattle
  (e.g. a pure `deathrattleSummon`).
- **Integration** (real combat, `buffSelfTrigger.test.ts` style): a Sergeant-dies combat produces a `buffWave`
  moment whose buff-others' source resolves as a Deathrattle buffer — proving the descend branch is taken.
- Full gate green: typecheck + lint + test + build:web.
- **Live** check (owner eyeball): Sergeant dies → each ally gets a drop + pulse + badge flash; no tendril fires
  from the (absent) source.

## Follow-ups (tracked in roadmap, not this PR)

- Per-tribe descend presets (tune on the rig + tribe mappings).
- A robust sim-level trigger annotation on buff events (would remove the `DEATHRATTLE_BUFF_FACTORIES` maintenance
  list and handle a future dual-effect card) — only if that edge ever appears.
- The separate living-source on-attack-buffer tendril gap.
