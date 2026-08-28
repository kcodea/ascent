import { memo } from 'react';
import { CARD_INDEX } from '@game/content';
import { chooseBothActive, hasTier7Access, spellAttackBonus, spellHealthBonus } from '@game/sim';
import { Card, type CardView } from './Card';
import { stepProgress } from './cardText';
import { liveCardText } from './instView';
import { useGame } from './store';
import type { UnitFrame } from './useCombatReplay';

/* Floats (damage numbers, keyword glyphs) used to render HERE, as siblings of the `<Card>`. They now live in
   a board-level overlay in `Recruit.tsx` (`.floatanchor`) so their z-index is globally comparable and the
   numbers stay readable OVER the Pixi FX canvas — the reasoning is in `choreo/channels/float.ts`. A unit
   therefore no longer re-renders when a float spawns or expires. */
interface UnitProps {
  u: UnitFrame;
  side: 'foe' | 'you';
  anim?: string;
  /** Pulse the trigger medallion this beat — this unit's effect just fired in combat. */
  triggered?: boolean;
  /** Pulse the trigger medallion YELLOW — a Rally fired as this unit attacks (fired mid-lunge, at the
   *  wind-up pause, so it's timed to the strike rather than the beat start). Takes precedence over `triggered`.
   *  A per-fire nonce (not a bool) so a repeat Rally in the same combat restarts the pulse (used as a `key`). */
  rallyPulse?: number;
  /** Pulse the trigger medallion LIGHT BLUE — this unit is a watcher that answered an ally's attack. Nonce. */
  watcherPulse?: number;
  /** Bloom this unit's card frame light blue — the watcher's frame surface (CSS fallback). Nonce. */
  framePulse?: number;
}

const sameKeywords = (a: string[], b: string[]): boolean =>
  a === b || (a.length === b.length && a.every((k, i) => k === b[i]));

/** A combat unit — the same Card as recruit, wrapped for animations and the DS ring. */
function UnitInner({ u, side, anim, triggered, rallyPulse, watcherPulse, framePulse }: UnitProps) {
  const cls = ['unit', side, u.divineShield ? 'ds' : '', anim ?? ''].filter(Boolean).join(' ');
  const def = CARD_INDEX[u.cardId];
  const goldMul = u.golden ? 2 : 1;
  // Run-level scalers. For a PLAYER minion these come from the live run (frozen during combat so the text
  // reflects the value the fight used). For an ENEMY minion (side === 'foe') they come from the OPPONENT's
  // captured snapshot (`lastCombat.enemyScalers`) — so an enemy Grim / Taragosa / Watcher / Hoardbreaker /
  // Pack Leader / Runescale reads at the value THAT player had, not ours (mirrors the per-side sim math).
  const foe = side === 'foe';
  const runSpA = useGame((s) => spellAttackBonus(s.run));
  const runSpH = useGame((s) => spellHealthBonus(s.run));
  const runDrTally = useGame((s) => s.run.deathrattlesTriggered);
  const runSpellsThisTurn = useGame((s) => s.run.spellsThisTurn);
  const runPlayedThisTurn = useGame((s) => s.run.playedThisTurn);
  const enemyScalers = useGame((s) => s.run.lastCombat?.enemyScalers);
  // Rune of the Zoo: Beardsley's combat text prints the NEXT summon's live grant. A primitive selector — units
  // only re-render when the summon tally actually moves (a rare board-reflow beat), and only with the rune held.
  const zooSummons = useGame((s) => (s.run.questFlags?.runeZoo ? (s.combatQuestDelta?.summonCombat ?? 0) : undefined));
  const spA = foe ? (enemyScalers?.spellPower.attack ?? 0) : runSpA;
  const spH = foe ? (enemyScalers?.spellPower.health ?? 0) : runSpH;
  const drTally = foe ? (enemyScalers?.deathrattles ?? 0) : runDrTally;
  const spellsThisTurn = foe ? (enemyScalers?.spellsThisTurn ?? 0) : runSpellsThisTurn;
  // Pack Leader's grant: the player counts qualifying plays from the card-id array; the enemy's beast count is
  // pre-computed in its snapshot (the ids aren't carried), so pass the number straight through.
  const beastsPlayed: string[] | number | undefined = foe ? (enemyScalers?.beastsPlayed ?? 0) : runPlayedThisTurn;
  // Combat live text — the SAME `liveCardText` the shop/board use, so every card reads identically in both phases
  // and any newly-added scaling card is covered automatically (no parallel chain to drift). Per-instance values
  // come from the snapshot (u.*); run-level scalers are per-side (player = the live run, frozen for the fight;
  // enemy = its captured `enemyScalers`); run-wide economy (Steward's last spell, Cling enchant, Soulsman Gold,
  // Eternal Knight's run tally, …) is player-only — an enemy carries no run, so those fall back to base text.
  const run = useGame((s) => s.run);
  const { text: liveText, goldenText: liveGoldenText } = def
    ? liveCardText(u.cardId, {
        tier: run.tier, golden: u.golden,
        spellBonus: spA, spellBonusH: spH,
        frontToBackBonus: foe ? 0 : run.frontToBackBonus, frontToBackBonusH: foe ? 0 : run.frontToBackBonusH,
        spellsThisTurn, spellsCast: foe ? 0 : run.spellsCast, deathrattlesTriggered: drTally,
        clingEnchant: foe ? undefined : run.cardBuffs?.cling,
        fodderConsumed: foe ? undefined : run.fodderConsumedThisTurn,
        undeadBuyAtk: foe ? 0 : run.undeadBuyAtk, soulsmanGold: foe ? 0 : (run.soulsmanGold ?? 0),
        impAura: foe ? undefined : run.impBuff, // enemyScalers carries no Imp Aura → an enemy Raag reads its printed text
        cardBuffs: foe ? undefined : run.cardBuffs,
        chosenOption: u.chosenOption, // a resolved Choose One prints only the branch it became
        // (Both) — a golden Orivax / a Veinbreaker under its rune records NO branch (it gained them all), so in
        // combat it must still read as doing both rather than falling back to a "Choose One:" it never asked.
        // Player-side only: an enemy snapshot carries no run, the same fallback every run-scoped input takes.
        chooseBoth: foe ? false : chooseBothActive(run, u, def),
        rallySpreadAtk: u.rallySpreadAtk, // Sunmane: the rally's live escalating grant
        taughtSpellId: u.taughtSpellId, // a Mage-Pup names the spell it was taught
        spellProgress: u.spellProgress, ascendProgress: u.ascendProgress, summonBonus: u.summonBonus,
        overflowBonus: u.overflowBonus, hpGrantBonus: u.hpGrantBonus, eotBonus: u.eotBonus, eotTick: u.eotTick,
        sellBonus: u.sellBonus, attackSeen: u.attackSeen, permaGain: u.permaGain,
        playedThisTurn: beastsPlayed, squirlScoutBuff: foe ? 0 : run.squirlScoutBuff,
        // CONDUCTOR — PER SIDE, unlike the run-scoped scalers around it: the foe's snowball rides its snapshot
        // into `enemyScalers`, so a served Conductor prints the OPPONENT's N instead of falling back to base.
        // `onBoard` picks the right framing: a combat body is already played, so it reads the CURRENT N.
        conductorBuff: foe ? (enemyScalers?.conductorBuff ?? 0) : (run.conductorBuff ?? 0), onBoard: true,
        // Drunken Oaf's rep count. Player-only: `enemyScalers` carries no Ale tally, so a served Oaf reads its
        // printed text — the same fallback every other run-scoped scaler takes on the foe side.
        alesThisTurn: foe ? undefined : run.alesCastThisTurn,
        goldSpent: foe ? 0 : run.goldSpentThisTurn,
        // Ancient Wanderer's run-lifetime meter. Player-only: an enemy snapshot carries no run, so a served
        // Wanderer reads its printed rate — the same fallback every other run-scoped scaler takes on the foe
        // side (its STATS are still right; they were baked in the shop).
        goldSpentRun: foe ? 0 : run.goldSpent,
        lastSpellName: foe ? undefined : (run.lastSpellCastId ? CARD_INDEX[run.lastSpellCastId]?.name : undefined),
        // Runesnout Archivist's journal + Ashen Heir's banked Imp stats, LIVE during the fight: both cards are
        // entirely about a number that moves mid-combat, so the printed text has to move with it (the hard
        // live-value rule). The journal is run-side (player only, like lastSpellName); the bank rides the
        // combat body itself, so a served Heir shows its own.
        rememberedSpellNames: foe ? undefined
          : (run.rememberedSpellIds ?? []).map((id) => CARD_INDEX[id]?.name).filter((n): n is string => !!n),
        impBank: u.impBank,
        // The Dragon copiers' targets are frozen with the rest of the run for the fight — player-side only,
        // same as lastSpellName (an enemy carries no run, so it falls back to its printed text).
        firstSpellThisTurnName: foe ? undefined : (run.firstSpellThisTurnId ? CARD_INDEX[run.firstSpellThisTurnId]?.name : undefined),
        lastSpellThisTurnName: foe ? undefined : (run.lastSpellThisTurnId ? CARD_INDEX[run.lastSpellThisTurnId]?.name : undefined),
        // Rune-modified card rules read live in COMBAT too (owner audit 2026-08-02) — player-side only.
        runeMammoth: foe ? undefined : !!run.questFlags?.runeMammoth,
        // Tier-7 ACCESS, live in combat too (the hard live-value rule): Skybound Ascendant's "(up to Tier 7)"
        // is a promise only a Summit / Rune-of-the-Summit run can keep, so a served body reads Tier 6.
        // Player-side only — an enemy snapshot carries no run, the same fallback every run-scoped input takes.
        tier7Access: foe ? false : hasTier7Access(run),
        zooSummons: foe ? undefined : zooSummons, // Beardsley + Rune of the Zoo: the next summon's live grant

        runeFlags: foe ? undefined : { matriarch: !!run.runeMatriarch, brokerage: !!run.runeBrokerage, livingTreasure: !!run.questFlags?.runeLivingTreasure },
        // Rune of Rebirth: only the body the Start-of-Combat grant actually landed on prints the Echo.
        rebirthOwner: u.grantedEcho,
      })
    : { text: '', goldenText: undefined };
  const view: CardView = {
    name: u.name, cardId: u.cardId, tribe: u.tribe, tribe2: def?.tribe2,
    chosenOption: u.chosenOption, // the branch's ART rides into combat with it, same as its text
    attack: u.attack,
    health: Math.max(0, u.health),
    keywords: u.keywords, golden: u.golden,
    text: liveText,
    // liveCardText already folds golden-awareness + the golden-variant fallback into its goldenText (Card renders
    // that for goldens), so pass it straight through — same source of truth as the shop.
    goldenText: liveGoldenText ?? def?.goldenText,
    tier: def?.tier,
    // Two thresholds in combat: green above the *printed* base (it's buffed), red below the *floor* it
    // entered the fight with (it's been damaged/debuffed). So a recruit-buffed 5/5 stays green until
    // it's chipped below 5 — it doesn't flip to red/neutral the instant combat begins.
    baseAttack: (def?.attack ?? 0) * goldMul, baseHealth: (def?.health ?? 0) * goldMul,
    floorAttack: u.baseAttack, floorHealth: u.baseHealth,
    buffs: u.buffs, // per-source breakdown (recruit + combat) for the right-click inspect panel
    // Live step counter (Guel 1/4, Crypt Drake 1/2, …) — ticks mid-fight from the unit's per-instance accruals.
    stepProgress: stepProgress(u.cardId, {
      spellProgress: u.spellProgress, summonBonus: u.summonBonus,
      ascendProgress: u.ascendProgress, attackSeen: u.attackSeen,
      avengeSeen: u.avengeSeen, bleedAttacks: u.bleedAttacks,
      // orbitTick deliberately absent: Orbits are a shop mechanic, no combat counter (audit 2026-08-06).
    }) ?? undefined,
    // Combat: the counter fades in on each tick and fades out after ~3s (see `.stepcounter.ephemeral`).
    // Shop/recruit paths (instView) leave this undefined so the counter stays persistently visible.
    stepEphemeral: true,
  };
  return (
    // A `ghost` (a dead body kept only to anchor its own still-playing FX) is hidden but keeps its layout box,
    // so the volley launches from its slot and the board doesn't reflow into the gap until the effect finishes.
    <div className={cls} data-uid={u.uid} data-card={u.cardId} style={u.ghost ? { visibility: 'hidden' } : undefined}>
      {/* `uid` connects this badge to the shared hold store (`fx/statHold`), so a combat buff rolls the same
          way a shop gem does; `autoRoll={false}` keeps damage instant — damage is an unheld change, so the
          number updates immediately and the pop still fires off it, while a buff (an `effect`-origin hold
          the replay itself drives via `driveRoll`) is the only thing that rolls. See `useCombatReplay`. */}
      <Card card={view} uid={u.uid} autoRoll={false} pulse={triggered} pulseRally={rallyPulse} pulseWatcher={watcherPulse} pulseFrame={framePulse} />
    </div>
  );
}

/**
 * Memoized so an unchanged unit skips re-render on every combat beat. `computeFrame` rebuilds fresh
 * `UnitFrame` objects each beat, so a reference compare always misses — we compare the rendered fields
 * by VALUE. Result: only the 1–3 units that actually changed in a beat reconcile, instead of the whole board
 * (×2 in dev StrictMode). Floats are no longer part of this at all — they render board-level, so a spawning
 * or expiring number costs the units nothing.
 */
export const Unit = memo(UnitInner, (a, b) =>
  a.side === b.side &&
  a.anim === b.anim &&
  a.triggered === b.triggered &&
  a.rallyPulse === b.rallyPulse &&
  a.watcherPulse === b.watcherPulse &&
  a.framePulse === b.framePulse &&
  a.u.uid === b.u.uid &&
  a.u.attack === b.u.attack &&
  a.u.health === b.u.health &&
  a.u.divineShield === b.u.divineShield &&
  a.u.ghost === b.u.ghost &&
  a.u.golden === b.u.golden &&
  a.u.summonBonus === b.u.summonBonus &&
  a.u.attackSeen === b.u.attackSeen &&
  // avengeSeen only ticks on a death (a rare board-reflow beat) — cheap to compare, and it's what
  // restarts the avenge counter's fade-in. (bleedAttacks is the GLOBAL attack count stamped on every
  // unit every attack; comparing it here would re-render the whole board each beat — deliberately left
  // out. A bleed unit's counter still refreshes when that unit re-renders for its own attack/buff.)
  a.u.avengeSeen === b.u.avengeSeen &&
  a.u.ascendProgress === b.u.ascendProgress &&
  a.u.hpGrantBonus === b.u.hpGrantBonus &&
  a.u.spellProgress === b.u.spellProgress &&
  a.u.permaGain?.attack === b.u.permaGain?.attack &&
  a.u.permaGain?.health === b.u.permaGain?.health &&
  a.u.name === b.u.name &&
  a.u.cardId === b.u.cardId &&
  a.u.tribe === b.u.tribe &&
  a.u.baseAttack === b.u.baseAttack &&
  a.u.baseHealth === b.u.baseHealth &&
  sameKeywords(a.u.keywords, b.u.keywords),
);
