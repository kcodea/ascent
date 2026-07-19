# Animation & SFX coverage heatmap

Which minion triggers have a dedicated effect, which get only the shared generic buff, and which have
nothing — plus the same read for sound. Traced from `main` @ `5cbaab71`.

**Interactive version:** https://claude.ai/code/artifact/223ad506-d636-4096-b01c-9e957038f2f5
(filter by status, search by name — easier to work through than this file)

Animation and sound are scored **independently**: a bespoke effect with no cue is still a gap.

- **Bespoke** — a dedicated visual authored for that moment
- **Generic** — reuses the shared buff pulse/descend, a float, or a badge: it registers, but doesn't say
  *what* happened
- **Missing** — nothing renders on the board

## Headline

| | |
|---|---|
| Combat events with bespoke FX | 14 / 23 |
| …generic or text-only | 5 |
| …rendering nothing on board | 4 |
| Combat events with no sound | 15 / 23 |
| Shop interactions with no FX | 12 |
| Distinct descend looks (shared by every buff) | **1** |
| Distinct tendril looks | 5 tribes, **0** per-card |

## The six highest-value gaps

1. **One effect does almost all the work.** `DESCEND_PRESETS` has exactly one entry and `DESCEND_ASSIGN` is
   empty, so every spell buff, Deathrattle buff, quest/rune reward and the whole End-of-Turn capture resolve
   to one identical amber drop. `BUFF_ASSIGN.byCard` is empty — no card has its own tendril; there are only
   five tribe variants, and the neutral default is a copy of the beast green. **Highest leverage: the
   assignment maps already exist and are simply unpopulated — no new primitives needed.**
2. **Three combat events burn a beat and draw nothing.** `questTrigger`, `questComplete` and `spellProgress`
   have no case in `momentKind` (`kinds.ts:19`), so each falls to the 300ms default hold
   (`choreoConfig.ts:106`) — at 1.5x speed that is **450ms of dead air** with nothing on the board.
3. **Enemy quest triggers are wholly invisible.** Both handlers filter on player-side only
   (`useCombatReplay.ts:1175`, `:1191`).
4. **Hero sound is 100% dead.** `packages/ui/src/audio/heroes/` does not exist and `heroSelect`/`heroPower`
   have no synth fallback (`sfx.ts:400`) — every hero pick and hero power is silent despite being wired.
5. **An End-of-Turn tribe-aura rise has no aura wave.** `auraFxSeq` is only stamped while the phase stays
   `recruit` (`reducer.ts:398`), so it never fires during End Turn.
6. **Two animation classes are applied but undefined.** `.unit.shatter` and `.unit.shieldgain` have zero CSS
   rules (`useCombatReplay.ts:266-267`). Shield break survives on its Pixi effect; gaining a Ward is left with
   just a glyph.

## Combat events (all 23)

| Event | FX | SFX | What fires | Note |
|---|---|---|---|---|
| `spellProgress` | missing | missing | nothing | No kind, no float, no medallion. ~450ms silent beat. |
| `questTrigger` | missing | missing | off-board badge glow | Player-side only. ~450ms dead air. |
| `questComplete` | missing | missing | off-board badge lights | Same player-only filter. |
| `hpGrant` | missing | missing | trigger medallion only | `hpGrant: 0` — deliberate zero-length beat. |
| `shieldUp` | generic | yes | glyph float + sound | `.unit.shieldgain` has no CSS. |
| `keywordLost` | generic | missing | `.struck` flash | Indistinguishable from taking a hit. |
| `keyword` | generic | missing | buffpulse + name float | Generic pulse for every keyword gained. |
| `improve` | generic | missing | `pixiFx.pulse` + float | Reads the same as a stat buff. |
| `buff` | generic | yes | tendril/descend + badge flash | This *is* the generic effect. |
| `toHand` | bespoke | missing | flying `.handgrant` card | |
| `dmg` | bespoke | partial | float, `.struck`, damageBurst | Non-attack damage has no cue. |
| `death` | bespoke | yes | dying/rising CSS, skull, board shake | A plain death gets CSS only, no Pixi. |
| `reveal` | bespoke | missing | `revealpop` | Stealth break. |
| `shield` | bespoke | missing | `shatterAt` at lunge contact | `.unit.shatter` has no CSS (harmless — Pixi carries it). |
| `attack` | bespoke | yes | lunge, impact, dust, crit, wind-slash | Richest path in the game. |
| `sc` | bespoke | yes | `sccast` + bolts + cast sound | Only when it actually casts. |
| `poison` | bespoke | missing | `.poisoned` + green mist, float | |
| `venomLost` | bespoke | missing | venomflash + burst ring | |
| `summon` | bespoke | yes | summonpop + dust + sound | |
| `ascend` | bespoke | missing | flashBloom + ascendpop | A mid-combat transform with no sound. |
| `reborn` | bespoke | yes | aura re-form + rising CSS | |
| `rally` | bespoke | missing | medallion pulse + flare on target | |
| `maxGold` | bespoke | yes | coins + float + goldproc | |

## Recruit / shop — the missing twelve

End-of-Turn tribe aura · `onSell` effects · `goldSpent` effects · `buyQuest` · `buyRune` · `chooseOne` ·
`battlecryTarget` · `rerollRuneforge` · `skipRuneforge` · `reorderHand` · `buy` · discover (the *pick*, as
opposed to the window opening).

`fireOnSell` (`recruit.ts:2591`) and `applyGoldSpent` (`recruit.ts:2238`) call their factories **bare** — no
`captureBuffFx` wrapper — so buffs they hand out get no directed FX, only the legacy green stat-pop.

## Keyword coverage

Split into resting state vs moment FX — several keywords have one without the other.

| Keyword | Cards | Resting | Moment | SFX |
|---|---|---|---|---|
| RL Rally | 15 | bespoke | bespoke | missing |
| DS Divine Shield | 7 | bespoke | bespoke | yes |
| SL Slaughter | 7 | missing | missing | missing |
| M Magnetic | 7 | missing | bespoke | missing |
| T Taunt | 6 | bespoke | generic | yes |
| SC Start of Combat | 5 | generic | bespoke | yes |
| W Windfury | 3 | missing | bespoke | partial |
| EG Engraved | 3 | missing | missing | missing |
| R Reborn | 2 | bespoke | bespoke | yes |
| V Venomous | 1 | bespoke | bespoke | missing |
| C Cleave | 1 | generic | generic | missing |
| CR Critical Strike | 1 | missing | bespoke | yes |
| FD Fodder | 1 | generic | bespoke | missing |
| IMM Immune / ST Stealth | 0 | — | — | no card uses these yet |

**Slaughter (7 cards) and Engraved (3 cards) are the most under-served** — no resting treatment and no
trigger moment. Engraved in particular means stats carrying back to the run board is entirely invisible.

## Sound assets

- `audio/heroes/` — **does not exist**; `heroSelect`/`heroPower` are permanently silent, no fallback.
- `cards/*.effect.mp3` and `cards/*.death.mp3` — **none exist**; those cues are silent for every card.
- `cards/` voicelines — only `alley.mp3` and `stray.mp3`, out of 198 cards.
- `sfx.tick` — dead in gameplay (dev balance panel only). A comment at `Recruit.tsx:471` claims a
  last-5-seconds countdown tick that does not exist.
- `deny` only fires for 4 rejectable actions — a rejected hero power, rune buy, freeze or reposition is silent.
- `flurryLunge` / `flurryHit` have assets but no synth fallback, so they are silent until decode completes
  (intentional, documented).

## Trigger census — use this to weight the work

Cards using each trigger: `cast` 38 · `onDeath` 27 · `onPlay` 21 · `onAttack` 17 · `endOfTurn` 15 ·
`startOfCombat` 12 · `avenge` 12 · `onKill` 7 · `onSummon` 5 · `spellCast` 4 · `battlecryTriggered` 4 ·
`onDamaged` 2 · `summonOverflow` 2 · `onGainAttack` 2 · `goldSpent` 2 · `onBuy` 1 · `onSell` 1.

`onConsume` and `onLoseDivineShield` are declared in the schema but **no card uses them** — don't build for
them yet.

## What is already solid

- The **attack path** — GSAP lunge, contact-anchored impact, dust, crit variant, Flurry wind-slash, and a
  synced smack. Nothing to do here.
- **All 9 recruit FX signals are watched** — every `stamp*Seq` in the sim has a live listener in
  `Recruit.tsx`. No orphaned effects.
- Nine tuned, dev-adjustable effects ship with config panels: weld, aura wave, buff gust, fodder infusion,
  swap, hero aim, buff descend, strike, crit.
- Venom, Ascend, Max Gold, Reborn, Summon and Rally all have real dedicated effects.

## Needs verification before acting

**The End-of-Turn gust/infusion allowlist.** Effects firing inside `faceOmen` stamp their FX signals after
the phase has flipped to combat, so the phase-gated watchers drop them. The EoT beat sequence compensates —
but for gust and infusion it re-derives them from a hardcoded four-name allowlist (`Recruit.tsx:2702`,
`:2705`) rather than reading the stamps, because `EotStepFx` only carries `{buffFx, eaten, welds}`. Welds and
buffs are recovered generically and are safe. Any *other* End-of-Turn effect that triggers a gust or infusion
would be invisible — but this is **inferred from structure, not confirmed factory-by-factory**, so check it
before acting on it.
