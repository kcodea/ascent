# Buff Descend — a rain-down FX for Deathrattle buff-others

**Date:** 2026-07-11
**Status:** design approved (owner sign-off 2026-07-11)
**Siblings:** [`2026-07-10-buff-tendril-design.md`](2026-07-10-buff-tendril-design.md) (source→target beam, living source) and
[`2026-07-11-buff-pulse-design.md`](2026-07-11-buff-pulse-design.md) (in-place blast, self-buff). Descend is the
third member: a source-less rain-down for buff-others whose source is **dead**.

## Problem

A tendril flies **from the source unit's on-screen card**. A **Deathrattle** buff-other (e.g. Sergeant —
`onDeath` → `deathrattleBuffAllHealth`, "give your minions +Health") emits its buff events in a `buffWave` moment
that plays **after** the source's death beat — by which point the dead unit has been dropped from the board
(`useCombatReplay.ts`: a `death` marks the unit `'dying'` for its own beat only, then it's removed). So
`findEl(source)` returns `null` and the tendril handler's `if (!sEl || !tEl) continue` **silently skips** every
tendril. These buffs currently show **nothing** — the stat just changes silently (floats are suppressed for all
buffs).

Affected cards (combat Deathrattle buff-others, all currently FX-less): **Sergeant** (`deathrattleBuffAllHealth`),
`deathrattleBuffAll`, `deathrattleBuffImps`, `deathrattleBuffTribeByTally`, plus any future card on the
`deathrattleBuff*` factories.

## Goal

Give Deathrattle buff-others a fitting FX: for **each** buffed ally, a short energy tendril **drops from just
above that ally's card into its center** and triggers a **pulse** on landing, with the ally's badge flashing to
its new value on that impact. No source→target beam (the source is gone) — the buff "rains down" onto each
recipient. Fully preset-driven with a live tuning rig, exactly like tendril and pulse.

## Non-goals (this pass)

- Per-tribe descend presets (ships one `default`; per-tribe is a follow-up, same as pulse).
- Any change to the living-source tendril or the self-buff pulse behavior.
- Any simulation change. Presentation-only — `simulate()` and the event log are untouched.
- The separate on-attack-buffer tendril gap (living source absorbed into `attackExchange`) — unrelated.

## Architecture

Third sibling of the tendril/pulse systems. Five pieces.

### 1. Trigger detection & routing — split buff-others by source liveness

Buff-others (`source ≠ target`) split by **whether the source has already died** — a `death` event whose target
is the buff's source, occurring at an event index **before the current moment's start**:
- **Living source** → tendril (unchanged).
- **Dead source** → descend (new). For a buff-*other*, a dead source can only be that unit's own Deathrattle; a
  death-*triggered* buff from a living unit (Avenge/Rally) keeps its live source and stays a tendril.

A small shared helper computes the died-set for a moment (uids with a `death` event before `moment.start`). Two
pure channels consume it:
- **`groupBuffCasts`** (existing, `choreo/channels/buffCast.ts`) — MODIFIED to exclude dead-source buff-others,
  so they don't also try (and skip) a tendril. Living-source buff-others only.
- **`groupDeathBuffs`** (new, `choreo/channels/deathBuff.ts`) — dead-source buff-others, grouped **per target**
  (descend needs the recipient + summed delta + a representative source uid for preset lookup). Shape:
  `DeathBuff = { uid: string; source: string; attack: number; health: number }`.

`score.ts` gains a `buffDescend` cue on the `buffWave` moment (alongside `buffCast` + `buffSelf`) and an
`onDeathBuffs(deathBuffs: DeathBuff[])` `CueContext` callback.

### 2. Renderer — `pixiFx.descend(x, y, cfg)`

`(x, y)` = the target card's center. Composes existing primitives with **no changes** to `buffTendril`/`pulse`:
- Reuses the ribbon-draw helpers (`sampleTendril` / `buildRibbonPoly` / `rebuildRibbon`) to draw a short vertical
  tapered ribbon from `(x, y − startHeight)` down to `(x, y)`, revealed over `dropMs`.
- On landing (drop head reaches the center), fires the pulse (reusing the pulse's ring/flash/spark spawn logic)
  at `(x, y)` using the preset's embedded `pulse` config.
- Tracked in a small `descends` state array advanced in the `update` ticker — same lifecycle pattern as
  `tendrils` and `pulses` (create → advance → strike-once latch → retract/fade → splice). Cleanup in
  `clearParticles` / `detach`.

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

Reuses the existing `statHold` / `statFlash` machinery (built for tendrils, shared by pulse): hold the target's
pre-buff value during the drop, then release + flash the changed badge(s) to the new value on the landing pulse
(hold ≈ `dropMs`). Floats are already suppressed for every buff — so descend **adds** a visual where there is
none today; no float change needed.

### 5. Editor rig — `apps/web/public/fx/buff-descend-preview.html`

A self-contained clone of the tendril/pulse rigs: cream board, a card marker, the drop dials
(`startHeight`/`dropMs`/`curve`/`wobble`/`retractMs`/widths/alphas/colors) + the full pulse dial-set + a `blend`
dropdown, a Fire button + auto-repeat, and a live `DescendPresetCfg` JSON export. The owner tunes; the JSON is
baked into `descendPresets.ts` (generated from the JSON to avoid transcription drift).

## Data flow

```
combat log ──▶ compileMoments ──▶ buffWave moment
                                    ├─ buffCast   ─▶ groupBuffCasts (living source) ─▶ onBuffCasts  ─▶ pixiFx.buffTendril
                                    ├─ buffSelf   ─▶ groupSelfBuffs (source==target) ─▶ onSelfBuffs  ─▶ pixiFx.pulse
                                    └─ buffDescend─▶ groupDeathBuffs (dead source)  ─▶ onDeathBuffs ─▶ pixiFx.descend (drop → pulse)
badge: statHold (pre-buff) ─(dropMs)─▶ statFlash + tick to new value on the landing pulse
```

Every combat buff is now a directed FX: living-other → tendril, self → pulse, dead-other → descend.

## Testing / verification

- **Unit** `deathBuff.test.ts`: dead-source buff-others grouped per target + summed; living-source excluded;
  source-died detection (death before the moment) correct; order stable.
- **Unit** `buffCast.test.ts` (extend): a dead-source buff-other is now EXCLUDED from `groupBuffCasts`.
- **Unit** `descendPresets.test.ts`: resolver (card → tribe → default; stale → default); every preset has all
  `DescendPresetCfg` fields incl. a complete embedded `pulse`.
- **Unit** `score.test.ts` (extend): a dead-source buff-other on `buffWave` routes to `onDeathBuffs`, not
  `onBuffCasts`; a living-source one still routes to `onBuffCasts`.
- **Integration** (extend `buffSelfTrigger.test.ts`-style): a real Sergeant-dies combat → a `buffWave` moment
  whose buff-others are dead-source and surface through `groupDeathBuffs`.
- Full gate green: typecheck + lint + test + build:web.
- **Live** check on the dev server (owner eyeball): Sergeant dies → each ally gets a drop + pulse + Attack/Health
  badge flash; no tendrils try to fire from the corpse.

## Follow-ups (tracked in roadmap, not this PR)

- Per-tribe descend presets (tune on the rig + tribe mappings).
- Whether living-source on-attack buffers (absorbed into `attackExchange`) should get contact-timed tendrils —
  a separate pre-existing gap.
