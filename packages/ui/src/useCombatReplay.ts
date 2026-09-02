import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import gsap from 'gsap';
import type { CombatEvent, CombatResult, Keyword, MinionBuff, MinionSnapshot, Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { triggerCounts } from './choreo/triggerCounts';
import { getSpellPowerFxConfig, floatSpellPowerNumber } from './spellPowerFxConfig';
import { getRubyPowerFxConfig, floatRubyPowerNumber } from './rubyPowerFxConfig';
import { fireSpellBuffOnHandSpells, fireSpellBuffOnHandRubies } from './spellBuffFx';
import { useGame } from './store'; // `useGame.getState()` — read the live hand for the mid-combat spell/Ruby buff cue
import { pixiFx } from './pixiFx';
import { getAuraFxConfig } from './auraFxConfig';
import { buffPreset, wavePalette } from './buffPresets';
import { sfx } from './sfx';
import { getChoreoConfig } from './choreo/choreoConfig';
import { applyFloatSpeed } from './floatConfig';
import { buildAuthoredTimeline, getCombatRampConfig, rampSpeed } from './combatRampConfig';
import { attackerOfImpact, meleePairOfImpact, type Beat } from './combatBeats';
import { holdMs } from './choreo/clock';
import type { Moment } from './choreo/compile';
import { replayBeats, replayOrder } from './choreo/replayOrder';
import { rallyDeliveredUids, runMomentCues } from './choreo/score';
import { anySummonHeld, holdSummon, isSummonHeld, releaseAllSummons, releaseSummons, subscribeSummonHolds, summonHoldVersion } from './fx/summonHold';
import { notifyTutorialPresented } from './tutorial/presentationBus';
import { attackSummonUids, rallyProcsFor } from './choreo/channels/rallyFired';
import { shoutsAheadOf } from './choreo/channels/shoutFired';
import { groupBuffCasts, type BuffCast } from './choreo/channels/buffCast';
import { groupSelfBuffs, type SelfBuff } from './choreo/channels/buffSelf';
import { runAttackExchangeCues, runRiseReturn } from './choreo/engine';
import { setTransition } from './choreo/channels/lunge';
import { burstDeathAuras, breakShieldAura, reformReborn } from './choreo/channels/aura';
import { type Float, type DeathFloat, KW_FLOAT } from './choreo/channels/float';
import { combatBuffDelta, type CombatBuffDelta } from './runBuffs';
import type { CombatQuestDelta } from './store'; // type-only (erased) — no runtime edge back to the store
import { PULSE_PRESETS, pulsePreset } from './pulsePresets';
import { ASCEND_PRESETS, ascendPreset } from './ascendPresets';
import { isDeathrattleBufferCard } from './deathrattleBuffers';
import { fireBuffFx } from './buffFxRender';
import { cardFxScale } from './fx/cardScale';
import { canPlayDefs, playDef } from './fx/playDef';
import { authoredBuffDefFor, bindingFor, labelBuffFxFor } from './choreo/bindings';
import { isRuneBuffSource, hasPower } from '@game/sim';
import { anchorsForUnits } from './fx/combatAnchors';
import { getDef } from './fx/fxDefs';
import { WATCHER_PULSE_DEF_ID, watcherPixiReady } from './fx/watcherPulse';
import { watcherPulseUids } from './choreo/channels/watcherPulse';
import { combatBuffDeltas, combatDamageDeltas, driveRoll } from './fx/combatBuffRoll';
import { heldFor, holdStat, releaseStat, replaceHold } from './fx/statHold';

/** Card display name from its id (for combat-log lines about generated cards). */
const cardName = (id: string): string => CARD_INDEX[id]?.name ?? id;

/** Map a just-presented CombatEvent to the tutorial's coarse "what was shown" vocabulary and report it to the
 *  tutorial presentation bus. READ-ONLY: it observes the beat the replay already decided to show — no timing,
 *  order, or FX change — and is a no-op (one set check inside the bus) whenever no tutorial is observing. */
function notifyPresented(e: CombatEvent): void {
  switch (e.type) {
    case 'rally': return notifyTutorialPresented({ kind: 'rally', srcUid: e.source, srcCard: e.srcCard });
    case 'buff': return notifyTutorialPresented({ kind: 'buff', srcUid: e.source, srcCard: e.srcCard });
    case 'summon': return notifyTutorialPresented({ kind: 'summon', srcUid: e.source, srcCard: e.srcCard });
    case 'death': return notifyTutorialPresented({ kind: 'death', srcUid: e.target, srcCard: e.srcCard });
    case 'attack': return notifyTutorialPresented({ kind: 'attack', srcUid: e.attacker, srcCard: e.srcCard });
    case 'sc': return notifyTutorialPresented({ kind: e.cast ? 'startOfCombat' : 'shout', srcUid: e.source, srcCard: e.srcCard });
    case 'shout': return notifyTutorialPresented({ kind: 'shout', srcUid: e.source, srcCard: e.srcCard });
    default: return;
  }
}

/** How long a combat badge roll takes, in ms (before the combat-speed divide) — both a buff counting UP and a
 *  hit counting the HP DOWN. Owner-tuned 2026-08-07 to 650ms (up from the shop's `DEFAULT_ROLL_MS`, 420) so the
 *  count runs slower and reads more clearly in a fight; it is its own constant precisely so a fight-paced roll
 *  can diverge from the shop's pace like this. */
/** How long after an AUTHORED buff def lands its target's stat roll starts. The stock tendril uses its own
 *  flight time; a def has no flight, so this is its stand-in — short, because the whole reason an on-attack
 *  cast is absorbed into the wind-up is that its numbers should reconcile while the attacker is still held
 *  (owner ask 2026-09-01). */
const AUTHORED_BUFF_ROLL_MS = 140;
const COMBAT_ROLL_MS = 650;

/**
 * How long the install effect's pre-buff hold survives before the store's own fail-open forces it, in ms
 * (before the combat-speed divide) — Task 6, found only by tracing the browser gate.
 *
 * `fx/statHold`'s default TTL (`HOLD_TTL_MS`, 1200ms) is sized for the SHOP's authored gem-apply timeline
 * (900ms end to end, per that constant's own doc comment) and is a floor `holdStat` applies automatically —
 * fine there, but combat's OWN delivery timeline routinely runs longer: the wind-up before a buff's tendril
 * even launches (`LUNGE_DEFAULTS.windupDur`, 540ms owner-tuned) PLUS the tendril's own travel
 * (`BUFF_PRESETS[...].travelMs`, up to 780ms for the slowest tribe) PLUS the roll itself (`COMBAT_ROLL_MS`,
 * 420ms) is ~1740ms at 1x combat speed alone — already close to the 1200ms floor, and every one of those
 * three legs gets divided by combat speed the same way this constant is below, so a deliberately slowed-down
 * replay (0.5x, the slowest the in-combat slider allows) pushes the REAL wait past 3400ms.
 *
 * Before Task 6, this race was invisible: the strike timer almost always got CANCELLED outright by the beat
 * advance (the bug Task 6 fixes), so `driveRoll` rarely survived long enough to run into the TTL at all. Once
 * the strike timer survives, this second, previously-masked race surfaces — the store's fail-open fires
 * BEFORE the strike lands, snapping the badge to the true value moments before the (still-pending) roll would
 * have started, which then finds nothing left to reveal (a correct no-op against an already-gone hold, but
 * the wrong OUTCOME — a snap instead of a roll). `fx/statHold.ts` is off-limits for this task (see the brief),
 * so this passes an explicit `ttlMs` from the call site instead of touching the shared default: 2000ms at 1x
 * — the ~1740ms worst-case chain above plus a margin for real-world jitter (dispatch overhead, a dropped
 * frame) — comfortably clears the roll's own natural completion without weakening the TTL's actual job: an
 * unclaimed hold (an off-screen target, a bug elsewhere) still fails open in a few seconds, not never.
 *
 * KNOWN ASYMMETRY (fix round 1, Finding 2, deliberately left open): `ttlMs` is computed ONCE, off the speed
 * live at PLACEMENT time, and baked into `holdStat`'s `until` (`fx/statHold.ts`) — a fixed wall-clock deadline.
 * `driveRoll`'s roll, by contrast, re-reads speed every frame (the whole point of the speed-GETTER change
 * above). A slider drag that SLOWS DOWN combat mid-roll lengthens the roll in real time but does not move
 * `until` — so a slowdown severe/late enough can make the TTL force-deliver before the (now slower) roll
 * finishes, printing the true value a little early instead of the last stretch of the animation. This is
 * still FAIL OPEN — the value shown is the correct true one, just earlier than the roll would have arrived on
 * its own — so it is not an invariant break, only a lost few frames of animation in an edge case (an active
 * mid-roll slowdown, not just a slow *replay*: this constant's own 1/speed division already covers a combat
 * that STARTS slow). Left as a documented gap rather than fixed: closing it properly means re-arming a live
 * hold's `until` without resetting `revealed` (what `holdStat` does) or its schedule (what `claimStat` does
 * without touching TTL) — no existing `fx/statHold.ts` export does that, and that file is off-limits for this
 * task. A same-file workaround (a second, ttlMs-scaling timer chasing the live speed) would just be this exact
 * asymmetry moved one level up, not resolved.
 */
const COMBAT_HOLD_TTL_MS = 2000;

/**
 * How long a unit's OWN on-attack summons are withheld before they slide onto the board — so Errand Fiend's
 * Imps arrive a beat after the swing instead of snapping in at wind-up start (owner ask 2026-08-07). Measured
 * from the instant the attack beat becomes current, and scaled by combat speed at the call site so the lead
 * shrinks with a faster replay. Kept short so the reveal stays well inside the attack beat (always longer than
 * this) — which is what lets the Imp mount while its `summoned` anim is still live and play `summonpop`.
 */
const IMP_SUMMON_LEAD_MS = 300;

/** A live combat unit, folded from the initial snapshot + the event log up to a beat. */
export interface UnitFrame {
  uid: string;
  cardId: string;
  name: string;
  tribe: Tribe;
  attack: number;
  health: number;
  keywords: Keyword[];
  divineShield: boolean;
  alive: boolean;
  /** Rune of Rebirth handed THIS body the exact-copy Echo at Start of Combat. Per-instance on purpose: the
   *  rune picks ONE random friendly minion, so the granted rule belongs on that card and nowhere else. */
  grantedEcho?: boolean;
  /** A DEAD unit kept on the board ONLY to anchor its own still-playing FX (a Deathrattle whose Echo fires a
   *  beat after the body left — Fel Spikes' spike volley). Rendered INVISIBLE, but it holds its slot so the
   *  board doesn't reflow into the gap until the effect finishes. Set by `computeFrame`'s damage-source
   *  retention; never on a live unit. */
  ghost?: boolean;
  golden: boolean;
  /** Live summon-buff bonus (Kennelmaster) — climbs via `improve` events mid-fight. */
  summonBonus: number;
  /** Flowing Monk's flat grant bonus (triple combine) — static; feeds the live card text. */
  overflowBonus?: number;
  /** Crypt Drake: ally attacks seen this combat — drives the live "current buff / N to go" text. */
  attackSeen?: number;
  /** Ashen Heir: stats banked from dead Imps, waiting for the next one (live during the fight). */
  impBank?: { attack: number; health: number };
  /** Avenge units: this side's running FRIENDLY-death tally this combat (drives the "N/threshold" Avenge counter).
   *  Combat-only (set by `computeFrame`); undefined outside a fight → no shop counter. */
  avengeSeen?: number;
  /** Bloodbinder: total GLOBAL attack swings this combat (either side) — drives the Bleed's "N/every" counter. */
  bleedAttacks?: number;
  /** Tara: how many stat-grants have accumulated toward ascension this combat. */
  ascendProgress?: number;
  /** Guel: spells cast while on the run board (seeded from the snapshot) — for the live combat text. */
  spellProgress?: number;
  /** Sergeant: accumulated HP bonus on the Deathrattle (grows each time Sergeant gains Attack). */
  hpGrantBonus?: number;
  /** Ritualist's End-of-Turn grant accrual, Trail Forager's sell bonus, and the cadence End-of-Turn counter
   *  (Frontdrake / Money Maker / Vineweaver) — all seeded from the snapshot purely so the live combat card text
   *  reads the same value the shop shows. (Without carrying these here they were silently dropped, so those cards
   *  reverted to their printed base in combat.) */
  eotBonus?: number;
  sellBonus?: number;
  eotTick?: number;
  /** Thundering Abomination (Engraved): permanent stat gains accrued mid-combat. */
  permaGain?: { attack: number; health: number };
  /** Per-source buff breakdown for the right-click inspect panel: the recruit-phase buffs this minion
   *  entered the fight with (carried in the snapshot), plus the combat `buff` events it gains as the log
   *  folds — merged by source name. Mirrors the shop inspect's breakdown. */
  buffs?: MinionBuff[];
  /** Combat-start stats — the values this unit *entered the fight* with (for tokens, its summon stats).
   *  This is the in-combat baseline for the green/red stat colouring: health below it reads red
   *  (damaged), attack below it reads red (debuffed), above reads green (buffed). It is NOT the printed
   *  card base used in the shop — a buffed 5/5 that drops to 5/3 in combat shows red, not green.
   *  Reset on Reborn (a returned minion is "fresh" at its new stats). */
  baseAttack: number;
  baseHealth: number;
  /** Choose One: the branch this instance became (`BoardCard.chosenOption`) — so the combat card prints only
   *  the option it took, matching the shop. Display-only; carried from the snapshot. */
  chosenOption?: number;
  /** Mage-Pup: the id of the spell it was taught — so the combat card names the spell it casts. Display-only. */
  taughtSpellId?: string;
  /** Sunmane Herald: the live escalating rally grant, so the combat card shows its current value. Display-only. */
  rallySpreadAtk?: number;
}

// Stable empty list for the hand-grant memo — a fresh [] each render would churn every downstream memo.
const EMPTY_GRANTS: string[] = [];

const fromSnap = (s: MinionSnapshot): UnitFrame => ({
  uid: s.uid, cardId: s.cardId, name: s.name, tribe: s.tribe, attack: s.attack, health: s.health,
  keywords: [...s.keywords], divineShield: s.keywords.includes('DS'), alive: true,
  golden: s.golden ?? false, summonBonus: s.summonBonus ?? 0, overflowBonus: s.overflowBonus,
  hpGrantBonus: s.hpGrantBonus, // Sergeant: seed the live combat text from the run-board accrual (frame 1)
  ascendProgress: s.ascendProgress, // Tara: seed the ascend tracker from the run-board total, then count up
  spellProgress: s.spellProgress, // Guel: seed his on-board spell tally for the live combat text
  eotBonus: s.eotBonus, // Ritualist: seed the per-tick grant so the combat text isn't stuck at base
  sellBonus: s.sellBonus, // Trail Forager: seed the accrued sell value for the combat text
  eotTick: s.eotTick, // Frontdrake / Money Maker / Vineweaver: seed the cadence counter for the combat text
  baseAttack: s.attack, baseHealth: s.health, // the stats it entered the fight (or was summoned) with
  chosenOption: s.chosenOption, // Choose One: the combat card prints the branch it became
  taughtSpellId: s.taughtSpellId, // Mage-Pup: the combat card names the spell it was taught
  rallySpreadAtk: s.rallySpreadAtk, // Sunmane Herald: the combat card shows the live escalating rally grant
  // Clone the recruit-buff breakdown so the per-beat fold can merge in combat buffs without mutating the snapshot.
  buffs: s.buffs ? s.buffs.map((b) => ({ ...b })) : undefined,
});

/** Merge one buff into a per-source breakdown (find-and-sum by source, else push) — the combat counterpart
 *  of sim's recruit `bumpBuff`, used to fold `buff` events into a unit's inspect breakdown. */
function recordBuff(buffs: MinionBuff[], source: string, attack: number, health: number): void {
  const e = buffs.find((b) => b.source === source);
  if (e) { e.attack += attack; e.health += health; e.count += 1; }
  else buffs.push({ source, attack, health, count: 1 });
}

/**
 * The cardIds a combat has put in the player's hand as of `beatIdx` — every `toHand` through the beat that
 * is CURRENTLY ON SCREEN. The recruit hand stays the pre-combat hand until `resolveCombat`, so the combat
 * view appends these and the hand grows as the cards arrive.
 *
 * **`beatIdx` is the beat about to play; the one on screen is `beats[beatIdx - 1]`** (see the scheduler's
 * `shown`/`next` split, and `processedEnd` — the same index the live frame folds through). Everything here
 * hangs off that: the card must materialise on the beat whose effect granted it, in lockstep with that
 * unit's trigger-medallion pulse, which is derived from the same `beats[beatIdx - 1]` window.
 *
 * Slicing one beat further (`beats[beatIdx].end`) puts the card in hand a beat BEFORE its own pulse. With two
 * Avenge granters that desynchronises the whole read — the pulses and the coalesces stop pairing up, which is
 * exactly what the owner reported on 2026-07-27. Don't "fix" a late-looking grant by widening this window; if
 * a card seems to arrive only after combat, check first that the effect emits a `toHand` event at all (a
 * DEFERRED economy Battlecry did not, until `replayCombatBattlecry` began announcing named grants).
 */
export function grantsShownThrough(events: CombatEvent[], beats: Beat[], beatIdx: number): string[] {
  const through = beatIdx === 0 ? 0 : (beats[beatIdx - 1]?.end ?? events.length);
  return events.slice(0, through).flatMap((e) => (e.type === 'toHand' ? [e.cardId] : []));
}

/**
 * Fold the event log up to `upto` into the live board state. Deaths from *before*
 * the current beat (index < `beatStart`) are removed outright; a minion dying in
 * the current beat is kept one beat (rendered with its death pop, no grey) so the
 * killing blow reads, then it's gone next beat.
 */
export function computeFrame(
  initial: { player: MinionSnapshot[]; enemy: MinionSnapshot[] },
  events: CombatEvent[],
  upto: number,
  beatStart: number,
  names: Map<string, string>,
): { player: UnitFrame[]; enemy: UnitFrame[] } {
  const player = initial.player.map(fromSnap);
  const enemy = initial.enemy.map(fromSnap);
  // ASHEN HEIR banks a dying Imp's MAX Health, not the 0 it has left after the killing blow — so the replay
  // has to know each body's max. `UnitFrame` doesn't carry one, and adding it would widen a hot per-beat
  // structure for one card, so it is tracked here instead: seeded from the starting/summoned body and grown
  // by every Health buff, which is exactly how the sim's `maxHealth` moves.
  const maxHp = new Map<string, number>();
  for (const u of [...player, ...enemy]) maxHp.set(u.uid, u.health);
  // Per-uid Avenge floors, stamped on Rise — a risen body's counter restarts at 0 (mirrors the sim's
  // `avengeBaseline`; assigned where `avengeSeen` is stamped at the bottom).
  const avengeBase = new Map<string, number>();
  const find = (uid: string) => player.find((u) => u.uid === uid) ?? enemy.find((u) => u.uid === uid);
  const gone = new Set<string>();
  // Running tallies for the live Avenge / Bleed step counters: FRIENDLY deaths per side (a Rise death doesn't count —
  // matches the sim's Avenge gate) and total GLOBAL attack swings (Bloodbinder's Bleed fires every N, either side).
  const deaths: Record<'player' | 'enemy', number> = { player: 0, enemy: 0 };
  let attackCount = 0;
  for (let i = 0; i < Math.min(upto, events.length); i++) {
    const e = events[i];
    if (e.type === 'attack') attackCount++;
    if (e.type === 'dmg') {
      const u = find(e.target);
      if (u) u.health = e.remainingHp;
    } else if (e.type === 'shield') {
      const u = find(e.target);
      if (u) { u.divineShield = false; u.keywords = u.keywords.filter((k) => k !== 'DS'); }
    } else if (e.type === 'shieldUp') {
      const u = find(e.target);
      if (u) { u.divineShield = true; if (!u.keywords.includes('DS')) u.keywords.push('DS'); }
    } else if (e.type === 'poison') {
      const u = find(e.target);
      if (u) u.health = 0;
    } else if (e.type === 'reborn') {
      // Returns at base stats: overwrite attack/health/keywords/shield (not a delta) so the buffed
      // body sheds its combat buffs + granted keywords and the blue Reborn aura drops (no more 'R').
      const u = find(e.target);
      if (u) {
        u.health = e.hp;
        u.attack = e.attack;
        u.keywords = [...e.keywords];
        u.divineShield = e.keywords.includes('DS');
        // A risen body's Avenge restarts (owner ruling 2026-08-08) — the sim stamps its baseline AFTER its
        // own rise-death was tallied, and the reborn event lands after that death here too, so the current
        // side tally IS the baseline. The counter below subtracts it, mirroring `avengeCountFor`.
        avengeBase.set(u.uid, player.includes(u) ? deaths.player : deaths.enemy);
        u.baseAttack = e.attack; // a returned minion is "fresh" — its stats become the new baseline
        u.baseHealth = e.hp;
        u.buffs = undefined; // back at base stats — the old buff breakdown no longer applies
        u.alive = true; // a Rise dies FIRST (a `rise` death precedes this) → bring the body back to life…
        gone.delete(e.target); // …and un-remove it if that death landed in an earlier beat
        // Re-slot to the RIGHT of `after` — the token its Deathrattle summoned into its old slot — so the
        // risen body returns to that token's right (mirrors the sim's board move). No `after` → it stays put.
        if (e.after) {
          const arr = player.includes(u) ? player : enemy;
          const from = arr.indexOf(u);
          if (from >= 0) {
            arr.splice(from, 1);
            const anchor = arr.findIndex((x) => x.uid === e.after);
            arr.splice(anchor >= 0 ? anchor + 1 : arr.length, 0, u);
          }
        }
      }
    } else if (e.type === 'reveal') {
      const u = find(e.target);
      if (u) u.keywords = u.keywords.filter((k) => k !== 'ST'); // Stealth lost on attack
    } else if (e.type === 'sc' && e.grantsEcho) {
      // Rune of Rebirth's Start-of-Combat pick. From this beat on, THIS card prints the Echo it was handed —
      // the rune grants it to one random friendly minion, so tagging every minion the player controls (which
      // is what the run-flag-driven text did) claimed a rule 6 of 7 bodies do not have.
      const u = find(e.source);
      if (u) u.grantedEcho = true;
    } else if (e.type === 'keyword') {
      // A combat effect granted a keyword (Mumi → Rise, a Ryme-replayed keyword battlecry) — the
      // pill appears on the card from this beat on. DS also raises the shield flag (bubble).
      const u = find(e.target);
      if (u && !u.keywords.includes(e.keyword)) {
        u.keywords = [...u.keywords, e.keyword];
        if (e.keyword === 'DS') u.divineShield = true;
      }
    } else if (e.type === 'keywordLost') {
      // A combat effect STRIPPED a keyword (Tauntbreaker → Taunt/Rise off the enemy it hit) — drop the pill.
      const u = find(e.target);
      if (u) u.keywords = u.keywords.filter((k) => k !== e.keyword);
    } else if (e.type === 'venomLost') {
      const u = find(e.target);
      if (u) u.keywords = u.keywords.filter((k) => k !== 'V'); // Venomous spent on its first proc
    } else if (e.type === 'death') {
      const u = find(e.target);
      if (u) { u.alive = false; u.health = 0; }
      // ASHEN HEIR's bank, re-derived from the log exactly the way Crypt Drake's `attackSeen` is. The sim banks
      // a dying friendly Imp's stats onto each friendly Heir, and empties the bank when an Imp arrives — both
      // halves are mirrored here (the summon half below) so the Heir's printed text can show what the NEXT Imp
      // would actually inherit. Nothing new crosses the event boundary; the replay just applies the same rule.
      if (u && CARD_INDEX[u.cardId]?.imp) {
        // `u.health` is already 0 by now, so the banked Health comes from the max-Health track — the Heir
        // passes on what the Imp WAS, which is the `maxHealth` the sim read.
        const arr = e.side === 'player' ? player : enemy;
        const banked = { attack: Math.max(0, u.attack), health: Math.max(0, maxHp.get(e.target) ?? 0) };
        // Only a death with NO living Imp left to receive it reaches the bank — otherwise the stats went
        // straight to that Imp as a normal buff event, which the replay already applies. Mirrors the sim's
        // rule exactly; a mirror that banked unconditionally would show a bank the fight doesn't have.
        const anyImpAlive = arr.some((m) => m !== u && m.alive && CARD_INDEX[m.cardId]?.imp);
        if (!anyImpAlive && (banked.attack > 0 || banked.health > 0)) {
          for (const h of arr) if (h.cardId === 'ashen_heir' && h.alive) {
            h.impBank = { attack: (h.impBank?.attack ?? 0) + banked.attack,
              health: (h.impBank?.health ?? 0) + banked.health };
          }
        }
      }
      // A RISE death counts (owner ruling 2026-07-27, and `killOrReborn` in the sim calls `emitAvenge` for it).
      // This skipped `e.rise`, so the DISPLAYED Avenge counter disagreed with the tally that actually fires the
      // effect — a Kennelmaster/Solaris behind a Rise minion looked stuck while its Avenge really was advancing
      // (owner report 2026-07-29). The replay must mirror the sim, not hold its own older rule.
      if (e.side === 'player' || e.side === 'enemy') deaths[e.side] += 1; // friendly-death tally → Avenge counter
      if (i < beatStart) gone.add(e.target);
    } else if (e.type === 'buff') {
      const u = find(e.target);
      if (u) {
        u.attack += e.attack;
        u.health += e.health;
        if (e.health > 0) maxHp.set(u.uid, (maxHp.get(u.uid) ?? u.health) + e.health); // Ashen Heir's max-Health track
        // Itemize the buff under its source for the inspect panel (combat buffs merge alongside recruit ones).
        if (e.attack !== 0 || e.health !== 0) {
          u.buffs ??= [];
          // A source is EITHER a minion uid (resolved through `names`) or an authored label a rune passed in
          // ("Rune of Savagery"). Collapsing the second kind to 'Combat' hid which rune granted what — every
          // rune buff read as anonymous in the inspect panel. Combat uids are `m<n>` / `e<n>`, so anything
          // that doesn't match that shape is a label and is kept verbatim.
          const isUid = /^[me]\d+$/.test(e.source ?? '');
          recordBuff(u.buffs, names.get(e.source) ?? (!isUid && e.source ? e.source : 'Combat'), e.attack, e.health);
        }
        // Tara: tally stat-grants on minions with ascendAt toward their ascend threshold.
        if ((e.attack !== 0 || e.health !== 0) && CARD_INDEX[u.cardId]?.ascendAt) {
          u.ascendProgress = (u.ascendProgress ?? 0) + 1;
        }
        // Thundering Abomination (EG): accumulate permanent stat gains for live card text.
        if (u.keywords.includes('EG') && (e.attack !== 0 || e.health !== 0)) {
          u.permaGain = {
            attack: (u.permaGain?.attack ?? 0) + e.attack,
            health: (u.permaGain?.health ?? 0) + e.health,
          };
        }
      }
      // Crypt Drake: detect its self-buff (source === target, attack > 0) to count ally-attack triggers.
      // Its onAllyAttackBuffAll buffs all friends including itself — this event is uniquely self-sourced.
      if (e.source === e.target && e.attack > 0) {
        const src = find(e.source);
        if (src?.cardId === 'cryptdrake') src.attackSeen = (src.attackSeen ?? 0) + 1;
      }
    } else if (e.type === 'hpGrant') {
      const u = find(e.target);
      if (u) u.hpGrantBonus = e.amount; // Sergeant: absolute cumulative HP-grant bonus → live card text
    } else if (e.type === 'spellProgress') {
      const u = find(e.target);
      if (u) u.spellProgress = e.amount; // Archmagus Guel: on-board spell tally after a combat cast → live countdown
    } else if (e.type === 'improve') {
      const u = find(e.target);
      if (u) u.summonBonus += e.amount; // Kennelmaster's aura climbs mid-fight → live card text
    } else if (e.type === 'summon') {
      const arr = e.side === 'player' ? player : enemy;
      arr.splice(Math.min(e.index, arr.length), 0, fromSnap(e.minion));
      maxHp.set(e.minion.uid, e.minion.health);
      // Ashen Heir, the paying half: an arriving Imp inherits the bank, so the bank empties (see the death branch).
      if (CARD_INDEX[e.minion.cardId]?.imp) {
        for (const h of arr) if (h.cardId === 'ashen_heir' && h.alive) h.impBank = undefined;
      }
    } else if (e.type === 'ascend') {
      // A mid-combat transform (Tara → Taragosa, Spirit Pup → Spirit Worgen): adopt the new form's identity so
      // the card's art / name / tribe / rule text / new-form keyword pills update live, exactly as the sim does
      // in `ascendMinion` (the stat buffs keep landing on the same uid via `buff` events). Without this the card
      // kept its pre-ascension face for the rest of the replay.
      const u = find(e.target);
      const def = CARD_INDEX[e.into];
      if (u && def) {
        u.cardId = e.into;
        u.name = def.name;
        u.tribe = def.tribe;
        for (const k of def.keywords) if (!u.keywords.includes(k)) u.keywords.push(k);
        if (def.keywords.includes('DS')) u.divineShield = true;
      }
    }
  }
  // Stamp the live step-counter tallies onto every frame: each unit sees its OWN side's death count (Avenge) and
  // the global attack count (Bleed). stepProgress only reads these for the qualifying cards; others ignore them.
  for (const u of player) { u.avengeSeen = deaths.player - (avengeBase.get(u.uid) ?? 0); u.bleedAttacks = attackCount; }
  for (const u of enemy) { u.avengeSeen = deaths.enemy - (avengeBase.get(u.uid) ?? 0); u.bleedAttacks = attackCount; }
  // Keep a DEAD unit on screen for the beat in which it is still DEALING damage — a Deathrattle whose Echo
  // sprays the board (Fel Spikes) fires its volley one beat AFTER its body would have left, and a source→target
  // FX anchored to that body needs it present to launch from. Only the CURRENT beat's damage ([beatStart, upto))
  // counts, so the body lingers exactly for its own eruption and is gone the next beat. Sourceless damage (no
  // `source`) retains nothing, so ordinary trades and the resting end-frame (beatStart === upto → empty window)
  // are untouched.
  const dealingSources = new Set<string>();
  for (let i = beatStart; i < Math.min(upto, events.length); i++) {
    const e = events[i];
    if (e?.type === 'dmg' && typeof e.source === 'string') dealingSources.add(e.source);
  }
  const keep = (u: UnitFrame): boolean => {
    if (!gone.has(u.uid)) return true;
    if (dealingSources.has(u.uid)) { u.ghost = true; return true; } // kept ONLY to anchor its own FX → invisible
    return false;
  };
  return { player: player.filter(keep), enemy: enemy.filter(keep) };
}

// Per-beat lengths (ms) + the global tempo baseline + float/hold lifetimes all live in `choreo/choreoConfig.ts`,
// live-tunable via the DEV Pacing tuner. The beat clock's hold formula lives in the pure `holdMs`
// (`choreo/clock.ts`) — it reads choreoConfig by primary event type each beat, so retuning applies to the
// next beat, and welds the `attack` (wind-up) beat to the lunge connection time (from lungeConfig.ts) so the
// damage float always lands ON contact, independent of pacing.

/** The transient animation class for the unit the active event acts on. */
function animFor(e: CombatEvent | undefined): Record<string, string> {
  if (!e) return {};
  switch (e.type) {
    case 'attack': return { [e.attacker]: 'attacking', [e.defender]: 'aimed' };
    case 'dmg': return { [e.target]: 'struck' };
    case 'shield': return { [e.target]: 'shatter' };
    case 'shieldUp': return { [e.target]: 'shieldgain' };
    case 'poison': return { [e.target]: 'poisoned' };
    case 'venomLost': return { [e.target]: 'venomspent' };
    case 'reborn': return { [e.target]: 'reborn' };
    case 'buff': return { [e.target]: 'buffed' };
    case 'improve': return { [e.target]: 'buffed' };
    case 'keyword': return { [e.target]: 'buffed' }; // a granted keyword pulses like a buff landing
    case 'keywordLost': return { [e.target]: 'struck' }; // a stripped keyword flinches like a hit
    case 'maxGold': return { [e.target]: 'goldproc' };
    case 'sc': return e.cast ? { [e.source]: 'sccast' } : {}; // only a genuine SoC cast flashes; narration (spell power, etc.) is silent
    case 'death': return { [e.target]: 'dying' };
    case 'summon': return { [e.minion.uid]: 'summoned' };
    case 'rally': return { [e.source]: 'sccast', [e.target]: 'flare' }; // Deathsayer pulses; the Deathrattle minion flares
    case 'shout': return { [e.target]: 'sccast' }; // the Shout's owner flashes as it fires; the re-trigger source pulses per proc from `onShoutProc`
    case 'ascend': return { [e.target]: 'ascendpop' }; // transform: the new card pops in under the flash bloom (fired by onAscend)
    case 'reveal': return { [e.target]: 'revealed' }; // Stealth breaks (unit attacks) → a quick de-cloak shimmer into full view
    default: return {};
  }
}

/** Verbose narration for the Combat Log — every event spelled out, with damage and the
 *  defender's remaining Health, tagged by kind so the overlay can colour each line. */
function narrateLog(e: CombatEvent, names: Map<string, string>): { text: string; kind: string } | null {
  const n = (uid: string): string => names.get(uid) ?? 'a minion';
  switch (e.type) {
    case 'sc': return { text: e.text, kind: 'sc' };
    case 'attack': return { text: `${n(e.attacker)} strikes ${n(e.defender)} for ${e.swing}.`, kind: 'attack' };
    case 'dmg': return { text: `${n(e.target)} takes ${e.amount} damage (${Math.max(0, e.remainingHp)} HP left).`, kind: 'dmg' };
    case 'shield': return { text: `${n(e.target)}'s Ward absorbs the hit.`, kind: 'shield' };
    case 'shieldUp': return { text: `${n(e.target)} gains a Ward.`, kind: 'shield' };
    case 'poison': return { text: `Execute destroys ${n(e.target)}.`, kind: 'poison' };
    case 'venomLost': return { text: `${n(e.target)}'s Execute is spent.`, kind: 'poison' };
    case 'reborn': return { text: `${n(e.target)} rises at ${e.hp} HP.`, kind: 'reborn' };
    case 'reveal': return { text: `${n(e.target)} breaks Stealth.`, kind: 'reveal' };
    case 'death': return { text: `${n(e.target)} is destroyed.`, kind: 'death' };
    case 'summon': return { text: `${e.minion.name} (${e.minion.attack}/${e.minion.health}) is summoned.`, kind: 'summon' };
    case 'buff': return { text: `${n(e.target)} grows +${e.attack}/+${e.health}.`, kind: 'buff' };
    case 'improve': { const d = e.display ?? e.amount; return d > 0 ? { text: `${n(e.target)}'s effect improves by ${d}.`, kind: 'buff' } : null; }
    case 'keyword': return { text: `${n(e.target)} gains ${KW_FLOAT[e.keyword] ?? e.keyword}${e.source ? ` from ${n(e.source)}` : ''}.`, kind: 'buff' };
    case 'keywordLost': return { text: `${n(e.target)} loses ${KW_FLOAT[e.keyword] ?? e.keyword}${e.source ? ` to ${n(e.source)}` : ''}.`, kind: 'dmg' };
    case 'maxGold': return { text: `${n(e.target)}'s Avenge raises your max Gold by ${e.amount}.`, kind: 'buff' };
    case 'rally': return { text: `${n(e.source)}'s Rally triggers ${n(e.target)}'s Echo.`, kind: 'sc' };
    case 'shout': return { text: `${n(e.source)} triggers ${n(e.target)}'s Shout.`, kind: 'sc' };
    case 'toHand': return { text: `${cardName(e.cardId)} is added to your hand.`, kind: 'summon' };
    default: return null;
  }
}

function narrate(e: CombatEvent, names: Map<string, string>): string | null {
  const n = (uid: string) => names.get(uid) ?? 'a minion';
  switch (e.type) {
    case 'sc': return e.text;
    case 'attack': return `${n(e.attacker)} strikes ${n(e.defender)}.`;
    case 'shield': return 'A Ward absorbs the blow!';
    case 'shieldUp': return `${n(e.target)} gains a Ward.`;
    case 'poison': return `Execute! ${n(e.target)} is destroyed.`;
    case 'reborn': return `${n(e.target)} rises at 1 Health.`;
    case 'death': return `${n(e.target)} falls.`;
    case 'summon': return `${e.minion.name} joins the fray.`;
    case 'buff': return `${n(e.target)} grows +${e.attack}/+${e.health}.`;
    case 'improve': { const d = e.display ?? e.amount; return d > 0 ? `${n(e.target)}'s effect improves (+${d}).` : null; }
    case 'keyword': return `${n(e.target)} gains ${KW_FLOAT[e.keyword] ?? e.keyword}!`;
    case 'keywordLost': return `${n(e.target)} loses ${KW_FLOAT[e.keyword] ?? e.keyword}!`;
    case 'maxGold': return `${n(e.target)} raises your max Gold by ${e.amount}!`;
    case 'rally': return `${n(e.source)}'s Rally fires ${n(e.target)}'s Echo!`;
    case 'shout': return `${n(e.source)} triggers ${n(e.target)}'s Shout!`;
    case 'toHand': return `${cardName(e.cardId)} is added to your hand.`;
    default: return null;
  }
}

/** A per-source proc report for the "Procs" tab — who triggered what, and how many times. Reads
 *  attribution off the events: `rally` (source → the Deathrattle it fired), `toHand`/`summon`/`buff`
 *  carry their producing minion's uid. So you get lines like "Deathsayer → Arcane Weaver's Deathrattle
 *  — 1×" and "Arcane Weaver → Spirit Fire — 2×". Headers are tagged kind `head`. */
function procReport(events: CombatEvent[], names: Map<string, string>): { text: string; kind: string }[] {
  const n = (uid: string): string => names.get(uid) ?? uid;
  const inc = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1);
  let attacks = 0, dmg = 0, deaths = 0, reborn = 0, poison = 0, shieldUp = 0, shieldBreak = 0;
  const rally = new Map<string, number>();
  const shout = new Map<string, number>(); // a Shout re-fire, per source → owner pair (× Drakko fires)
  const generated = new Map<string, number>();
  const summoned = new Map<string, number>();
  const startCombat = new Map<string, number>(); // Start-of-Combat effects that fired (by source)
  const buffs = new Map<string, { n: number; atk: number; hp: number }>();
  const maxGold = new Map<string, { n: number; total: number }>(); // Soulsman's Avenge → max Gold raised
  for (const e of events) {
    if (e.type === 'attack') attacks++;
    else if (e.type === 'dmg') dmg += e.amount;
    else if (e.type === 'death' && !e.rise) deaths++; // a Rise's death isn't a kill — the body returns
    else if (e.type === 'reborn') reborn++;
    else if (e.type === 'poison') poison++;
    else if (e.type === 'shieldUp') shieldUp++;
    else if (e.type === 'shield') shieldBreak++;
    else if (e.type === 'rally') inc(rally, `${n(e.source)} → ${n(e.target)}'s Echo`);
    else if (e.type === 'shout') inc(shout, `${n(e.source)} → ${n(e.target)}'s Shout`);
    else if (e.type === 'sc') inc(startCombat, n(e.source));
    else if (e.type === 'toHand') inc(generated, e.source ? `${n(e.source)} → ${cardName(e.cardId)}` : cardName(e.cardId));
    else if (e.type === 'summon') {
      inc(summoned, e.source ? `${n(e.source)} → ${e.minion.name}` : e.minion.name);
    }
    else if (e.type === 'buff') {
      const k = n(e.source);
      const t = buffs.get(k) ?? { n: 0, atk: 0, hp: 0 };
      t.n++; t.atk += e.attack; t.hp += e.health;
      buffs.set(k, t);
    }
    else if (e.type === 'maxGold') {
      const k = n(e.target);
      const t = maxGold.get(k) ?? { n: 0, total: 0 };
      t.n++; t.total += e.amount;
      maxGold.set(k, t);
    }
  }
  const out: { text: string; kind: string }[] = [];
  out.push({ text: `${attacks} attacks · ${dmg} damage dealt · ${deaths} deaths`, kind: 'total' });
  const kw: string[] = [];
  if (shieldUp) kw.push(`${shieldUp} Wards gained`);
  if (shieldBreak) kw.push(`${shieldBreak} Wards broken`);
  if (poison) kw.push(`${poison} Execute kills`);
  if (reborn) kw.push(`${reborn} rises`);
  if (kw.length) out.push({ text: kw.join(' · '), kind: 'total' });
  if (startCombat.size) { out.push({ text: 'Start of Combat', kind: 'head' }); for (const [k, c] of startCombat) out.push({ text: c > 1 ? `${k} — ${c}×` : k, kind: 'sc' }); }
  if (rally.size) { out.push({ text: 'Rally', kind: 'head' }); for (const [k, c] of rally) out.push({ text: `${k} — ${c}×`, kind: 'rally' }); }
  if (shout.size) { out.push({ text: 'Shout', kind: 'head' }); for (const [k, c] of shout) out.push({ text: `${k} — ${c}×`, kind: 'sc' }); }
  if (generated.size) { out.push({ text: 'Cards generated', kind: 'head' }); for (const [k, c] of generated) out.push({ text: `${k} — ${c}×`, kind: 'summon' }); }
  if (summoned.size) { out.push({ text: 'Summoned', kind: 'head' }); for (const [k, c] of summoned) out.push({ text: `${k} — ${c}×`, kind: 'summon' }); }
  if (buffs.size) { out.push({ text: 'Buffs', kind: 'head' }); for (const [k, t] of buffs) out.push({ text: `${k} — ${t.n}× (+${t.atk}/+${t.hp})`, kind: 'buff' }); }
  if (maxGold.size) { out.push({ text: 'Max Gold', kind: 'head' }); for (const [k, t] of maxGold) out.push({ text: `${k} — +${t.total} (${t.n}×)`, kind: 'buff' }); }
  return out;
}

export interface CombatReplay {
  /** The TRUTH board at the current beat. Use this for anything that counts or measures (the loss-damage
   *  survivor tally) — it includes units an effect is still withholding. */
  frame: { player: UnitFrame[]; enemy: UnitFrame[] };
  /** The board as it should be DRAWN: `frame` minus anything `fx/summonHold.ts` is holding back so an
   *  effect can deliver it. Identical to `frame` (by identity) whenever nothing is held, which is every
   *  fight without a bound Rally. Render from this; never count from it. */
  visibleFrame: { player: UnitFrame[]; enemy: UnitFrame[] };
  anims: Record<string, string>;
  lungeUid: string | null;
  projectiles: { id: number; x: number; y: number; dx: number; dy: number; kind?: string }[];
  /** ALL live combat floats, each carrying the anchor box captured at spawn. Rendered in a board-level
   *  overlay (`.floatanchor`) rather than inside the `.unit`, so their z-index is globally comparable and the
   *  numbers sit ABOVE the Pixi FX canvas in every unit state — see `choreo/channels/float.ts`. */
  floats: Float[];
  /** Damage floats for units that died this beat — rendered in a board-level overlay (their unit collapses
   *  + is removed), positioned at the captured screen coords so the killing-blow number reads + lingers. */
  deathFloats: DeathFloat[];
  log: string;
  /** The whole fight narrated in detail (every attack, hit, shield, death…) for the
   *  post-combat Combat Log — each line tagged with its kind for styling. */
  fullLog: { text: string; kind: string }[];
  /** Per-source proc report for the "Procs" tab (who triggered what, how many times). */
  procs: { text: string; kind: string }[];
  /** A card a combat effect just granted to the hand, shown flying to the hand (null when none). */
  handGrant: { cardId: string; key: number } | null;
  /** Card ids granted to the hand so far in the replay — appended to the combat hand so it grows live. */
  handGrantsShown: string[];
  /** uids whose effect fired in the current window — their trigger medallion pulses. */
  triggerUids: Set<string>;
  /** uid → a per-fire nonce for units mid-Rally (used as the medallion `key` so each pulse restarts). */
  rallyPulseUids: Map<string, number>;
  /** uid → a per-fire nonce for watchers (units, other than the attacker, that fired an effect on an
   *  attack beat) — the medallion `key` so each light-blue pulse restarts. */
  watcherPulseUids: Map<string, number>;
  /** uid → a per-fire nonce for the watcher's card-frame bloom (CSS fallback when the Pixi def can't play). */
  framePulseUids: Map<string, number>;
  done: boolean;
  result: CombatResult['result'] | null;
  shaking: boolean;
  critShaking: boolean;
  beatCount: number;
  /** Enemy minions killed so far in the replay (up to the current beat) — drives Cassen's live counter. */
  enemyDeaths: number;
  /** Run-buff gains telegraphed so far this fight (spell power, max Gold) — drives the live Buffs window. */
  combatBuffs: CombatBuffDelta;
  /** Combat quest progress landed so far this fight (up to the replayed beat) — quest nodes tick live off it. */
  questDelta: CombatQuestDelta;
  /** Badge id → times its combat effect has fired so far this fight; each bump pulses the node once. */
  triggeredQuests: Record<string, number>;
  /** Quest ids that COMPLETED mid-replay — QuestBadges renders + lights these before the quest formally settles. */
  completedQuests: string[];
  skip: () => void;
  /**
   * DEV (proc harness): jump the replay to `index`, clearing per-beat transient state as a fresh fight would,
   * then continue forward on the normal clock.
   *
   * **Follows the hook's index convention:** `beatIdx = N` is the moment ABOUT TO PLAY, and the one on screen
   * is `beats[N - 1]`. So `seekTo(N)` does not "show moment N" — it plays *into* moment N, which is what you
   * want when the point is to watch that moment's effect fire. The corollary is worth stating outright,
   * because it surprises: since every cue effect renders `beats[beatIdx - 1]`, `seekTo(N)` immediately
   * replays moment **N−1**'s cues and only reaches N one hold later. To put moment N's effect on screen
   * right now, seek to `N + 1`.
   *
   * Re-seeking the index you are already on replays it (a seek nonce drives the cue effects, since `beatIdx`
   * itself would not change). The index is clamped to `beats.length - 1`, so the last moment can be played
   * into but can never be the resting displayed state — that is `beatIdx === beats.length`, what `skip`
   * produces.
   *
   * Safe for any index because the board is a pure fold of `(initial, events, upto)` — see
   * `computeFrame.purity.test.ts`, which exists to keep that true.
   */
  seekTo: (index: number) => void;
}

/** Death read-lead (ms, at 1× speed) held BEFORE a death's on-screen CONSEQUENCE so the death reads FIRST and
 *  there's a breath of empty slot before the consequence lands — instead of the token/returned body appearing
 *  the instant the body clears (which reads as rushed). Three consequences get a lead:
 *   - **Deathrattle → summon** (`DR_SUMMON_LEAD`): the bone-skull pops (`DR_POP_MS` 320) + holds + poofs
 *     (~600ms; embers ~800ms) before its tokens appear.
 *   - **Rise → reborn** (`REBORN_LEAD`): the `.dying.rising` body fully fades before it re-forms.
 *   - **Deathrattle → buff** (`DR_BUFF_LEAD`): the OPPOSITE problem to the two above. A buffing Deathrattle's
 *     beat is a `buffWave`, whose base hold is only `beatDelay('buff')` 140 × 1.5 = **210ms** — but a dead
 *     buffer is `sourceless` (see `isDeathrattleBufferCard`) so its FX is a DESCEND: `dropMs` 340 to land,
 *     then the stat-hold releases and the badge flashes 360ms ⇒ **~700ms of read**. Without a lead the beat
 *     tore down mid-flight, dropping the stat holds so the target's numbers SNAPPED instead of landing with
 *     the descend. Note this is the one lead that makes a beat LONGER than its animation would otherwise get,
 *     rather than holding a consequence back.
 *  An ATTACKER that died mid-lunge is first pulled home (~0.34s, see runRiseReturn / `.dr.returning`), so its
 *  skull/fade starts later — hence the higher `attacker` figure. The lead is layered ON TOP of the generic
 *  `overlapMs` (which alone measured the consequence from the IMPACT's start, landing it on top of the FX).
 *  Returns 0 for any other transition. */
const DR_SUMMON_LEAD = { defender: 800, attacker: 1150 }; // Deathrattle death → its summoned tokens
const REBORN_LEAD = { defender: 800, attacker: 1150 };    // Rise death → the body returning
const DR_BUFF_LEAD = { defender: 500, attacker: 500 };    // Deathrattle death → its buff descend (+210 base ⇒ ~710ms)
/**
 * A unit's LAYOUT-frame centre + footprint: its live rect with any in-flight GSAP transform divided back out.
 *
 * `getBoundingClientRect()` reports where a card is *right now* — including a lunge, a knockback recover, or a
 * dying attacker's pull-home. FX that MARK a unit (a burst, a pulse, a dust poof, a shatter) must land at the
 * unit's SLOT, because that is where the card lives and returns to; anchoring them to a mid-flight position
 * paints them over empty board. That was the proven root cause of the "phantom mid-board ring" (owner clip
 * 2026-07-21): the death moment's damage burst fired at a dying attacker's mid-pull-home rect and masqueraded
 * as a misplaced strike ring through three wrong fixes. Every unit-marking FX now measures through here so the
 * next one can't regress the same way.
 *
 * `w`/`h` are de-scaled too — a card measured mid-wind-up is inflated by `windupScale`, which would otherwise
 * over-size footprint-driven FX (the summon dust, the aura shatter).
 *
 * NOT for: the attack vector in `runAttackExchangeCues` (the engine does its own layout-frame correction —
 * correcting here too would double it), and not for the buff tendril's endpoints (a *travelling* FX drawn
 * between two cards, where anchoring to the visible card is defensible — left as its own call).
 */
export function layoutRectOf(el: Element): { cx: number; cy: number; w: number; h: number } {
  const r = el.getBoundingClientRect();
  const sx = Number(gsap.getProperty(el, 'scaleX')) || 1;
  const sy = Number(gsap.getProperty(el, 'scaleY')) || 1;
  return {
    cx: r.left + r.width / 2 - (Number(gsap.getProperty(el, 'x')) || 0),
    cy: r.top + r.height / 2 - (Number(gsap.getProperty(el, 'y')) || 0),
    w: r.width / sx,
    h: r.height / sy,
  };
}

function deathConsequenceLead(
  shown: Moment | undefined,
  next: Moment,
  events: CombatEvent[],
  cardIds: Map<string, string>,
  attackerUid: string | null,
): number {
  if (!shown) return 0;
  const summon = next.primary.type === 'summon';
  const reborn = next.primary.type === 'reborn';
  const buff = next.primary.type === 'buff';
  if (!summon && !reborn && !buff) return 0;
  let lead = 0;
  for (let i = shown.start; i < shown.end; i++) {
    const e = events[i];
    if (e?.type !== 'death') continue;
    if (reborn) {
      // A Rise's death (`rise:true`) → hold the body's return until its fade has read.
      if (!e.rise) continue;
      lead = Math.max(lead, e.target === attackerUid ? REBORN_LEAD.attacker : REBORN_LEAD.defender);
      continue;
    }
    // summon | buff — only a Deathrattle's OWN consequence waits on its skull/descend. A plain summon (a SoC
    // token) or an unrelated buff wave that merely follows a death doesn't.
    if (!CARD_INDEX[cardIds.get(e.target) ?? '']?.effects?.some((f) => f.on === 'onDeath')) continue;
    const table = summon ? DR_SUMMON_LEAD : DR_BUFF_LEAD;
    lead = Math.max(lead, e.target === attackerUid ? table.attacker : table.defender);
  }
  return lead;
}

/** A PLAIN attacker death (no Rise / Deathrattle consequence to lead the hold) still gets pulled back to its
 *  slot before it dies (`runRiseReturn` + `.dying.returning`), so hold this beat long enough for the ~0.34s
 *  pull-home + the collapse to read in the unit's own slot — otherwise the base beat hold unmounts the body
 *  mid-pull and the return is cut. Only when the SHOWN beat contains the impact attacker's death; the Rise
 *  case already gets a (larger) consequence lead, so the caller takes the max.
 *
 *  Two figures, because the two `returning` variants have different CSS timelines (see styles.css):
 *   - **Deathrattle** (`.dying.dr.returning`): the skull fires at `landed` and needs ~0.38s to pop+burst before
 *     the slot may reflow → fade 0.6s→0.92s, collapse 0.72s→1.04s. Hold must cover 1.04s.
 *   - **Plain** (`.dying.returning`): nothing to read after landing, so the fade starts AS IT LANDS →
 *     fade 0.36s→0.68s, collapse 0.48s→0.80s. Holding the DR figure here parked a landed, fully-faded card
 *     for ~250ms of dead air on every ordinary trade. */
const PULL_HOME_HOLD_DR = 1050;   // ms (pre-speed): pull-home + skull read + the soft fade at home (collapse ends ~1.04s)
// NB leads are ADDED to the base hold, so this is 500 + 550 = 1050ms after contact. A plain attacker death
// fires NO Pixi FX (burstDeathAuras is gated on isRise, the skull on hasDR) — unlike the Rise/DR cases there
// is no debris to outlive the fade. Its collapse ends at 800ms, so the binding constraint is the 1000ms
// deathFloat over the body, not the animation. Was 850 (⇒1350ms, ~350ms of dead air past the float).
const PULL_HOME_HOLD_PLAIN = 550;
function pulledHomeAttackerHold(
  shown: Moment | undefined,
  attackerUid: string | null,
  events: CombatEvent[],
  cardIds: Map<string, string>,
): number {
  if (!shown || !attackerUid) return 0;
  for (let i = shown.start; i < shown.end; i++) {
    const e = events[i];
    if (e?.type === 'death' && e.target === attackerUid) {
      const hasDR = !!CARD_INDEX[cardIds.get(attackerUid) ?? '']?.effects?.some((f) => f.on === 'onDeath');
      return hasDR ? PULL_HOME_HOLD_DR : PULL_HOME_HOLD_PLAIN;
    }
  }
  return 0;
}

// ── PROJECTILE-DELIVERED ECHO (Fel Spikes) ──────────────────────────────────────────────────────────────
// A `launchOnDeath` binding (see `choreo/bindings`) fires its spike VOLLEY from the dying body a beat before
// its Echo damage lands, and the damage beat is HELD (a travel lead) so the numbers/health/kills land when the
// spikes connect. These three pure helpers answer the questions the death handler + the beat clock ask.

/** The ms into `defId` at which its impact reaches the TARGET — the largest `at` among its target-anchored
 *  layers. Drives the damage beat's travel lead, derived from the def so retuning the beam keeps them in sync.
 *  0 if the def has no target layers (nothing to wait for). */
function projectileImpactMs(defId: string): number {
  const def = getDef(defId);
  if (!def) return 0;
  let at = 0;
  for (const l of def.layers) if (l.anchor === 'target') at = Math.max(at, l.at ?? 0);
  return at;
}

/** Every `wave` that `dyingUid` sprays after `startIdx` (up to `endIdx`, exclusive), each with the distinct
 *  units it struck (damaged OR ward-blocked). A `dmg` carries its source; a `shield` (ward pop) belongs to the
 *  wave by its shared wave id. Golden Fel Spikes sprays twice → two entries, in order; a normal one → a single
 *  entry. `endIdx` bounds the scan to ONE trigger burst — a death-fired spray scans to the end (the body sprays
 *  once), but a forced trigger (Echohorn, alive) fires repeatedly, so each rally passes the NEXT rally as its
 *  `endIdx` to claim only its own waves. */
export function echoWaves(events: CombatEvent[], dyingUid: string, startIdx: number, endIdx: number = events.length): { uids: string[]; wave: number }[] {
  const mine = new Set<number>();
  for (let j = startIdx + 1; j < endIdx; j++) {
    const ev = events[j];
    if (ev?.wave !== undefined && ev.type === 'dmg' && ev.source === dyingUid) mine.add(ev.wave);
  }
  if (mine.size === 0) return [];
  const byWave = new Map<number, { uids: string[]; seen: Set<string> }>();
  const order: number[] = [];
  for (let j = startIdx + 1; j < endIdx; j++) {
    const ev = events[j];
    if (ev?.wave === undefined || !mine.has(ev.wave)) continue;
    if (ev.type !== 'dmg' && ev.type !== 'shield') continue;
    const t = ev.target;
    if (typeof t !== 'string') continue;
    let entry = byWave.get(ev.wave);
    if (!entry) { entry = { uids: [], seen: new Set() }; byWave.set(ev.wave, entry); order.push(ev.wave); }
    if (!entry.seen.has(t)) { entry.seen.add(t); entry.uids.push(t); }
  }
  return order.map((w) => ({ uids: byWave.get(w)!.uids, wave: w }));
}

/** How many DISTINCT units the wave `wave` of `dyingUid`'s spray dealt actual DAMAGE to — i.e. a `dmg` event, so
 *  a damage number fires. Ward-absorbed strikes (a `shield` pop, no number) are excluded on purpose. The land cue
 *  gates on this being > 0 — one play per volley, silent for a fully ward-absorbed one (owner ask 2026-08-22).
 *  Same `[startIdx, endIdx)` bounds as {@link echoWaves}. */
export function echoWaveDamagedCount(events: CombatEvent[], dyingUid: string, wave: number, startIdx: number, endIdx: number = events.length): number {
  const seen = new Set<string>();
  for (let j = startIdx + 1; j < endIdx; j++) {
    const e = events[j];
    if (e?.type === 'dmg' && e.wave === wave && e.source === dyingUid && typeof e.target === 'string') seen.add(e.target);
  }
  return seen.size;
}

/**
 * A beat of stillness before a PARKED attacker commits its swing (owner ask 2026-09-01).
 *
 * Returns 0 unless `next` carries the parked attacker's own damage — so an ordinary swing, and every beat of
 * the Echo in between, are untouched. `parkedCommitRef` is written by the park and cleared by its release.
 */
function parkedCommitLead(next: Moment, events: CombatEvent[]): number {
  const held = parkedCommitRef.uid;
  if (!held) return 0;
  for (let i = next.start; i < next.end; i++) {
    const e = events[i];
    if (e?.type === 'dmg' && e.source === held && e.wave === undefined) return PARKED_COMMIT_LEAD_MS;
  }
  return 0;
}

/** How long a parked attacker sits still after its Echo finishes, before its own swing lands. */
const PARKED_COMMIT_LEAD_MS = 260;

/** Who is currently parked, for `parkedCommitLead`. Module-scoped so the lead helper can sit beside its
 *  siblings instead of the beat effect threading a ref through every one of them. */
const parkedCommitRef: { uid: string | null } = { uid: null };

/**
 * What a PARKED swing's contact does — bound at RESUME time (see the beat clock), read by the lunge's
 * `onParkedContact`. Null while nothing is resuming, so a stray contact (a timeline replayed by a seek) is inert.
 */
const parkedContactRef: { current: (() => void) | null } = { current: null };

/** If the resumed strike's contact never fires — a timeline gutted by an earlier kill plays as an empty shell
 *  — the clock still advances after this long (ms at 1× speed), so a park can never stall the fight. Longer
 *  than any strike drive (130–190 ms) plus its rebound, so a real contact always wins. */
const PARKED_RESUME_FALLBACK_MS = 900;

/** The travel lead (ms, 1× speed) to HOLD before `next` when it is a `launchOnDeath` Echo damage wave whose
 *  spray was launched from a death in `shown` — so the wave's damage lands as the spikes connect. 0 otherwise. */
function echoDeliveryLead(shown: Moment | undefined, next: Moment, events: CombatEvent[], cardIds: Map<string, string>): number {
  if (!shown || next.primary.wave === undefined) return 0; // not a wave beat
  // The sprayer = the source of the wave's damage (scanned, so a leading ward pop doesn't hide it).
  let src: string | null = null;
  for (let i = next.start; i < next.end; i++) {
    const ev = events[i];
    if (ev?.type === 'dmg' && typeof ev.source === 'string') { src = ev.source; break; }
  }
  if (!src) return 0;
  const binding = bindingFor(cardIds.get(src) ?? null, 'damage');
  if (!binding?.launchOnDeath) return 0;
  // FIRST volley — the sprayer DIED in `shown`, so its spikes launched from there. Hold until THIS spike
  // connects (launch + beam travel + a read buffer). Each LATER volley lands as ITS OWN spike connects (the
  // subsequent branch below), so the victim's number CLIMBS one spike at a time (4, then 8). The victim stays
  // on the board through the whole spray (the engine defers its death), and all the deferred deaths resolve
  // together AFTER the last volley in their own step (owner ask 2026-08-20: aggregate per fire, resolve after).
  for (let i = shown.start; i < shown.end; i++) {
    const e = events[i];
    // The spray LAUNCHED in `shown` — either the sprayer DIED there (death-fired: hold the full skull→spray
    // gap) or a forced trigger (Echohorn's Rally, sprayer still alive: a shorter launch gap, no skull to read,
    // so a golden/Sylus-multiplied burst's waves come faster one after another). Both throw the spike from that
    // beat, so hold until it connects; the number climbs per wave exactly like a death-fired spray per pass.
    if (e?.type === 'death' && e.target === src) return ECHO_LAUNCH_DELAY_MS + projectileImpactMs(binding.def) + ECHO_IMPACT_BUFFER_MS;
    if (e?.type === 'rally' && e.target === src) return ECHO_RALLY_LAUNCH_DELAY_MS + projectileImpactMs(binding.def) + ECHO_IMPACT_BUFFER_MS;
  }
  // A SUBSEQUENT volley of the same spray (the sprayer died in an EARLIER beat): its spike connects one
  // pass-gap after the previous one, so hold that long — the number climbs by this volley's amount as it lands.
  return ECHO_PASS_GAP_MS;
}

/** Delay (ms, 1× speed) from the Echo SKULL to its spike volley launching — a beat so the skull reads on its own
 *  before the spray begins (owner ask 2026-08-21: widen the skull→spray gap). Slides the whole spray (launch +
 *  the numbers that trail it) later as one; travel, impact buffer and climb spacing are unaffected. */
const ECHO_LAUNCH_DELAY_MS = 400;
/** Delay (ms, 1× speed) from a FORCED Echo trigger (Echohorn's Rally) to its spike volley launching. Shorter
 *  than the death path's skull gap — a rally has no skull to read, and a golden Echohorn / Sylus can fire the
 *  Echo several times, so each rally-fired wave launches sooner and the waves come faster one after another
 *  (owner ask 2026-08-21: speed up the gap between each wave). */
const ECHO_RALLY_LAUNCH_DELAY_MS = 120;
/** Extra hold (ms, 1× speed) before the FIRST forced-spray wave when the rally is absorbed into the attacker's
 *  wind-up (Echohorn's held windup): the spikes must not fly while the attacker is still rearing back, so wait
 *  out the rear-back + rally pause and launch as it finishes settling into the held pose (owner ask 2026-08-22:
 *  rear back, pause, THEN the volleys). Matches `windupDur` (540) + the rally pause (440); the wave-beat hold
 *  (`echoDeliveryLead`, measured from the wave beat that plays AFTER the rear-back) is unchanged. */
const ECHO_WINDUP_HOLD_MS = 980;
/** Gap (ms, 1× speed) between a GOLDEN Fel Spikes' two sprays, so the volley reads as two quick taps rather
 *  than one merged cascade (owner report 2026-08-20). */
const ECHO_PASS_GAP_MS = 240;
/** Hold (ms, 1× speed) past the beam's target `at` before the number tallies. Small, so the number lands as the
 *  impact burst reaches its BRIGHTEST frame rather than its very first one — the tally then reads in sync with
 *  the strike's visual peak instead of finishing a touch ahead of it (owner 2026-08-21). Was 150 (number landed
 *  well after the blast, back when a landing number could KILL a unit early); the number only CLIMBS now. */
const ECHO_IMPACT_BUFFER_MS = 80;

/** Schedule the spike volley(s) a dying `launchOnDeath` unit throws: one per `echoWaves` wave, each launched a
 *  breath after the skull (`ECHO_LAUNCH_DELAY_MS`), and each golden pass a `ECHO_PASS_GAP_MS` after the last so
 *  two sprays read as two taps. Anchors resolve at FIRE time (inside the timer) so a pulled-home attacker's
 *  moved rect is honoured and the still-visible body is the launch point. `register` receives each timer id for
 *  the caller's cleanup. */
function scheduleEchoVolleys(defId: string, dyingUid: string, startIdx: number, events: CombatEvent[], speed: number, register: (id: number) => void, endIdx?: number, launchDelayMs: number = ECHO_LAUNCH_DELAY_MS): void {
  if (!canPlayDefs()) return;
  const s = speed > 0 ? speed : 1;
  const impactMs = projectileImpactMs(defId);
  echoWaves(events, dyingUid, startIdx, endIdx).forEach((wv, w) => {
    // Did THIS wave deal any actual damage (a number fires)? Gates the land cue — a fully ward-absorbed volley
    // (only `shield` pops, no number) stays silent (see `echoWaveDamagedCount`).
    const dealtDamage = echoWaveDamagedCount(events, dyingUid, wv.wave, startIdx, endIdx) > 0;
    const fire = (): void => {
      // ONE launch cue per volley, fired the instant the projectile pixi launches — not per target.
      sfx.felSpikeEcho();
      wv.uids.forEach((uid, k) => {
        const a = anchorsForUnits(dyingUid, uid);
        if (a) playDef(defId, a, { uids: { source: dyingUid, target: uid }, index: k });
      });
    };
    const delay = (launchDelayMs + w * ECHO_PASS_GAP_MS) / s;
    if (delay <= 0) fire();
    else register(window.setTimeout(fire, delay));
    // Land cue: ONE play per volley, timed to when its spikes CONNECT (launch + beam travel), only if the volley
    // dealt damage.
    if (dealtDamage) {
      const landDelay = delay + impactMs / s;
      if (landDelay <= 0) sfx.felSpikeEchoLand();
      else register(window.setTimeout(() => sfx.felSpikeEchoLand(), landDelay));
    }
  });
}

/**
 * The combat-replay engine, decoupled from layout. Folds `combat`'s event log into a
 * beat-by-beat animation: `active` gates whether the clock is ticking (so the caller
 * can hold on a "shop closing / enemies arriving" intro before the fight starts), and
 * `findEl` resolves a unit's live DOM node for measuring lunges + projectile bolts
 * (so the same engine works in any layout). The UI only *replays* — it never computes
 * the outcome (that's `simulate()`).
 */
export function useCombatReplay(
  combat: CombatResult | null | undefined,
  opts: { active: boolean; findEl: (uid: string) => Element | null; combatSpeed?: number; paused?: boolean; rampEnabled?: boolean },
): CombatReplay {
  const { active, findEl, paused = false, rampEnabled = false } = opts;
  /**
   * LAST-KNOWN slot rect per unit uid, refreshed every beat.
   *
   * Source-anchored FX (Ruby Power, spell power, proc crits) resolve their anchor through `findEl`, which
   * only sees LIVING units. A proc fired by a DYING body — Parting Cry replaying its own Shout as it dies —
   * therefore had no element by the time the beat rendered, so the effect bailed and nothing was drawn even
   * though the gain applied (owner report 2026-08-17: Deepvein Tender's +1 Health showed no Ruby flourish).
   * Keeping the previous beat's rect gives those procs somewhere to land.
   */
  const lastRectRef = useRef(new Map<string, { cx: number; cy: number; w: number; h: number }>());
  // Bloom the board aura-wash for a run-wide tribe aura that rose mid-combat — the same cue the recruit phase
  // shows off `auraFxSeq`, anchored to the player's board region. `'any'` (a board-wide aura) uses the neutral
  // palette. Mirrors Recruit.fireAuraWave 1:1 so the two phases read identically (owner ask 2026-07-21).
  const fireCombatAuraWave = (tribe: string): void => {
    const zoneEl = document.querySelector('[data-zone="warband"]');
    if (!zoneEl) return;
    const z = zoneEl.getBoundingClientRect();
    if (z.width < 8 || z.height < 8) return;
    const rr = zoneEl.querySelector('.row.warband')?.getBoundingClientRect();
    const y = rr && rr.height > 4 ? rr.top : z.top;
    const h = rr && rr.height > 4 ? rr.height : z.height;
    const paletteTribe = (tribe === 'any' ? 'neutral' : tribe) as Parameters<typeof buffPreset>[1];
    pixiFx.auraWave({ x: z.left, y, w: z.width, h }, { ...getAuraFxConfig(), ...wavePalette(buffPreset('', paletteTribe)) });
  };
  // User-controlled replay speed (in-combat slider). 1 = the tuned default; >1 faster, <1 slower. Every
  // beat delay / float lifetime / final hold is divided by it, and each lunge is timeScaled to match.
  const combatSpeed = opts.combatSpeed && opts.combatSpeed > 0 ? opts.combatSpeed : 1;
  // Slide onDamaged buffs (Target Dummy et al.) to the tail of their clash so a +N stat gain never splits the
  // impact — the whole exchange lands at its real values, then the buff floats. Presentation-only; the sim
  // event log is untouched (see deferClashBuffs). Both `beats` below AND `computeFrame` fold THIS array —
  // `computeFrame` needs the ordered EVENTS on their own (not just the compiled moments), so `replayOrder` is
  // still called here directly rather than only through `replayBeats`.
  // …then hold every Avenge payoff beat until AFTER the death cascade's summons deploy (deferAvengeAfterSummons):
  // a multi-death clash or a deferred attack-on-summon token would otherwise show the Avenge (a buff pulse, a
  // coin burst) before the token pops in. Composed on the clash-normalized copy; both folds see THIS array.
  // Both transforms live in `replayOrder` — the single source of truth for this ordering, so anything (like
  // the proc harness's `scanProcs`) that computes a moment index for `seekTo` folds the SAME array and can't
  // silently address a different moment than the one the replay is actually showing.
  const events = useMemo(() => replayOrder(combat?.events ?? []), [combat]);
  // Moments are Beat-shaped (choreographer phase 1): identical grouping to the old buildBeats (equivalence-
  // tested), now carrying stepGroups for later phases. buildBeats itself remains only as the test oracle.
  // `replayBeats` folds `compileMoments(replayOrder(events))` as ONE definition — see its doc comment for why
  // that composition, not `replayOrder` alone, is the seam the proc harness must also call.
  const beats = useMemo(() => replayBeats(combat?.events ?? []), [combat]);
  const [beatIdx, setBeatIdx] = useState(0);
  // Reset the replay index the instant a new combat arrives — DURING RENDER, not in the `[combat]` effect
  // below. A set-function called during render is applied by React BEFORE it commits or renders children, so
  // the FIRST committed render of a new fight already has `beatIdx === 0`. That closes the async gap the old
  // `seenCombatRef` gate could not: the ref was written synchronously in the reset effect but `setBeatIdx(0)`
  // was async, so one render saw the ref already say "new combat" while `beatIdx` still held the PREVIOUS
  // fight's value — `processedEnd` then fell through to `events.length` and `triggeredQuests` fired every
  // trigger of the whole fight at once (the Hatchery End-Turn burst spike, owner probe 2026-08-20). Resetting
  // here makes that window impossible; the `[combat]` effect keeps the imperative cleanup (GSAP kills, roll
  // cancellation, summon-hold release) it always did.
  const [renderedCombat, setRenderedCombat] = useState(combat);
  if (combat !== renderedCombat) {
    setRenderedCombat(combat);
    setBeatIdx(0);
  }
  // Mirrors read by the rAF ramp loop WITHOUT making it a React dep (so pause / beat advance don't re-arm it).
  const beatIdxRef = useRef(0);
  beatIdxRef.current = beatIdx;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  // Authored (base-speed) duration table for "time remaining" — O(1) per frame. Rebuilt only when the fight
  // (its beats) changes. `holdMs(next, prev, 1)` is the base-speed hold before each beat shows.
  const authored = useMemo(
    () => buildAuthoredTimeline(beats, (next, prev) => holdMs(next, prev, 1), getChoreoConfig().finalHold),
    [beats],
  );
  // Bumped by every seek. `beatIdx` alone cannot express "replay the beat you are already on": React bails
  // out of an identical setState, so no cue effect re-runs and the board just clears. Re-watching one moment
  // while tuning is the harness's whole workflow, so the nonce gives those effects something that always
  // changes. It never moves during ordinary playback, so the normal path is untouched.
  const [seekNonce, setSeekNonce] = useState(0);
  const [floats, setFloats] = useState<Float[]>([]);
  const [deathFloats, setDeathFloats] = useState<DeathFloat[]>([]); // damage on dying units (board overlay)
  const [triggers, setTriggers] = useState<Set<string>>(new Set()); // uids whose effect just fired → medallion pulse
  // Per-uid clear timers for that pulse. In a ref, not the effect's cleanup, so a hold outlives the beat that
  // started it — see the trigger effect for what cancelling them on every beat cost.
  const pulseTimersRef = useRef<Map<string, number>>(new Map());
  // uid → a monotonic nonce, bumped on EACH Rally fire. The nonce is used as a React `key` on the medallion
  // (see Card) so it REMOUNTS every fire and the gold pulse animation restarts — a rally unit's own Rally also
  // sets the normal trigger pulse, so `.pulsing` never leaves the element between swings and a plain class
  // re-add wouldn't replay the CSS animation (that's why the 2nd Rally in a combat pinged sound but no visual).
  const [rallyPulse, setRallyPulse] = useState<Map<string, number>>(new Map());
  const rallyNonceRef = useRef(0);
  // Watcher pulse: same nonce mechanism as rallyPulse, but for the light-blue medallion (a non-attacker
  // friendly unit that fired an effect on an attack beat). Frame pulse mirrors it for the CSS card-frame
  // bloom fallback (used only when the Pixi `watcher-pulse` def can't play — see the trigger effect below).
  const [watcherPulse, setWatcherPulse] = useState<Map<string, number>>(new Map());
  const watcherNonceRef = useRef(0);
  const [framePulse, setFramePulse] = useState<Map<string, number>>(new Map());
  const frameNonceRef = useRef(0);
  // ONE flash, used by both pulse owners: the lunge fires the attacker's opener from inside its GSAP
  // timeline, and the `rallyFx` cue fires every proc after it (owner call 2026-08-05 — the medallion pulses
  // once per proc, not once per Rally). Sharing the function is what guarantees the 2nd pulse is identical
  // to the 1st; the nonce is what makes it VISIBLE, since it keys the medallion's remount (see Card.tsx) and
  // a plain class re-add would not restart the CSS animation.
  /**
   * The "+A/+H Spell Power" narration flourish: the burst + climbing number over the source, and the held
   * spells' pop. Factored out of the beat-start loop (2026-09-01) so it reads as one body; a Shout re-fire's
   * narration rides its own fire's moment and so goes through this same loop, one fire at a time.
   *
   * PLAYER-SIDE ONLY. The `sc` narration carries no `side`, and an ENEMY spell-power source (an enemy Aeon
   * Guard) resolved to an enemy unit — so the flourish drew on the opponent's half of the board (owner report).
   * Gate on the player's uids: the initial player board plus everything the player summoned this fight.
   */
  const spellPowerNarration = useCallback((
    e: CombatEvent | undefined,
    playerUids: ReadonlySet<string>,
    anchorOf: (uid: string) => { cx: number; cy: number; w: number; h: number } | null,
  ): void => {
    if (!e || e.type !== 'sc' || !e.source || !e.text) return;
    const m = /^\+(-?\d+)\/\+(-?\d+) Spell Power$/.exec(e.text);
    if (!m) return;
    const gA = Number(m[1]), gH = Number(m[2]);
    if (gA <= 0 && gH <= 0) return;
    if (!playerUids.has(e.source)) return;
    const a = anchorOf(e.source);
    if (!a) return;
    const { cx, cy, h } = a; // SLOT — the source can be mid-lunge when its spell power rises
    pixiFx.spellPower(cx, cy, getSpellPowerFxConfig());
    floatSpellPowerNumber(cx, cy - h * 0.3, gA, gH);
    // …and pop the held SPELLS, whose printed values just moved. Without this the cards themselves only
    // reacted at combat RESOLUTION (owner report): the hand-card cue is driven by a diff of the rendered live
    // text, and run state doesn't change until settle — so mid-fight there is nothing for that diff to see.
    // Firing from the narration beat puts it on the moment the gain actually happens.
    fireSpellBuffOnHandSpells(useGame.getState().run.hand);
  }, []);
  /** The card-frame bloom alone (nonce → remount → the animation restarts), so a Shout's owner can bloom once
   *  PER FIRE — the beat-level `sccast` flash class fires once per beat and cannot repeat within it. */
  const bloomFrame = useCallback((uid: string): void => {
    const fn = ++frameNonceRef.current;
    setFramePulse((prev) => new Map(prev).set(uid, fn));
    window.setTimeout(() => setFramePulse((prev) => { const m = new Map(prev); if (m.get(uid) === fn) m.delete(uid); return m; }), 1150);
  }, []);
  /** The light-blue WATCHER medallion + card-frame bloom on `uid` — a reaction card acting. The same pair the
   *  beat-start watcher loop fires, factored so a Shout re-fire proc can pulse its re-triggering unit at the
   *  proc's own time. */
  const pulseWatcher = useCallback((uid: string): void => {
    const wn = ++watcherNonceRef.current;
    setWatcherPulse((prev) => new Map(prev).set(uid, wn));
    window.setTimeout(() => setWatcherPulse((prev) => { const m = new Map(prev); if (m.get(uid) === wn) m.delete(uid); return m; }), 1150);
    if (watcherPixiReady(!!getDef(WATCHER_PULSE_DEF_ID), canPlayDefs())) {
      const a = anchorsForUnits(uid, uid);
      if (a) playDef('watcher-pulse', a, { uids: { source: uid, target: uid } });
    } else {
      bloomFrame(uid);
    }
  }, [bloomFrame]);
  const firePulse = useCallback((uid: string): void => {
    sfx.triggerPulse();
    const n = ++rallyNonceRef.current;
    setRallyPulse((prev) => new Map(prev).set(uid, n));
    // Cleared only if THIS fire is still the current one — a later proc's nonce must not be cancelled by an
    // earlier proc's timer, or the second pulse would vanish partway through.
    window.setTimeout(() => setRallyPulse((prev) => {
      const m = new Map(prev);
      if (m.get(uid) === n) m.delete(uid);
      return m;
    }), 1150);
  }, []);
  // uids this instance currently holds in the module store (`fx/statHold`) — the install effect below
  // releases exactly what THIS beat placed before placing the next. A uid drops off this list the moment its
  // strike is SCHEDULED (`scheduleRoll`, not when the strike actually fires — see that function's own note
  // for why the distinction is load-bearing), because from that point its delivery belongs to the roll
  // registry below, not to this beat's plain release-on-advance. See the install effect for the ordering.
  const combatHeldRef = useRef<string[]>([]);
  // Task 6: every buff's strike-delay timer + the roll it hands off to, keyed by an incrementing id (not
  // uid — a target can be re-buffed before its first roll lands, so a second registration must not stomp
  // the first one's cancel). Lives for the WHOLE combat, unlike the per-beat `timers` arrays that
  // `fireBuffCasts`/`fireSelfBuffs` used to schedule this same timer into below.
  //
  // That per-beat array is cleared by the cue/windup effects' cleanup on EVERY beat advance, and beat
  // advance fires at lunge CONTACT (`runAttackExchangeCues`'s `advance()`), which routinely races the strike
  // timer close enough to lose it outright — margins of 5.3ms and 44ms measured in real fights (Task 6
  // brief). When contact wins, the strike timer is cancelled before it fires, `driveRoll` never starts, and
  // the badge's hold is delivered by the NEXT beat's install-effect release instead — a snap, not a roll.
  //
  // This registry is reachable only from `scheduleRoll` (writes) and `cancelPendingRolls` (reads/clears),
  // and `cancelPendingRolls` is called ONLY from `resetTo` below — never from the per-beat cue/windup
  // cleanups. That is HALF the fix: the beat advance can no longer cancel the strike timer outright. The
  // other half is `scheduleRoll` dropping the uid out of `combatHeldRef` at SCHEDULE time — otherwise the
  // very same beat advance still snaps the badge from a DIFFERENT angle (the install effect's own plain
  // release of `combatHeldRef` leftovers); see that function's comment for the browser trace that found it.
  const rollRegistryRef = useRef<Map<number, { uid: string; strikeTimer: number | null; cancelRoll: (() => void) | null }>>(new Map());
  const rollRegistryIdRef = useRef(0);
  // Combat-lifetime timers for a dying unit's Echo spike VOLLEYS (Fel Spikes). Each spray is launched from the
  // death beat but its later volleys fire whole beats later (one `ECHO_PASS_GAP_MS` apart), AFTER the replay has
  // advanced past the death beat — so they CANNOT live in the per-beat `timers` array, which the cue effect's
  // cleanup clears on every beat advance (that silently dropped a gilded+Sylus spray's 3rd/4th volleys). Kept
  // here instead, cleared ONLY on reset/seek (`cancelPendingRolls`), so every volley fires but a scrub cancels
  // the ones still pending.
  const echoVolleyTimersRef = useRef<number[]>([]);
  /**
   * FLOAT REMOVAL TIMERS — combat-lifetime, NOT per-beat (owner report 2026-09-01: *"dmg values being left
   * behind from fel spike's trigger"*).
   *
   * A float lives ~1.5s and is removed by its own timer. Those timers used to sit in the beat effect's
   * `timers` array, which its cleanup clears on every beat change — so any float still on screen when the beat
   * advanced lost its removal and stayed forever. A Fel Spikes spray is the worst case: many floats, spawned
   * across several fast wave beats.
   *
   * Latent all along, and exposed by splitting a swing's results into their own beats (2026-09-01) — more,
   * shorter beats means the race is lost far more often. This is the same fix, for the same reason, that
   * `scheduleRoll` and `echoVolleyTimersRef` already carry: a timer whose job outlives the beat that scheduled
   * it does not belong to that beat.
   */
  const floatTimersRef = useRef<number[]>([]);
  // HELD WINDUP (Echohorn firing a forced Fel Spikes spray on its swing): its lunge PARKS at the top of the
  // wind-up while the whole spray plays across the following beats, then resumes its strike when the attacker's
  // own attack lands — or is killed if the spray killed the attacker first. Combat-lifetime (survives per-beat
  // cleanup); cleared on reset/seek.
  /** A PARKED lunge: the attacker, the body it was swinging at, and the timeline holding its pose. The
   *  `defender` is what lets a CANCELLED swing be told apart from a pending one — see the release below. */
  const heldLungeRef = useRef<{ uid: string; defender: string; tl: ReturnType<typeof gsap.timeline>; resumed: boolean } | null>(null);

  // Schedule a buff's strike-delay timer in the combat-lifetime registry above (not the caller's per-beat
  // `timers`), so an ordinary beat advance cannot cancel it. When the delay elapses, hand off to `driveRoll`
  // with a LIVE speed getter (Task 6) — a mid-roll combat-speed change re-scales the remainder instead of
  // the roll finishing on whatever speed happened to be live when the strike landed.
  const scheduleRoll = useCallback((uid: string, ms: number): void => {
    const id = ++rollRegistryIdRef.current;
    const entry: { uid: string; strikeTimer: number | null; cancelRoll: (() => void) | null } =
      { uid, strikeTimer: null, cancelRoll: null };
    // Drop `uid` from `combatHeldRef` NOW, at SCHEDULE time — not when the strike actually fires. This is
    // the second half of the Task 6 fix, found only by tracing the browser gate: cancelling the strike
    // timer's cleanup (the registry above) stops the beat-advance race from cancelling the timer outright,
    // but a SEPARATE beat-advance race was still snapping the badge anyway — the install effect below
    // releases every uid still sitting in `combatHeldRef` at the TOP of every beat it runs (THE INVARIANT:
    // "last beat's leftovers"). If the beat advances before this uid's strike fires (the same lunge-CONTACT
    // race the registry exists for), the NEXT beat's install effect found `uid` still parked in
    // `combatHeldRef` and released it outright — a snap — moments before the (still-pending) strike/roll
    // ever got to run; `revealStat` against the now-gone hold was then correctly a no-op, so nothing about
    // the roll itself was visibly wrong, it simply had nothing left to reveal. Removing `uid` here, the
    // instant the strike is scheduled, tells the install effect this uid's delivery is the registry's job
    // from now on (whether still counting down or already rolling) — mirroring `cancelPendingRolls`, which
    // is the only OTHER thing allowed to resolve it early (on teardown/re-seek). A target that never reaches
    // `scheduleRoll` at all (its element wasn't measurable when `fireBuffCasts`/`fireSelfBuffs` ran) is
    // untouched by this and still falls through to `combatHeldRef`'s plain release, exactly as before.
    combatHeldRef.current = combatHeldRef.current.filter((u) => u !== uid);
    entry.strikeTimer = window.setTimeout(() => {
      entry.strikeTimer = null;
      // `onComplete` prunes this entry the moment the roll finishes on its own (fix round 1, Finding 4) — so
      // a combat with many buffs doesn't accumulate a completed-roll entry per buff for the rest of the
      // fight. Bounded either way (cleared in full by `cancelPendingRolls`/`cancelRollForUid`), just tidier.
      entry.cancelRoll = driveRoll(uid, COMBAT_ROLL_MS, () => combatSpeedRef.current, () => {
        rollRegistryRef.current.delete(id);
      });
    }, ms);
    rollRegistryRef.current.set(id, entry);
  }, []);

  // Cancel every pending strike timer and every in-flight roll, and release each one's hold outright — see
  // THE INVARIANT on the install effect below: a hold nothing will finish must not sit frozen mid-reveal.
  // `releaseStat` is safe/cheap when nothing is held (the strike already fired and the roll already
  // completed on its own), which covers most entries in the common case.
  //
  // Called ONLY from `resetTo` (a fresh combat replacing this instance, or an explicit seek) — belt-and-
  // braces with `dropBoardFx`'s `releaseAllStats` (store.ts), which already clears every hold on the actual
  // phase flip out of combat. This registry exists for the narrower case `releaseAllStats` doesn't cover:
  // THIS instance's own in-flight rolls being superseded by a fresh combat or a re-seek, both of which the
  // hook survives (it persists across fights) without ever leaving the combat phase.
  const cancelPendingRolls = useCallback((): void => {
    for (const entry of rollRegistryRef.current.values()) {
      if (entry.strikeTimer !== null) window.clearTimeout(entry.strikeTimer);
      entry.cancelRoll?.();
      releaseStat(entry.uid);
    }
    rollRegistryRef.current.clear();
    // Cancel any Echo spike volleys still pending from a death this instance already replayed — a fresh combat
    // or a re-seek supersedes them (they'd otherwise fire a stale spray onto the new frame).
    for (const id of echoVolleyTimersRef.current) window.clearTimeout(id);
    echoVolleyTimersRef.current = [];
    for (const id of floatTimersRef.current) window.clearTimeout(id);
    floatTimersRef.current = [];
    // A parked held-windup lunge from a swing this instance already replayed must not survive a fresh combat or
    // a re-seek — kill it and drop the frozen pose.
    if (heldLungeRef.current) { heldLungeRef.current.tl.kill(); heldLungeRef.current = null; }
    parkedCommitRef.uid = null; // a reset/re-seek drops the park, so it must drop its commit hold too
    parkedContactRef.current = null;
  }, []);

  /**
   * Fix round 1 (adversarial review): damage is instant and AUTHORITATIVE, so it must interrupt a mid-reveal
   * buff roll on the same uid, not coexist with one.
   *
   * `Card.tsx` prints `live - held` — a live stat straight off `frame` (already reflecting every event up to
   * and including this beat, damage included) minus whatever delta is still withheld. That self-corrects
   * across a further BUFF or TRADE (the install effect below always releases-before-places, so a fresh delta
   * replaces the stale one), but NOT across the live stat DROPPING while a hold from an EARLIER buff is still
   * mid-roll: the withheld amount keeps subtracting from a number that has since fallen, and if the drop is
   * big enough the print goes BELOW the unit's true floor — a number it never had. Worked case: a 3/4
   * self-buffs +0/+2 (hold placed, `held.health=2`, badge correctly holds pre-buff 4, live climbs to 6);
   * before the roll finishes, the SAME unit takes 3 counter-damage (live drops to 3); `live - held` prints
   * `3 - 2 = 1`, but the true floor across the whole exchange is 3 (4 -> 6 -> 3, damage never took it below
   * 3). This is NEW as of the beat-advance fix above: pre-fix, the roll was always cancelled at the beat
   * boundary (a snap), so a stale delta never survived long enough to meet a later damage frame.
   *
   * Cancels every registry entry for `uid` (pending strike timer AND/OR live roll — whichever phase it's in)
   * and releases the store hold outright, same shape as `cancelPendingRolls` but scoped to one uid instead of
   * the whole combat. Safe/cheap when nothing is live for `uid` (the common case — most damage lands on a
   * unit with no buff in flight). Called from the install effect below for every `dmg` event's target in the
   * beat just committed, so "you got hit" always wins over "you're still owed a roll": the badge snaps
   * straight to the true, already-damaged number instead of continuing to count up from a floor that no
   * longer applies. A unit buffed and damaged in the very same beat gets the same treatment — the hold this
   * beat's own buff pass just placed is interrupted immediately after, so the beat still nets out at
   * `frame`'s true value (both events already folded into it) rather than animating a roll whose start point
   * (`live - delta`) may not actually be a value the unit ever had, given the sim's real intra-beat event
   * order.
   */
  const cancelRollForUid = useCallback((uid: string): void => {
    for (const [id, entry] of rollRegistryRef.current) {
      if (entry.uid !== uid) continue;
      if (entry.strikeTimer !== null) window.clearTimeout(entry.strikeTimer);
      entry.cancelRoll?.();
      rollRegistryRef.current.delete(id);
    }
    // `combatHeldRef` too: a hold this beat's OWN buff pass just pushed there (below) hasn't reached
    // `scheduleRoll` yet (that happens later, from the FX effect, once the strike/pulse actually fires) — so
    // it wouldn't be caught by the registry loop above. Drop it here too, or the (buff-beat) install effect's
    // NEXT pass would try to release it a second time against an already-gone hold (harmless, but stale).
    combatHeldRef.current = combatHeldRef.current.filter((u) => u !== uid);
    releaseStat(uid); // safe/cheap no-op if nothing was actually held — covers the common undamaged-buff case
  }, []);
  const [shake, setShake] = useState(0);
  const [shaking, setShaking] = useState(false);
  const [critShake, setCritShake] = useState(0);   // bumped at a crit's contact → the punchier `.shaking-crit`
  const [critShaking, setCritShaking] = useState(false);
  // Which minion is mid-attack — drives the `attacking` glow class. The lunge MOTION is run
  // imperatively by GSAP (see the layout effect below); React never sets a transform on a unit.
  const [attackUid, setAttackUid] = useState<string | null>(null);
  // True only when the choreo engine's GSAP timeline is driving THIS beat's advance (an attack whose elements
  // resolved). The scheduler consults it so it skips the attack transition ONLY when the engine actually took
  // over — if the lunge couldn't run (elements unresolved), the scheduler still advances, so the replay never
  // stalls (restoring the pre-engine unconditional-advance robustness).
  const engineAdvancingRef = useRef(false);
  // Latest combat speed, read by the cue effect's float-expiry timers WITHOUT being a dep (so a mid-beat speed
  // toggle doesn't re-run the effect and re-fire that beat's sfx/shake — sfx is only per-call deduped).
  const combatSpeedRef = useRef(combatSpeed);
  // When NOT ramping, the ref tracks the base slider every render (today's behavior). While the ramp loop is
  // live it owns this ref; a stray render can only clobber it for a single frame before the loop reasserts.
  if (!(rampEnabled && active)) combatSpeedRef.current = combatSpeed;

  // AUTO-RAMP (owner ask 2026-08-18): while a fight plays with the toggle on, ease the effective speed up from
  // the base slider to the ceiling after a grace hold, then back down to base as the fight's estimated time
  // runs out. Drives a ref + CSS var + float speed only — NO per-frame React render. Off-path costs nothing.
  useEffect(() => {
    const root = typeof document !== 'undefined' ? document.documentElement.style : null;
    if (!active || !rampEnabled) return; // off / not fighting → base drives everything (see the gated ref write)
    let raf = 0;
    let elapsed = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const dt = now - last;
      last = now;
      if (!pausedRef.current) elapsed += dt;
      const cfg = getCombatRampConfig();
      const ceiling = Math.min(cfg.ceiling, 5); // never exceed the store's 5× cap
      const remaining = authored.remainingAt(beatIdxRef.current);
      const spd = rampSpeed(combatSpeed, elapsed, remaining, { ...cfg, ceiling });
      combatSpeedRef.current = spd;
      root?.setProperty('--combat-speed', String(spd > 0 ? spd : 1));
      applyFloatSpeed(spd);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Restore base on teardown so the post-combat UI + the next fight start from the slider value.
      combatSpeedRef.current = combatSpeed;
      root?.setProperty('--combat-speed', String(combatSpeed > 0 ? combatSpeed : 1));
      applyFloatSpeed(combatSpeed);
    };
    // combat in deps → new fight rebuilds `authored` and resets `elapsed`. `paused`/`beatIdx` intentionally
    // excluded (read via refs) so they never re-arm the loop.
  }, [active, rampEnabled, combat, combatSpeed, authored]);
  // Mirror of the per-beat `frame` (declared far below via useMemo) so the cue effect can look up a target's
  // live stats WITHOUT depending on `frame` directly (which would reorder/re-trigger the effect). Assigned
  // right after the `frame` useMemo.
  const frameRef = useRef<{ player: UnitFrame[]; enemy: UnitFrame[] } | null>(null);
  const [projectiles, setProjectiles] = useState<{ id: number; x: number; y: number; dx: number; dy: number; kind?: string }[]>([]);
  // A card a combat effect just granted to the hand (Arcane Weaver → Spirit Fire) — shown flying to the
  // hand for the duration of its beat, so the player sees it happen instead of it just appearing later.
  const [handGrant, setHandGrant] = useState<{ cardId: string; key: number } | null>(null);
  // `finished` lags `replayComplete` by a short hold (see below) so the FINAL beat's death animation +
  // damage float fully play before the replay reports `done` (which cleans up the dead + triggers the
  // round-end UI). Without it, the last kill was cut off mid-pop with no number.
  const [finished, setFinished] = useState(false);
  // Tab visibility — pause the beat clock while backgrounded so beats/lunges don't pile up and then fire
  // all at once (a loud burst of sounds) when you tab back in.
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const replayComplete = beatIdx >= beats.length;
  const done = finished;

  /**
   * Put the replay at `index` and clear every piece of transient per-beat state.
   *
   * Extracted from the fresh-combat reset so a SEEK can reuse it: jumping to an arbitrary beat needs exactly
   * the same clearing that starting a new fight does. The board itself needs no repair — `computeFrame`
   * rebuilds from `initial` on every call (see `computeFrame.purity.test.ts`) — but this transient state is
   * accumulated per beat and would otherwise carry stale floats, pulses and holds across the jump.
   *
   * `useCallback` with one dep (`cancelPendingRolls`, itself stable — see its own definition): every setter
   * here is otherwise stable, so the identity still never changes and callers can hold it without
   * re-subscribing.
   *
   * This is also THE teardown point for the combat-lifetime roll registry (Task 6): both callers below —
   * the fresh-combat effect and `seekTo` — need every in-flight buff roll from the PREVIOUS beat/fight
   * cancelled before the jump, or a roll started under the old fight/beat keeps driving `revealStat` against
   * a uid a re-staged fight may reuse. Ordinary beat advance never calls `resetTo`, so a normal roll is
   * untouched by this.
   */
  const resetTo = useCallback((index: number): void => {
    // FIRST, before the index is set. Killing a live lunge timeline makes GSAP re-render it and run the
    // `.add()` callbacks at its endpoint (see channels/lunge.ts) — including `ctx.advance()` and its
    // `setBeatIdx(k => k + 1)`. A timeline already PAST contact is protected: `onContact` is `once()`-wrapped,
    // so that is a harmless re-fire. But one seeked into BEFORE contact still has an unfired guard, so the
    // kill runs the advance for the FIRST time — and that functional update would otherwise queue AFTER our
    // absolute set and land the seek one beat late. Killing first puts the functional update ahead of the
    // absolute one, so the absolute value wins.
    gsap.killTweensOf('[data-zone] .unit');
    cancelPendingRolls(); // see the registry's own note: this is its only teardown call site
    setBeatIdx(index);
    setFloats([]);
    setDeathFloats([]);
    // …and drop the pulse holds with it, or a timer from the last fight clears a uid mid-pulse in this one.
    for (const t of pulseTimersRef.current.values()) window.clearTimeout(t);
    pulseTimersRef.current.clear();
    setTriggers(new Set());
    setRallyPulse(new Map());
    setWatcherPulse(new Map());
    setFramePulse(new Map());
    setFinished(false);
    setAttackUid(null);
    // (the `[data-zone] .unit` kill that stopped any lunge left mid-flight by the previous fight now runs
    //  first, at the top of this callback — see the comment there for why the ordering is load-bearing)
    setProjectiles([]);
    setShake(0);
    // …and drop the shake FLAGS with the counters. The shake effects bail on `!shake`, so zeroing the counter
    // cancelled their 300ms clear (effect cleanup) and then early-returned — leaving `.shaking` latched on
    // into the next fight. Only reachable when a fight starts within 300ms of a shake (a Skip), but it is the
    // same cleanup-cancels-the-clear defect as #735 / #736.
    setShaking(false);
    setCritShaking(false);
    setHandGrant(null);
    // …and drop any withheld summon too (combat's own stat holds are cleared by `cancelPendingRolls` above
    // and by the install layout effect). A summon hold surviving a seek or a fresh fight would hide a live
    // minion until its TTL, which is the one direction that feature must never fail in.
    releaseAllSummons();
  }, [cancelPendingRolls]);

  // A fresh combat resets the replay to the top (the hook persists across fights). `beatIdx` is already back
  // to 0 from the during-render reset above; this effect does the IMPERATIVE half — cancel pending rolls,
  // kill in-flight GSAP, drop withheld summons — which must run in an effect, not during render.
  useEffect(() => {
    resetTo(0);
  }, [combat, resetTo]);

  // uid → cardId for the whole fight (initial boards + everything summoned) — used to spot which dying
  // unit has a Deathrattle (so its medallion pulses) and which is a Blaster (purple blast bolts).
  const cardIds = useMemo(() => {
    const m = new Map<string, string>();
    if (!combat) return m;
    for (const u of [...combat.initial.player, ...combat.initial.enemy]) m.set(u.uid, u.cardId);
    for (const e of combat.events) if (e.type === 'summon') m.set(e.minion.uid, e.minion.cardId);
    return m;
  }, [combat]);

  // Fire a moment's buff-OTHER casts: a source→target tendril per cast (or a rain-down descend when the source is
  // a Deathrattle buffer), then roll each target's badge from its pre-buff value to the new one at the
  // strike/landing. Shared by the `buffWave` path (`onBuffCasts`) and the attack-wind-up path (on-attack / Rally
  // buffers, launched from the lunge timeline so the beat reads pulse → tendril → lunge). The release timer is
  // scheduled in the combat-lifetime roll registry (`scheduleRoll`, near `resetTo`) — NOT the caller's per-beat
  // `timers` array — so an ordinary beat advance can't cancel it out from under the roll it starts.
  const fireBuffCasts = useCallback((casts: BuffCast[]): void => {
    // target uid → the first landing cast's tendril flight time. A target can take several casts in one
    // moment, but they all release the SAME store hold together, so only the timing of the first is needed
    // — later casts on the same target no longer aggregate atk/hp here (the store already holds the beat's
    // full delta, installed by the layout effect below).
    const perTarget = new Map<string, number>();
    for (const c of casts) {
      const tEl = findEl(c.target);
      if (!tEl) continue; // target not on screen → nothing to land on
      const tr = tEl.getBoundingClientRect();
      const tc = { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 };
      // AUTHORED REPLACES STOCK, per BUFF (owner report 2026-09-01: *"they are back to casting tendrils instead
      // of dragonflame"*). A spell whose combat def is bound `buffedOn` plays ON the buffed unit INSTEAD of the
      // generic tendril — the two reach the same body on the same beat, so firing both draws one effect twice.
      //
      // Decided here rather than at the moment level because an on-attack cast now resolves INSIDE the wind-up:
      // the moment belongs to the ATTACK, so the spell is no longer visible from the moment's own binding and
      // only the individual buff still knows which spell caused it.
      const authored = authoredBuffDefFor(c.spellId);
      if (authored !== null) {
        playDef(authored, { source: tc, target: tc, cursor: tc, camera: { x: window.innerWidth / 2, y: window.innerHeight / 2 } },
          { uids: { source: c.target, target: c.target } });
        // The tendril's flight time is what normally releases the withheld stats; with no tendril, the roll
        // rides the def's own arrival instead. Kept SHORT on purpose — the number should reconcile while the
        // attacker is still held in its pre-strike pose, which is the whole point of absorbing the cast.
        if (!perTarget.has(c.target)) perTarget.set(c.target, AUTHORED_BUFF_ROLL_MS);
        continue;
      }
      const cardId = cardIds.get(c.source) ?? '';
      const tribe = (CARD_INDEX[cardId]?.tribe ?? 'neutral') as Tribe;
      /**
       * SOURCELESS also covers a grant attributed to a NAME rather than a body (owner report 2026-09-01:
       * *"gorun's buff doesn't get added at the right time, it's at resolution"*).
       *
       * `ctx.buff`'s `source` is usually the buffer's uid, but a hero power or a rune has no body on the
       * board and passes a LABEL instead — `'Blade Mastery'`, `'Rune of the Wild Hunt'`, `'The Old Hunt'`,
       * and about twenty more. `cardIds` has no entry for those, so `findEl` found nothing and the whole cast
       * was `continue`d — dropping not just the tendril but the `scheduleRoll` with it, which is why the badge
       * sat still until the hold expired long after the swing.
       *
       * A label grant genuinely has nowhere to travel FROM, which is exactly what the sourceless path is for
       * (it rains a descend instead of drawing a tendril) — so this is the presentation it should have had all
       * along, and it now gets its number rolled on the same clock as every other buff on the swing.
       */
      const sourceless = isDeathrattleBufferCard(cardId) || !cardIds.has(c.source);
      const sEl = sourceless ? null : findEl(c.source);
      if (!sourceless && !sEl) continue; // living-source buff needs a measurable source
      // AUTHORED REPLACES STOCK, for a LABEL grant (owner 2026-09-01, Gorun's Blade Mastery). A hero power has
      // no body to travel from, so its def rides the DESCEND convention the sourceless path already sets: the
      // pair is a point above the card → the card itself, which is what `fireBuffFx` draws generically and what
      // a `travel`-anchored ribbon reads as coming down onto the minion that earned it.
      const labelFx = sourceless ? labelBuffFxFor(c.source) : null;
      if (labelFx) {
        // FROM THE HERO POWER BUTTON (owner report 2026-09-01: *"gorun's hero power trail isn't originating
        // from the hero power button"*). A hero power has no body on the board, but it DOES have a control on
        // screen, and that is where the player watches it charge — so a `travel`-anchored ribbon should leave
        // from there rather than from a point in space above the card, which is what a generic descend uses.
        //
        // The ENEMY's power lives in its own corner (`.opp-power`), so the side is picked from where the
        // buffed body actually is. If neither button is on screen the descend is the fallback: an effect
        // slightly out of place beats no effect at all, and that was the pre-existing behaviour.
        const onEnemy = !frameRef.current?.player.some((u) => u.uid === c.target);
        const powerEl = document.querySelector<HTMLElement>(
          onEnemy ? '.heropowerbtn.opp-power' : '.statusbar .heropanel:not(.heropanel2):not(.equipslot) .heropowerbtn',
        ) ?? document.querySelector<HTMLElement>(onEnemy ? '.opp-power' : '.statusbar .heropowerbtn');
        const pr = powerEl?.getBoundingClientRect();
        const from = pr && (pr.width > 0 || pr.height > 0)
          ? { x: pr.left + pr.width / 2, y: pr.top + pr.height / 2 }
          : { x: tc.x, y: tc.y - tr.height };
        playDef(labelFx.def, { source: from, target: tc, cursor: tc, camera: { x: window.innerWidth / 2, y: window.innerHeight / 2 } },
          { uids: { source: c.target, target: c.target } });
        if (labelFx.heroId) sfx.heroPower(labelFx.heroId);
        if (!perTarget.has(c.target)) perTarget.set(c.target, AUTHORED_BUFF_ROLL_MS);
        continue;
      }
      const sr = sEl?.getBoundingClientRect();
      const strikeMs = fireBuffFx({
        source: sr ? { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 } : undefined,
        target: tc,
        cardId, tribe,
        sourceless,
      });
      if (!perTarget.has(c.target)) perTarget.set(c.target, strikeMs);
    }
    const unitOf = (uid: string) =>
      frameRef.current?.player.find((u) => u.uid === uid) ?? frameRef.current?.enemy.find((u) => u.uid === uid);
    for (const [target, strikeMs] of perTarget) {
      const tgt = unitOf(target);
      if (!tgt) continue;
      // The HOLD is installed pre-paint by the layout effect below — deliberately NOT here. Setting it from
      // this post-paint effect meant the browser painted the already-buffed number for one frame, then the
      // hold snapped it back to the pre-buff value, then the strike released it again: the "stat goes up,
      // down, then up with the tendrils" the owner filmed (2026-07-25). This path now owns only the RELEASE
      // — and the release is a ROLL (Task 3), not a snap: `driveRoll` walks the store's hold from 0 to 1 on
      // the strike's own clock, and the badge pop fires off the value moving (`useBadgePop`), with nothing
      // else to author here. `scheduleRoll` is what actually starts that clock, on its own combat-lifetime
      // timer (Task 6) rather than one the next beat's cleanup can cancel — see its own comment.
      const ms = strikeMs / (combatSpeedRef.current > 0 ? combatSpeedRef.current : 1);
      scheduleRoll(target, ms);
    }
  }, [findEl, cardIds, scheduleRoll]);

  // Fire a moment's SELF-buffs (a unit empowering ITSELF): one in-place pulse per unit, then after its own
  // hold time, roll its badge from the pre-buff value to the new one — the blast "causes" the tick. Shared by
  // the `buffWave` path (`onSelfBuffs`) and the attack-wind-up path (on-attack / on-ally-attack self-buffers
  // absorbed into the exchange, which `groupBuffCasts` deliberately skips). Same combat-lifetime registry as
  // `fireBuffCasts` above, via `scheduleRoll` — not the caller's per-beat `timers`.
  const fireSelfBuffs = useCallback((selfBuffs: SelfBuff[]): void => {
    const unitOf = (uid: string) =>
      frameRef.current?.player.find((u) => u.uid === uid) ?? frameRef.current?.enemy.find((u) => u.uid === uid);
    for (const s of selfBuffs) {
      const el = findEl(s.uid);
      if (!el) continue;
      // SLOT, not mid-flight: an ON-ATTACK self-buff is absorbed into the wind-up, so this fires while the
      // unit is leaning back — and the pulse marks the unit, so it belongs where the unit lives.
      const { cx, cy } = layoutRectOf(el);
      // AUTHORED REPLACES STOCK — the third path, and the last one (owner report 2026-09-01: *"they are also
      // triggering a 'self buff' animation and i want to remove that animation"*). A spell that buffs a RANDOM
      // friendly can roll its own caster; that buff has `source === target`, so it is sorted here rather than
      // into the tendril channel and needed the identical rule. Same helper, so all three paths agree.
      //
      // The def plays HERE rather than being skipped outright: this body was buffed like any other, so the
      // spell's effect belongs on it — dropping the pulse without playing the def would leave the one minion
      // the spell hit hardest showing nothing at all.
      const authored = authoredBuffDefFor(s.spellId);
      if (authored !== null) {
        const at = { x: cx, y: cy };
        playDef(authored, { source: at, target: at, cursor: at, camera: { x: window.innerWidth / 2, y: window.innerHeight / 2 } },
          { uids: { source: s.uid, target: s.uid } });
        if (unitOf(s.uid)) scheduleRoll(s.uid, AUTHORED_BUFF_ROLL_MS);
        continue;
      }
      const cardId = cardIds.get(s.uid) ?? '';
      const cfg = PULSE_PRESETS[pulsePreset(cardId, (CARD_INDEX[cardId]?.tribe ?? 'neutral') as Tribe)];
      pixiFx.pulse(cx, cy, cfg);

      const tgt = unitOf(s.uid);
      if (!tgt) continue; // no frame entry → nothing to release
      // Hold installed pre-paint by the layout effect below (see the note in `fireBuffCasts`); release only
      // — and the release is a roll now (Task 3): `driveRoll` walks the store's hold on the pulse's clock.
      const pulseHoldMs = cfg.holdMs / (combatSpeedRef.current > 0 ? combatSpeedRef.current : 1);
      scheduleRoll(s.uid, pulseHoldMs);
    }
  }, [findEl, cardIds, scheduleRoll]);

  // Track tab visibility (drives the pause-while-hidden gate on the beat clock).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = (): void => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Show the flying "→ hand" card only while its `toHand` beat is current; clear on any other beat.
  useEffect(() => {
    const beat = active ? beats[beatIdx] : undefined;
    if (beat && beat.primary.type === 'toHand') setHandGrant({ cardId: beat.primary.cardId, key: beatIdx });
    else setHandGrant(null);
    // `seekNonce`: `resetTo` nulls the flying card, so without this a re-seek onto a `toHand` beat would
    // clear the grant and never restore it — that moment's animation just wouldn't replay.
  }, [active, beatIdx, seekNonce, beats]);

  useEffect(() => {
    if (!shake) return;
    setShaking(true);
    const t = window.setTimeout(() => setShaking(false), 300);
    return () => window.clearTimeout(t);
  }, [shake]);

  useEffect(() => {
    if (!critShake) return;
    setCritShaking(true);
    const t = window.setTimeout(() => setCritShaking(false), 300);
    return () => window.clearTimeout(t);
  }, [critShake]);

  // Advance one beat at a time (a beat = an action + all its result events) — only once `active` (the intro
  // animation has finished and the fight is on), and NOT while the tab is hidden (so beats + GSAP lunges
  // don't pile up in the background and fire as one loud burst on tab-in; the clock resumes on return).
  useEffect(() => {
    // `paused` (a fullscreen overlay — Leaderboard / Balance Report / Career — is open) freezes the beat clock
    // just like `hidden` (backgrounded tab): the replay + its per-beat sfx stop, and resume when it's dismissed.
    if (!active || hidden || paused || beatIdx >= beats.length) return;
    // The moment on screen is beats[beatIdx-1]; the clock decides how long it stays before beats[beatIdx].
    // EXCEPT the attack-wind-up → its impact transition: the choreo engine's GSAP timeline (see the layout
    // effect below, `runAttackExchangeCues`) advances that one itself, anchored at the lunge's real
    // `contact` position — the former clock.ts smack-lead weld is retired, not duplicated here.
    const shown = beatIdx > 0 ? beats[beatIdx - 1] : undefined;
    if (shown?.kind === 'attackExchange' && engineAdvancingRef.current) return;
    const next = beats[beatIdx]!;
    let d = holdMs(next, shown, combatSpeedRef.current);
    // A Deathrattle summon (skull) or a Rise return (body fade) waits for the death to read — and an attacker
    // to settle home — before the consequence-overlap gap, so the tokens/returned body land AFTER the proc
    // reads, not on top of it.
    const atkUid = attackerOfImpact(beats, beatIdx - 1);
    // A Fel-Spikes-style Echo: the death holds for EXACTLY the volley's launch + travel — REPLACING the base
    // hold, not adding to it — so the damage numbers land ON the spike's strike, not a base-hold later (owner:
    // the damage felt late). The launch+travel is already ample death-read time, so nothing is lost.
    const echoHold = echoDeliveryLead(shown, next, events, cardIds);
    if (echoHold > 0) {
      d = echoHold / combatSpeedRef.current;
    } else {
      // Hold for the death cascade's consequence (DR summon / Rise return), OR — with no consequence — for a
      // plain attacker being pulled home to die in its slot. Max: a Rise/DR lead already covers its pull.
      const lead = Math.max(
        deathConsequenceLead(shown, next, events, cardIds, atkUid),
        pulledHomeAttackerHold(shown, atkUid, events, cardIds),
        // A PARKED attacker's own damage beat waits a moment first (owner ask 2026-09-01: *"we need a slight
        // delay after the final resolution before the echohorn actually commits its attack"*). Its forced Echo
        // has just finished — a spray, a charger's whole exchange — and the swing it has been holding should
        // read as a separate, deliberate act rather than the tail of that.
        //
        // Deliberately ADDITIVE, through this same `lead` path every other consequence hold uses. The previous
        // attempt REPLACED the hold and fired the release from this effect while the park was also driving the
        // advance — two owners of one clock, which is what desynced the frame. This only lengthens a beat; it
        // moves no callbacks and changes nothing about who advances.
        parkedCommitLead(next, events),
      );
      if (lead) d += lead / combatSpeedRef.current;
    }
    // A PARKED swing whose own damage beat is `next`: after the stillness, RESUME the strike and let its real
    // contact advance the clock — exactly what an ordinary swing's lunge does. The clock used to advance on the
    // timer alone and the layout effect resumed the strike as the damage beat became current, so the numbers
    // and the health had already changed while the attacker was still travelling — *"they attack immediately /
    // resolve their attack extremely fast"* (owner 2026-09-01, on a Shout re-fire; the same gap Echohorn's
    // forced Echo had carried as a known issue). Guarded so a park with no live timeline falls back to the
    // timer, and a fallback timer covers a resumed timeline whose contact never comes.
    const held = heldLungeRef.current;
    if (parkedCommitLead(next, events) > 0 && held && !held.resumed) {
      let fallback: number | null = null;
      let done = false;
      const go = (): void => {
        if (done) return;
        done = true;
        if (fallback !== null) window.clearTimeout(fallback);
        parkedContactRef.current = null;
        setBeatIdx((k) => k + 1);
      };
      const id = window.setTimeout(() => {
        const h = heldLungeRef.current;
        if (!h || h.resumed) { go(); return; }
        h.resumed = true;
        parkedContactRef.current = go;
        fallback = window.setTimeout(go, PARKED_RESUME_FALLBACK_MS / combatSpeedRef.current);
        h.tl.play(); // strike → contact (→ `go`) → settle, out of the held pose
      }, d);
      return () => { window.clearTimeout(id); if (fallback !== null) window.clearTimeout(fallback); };
    }
    const id = window.setTimeout(() => setBeatIdx((k) => k + 1), d);
    return () => window.clearTimeout(id);
    // `seekNonce`: not a cue, but a same-index re-seek must RESTART this hold rather than inherit whatever
    // remains of the original one — re-seek late in a beat and the replayed cues would be cut off almost
    // immediately, showing a flash instead of the moment. The cleanup clears the pending timeout, so the
    // extra dep can only restart the timer; it can never double-advance.
  }, [active, hidden, paused, beatIdx, seekNonce, beats, combatSpeed, events, cardIds]);

  // Hold on the final beat: once the clock reaches the end, wait FINAL_HOLD_MS before reporting `done` — so
  // the last kill's death collapse + damage float fully play before cleanup + the round-end UI take over.
  // A `returning` death in the LAST beat needs a longer, WALL-CLOCK floor: the pull-home fade is fixed CSS
  // (`.dying.dr.returning` ends ≈ 0.72s delay + 0.42s fade = 1.14s regardless of combatSpeed), while finalHold
  // divides by speed — without the floor the fight settles at ~900ms (or less at higher speed) and rips the
  // last clash's returning card out mid-fade (the end-of-fight blink).
  useEffect(() => {
    if (!active || !replayComplete) return;
    const last = beats[beats.length - 1];
    // The floor is that death's OWN pull-home hold + a small buffer for the fade's tail — so a plain trade
    // settles ~200ms sooner than a Deathrattle one instead of everything paying the DR figure.
    const pull = last ? pulledHomeAttackerHold(last, attackerOfImpact(beats, beats.length - 1), events, cardIds) : 0;
    const hold = Math.max(getChoreoConfig().finalHold / combatSpeed, pull > 0 ? pull + 100 : 0);
    const t = window.setTimeout(() => setFinished(true), hold);
    return () => window.clearTimeout(t);
  }, [active, replayComplete, combatSpeed, beats, events, cardIds]);

  // Trigger-medallion pulse — when a unit's EFFECT fires this beat (Start-of-Combat, Deathrattle/summon,
  // buff/aura, Rally, Avenge, Sergeant's HP-grant, Reborn), its trigger icon releases a ring of energy.
  // We tag the acting unit's uid, then clear it after the pulse animation so it always completes (and a
  // re-trigger restarts it). Held a fixed ~1.15s (glow flash + delayed ring) regardless of combat speed.
  useEffect(() => {
    if (!active || beatIdx === 0) return;
    const beat = beats[beatIdx - 1];
    if (!beat) return;
    const trig = new Set<string>();
    const beatWatchers: string[] = [];
    // The player's uids: the initial player board + every player-side summon in the whole log. Enemy-sourced
    // narrations (spell power, auras) are filtered against this so they never draw on the player's board and
    // vice-versa. Cheap — a Set built once per beat effect from data already in scope.
    const playerUids = new Set<string>((combat?.initial.player ?? []).map((u) => u.uid));
    for (const ev of events) if (ev.type === 'summon' && ev.side === 'player') playerUids.add(ev.minion.uid);
    // Refresh the last-known rects for everyone still on screen, THEN resolve anchors below through
    // `anchorOf`. Order matters: a unit that dies in this beat is already gone from the DOM, so its entry has
    // to come from the previous beat's snapshot.
    const rects = lastRectRef.current;
    for (const uid of playerUids) {
      const el = findEl(uid);
      if (el) rects.set(uid, layoutRectOf(el));
    }
    /** The slot to hang a source-anchored effect on: live if the unit is still up, else where it last was. */
    const anchorOf = (uid: string): { cx: number; cy: number; w: number; h: number } | null => {
      const el = findEl(uid);
      if (el) { const r = layoutRectOf(el); rects.set(uid, r); return r; }
      return rects.get(uid) ?? null;
    };
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (!e) continue;
      // TUTORIAL (read-only): report this event as PRESENTED so a Predict/Confirm coach step can advance at the
      // right beat. A no-op on every non-tutorial fight (the bus is empty). Never changes timing/order/FX.
      notifyPresented(e);
      // NB: `rally` is intentionally NOT here — a Rally that fires as a unit attacks pulses YELLOW from the
      // lunge's wind-up pause instead (see the attack layout effect), so it reads at the swing, not beat-start.
      // A `shout` pulses through `onShoutProc` (the re-triggering unit + the Shout's owner), not the white trigger.
      if (e.type === 'shout') continue;
      if ((e.type === 'sc' || e.type === 'buff' || e.type === 'keyword') && e.source) trig.add(e.source);
      else if ((e.type === 'summon' || e.type === 'toHand') && e.source) trig.add(e.source);
      else if (e.type === 'improve' || e.type === 'maxGold' || e.type === 'hpGrant' || e.type === 'reborn') trig.add(e.target);
      // A death whose unit has a Deathrattle/Avenge effect: its trigger just fired (the cleanest signal —
      // the resulting summon/buff events don't reliably carry the dying unit as their source).
      else if (e.type === 'death') {
        const effs = CARD_INDEX[cardIds.get(e.target) ?? '']?.effects;
        if (effs?.some((f) => f.on === 'onDeath' || f.on === 'avenge')) trig.add(e.target);
      }
    }
    // WATCHER pulse: on an attack beat, a non-attacker unit (any side, mirroring the trigger scan) that fired
    // an effect this beat is a watcher answering the swing (Crypt Drake, Mineral Master, …). Give it the distinct
    // light-blue look — medallion recolored + a card-frame bloom — instead of the generic white medallion pulse.
    // Additive: it keeps a medallion pulse (now blue) and gains the frame. Purely presentation; timed to the same
    // beat the white pulse would have fired.
    if (beat.primary.type === 'attack') {
      const watchers = watcherPulseUids(beat, events, beat.primary.attacker);
      for (const uid of watchers) {
        trig.delete(uid); // take the light-blue medallion class, not white
        beatWatchers.push(uid); // still feed the SFX gate below so watcher-only beats keep their sound
        // light-blue medallion (nonce → remount → animation restarts, mirroring firePulse/rallyPulse)
        const wn = ++watcherNonceRef.current;
        setWatcherPulse((prev) => new Map(prev).set(uid, wn));
        window.setTimeout(() => setWatcherPulse((prev) => { const m = new Map(prev); if (m.get(uid) === wn) m.delete(uid); return m; }), 1150);
        // card-frame bloom: Pixi ring-bloom when the def is committed + playable, else the CSS overlay
        if (watcherPixiReady(!!getDef(WATCHER_PULSE_DEF_ID), canPlayDefs())) {
          const a = anchorsForUnits(uid, uid); // source = target = the watcher's own card
          // Literal id (not WATCHER_PULSE_DEF_ID) so the directCalls scanner — a text pass over literal
          // playDef calls, see fx/directCallScan.ts — can attribute this site; keep in sync with
          // WATCHER_PULSE_DEF_ID in fx/watcherPulse.ts.
          if (a) playDef('watcher-pulse', a, { uids: { source: uid, target: uid } });
        } else {
          const fn = ++frameNonceRef.current;
          setFramePulse((prev) => new Map(prev).set(uid, fn));
          window.setTimeout(() => setFramePulse((prev) => { const m = new Map(prev); if (m.get(uid) === fn) m.delete(uid); return m; }), 1150);
        }
      }
    }
    // SPELL POWER gained mid-combat: `grantSpellPower` already emits an `sc` narration carrying the SOURCE
    // unit and a "+A/+H Spell Power" text, so the flourish rides that rather than needing a new choreo
    // channel. Fired over the unit that caused it, matching the shop behaviour (owner ask 2026-07-21).
    for (let i = beat.start; i < beat.end; i++) spellPowerNarration(events[i], playerUids, anchorOf);
    // SPELLS CAST mid-combat (owner ask 2026-08-07, for Yirin's Attunement): every player-side `spellcast`
    // event bumps the display-only counter, so the hero-power tracker ticks AS the casts happen.
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (e?.type === 'spellcast' && e.side === 'player') useGame.getState().dispatch({ type: 'combatSpellCastPreview' });
    }
    // FRIENDLY DEATHS mid-combat (owner ask 2026-08-24, for Cindara's Hoard): every player-side death ticks
    // her Avenge (4) tracker live. Gated on wielding Hoard because deaths are FAR more common than spellcasts,
    // so a per-death reducer dispatch for every other hero would be pure waste. `!e.rise` matches `simulate`'s
    // avenge count exactly on the common path: a first Rise returns and is not avenged. (A board-full Rise that
    // stays dead is a rise-flagged death that DID count — the one case this cosmetic tracker can lag by one; it
    // re-syncs at settle, where the preview clears.)
    if (hasPower(useGame.getState().run, 'hoard')) {
      for (let i = beat.start; i < beat.end; i++) {
        const e = events[i];
        if (e?.type === 'death' && e.side === 'player' && !e.rise) useGame.getState().dispatch({ type: 'combatFriendlyDeathPreview' });
      }
    }
    // GORUN's Blade Mastery grant climbs live (owner ask 2026-08-24): each player-side `bladeMastery`
    // questTrigger is exactly one buffed attack, so the +N grant and its "every 8" countdown tick as the swings
    // land rather than jumping at settle. Gated on wielding it, same reason as Cindara's above.
    if (hasPower(useGame.getState().run, 'bladeMastery')) {
      for (let i = beat.start; i < beat.end; i++) {
        const e = events[i];
        if (e?.type === 'questTrigger' && e.flag === 'bladeMastery' && e.side === 'player') useGame.getState().dispatch({ type: 'combatBladeAttackPreview' });
      }
    }
    // FRONT TO BACK improving itself mid-combat (owner ask 2026-08-07): the resolver narrates each
    // improvement, and this moves the HELD card's printed value live via the display-only preview action.
    // Player-side only — `side` is stamped on the narration, so an enemy Quil's casts don't touch your hand.
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (!e || e.type !== 'sc' || !e.text || e.side !== 'player') continue;
      const m = /improves \+(\d+)\/\+(\d+)$/.exec(e.text);
      if (!m) continue;
      useGame.getState().dispatch({ type: 'combatEscalationPreview', attack: Number(m[1]), health: Number(m[2]) });
      fireSpellBuffOnHandSpells(useGame.getState().run.hand); // pop the held spells, same cue as spell power
    }
    // RUBY POWER gained mid-combat (owner ask 2026-07-24) — Veinbreaker's Avenge and friends. `gainRubyBonus`
    // used to accumulate silently and only surface at settle, so there was nothing to hang a cue on at the
    // moment it fired; it now emits the same `sc` narration shape spell power does, which is what this reads.
    // Player-side gating is identical and for the same reason: `sc` carries no `side`, so an enemy source would
    // otherwise draw the flourish on the opponent's half of the board.
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (!e || e.type !== 'sc' || !e.source || !e.text) continue;
      const m = /^\+(-?\d+)\/\+(-?\d+) Ruby Power$/.exec(e.text);
      if (!m) continue;
      const gA = Number(m[1]), gH = Number(m[2]);
      if (gA <= 0 && gH <= 0) continue;
      if (!playerUids.has(e.source)) continue;
      const a = anchorOf(e.source);
      if (!a) continue;
      const { cx, cy, h } = a;
      pixiFx.rubyPower(cx, cy, getRubyPowerFxConfig());
      floatRubyPowerNumber(cx, cy - h * 0.3, gA, gH);
      // …and pop the held Rubies themselves, so the player sees WHICH cards the gain lands on. The spell-buff
      // bus is callable from here precisely because it no longer lives in Recruit's state.
      fireSpellBuffOnHandRubies(useGame.getState().run.hand);
    }
    // PROC CRIT (Karwind's 20% double trigger). Unlike the two gains above this carries its own `source` uid
    // on a dedicated event, so no text-matching and no side-gating heuristic is needed — an enemy Karwind's
    // crit simply resolves to an enemy slot and draws there, which is correct.
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (!e || e.type !== 'proccrit') continue;
      const a = anchorOf(e.source);
      if (!a) continue;
      const { cx, cy, h } = a; // SLOT, not the live rect — the proccer may be mid-lunge
      pixiFx.procCritText(cx, cy - h * 0.45, `${e.mult}x`);
    }
    // RUNE-BUFF-UNIT (owner ask 2026-08-19): any minion a RUNE buffs this beat gets the sparkle, on the unit.
    // Combat rune buffs (Ruins, Aftershocks, Wild Hunt, Inheritance, Hatchery's stat grant, …) carry a rune
    // SOURCE LABEL on the buff event (`'Rune of Ruins'`, etc.), not a source uid, so this fires independently
    // of the tendril grouping (which keys on a living source). Both sides — an enemy's rune buff sparkles on
    // its own minion, which is correct.
    if (canPlayDefs()) {
      const rbCamera = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      for (let i = beat.start; i < beat.end; i++) {
        const e = events[i];
        if (!e || e.type !== 'buff' || !isRuneBuffSource(e.source)) continue;
        const a = anchorOf(e.target);
        if (!a) continue;
        playDef('rune-buff-unit', { target: { x: a.cx, y: a.cy }, camera: rbCamera }, { uids: { target: e.target } });
      }
    }
    // SHOP BUFF earned mid-combat (Demon Horse and friends). Unlike the Imp buff — which already blooms the
    // board aura-wash off its `tribeAura` event — this one accumulated with NO cue at all and only showed up in
    // the next shop, so the moment it was earned looked like nothing happened (owner report 2026-07-31). Rides
    // the same `sc` narration shape spell power and Ruby power use, with the identical player-side gate.
    let shopBuffAnchor: { cx: number; cy: number; uid: string } | null = null;
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (!e || e.type !== 'sc' || !e.source || !e.text) continue;
      const m = /^\+(-?\d+)\/\+(-?\d+) Shop$/.exec(e.text);
      if (!m) continue;
      const gA = Number(m[1]), gH = Number(m[2]);
      if (gA <= 0 && gH <= 0) continue;
      if (!playerUids.has(e.source)) continue;
      const a = anchorOf(e.source);
      if (!a) continue;
      const { cx, cy, h } = a;
      floatSpellPowerNumber(cx, cy - h * 0.3, gA, gH);
      shopBuffAnchor = { cx, cy, uid: e.source };
    }
    // The authored `shop-buff-aura` bloom, in the LUNGE with the number — because the `sc` is now absorbed into
    // the attack wind-up (choreo/compile.ts), this block runs at the attack beat's presentation. Previously the
    // aura ONLY played later, over the shop row, on return to recruit (reducer's `tavernBuyBonus` diff) — so a
    // Shop buff earned mid-combat had no on-attack bloom (owner report 2026-08-18). ONE camera-anchored play per
    // beat (deduped over several shop-buffers), anchored at the last buffer for any source/target layers; the
    // shop-row confirmation on return still fires there, a different surface.
    if (shopBuffAnchor) {
      const camera = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      const at = { x: shopBuffAnchor.cx, y: shopBuffAnchor.cy };
      playDef('shop-buff-aura', { source: at, target: at, camera }, { uids: { source: shopBuffAnchor.uid, target: shopBuffAnchor.uid }, index: 0 });
    }
    // RUN-WIDE TRIBE AURA rose this beat (Ryme, Anubis's Lantern of Souls, Deathswarmer, …): bloom the board
    // aura-wash, the SAME cue the recruit phase shows off `auraFxSeq`. Player side only — the wash is a
    // "your board got stronger" read, and the recruit version is player-only too. Deduped per (tribe) so a
    // multi-source beat washes each tribe once. (owner ask 2026-07-21.)
    const washedTribes = new Set<string>();
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (!e || e.type !== 'tribeAura' || e.side !== 'player') continue;
      if (washedTribes.has(e.tribe)) continue;
      washedTribes.add(e.tribe);
      fireCombatAuraWave(e.tribe);
    }
    // A SPELL CAST MID-COMBAT plays the SPELL's own clip, not just the caster's (owner ask 2026-09-01:
    // Dragonflame's sound must follow the spell "from cards that cast it in combat"). `spellId` is stamped on
    // every "X casts Y" event, so this is the sound half of the same identity the FX binding reads in
    // `score.ts` — without it the spell's clip could only be reached by giving every caster its own copy.
    //
    // NOT deduped by card the way the per-unit loop below is, and NOT gated on `trig`: two casts of the same
    // spell in one beat are two casts, and the owner asked for every one of them to be shown.
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (e?.type === 'sc' && e.spellId) sfx.cardEffect(e.spellId);
    }
    if (trig.size === 0 && beatWatchers.length === 0) return;
    sfx.triggerPulse(); // once per beat regardless of how many units pulse (the dedupe is built in too)
    // Each triggering unit also plays its OWN effect voiceline (cards/<id>.effect.mp3) — the combat half of the
    // per-card effect sound (the shop half fires from store.ts on a Battlecry). Deduped by cardId so a beat with
    // several copies of one card firing plays that clip once. Silent until the clip is recorded. Watchers are
    // included here (though rerouted out of `trig` above) so a watcher-only beat still plays its trigger sound.
    const firedEffect = new Set<string>();
    for (const uid of [...trig, ...beatWatchers]) {
      const cid = cardIds.get(uid);
      if (cid && !firedEffect.has(cid)) { firedEffect.add(cid); sfx.cardEffect(cid); }
    }
    setTriggers((prev) => new Set([...prev, ...trig]));
    /* The ~1150ms hold is PER UID and must outlive the beat. This used to be one timeout cancelled by the
       effect's own cleanup, which was invisible only while every beat ran longer than the hold: the moment
       `toHand` dropped to 410 (×1.5 ≈ 615ms) the beat advanced first, the cleanup killed the pending clear,
       and the uid was never removed from the set. A unit that had pulsed once stayed flagged forever, so its
       next trigger couldn't toggle the class off→on and simply did not animate — the owner's "the effect icon
       doesn't pulse every time" (the Avenge counter, driven separately, kept firing). Keyed timers in a ref
       survive the beat change; a re-trigger inside the window restarts its own hold. */
    for (const uid of trig) {
      const prevT = pulseTimersRef.current.get(uid);
      if (prevT !== undefined) window.clearTimeout(prevT);
      pulseTimersRef.current.set(uid, window.setTimeout(() => {
        pulseTimersRef.current.delete(uid);
        setTriggers((prev) => {
          if (!prev.has(uid)) return prev;
          const next = new Set(prev);
          next.delete(uid);
          return next;
        });
      }, 1150));
    }
    // `seekNonce`: re-seeking the beat you are already on leaves `beatIdx` identical, so without it this
    // per-beat cue would not re-run and the pulse would never replay. Constant during normal playback.
  }, [active, beatIdx, seekNonce, beats, events, cardIds]);

  // Combat cues — sfx (choreo/channels/sfx.ts) + floats (choreo/channels/float.ts) for the moment just
  // resolved, dispatched via the Score's channel registry (choreo/score.ts). The melee smack/impact-FX/
  // recoil for an attack's OWN contact fire separately, from the lunge's GSAP timeline (see the layout
  // effect below) — anchored at the real `contact` position instead of this beat-boundary effect.
  useEffect(() => {
    if (!active || beatIdx === 0) return; // only during the live replay (avoids a phantom cue at shop swap-in)
    const beat = beats[beatIdx - 1];
    if (!beat) return;
    const timers: number[] = [];
    // A unit's live VIEWPORT center+footprint (for the taunt death-burst + the reborn re-form glow, both of
    // which draw on the viewport-fixed FX layer). null when the unit isn't currently measurable.
    const rectOf = (uid: string): { cx: number; cy: number; w: number; h: number } | null => {
      const el = findEl(uid);
      return el ? layoutRectOf(el) : null; // SLOT, not mid-flight — see layoutRectOf
    };
    // The reborn re-form glow is scheduled +460ms (the auraReform cue offset), but its FOOTPRINT must be the
    // unit's rect at BEAT-START — not at fire time, when the `risepop` CSS has scaled the card up to full size
    // (that would size the glow larger than pre-choreographer-panel behavior). Pre-measure here so the glow's
    // size stays byte-identical while its timing rides the cue offset.
    const rebornRects = new Map<string, { cx: number; cy: number; w: number; h: number } | null>();
    for (let i = beat.start; i < beat.end; i++) { const e = events[i]; if (e?.type === 'reborn') rebornRects.set(e.target, rectOf(e.target)); }
    const stop = runMomentCues(beat, {
      events,
      cardIds, // lets the sfx channel play a dying unit's own death voiceline (cards/<id>.death.mp3)
      combatSpeed: combatSpeedRef.current,
      // A forced-Echo CONTINUATION beat (Echohorn's 2nd+ rally, split into its own moment by the Echo's
      // consequences) must NOT re-pulse the attacker's medallion: it already pulsed at its wind-up opener, and
      // the gilded doubling reads through the repeated SPARKLE + EFFECT, not a second pulse (owner 2026-08-24).
      // `heldLungeRef` is the mid-swing attacker held through its Echo; suppress only its pulse here — the
      // sparkle (an authored `playDef`, not this callback) still fires per proc, and every other rallier pulses.
      onRallyPulse: (uid: string) => { if (heldLungeRef.current?.uid !== uid) firePulse(uid); },
      // A Shout RE-FIRE's own moment (`channels/shoutFired.ts`): the re-triggering unit pulses (the reaction
      // medallion), the Shout's owner blooms. Its consequences — the buff wave, the float, the Ruby — are this
      // moment's own events and play through the ordinary channels; the swing that caused it is parked.
      onShoutProc: (source: string, target: string) => { pulseWatcher(source); bloomFrame(target); },

      onShake: () => setShake((n) => n + 1),
      // Every float (including the killing-blow one) is anchored from this SLOT reading, taken once at
      // spawn — see spawnFloats' "the position snapshot" note.
      slotRectOf: rectOf,
      attackerUid: attackerOfImpact(beats, beatIdx - 1),
      meleePair: meleePairOfImpact(beats, beatIdx - 1),
      onFloats: (spawned) => {
        // Upsert by id: a re-spawned float (a climbing Fel Spikes volley number — same stable id, higher
        // running total) REPLACES the prior one in place so the number ticks up on ONE anchor instead of
        // stacking a pop per volley. Non-climbing floats always carry a fresh event-index id, so for them this
        // is a plain append (no id collides). The first volley's removal timer supersedes any later re-spawn's,
        // trimming the final number ~one pass-gap early — invisible against the ~1.5s float lifetime.
        setFloats((arr) => {
          const next = new Map(spawned.map((s) => [s.id, s] as const));
          const merged = arr.map((x) => next.get(x.id) ?? x);
          const present = new Set(arr.map((x) => x.id));
          return [...merged, ...spawned.filter((s) => !present.has(s.id))];
        });
        const ids = new Set(spawned.map((s) => s.id));
        floatTimersRef.current.push(window.setTimeout(() => setFloats((arr) => arr.filter((x) => !ids.has(x.id))), getChoreoConfig().floatMs / combatSpeedRef.current));
      },
      onDeathFloats: (deaths) => {
        setDeathFloats((arr) => [...arr, ...deaths.filter((s) => !arr.some((x) => x.id === s.id))]);
        const ids = new Set(deaths.map((s) => s.id));
        floatTimersRef.current.push(window.setTimeout(() => setDeathFloats((arr) => arr.filter((x) => !ids.has(x.id))), getChoreoConfig().deathFloatMs / combatSpeedRef.current));
      },
      onAuraBurst: (uid) => burstDeathAuras(uid, rectOf(uid)),
      onShieldBreak: (uid) => breakShieldAura(rectOf(uid)),
      onReborn: (uid) => reformReborn(rebornRects.get(uid) ?? rectOf(uid)),
      // Execute proc → the crescent strike at the VICTIM's slot (the unit being destroyed), read at fire time
      // so a tuner edit applies to the next proc.
      onExecuteFx: (uids) => {
        for (const uid of uids) {
          const r = rectOf(uid);
          // No blow direction here by definition: this path is the NON-melee proc (a Start-of-Combat nuke or
          // split damage), which has no attacker lunging in — so the strike takes its default rightward cut.
          // The melee case, which does have a direction, is fired from the impact channel instead.
          if (r) pixiFx.executeStrike(r.cx, r.cy);
        }
      },
      // buff-OTHER casts (source ≠ target) → tendril/descend + badge flash (shared with the attack-wind-up path).
      onBuffCasts: (casts) => fireBuffCasts(casts),
      onSelfBuffs: (selfBuffs) => fireSelfBuffs(selfBuffs),
      // An aura STRENGTHENED (Kennelmaster's Avenge bump, Mama Bear / Flowing Monk growth) → a bare in-place pulse
      // at the unit. No badge hold/flash: an `improve` grows the unit's AURA (future grants), not its own Atk/HP.
      onImprove: (uids) => {
        for (const uid of uids) {
          const el = findEl(uid);
          if (!el) continue;
          const { cx, cy } = layoutRectOf(el);
          const cardId = cardIds.get(uid) ?? '';
          const cfg = PULSE_PRESETS[pulsePreset(cardId, (CARD_INDEX[cardId]?.tribe ?? 'neutral') as Tribe)];
          pixiFx.pulse(cx, cy, cfg);
        }
      },
      // A max-Gold gain (Soulsman / Bone Taxer Avenge) → a coins burst at the unit, on top of the "+N max gold" float.
      onMaxGold: (uids) => {
        for (const uid of uids) {
          const el = findEl(uid);
          if (!el) continue;
          const { cx, cy } = layoutRectOf(el);
          playDef('coins', { source: { x: cx, y: cy }, target: { x: cx, y: cy } }, { uids: { source: uid, target: uid } });
        }
      },
      // A NON-melee hit (SC nuke / split damage / Blaster AoE) → a damage burst + impact ring at each target, so a
      // cast hit reads like a hit and not just a number. The melee pair is filtered out upstream (see `meleePair`
      // in score.ts): their hit FX rides the attack's own impact channel, fired once at contact on the defender.
      onDamageFx: (uids) => {
        for (const uid of uids) {
          const el = findEl(uid);
          if (!el) continue;
          // SLOT, not the mid-flight rect — this cue also rides `death` moments, where a dying ATTACKER is
          // mid-pull-home. See layoutRectOf: this exact site was the phantom mid-board ring.
          const { cx, cy } = layoutRectOf(el);
          // The crimson hit burst is the authored `damage-burst` def (migrated out of `pixiFx`); the impact
          // ring beside it is still hand-written — it takes a per-call size, which `playDef` cannot pass yet.
          playDef('damage-burst', { source: { x: cx, y: cy }, target: { x: cx, y: cy } }, { uids: { source: uid, target: uid } });
          pixiFx.impactPulse(cx, cy);
        }
      },
      // A summon arrival → a dust poof under the new unit. Fired late (cue offset) so the summonpop scale-in has
      // grown it to a measurable, full size; skip if the element isn't resolvable (e.g. a summon off-screen).
      onSummonFx: (uids) => {
        for (const uid of uids) {
          const el = findEl(uid);
          if (!el) continue;
          const { cx, cy, w, h } = layoutRectOf(el);
          if (w < 1 || h < 1) continue; // not laid out yet → no valid spawn rect
          // The authored `landing-dust` def, sized to THIS card via `playDef`'s per-call `scale` (which is
          // what the hand-written `pixiFx.dust(cx, cy, w, h)` used its w/h for).
          playDef('landing-dust', { source: { x: cx, y: cy }, target: { x: cx, y: cy } }, { scale: cardFxScale(w), uids: { source: uid, target: uid } });
        }
      },
      // A transform (Tara→Taragosa, Spirit Pup→Worgen) → bloom a flash over the unit, masking the card swap
      // (owner-tuned `flash` morph). The new card's pop-in rides the CSS `ascendpop` anim (see the anims map).
      onAscend: (uids) => {
        for (const uid of uids) {
          const el = findEl(uid);
          if (!el) continue;
          const { cx, cy } = layoutRectOf(el);
          const cardId = cardIds.get(uid) ?? '';
          const cfg = ASCEND_PRESETS[ascendPreset(cardId, (CARD_INDEX[cardId]?.tribe ?? 'neutral') as Tribe)];
          pixiFx.flashBloom(cx, cy, {
            flashSize: cfg.flashSize, flashMs: cfg.flashMs, flashAlpha: cfg.flashAlpha, colorGlow: cfg.colorGlow, blend: 'screen',
          });
        }
      },
    });

    // A Rise DEFENDER (dying but NOT the impact attacker being pulled home) explodes in place immediately —
    // the runner skips rise deaths, and the engine's runRiseReturn only handles the pulled-home ATTACKER.
    const impactAtk = attackerOfImpact(beats, beatIdx - 1);
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (e?.type === 'death' && e.rise && e.target !== impactAtk) burstDeathAuras(e.target, rectOf(e.target));
    }
    // Deathrattle skull-shatter: any dying unit whose card has an onDeath effect (a Deathrattle) fires the
    // painted bone skull — INCLUDING a Rise death. A unit with both Rise + a Deathrattle procs its rattle as it
    // dies (owner ruling), so the skull pops even though the body will re-form; a pure-Rise unit (no onDeath)
    // still gets nothing. EXCEPTION: the impact ATTACKER (it died mid-lunge) is pulled back to its slot first,
    // and fires its skull at `landed` from the layout effect below — so we skip it here (no mid-lunge skull).
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (e?.type !== 'death' || e.target === impactAtk) continue;
      if (!CARD_INDEX[cardIds.get(e.target) ?? '']?.effects?.some((f) => f.on === 'onDeath')) {
        // …and a PLAIN death (no Deathrattle) gets the authored `death-dissolve` def instead. It lives in the
        // `else` of the SKULL's own gate, in the skull's own loop, so the two can never both fire for one unit
        // — the reason this isn't an `fxDef` cue in the Score: a cue is chosen by moment KIND, and a kind is
        // derived from the event alone, which cannot see whether the dying card has an onDeath effect.
        // Rise deaths are excluded too (the body re-forms — it doesn't dissolve). Inert in production, where
        // defs don't ship (`canPlayDefs()` false), and a no-op until `death-dissolve` is authored (`playDef`
        // returns null for an unknown id).
        if (!e.rise && canPlayDefs()) {
          const a = anchorsForUnits(null, e.target); // no source: the anchors fold onto the dying unit
          if (a) playDef('death-dissolve', a, { uids: { source: null, target: e.target } });
        }
        continue;
      }
      const r = rectOf(e.target);
      if (r) pixiFx.deathrattle(r.cx, r.cy, r.w);
      // Fel Spikes' Echo: LAUNCH the spike volley from the dying body — a breath after the skull, while it is
      // still on screen — toward every unit its upcoming spray will strike, a beat before the damage lands (the
      // beat clock holds that beat for the beam's travel, `echoDeliveryLead`). Golden sprays twice as two quick
      // taps. The stock hit-burst on the damage beat is still claimed + suppressed by the fxDef fan-out; only
      // the projectile is relocated here.
      const echoBinding = bindingFor(cardIds.get(e.target) ?? null, 'damage');
      if (r && echoBinding?.launchOnDeath) {
        // Combat-lifetime registry, NOT `timers`: later volleys fire after the beat advances, so the per-beat
        // cleanup must not clear them (see `echoVolleyTimersRef`). A seek/reset cancels them via cancelPendingRolls.
        scheduleEchoVolleys(echoBinding.def, e.target, i, events, combatSpeedRef.current, (id) => echoVolleyTimersRef.current.push(id));
      }
    }
    // FORCED Echo trigger (Echohorn's Rally / Hawkus / Spots): the sprayer is ALIVE — there is no death to hang
    // the volley on — so launch its spikes from the LIVING body when its rally fires. Same combat-lifetime
    // registry + same `echoDeliveryLead` hold as the death path, so travel + the climbing numbers read
    // identically. Each rally claims only ITS OWN waves (bounded by the NEXT rally to the same sprayer), so a
    // golden Echohorn's two rallies throw two sprays instead of one launch double-counting the other's waves.
    if (canPlayDefs()) {
      for (let i = beat.start; i < beat.end; i++) {
        const e = events[i];
        if (e?.type !== 'rally' || typeof e.target !== 'string') continue;
        const rallyBinding = bindingFor(cardIds.get(e.target) ?? null, 'damage');
        if (!rallyBinding?.launchOnDeath || !rectOf(e.target)) continue;
        let endIdx = events.length;
        for (let j = i + 1; j < events.length; j++) {
          const n = events[j];
          if (n?.type === 'rally' && n.target === e.target) { endIdx = j; break; }
        }
        // If this rally is absorbed into the attacker's wind-up (held windup), delay the first launch past the
        // rear-back so the spikes fly only once the attacker has fully reared back + paused.
        const windupLead = beat.primary.type === 'attack' ? ECHO_WINDUP_HOLD_MS : 0;
        scheduleEchoVolleys(rallyBinding.def, e.target, i, events, combatSpeedRef.current, (id) => echoVolleyTimersRef.current.push(id), endIdx, ECHO_RALLY_LAUNCH_DELAY_MS + windupLead);
      }
    }
    // HELD WINDUP resolve: a parked Echohorn lunge resumes its strike the beat its OWN attack lands (a non-wave
    // `dmg` it deals), or is released into its death animation if the deferred spray killed it first. A death in
    // the beat wins — a dead attacker never swings.
    const held = heldLungeRef.current;
    if (held) {
      let died = false;
      let struck = false;
      let targetGone = false;
      // The WHOLE beat is scanned before deciding: the old loop broke on the attacker's death, so a beat
      // carrying both its strike and its death read as a death alone.
      for (let i = beat.start; i < beat.end; i++) {
        const e = events[i];
        if (e?.type === 'death' && e.target === held.uid) died = true;
        if (e?.type === 'death' && e.target === held.defender) targetGone = true;
        if (e?.type === 'dmg' && e.source === held.uid && e.wave === undefined) struck = true;
      }
      if (held.resumed && (struck || died)) {
        // The beat clock already resumed this strike and its contact (or the fallback) brought us here: the
        // swing is in flight or landed, so the park is simply over. A death in this beat is handled the way a
        // normal swing's retaliation death is — the dying-attacker pull-home — not by killing the pose.
        heldLungeRef.current = null;
        parkedCommitRef.uid = null;
      } else if (died) {
        held.tl.kill(); // drop the parked pose so the death plays from rest; the lunge never fires
        const el = findEl(held.uid);
        if (el) { setTransition(el, ''); gsap.set(el, { clearProps: 'transform,zIndex' }); }
        heldLungeRef.current = null;
        parkedCommitRef.uid = null;
      } else if (struck) {
        // Reached only when the clock could not resume (no live timeline at the time) — the old release.
        held.tl.play(); // resume: strike → contact → settle, out of the held pose
        heldLungeRef.current = null;
        parkedCommitRef.uid = null;
      } else if (targetGone) {
        /**
         * ITS TARGET DIED BEFORE IT COULD SWING — the swing is cancelled and the body relaxes.
         *
         * The park is released by the attacker's OWN damage landing. Since 2026-09-01 the engine SKIPS the
         * clash when the target died in the wind-up (no damage out, no retaliation back), so that damage never
         * comes and the release had no third way out: the attacker stood reared back for the rest of the
         * fight. Two conditions were never enough — a swing can also simply be cancelled.
         *
         * Tweened home rather than the death branch's `clearProps` snap, because this body is alive and on
         * screen: it should relax out of the pose, not teleport out of it. No strike — there is nothing left
         * to hit, and lunging into an empty slot reads as a miss the engine never had.
         */
        held.tl.kill();
        const el = findEl(held.uid);
        if (el) {
          gsap.to(el, {
            x: 0, y: 0, rotation: 0, scale: 1,
            duration: 0.24 / (combatSpeedRef.current > 0 ? combatSpeedRef.current : 1),
            ease: 'power2.out',
            onComplete: () => { setTransition(el, ''); gsap.set(el, { clearProps: 'transform,zIndex' }); },
          });
        }
        heldLungeRef.current = null;
        parkedCommitRef.uid = null;
      }
    }
    // Stop showing a CLIMBING Fel Spikes number on a unit that DIES: its number is a persistent (held) float,
    // so drop it when its victim's death lands — a dead unit shows no lingering tally (owner ask 2026-08-22).
    const dyingThisBeat = new Set<string>();
    for (let i = beat.start; i < beat.end; i++) { const e = events[i]; if (e?.type === 'death') dyingThisBeat.add(e.target); }
    if (dyingThisBeat.size > 0) {
      setFloats((arr) => (arr.some((x) => x.kind === 'dmg' && dyingThisBeat.has(x.uid)) ? arr.filter((x) => !(x.kind === 'dmg' && dyingThisBeat.has(x.uid))) : arr));
    }
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      // The buff strike timer + the roll it hands off to are NOT in `timers` (Task 6) — `fireBuffCasts`/
      // `fireSelfBuffs` schedule those in the combat-lifetime roll registry instead (`scheduleRoll`, near
      // `resetTo`), which this ordinary per-beat cleanup deliberately does not touch. That's what makes a
      // buff's roll survive the race against lunge CONTACT advancing the beat — see the registry's own
      // comment for the measured margins that used to lose the timer to this exact cleanup.
      stop();
    };
    // `seekNonce`: see the trigger-pulse effect above — a re-seek to the same beat must re-fire these cues.
  }, [active, beatIdx, seekNonce, beats, events, findEl, cardIds, fireBuffCasts, fireSelfBuffs]);

  // Verdict sting when the replay finishes.
  useEffect(() => {
    if (!active || !done || !combat) return;
    if (combat.result === 'win') sfx.win();
    else if (combat.result === 'lose') sfx.lose();
  }, [active, done, combat]);

  // Measure lunge + SC projectiles AFTER the beat commits, so positions reflect the
  // frame on screen (not the previous one). Runs synchronously before paint.
  useLayoutEffect(() => {
    const cur = beatIdx > 0 ? beats[beatIdx - 1] : undefined;
    const center = (uid: string): { x: number; y: number } | null => {
      const el = findEl(uid);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };

    // A RISE ATTACKER dying to retaliation returns HOME first: the engine's `runRiseReturn` kills the slow
    // elastic settle and pulls the unit straight back to its slot (a short hold so the contact reads, then a
    // quick pull), then fires the spirit burst the moment the body lands — so burst + fade + re-form all land
    // in its own slot. A Rise DEFENDER never gets pulled → the cue effect bursts it in place immediately.
    if (cur) {
      const impactAtk = attackerOfImpact(beats, beatIdx - 1);
      if (impactAtk) {
        for (let i = cur.start; i < cur.end; i++) {
          const e = events[i];
          if (e?.type !== 'death' || e.target !== impactAtk) continue;
          const el = findEl(impactAtk) as HTMLElement | null;
          if (!el) continue;
          // An ATTACKER that died mid-lunge is pulled straight back to its slot, then its on-death FX fire the
          // moment it LANDS — the Rise spirit burst AND/OR the Deathrattle skull — so both play at HOME, in the
          // unit's own slot, not mid-flight. (A Rise DEFENDER never gets pulled → the cue effect bursts it in
          // place immediately; a non-attacking Deathrattle death fires its skull immediately in the cue effect.)
          const isRise = !!e.rise;
          const hasDR = !!CARD_INDEX[cardIds.get(impactAtk) ?? '']?.effects?.some((f) => f.on === 'onDeath');
          // EVERY dying attacker is pulled home (not just Rise/Deathrattle ones): a plain death — e.g. a REBORN
          // unit's true death, which has shed its `R` and has no rattle — otherwise fades mid-lunge, which reads
          // jarring. The pull is universal; the on-land FX below stay gated (only Rise bursts / only DR skulls).
          // Capture the unit's rect NOW (it's present — we just passed the `!el` guard). In a MUTUAL kill
          // (attacker + defender both die), the dying attacker can be dropped from the DOM before the ~0.34s
          // pull-back's `onLanded` fires, so re-finding it there returns null and the skull/burst was LOST.
          // Fall back to this captured rect so the FX always fire — at home when the unit survives the
          // pull-back, at its last-known spot otherwise.
          // Captured in the LAYOUT frame: this runs while the attacker is still mid-lunge, so its live rect is
          // in flight. As a fallback for the FX below it must be the unit's SLOT — the pull-home is heading
          // there, and a mid-flight fallback would drop the skull/burst over empty board.
          const capRect = layoutRectOf(el);
          runRiseReturn(el, combatSpeedRef.current, () => {
            const rEl = findEl(impactAtk);
            const rect = rEl ? layoutRectOf(rEl) : capRect;
            if (isRise) burstDeathAuras(impactAtk, rect);                       // spirit release, at home
            if (hasDR) pixiFx.deathrattle(rect.cx, rect.cy, rect.w);            // bone-skull shatter — always fires
            // Fel Spikes killed MID-ATTACK (it swung and died to retaliation) lands here, not the immediate
            // death loop — so its Echo volley must launch from the pulled-home body here too, or the death
            // shows no spikes (owner report 2026-08-20: a second Fel Spikes didn't fire). Registered in the
            // combat-lifetime registry (like the immediate path) so later volleys survive the beat advance and
            // a seek/reset still cancels them.
            const echoBinding = bindingFor(cardIds.get(impactAtk) ?? null, 'damage');
            if (echoBinding?.launchOnDeath) {
              scheduleEchoVolleys(echoBinding.def, impactAtk, i, events, combatSpeedRef.current, (id) => echoVolleyTimersRef.current.push(id));
            }
          });
        }
      }
    }

    // On the attack beat the attacker is marked (the glow) and the choreo engine runs the whole cue
    // timeline — wind up, strike toward the defender, the contact-anchored impact FX/sfx/recoil, the
    // beat-clock ADVANCE itself (fired from the SAME GSAP position — see choreo/engine.ts), then an
    // elastic settle.
    if (cur?.primary.type === 'attack') {
      const atkEl = findEl(cur.primary.attacker);
      const a = center(cur.primary.attacker);
      const d = center(cur.primary.defender);
      // Wards this exchange consumed (attacker/defender): shatter them AT the lunge's contact (onImpactAuras),
      // not on the old fixed start+300ms cue that drifted off the hit — see score.ts (auraBreak removed here). The
      // ward is CSS now, so the shatter fires at the unit's live rect (no Pixi bubble to read coords from).
      const wardTargets: string[] = [];
      for (let i = cur.start; i < cur.end; i++) { const e = events[i]; if (e?.type === 'shield') wardTargets.push(e.target); }
      // EXECUTE proc inside this exchange → the strike REPLACES the standard hit FX at contact (see impact.ts).
      // Gated on a `poison` EVENT, not on the attacker carrying `V`: the keyword is spent after one kill, so a
      // keyword check would keep slashing on later swings that no longer execute anything.
      let executeSlash = false;
      for (let i = cur.start; i < cur.end; i++) { if (events[i]?.type === 'poison') { executeSlash = true; break; } }
      // DELIBERATELY the LIVE rect, not `layoutRectOf`: the Ward dome is CSS drawn ON the card, so it rides the
      // lunge — the gold shatter has to pop where the bubble visibly is (mid-strike, at contact), not back at
      // the unit's empty slot. The opposite call from the unit-marking FX; don't "fix" this to match them.
      const rectFor = (uid: string) => { const r = findEl(uid)?.getBoundingClientRect(); return r ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height } : null; };
      const breakWards = wardTargets.length ? () => { for (const t of wardTargets) breakShieldAura(rectFor(t)); } : undefined;
      if (atkEl && a && d) {
        setAttackUid(cur.primary.attacker);
        // A Rally firing as THIS unit attacks → the lunge pauses at the top of the wind-up and flashes the
        // attacker's YELLOW trigger pulse before the strike (so the Rally + its effects read as one beat).
        // ANY attacker with the RL keyword rallies on its own swing — check the unit's LIVE keywords first (the
        // frame mirror covers a Rally granted mid-combat too), then its printed keyword off the card index, then
        // the `rally` event (Deathsayer's Rally→Echo — a subset kept as a final fallback).
        const atkUid = cur.primary.attacker;
        const atkUnit = frameRef.current?.player.find((u) => u.uid === atkUid) ?? frameRef.current?.enemy.find((u) => u.uid === atkUid);
        let rallies = !!atkUnit?.keywords.includes('RL') || !!CARD_INDEX[cardIds.get(atkUid) ?? '']?.keywords?.includes('RL');
        if (!rallies) for (let i = cur.start; i < cur.end; i++) { const e = events[i]; if (e?.type === 'rally' && e.source === atkUid) { rallies = true; break; } }
        // Buffs absorbed into this attack's wind-up (on-attack / on-ally-attack / Rally buffers) → fire their FX at
        // the top of the wind-up (after the yellow rally pulse), so the beat reads pulse → tendril → lunge. Buff-
        // OTHERS rain a tendril/descend; the buffer's own SELF-buff (which `groupBuffCasts` skips) pops an in-place
        // pulse — the same split the `buffWave` path makes, so an on-attack aura-of-self reads like a standalone one.
        const windupCasts = groupBuffCasts(cur, events);
        const windupSelfBuffs = groupSelfBuffs(cur, events);
        /**
         * DOES THIS SWING CHANGE STATS AT ALL? — the question the wind-up pause actually turns on.
         *
         * `groupBuffCasts`/`groupSelfBuffs` answer "which stock buff cue should fire", and they deliberately
         * skip a RUBY (its gem detonation tells it instead) and know nothing about a run-wide aura. Both are
         * still stat changes the swing caused, so gating the PAUSE on those two lists alone meant a Ruby-on-
         * attack (Boulderdash's Rally) rolled its numbers with no hold at all, while an ordinary buffer held
         * (owner ask 2026-09-01: make the timing apply "across the board for any buffs that happen from
         * attacks … to boulderdash rubies, to anything like that").
         *
         * Deliberately NOT included: `summon` (its arrival has its own hold) and `improve` (an accrual that
         * feeds later summons — no badge on screen moves, so there is nothing to wait for).
         */
        let windupStatChange = windupCasts.length > 0 || windupSelfBuffs.length > 0;
        /**
         * The units this swing RUBIED, which need their badge rolled by hand.
         *
         * A Ruby's stat change is withheld by the `rubyFx` cue and released by whatever delivers it — and
         * `ruby-gem-apply`'s `react` layer does NOT carry the number, so nothing delivers it and the hold
         * simply EXPIRES. That expiry is `HOLD_TTL_MS` (1200ms), which lands just past the end of the
         * wind-up pause: the gem detonates in the hold, the pause ends, the lunge goes out, and only then
         * does the badge tick over. Exactly the report (owner 2026-09-01): *"boulderdash/maybe rubies are
         * not updating the values until after the lunge."*
         *
         * Rolling them here puts them on the same clock as every other wind-up stat change, rather than
         * making the fix an edit to an authored def (ticking `carries` on that `react` layer would also
         * work, but that is the owner's tuning surface, not plumbing).
         */
        const windupRubyUids: string[] = [];
        for (let i = cur.start; i < cur.end; i++) {
          const e = events[i];
          if (e?.type === 'buff' || e?.type === 'tribeAura') windupStatChange = true;
          if (e?.type === 'buff' && e.ruby && !windupRubyUids.includes(e.target)) windupRubyUids.push(e.target);
        }
        // HELD WINDUP: this swing's own Rally FORCE-TRIGGERS an Echo (Echohorn / Deathsayer). Whatever the Echo
        // does, the simulator resolves it BETWEEN the attacker's rally and the attacker's own strike, and only
        // the flash types (`buff`/`rally`/`summon`/…) get absorbed into the wind-up — a Fel Spikes spray's `dmg`,
        // and equally a Battlecry-replay Echo's `sc` (Dawnclaw firing an adjacent Shout), are NOT absorbed and so
        // fall out as their OWN beats after the lunge. So PARK the lunge at the top of the wind-up for ANY forced
        // Echo (proven for Dawnclaw: its `sc` + the replayed Shout's `buff` land as separate post-attack beats,
        // 2026-08-24): the attacker holds its reared-back pose through the whole Echo — every pulse, skull and
        // volley — and strikes (or dies) only once its own `dmg` finally lands (the resume above). Marked by the
        // attacker emitting a `rally` on this swing (the force-triggered-Echo signal), before its own strike.
        //
        // ── WHY THIS IS STILL THE FORCED-ECHO SIGNAL, AND NOT "did this swing absorb anything" ──────────────
        //
        // It was briefly widened to `cur.end > cur.start + 1` (2026-09-01) to get an on-attack CAST resolving
        // inside the wind-up. That worked, and broke the swing: *"the damage is being dealt from the attack
        // slightly too early, before the unit actually lunges into the attack."*
        //
        // Parking is a BEAT-SPANNING device. It advances the clock at the top of the wind-up and resumes the
        // strike on a later beat, which is exactly right for a forced Echo — whose consequences land in beats
        // of their own — and exactly wrong for a swing whose consequences were ABSORBED. Absorbed consequences
        // are inside this very moment, so there is no later beat to wait for: parking just let the damage beat
        // start while the strike was still held, and the numbers landed before the lunge had moved.
        //
        // The absorbed case needs no park at all. It needs a LONGER WIND-UP, which the lunge timeline already
        // does (`rallyPauseMs` → fire the consequences → hold the pose → strike). Everything after the pause —
        // the lunge, its speed, contact, and the damage that rides it — keeps its original timing, which is
        // what the owner asked for: *"it should only be adding a slight pause before the lunge goes off."*
        let heldWindup = false;
        if (rallies) {
          for (let i = cur.start; i < events.length; i++) {
            const e = events[i];
            if (e?.type === 'attack' && i > cur.start) break;
            if (e?.type === 'rally' && e.source === atkUid) { heldWindup = true; break; }
          }
        }
        // A SHOUT RE-FIRE ahead of this swing's own strike (Hawkus forcing Dawnclaw's Echo → Wardkeeper ×
        // Drakko; Chorus Drake; Embercrest) parks the swing exactly like a forced Echo does: each fire is its
        // own moment (`compileMoments`'s `shout` branch) with its own frame commit and number roll, played
        // while the attacker holds its pose; the strike resumes on its own damage beat through the same
        // `heldLungeRef` release (struck / died / target gone). Owner call 2026-09-01, after the absorbed
        // version — every fire committing at once, then a frozen pause — was rejected.
        if (!heldWindup && shoutsAheadOf(cur, events, atkUid)) heldWindup = true;
        const advance = () => setBeatIdx((k) => k + 1);
        const tl = runAttackExchangeCues(cur, atkEl, findEl(cur.primary.defender), d.x - a.x, d.y - a.y, {
          combatSpeed: combatSpeedRef.current, advance,
          holdAfterWindup: heldWindup,
          onWindupHeld: heldWindup ? advance : undefined,
          // Bound at RESUME time by the beat clock (see `parkedContactRef`): the strike's contact advances into
          // the attacker's own damage beat. Read through the ref so the timeline built now can fire the release
          // decided many beats later.
          onParkedContact: heldWindup ? () => parkedContactRef.current?.() : undefined,
          onRallyPulse: rallies ? () => firePulse(atkUid) : undefined,
          // How many procs this swing carries — the wind-up stretches to fit their pulse→sparkle pairs.
          // Only Echohorn can exceed 1 today (see `rallyProcsFor`).
          rallyProcs: rallyProcsFor(cur, events, atkUid),
          // Supplying this does two things: it fires the stock buff cues at the top of the wind-up, AND it is
          // what switches the wind-up PAUSE on (see `windupPauseS` in `channels/lunge.ts`). For a Ruby or an
          // aura both lists are empty and the callback fires nothing — the gem and the board wash are told by
          // their own channels — but the pause still happens, which is the whole point.
          onWindupBuffs: windupStatChange
            ? () => {
              fireBuffCasts(windupCasts);
              fireSelfBuffs(windupSelfBuffs);
              // …and the Rubies' numbers, which have their own FX but no deliverer (see `windupRubyUids`).
              // Same lead the authored buff defs use, so every number on this swing lands together.
              for (const uid of windupRubyUids) scheduleRoll(uid, AUTHORED_BUFF_ROLL_MS);
            }
            : undefined,
          onImpactAuras: breakWards,
          onCritImpact: cur.primary.crit ? () => setCritShake((n) => n + 1) : undefined,
          // Flurry (W): the engine fires the wind-slash gust on the EXTRA swing (swing ≥ 1). Check the unit's
          // LIVE keywords (covers Flurry granted mid-combat), then the printed keyword off the card index.
          flurry: !!atkUnit?.keywords.includes('W') || !!CARD_INDEX[cardIds.get(atkUid) ?? '']?.keywords?.includes('W'),
          execute: executeSlash,
          // Cleave -> hit-stop + claw rake. Live keywords first so a mid-combat grant/strip is honoured.
          cleave: !!atkUnit?.keywords.includes('C') || !!CARD_INDEX[cardIds.get(atkUid) ?? '']?.keywords?.includes('C'),
        });
        engineAdvancingRef.current = tl !== null; // engine owns the advance; if it couldn't build, the scheduler falls back
        // Remember a PARKED lunge so a later beat can resume its strike (attacker's own hit) or kill it (attacker
        // died in the spray). Cleared on resolve/reset. If the lunge couldn't build, there's nothing to park.
        // A NON-PARKED swing must not clear an existing park: Echohorn's Rally can summon a body that attacks
        // DURING the park, and an unconditional `: null` drops the handle to its held lunge — leaving it parked
        // with nobody able to release it. A park is cleared only by its own release, or by a reset.
        if (heldWindup && tl !== null) {
          heldLungeRef.current = { uid: atkUid, defender: cur.primary.defender, tl, resumed: false };
          parkedCommitRef.uid = atkUid;
        } else if (heldLungeRef.current?.uid === atkUid) {
          heldLungeRef.current = null;
        parkedCommitRef.uid = null; // this attacker is swinging again, un-parked — its old park is void
        }
        if (tl === null) breakWards?.(); // lunge cue dropped → no contact anchor to ride; shatter now so it isn't lost
      } else {
        setAttackUid(null);
        engineAdvancingRef.current = false; // elements unresolved — let the scheduler advance so the replay never stalls
        breakWards?.(); // no lunge to anchor to → shatter now (the bubble's last-tracked spot) rather than drop it
      }
    } else {
      setAttackUid(null);
      engineAdvancingRef.current = false;
    }

    // Projectiles: Start-of-Combat bolts (caster → its next-beat dmg targets), plus Blaster's Deathrattle
    // — purple bolts from the dying Blaster to every minion its AOE hit (the dmg events in the same beat).
    const ps: { id: number; x: number; y: number; dx: number; dy: number; kind?: string }[] = [];
    if (cur?.primary.type === 'sc' && cur.primary.cast) {
      // Only a genuine Start-of-Combat damage cast fires the projectile bolt. A mid-combat narration `sc`
      // (a spell-power gain from Cinderwing-via-Ryme, Gnasher, Bladesmith…) has no `cast` flag, so it no
      // longer flings a phantom "Ember Whelp" bolt at whatever the next beat's damage happens to be.
      const src = center(cur.primary.source);
      const next = beats[beatIdx];
      if (src && next) {
        for (let i = next.start; i < next.end; i++) {
          const ev = events[i];
          if (ev?.type === 'dmg') {
            const t = center(ev.target);
            if (t) ps.push({ id: i, x: src.x, y: src.y, dx: t.x - src.x, dy: t.y - src.y });
          }
        }
      }
    }
    if (cur) {
      for (let i = cur.start; i < cur.end; i++) {
        const ev = events[i];
        if (ev?.type !== 'death' || cardIds.get(ev.target) !== 'blaster') continue;
        const src = center(ev.target); // the dying Blaster is kept this beat, so it's still measurable
        if (!src) continue;
        for (let j = i + 1; j < cur.end; j++) {
          const d = events[j];
          if (d?.type === 'dmg') {
            const t = center(d.target);
            if (t) ps.push({ id: 100000 + j, x: src.x, y: src.y, dx: t.x - src.x, dy: t.y - src.y, kind: 'blast' });
          }
        }
      }
    }
    setProjectiles(ps);
    // No cleanup needed: this effect no longer owns any teardown-able resource of its own. The wind-up
    // buffs' strike timer + roll used to be tracked here (`windupTimers`, cleared on every beat advance) —
    // that per-beat clearing was the Task 6 bug. They now live in the combat-lifetime roll registry (see
    // `scheduleRoll`/`cancelPendingRolls` near `resetTo`), which this effect never reaches into.
    // `seekNonce`: see the trigger-pulse effect above — a re-seek to the same beat must re-measure + re-lunge.
  }, [beatIdx, seekNonce, beats, events, findEl, cardIds, fireBuffCasts, fireSelfBuffs]);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    if (!combat) return m;
    for (const u of [...combat.initial.player, ...combat.initial.enemy]) m.set(u.uid, u.name);
    for (const e of combat.events) if (e.type === 'summon') m.set(e.minion.uid, e.minion.name);
    return m;
  }, [combat]);

  // `beatIdx` can briefly outlive its beats: when a new (often shorter) combat's event log replaces the
  // previous one, this render runs with the OLD, larger beatIdx for one render *before* the reset effect
  // (`setBeatIdx(0)` on `[combat]`) fires. Guard the lookup so that stale render shows the final frame
  // instead of reading `.end`/`.start` off an out-of-range (undefined) beat — which threw, and with no
  // error boundary crash-looped the whole app into a hard lock (a long fight followed by a shorter one).
  const processedEnd = beatIdx === 0 ? 0 : (beats[beatIdx - 1]?.end ?? events.length);
  // TRUE only on that one stale render: `beatIdx` is from the previous fight, so `processedEnd` fell back to
  // `events.length` and every derived "…so far this fight" count would briefly read the WHOLE new fight at
  // once. Harmless for the self-correcting live-tick displays (they fix on the very next render), but
  // `triggeredQuests` drives a ONE-SHOT rune-badge burst that cannot be un-fired — a spike there fired every
  // one of the fight's triggers at the instant combat began (owner report 2026-08-19: "it triggers many
  // times when I press End Turn"). Gate that one memo on this.
  // Defensive: `beatIdx` should never point past `beats` now that the during-render reset (top of the hook)
  // snaps it to 0 the instant `combat` changes — `beats` and `beatIdx` update in the SAME render, so the stale
  // window that used to fire `triggeredQuests` for the whole fight at combat start (the Hatchery End-Turn
  // spike, owner probe 2026-08-20) no longer exists. Kept as cheap insurance so a future out-of-range `beatIdx`
  // still can't leak the `events.length` fallback into the one-shot rune-badge burst.
  const beatIdxIsStale = beatIdx !== 0 && beats[beatIdx - 1] === undefined;
  // Mid-replay, keep the current beat's dying minions one beat; once done, drop
  // every dead minion so the result shows only survivors.
  const beatStart = done ? processedEnd : beatIdx === 0 ? 0 : (beats[beatIdx - 1]?.start ?? 0);
  const frame = useMemo(
    () => (combat ? computeFrame(combat.initial, events, processedEnd, beatStart, names) : { player: [], enemy: [] }),
    [combat, events, processedEnd, beatStart, names],
  );
  frameRef.current = frame;

  // ── Buff stat HOLDS, installed BEFORE the browser paints this beat ────────────────────────────────────
  //
  // `frame` already includes the buffs of the beat now being cued (`processedEnd` = the previous beat's end),
  // because the FX for a beat plays while the frame shows that beat's outcome. The display is meant to lag —
  // a buffed badge holds its PRE-buff number until the tendril lands, then ticks up. That hold used to be
  // installed from the post-paint cue effect, which meant every buff painted three times: the new value for
  // one frame, then the hold snapping back to the old value, then the release ticking up again. That is the
  // "attack goes up, then down, then up when the tendrils come out" the owner filmed (2026-07-25).
  //
  // A LAYOUT effect commits the hold in the same paint as the frame advance, so the intermediate value is
  // never shown. Cheap by construction — arithmetic over one beat's buff events, no DOM measurement — so it
  // doesn't put layout work on the beat boundary. The FX path (`fireBuffCasts` / `fireSelfBuffs`) still owns
  // the RELEASE, which is what has to be timed to the animation — and, as of Task 3, the release is a ROLL
  // (`driveRoll`), not a snap: combat's `Card` now carries a `uid`, so it reads this hold the same way a shop
  // card reads a gem's.
  //
  // Places the beat's buffs into the shared module store (`fx/statHold`) at `effect` origin — its ticker
  // skips `effect` holds outright, so combat's own strike timers stay the only clock driving delivery.
  //
  // THE INVARIANT: every uid this beat is about to (re-)place must be RELEASED first, whether or not its
  // strike already fired. Two lists jointly guarantee that — `combatHeldRef` (last beat's leftovers: a uid
  // whose `driveRoll` never got to run) AND this beat's own `combatBuffDeltas` (uids whose `driveRoll`
  // *did* already fire and start walking a live hold). Releasing only the first was the Task 3 regression:
  // `driveRoll` drops a uid from `combatHeldRef` the moment it takes over delivery (so the *next* beat's
  // release-first doesn't yank a roll out from under it), but that also means a SAME-beat re-seek — a manual
  // scrub back onto the beat already on screen, mid-roll (`seekNonce` bumps, `beatIdx` doesn't) — no longer
  // finds that uid in `combatHeldRef`. `holdStat` then lands on the still-live, partially-revealed hold and
  // takes the "carry the unrevealed remainder" path: it ADDS the fresh delta on top of what's already been
  // shown, instead of replacing it — e.g. a 24-point buff half-revealed (12 shown, 12 still owed) plus a
  // fresh 24 held again totals 36 held against a 49-attack unit, printing 13 for a frame: BELOW the 25
  // pre-buff floor, a number the minion never had. Releasing this beat's own uids unconditionally (not just
  // `combatHeldRef`'s) closes that gap: `holdStat` always sees a clean slate for a uid it's about to place.
  useLayoutEffect(() => {
    // Release last beat's leftover holds — see THE INVARIANT above. On every pass through this effect,
    // including the inactive/beat-0 early-out just below: skipping it would leave a stale hold live into the
    // next real beat, and `holdStat` ACCUMULATES same-origin deltas onto a live hold rather than replacing
    // them, double-counting one beat's buff.
    for (const uid of combatHeldRef.current) releaseStat(uid);
    combatHeldRef.current = [];
    if (!active || beatIdx === 0) return;
    const beat = beats[beatIdx - 1];
    if (!beat) return;
    // Computed once and reused for both the release pass and the place pass below, rather than calling
    // `combatBuffDeltas` twice for the same beat.
    const deltas = combatBuffDeltas(beat, events, frame);
    // Same-beat damage per SURVIVING target. A unit buffed AND hit in one beat NETS into a single roll from
    // its pre-beat HP to `frame`'s true HP — both real values, so never a below-floor print — instead of a
    // health buff hold and a separate health down-roll fighting over the badge. Built once; read by the place
    // pass here and the damage pass below (`buffedThisBeat` tells that pass which uids are already handled).
    const dmgByUid = new Map(combatDamageDeltas(beat, events, frame).map((d) => [d.uid, d.health]));
    const buffedThisBeat = new Set(deltas.map((d) => d.uid));
    // Release THIS beat's own targets too, even the ones no longer in `combatHeldRef` because their strike
    // already fired and `driveRoll` took over — see THE INVARIANT above. Safe/cheap when nothing is held
    // (`releaseStat` no-ops), which covers the ordinary forward-playback case where nothing has fired yet.
    for (const d of deltas) releaseStat(d.uid);
    for (const d of deltas) {
      // `effect` origin: the store's ticker leaves it alone, so the badge holds pre-buff until the STRIKE
      // drives it — same contract an authored `react` layer gets from `carries`; combat's strike timers are
      // that layer's hand-rolled equivalent here. A hold nobody claims still fails OPEN on its own TTL
      // (`fx/statHold`), so a lost release (skip / speed change / unmount mid-beat) can't freeze a badge.
      // `ttlMs` explicit (Task 6): the default TTL floor is too tight for combat's own wind-up+travel+roll
      // chain — see `COMBAT_HOLD_TTL_MS`'s own comment for the browser-traced race this closes.
      //
      // Net the same-beat damage into HEALTH only (a hit never moves Attack): a self-buffer met by counter-
      // damage in one beat rolls both stats together on the buff's own strike clock and lands exactly on
      // `frame`. The badge holds `frame - netHealth` = the pre-beat HP and rolls to `frame` — no intermediate
      // value the unit never had. A net of 0 stores nothing (`holdStat` drops a zero delta), so the number
      // simply doesn't move, which is correct when a buff and a hit cancel out.
      const netHealth = d.health - (dmgByUid.get(d.uid) ?? 0);
      // NEVER ACCUMULATE ONTO A FOREIGN HOLD. The release pass above clears the holds THIS effect placed, but
      // a cue can have placed one for the same beat — the Ruby cue in `choreo/score.ts` is the case that bit
      // (owner report 2026-08-31). Equal ranks accumulate, so landing on top of one withholds the same change
      // twice and prints a number below the unit's floor.
      //
      // Released rather than skipped, because THIS delta is the authoritative one: it is the whole beat and
      // it nets same-beat damage into Health, which a per-Ruby land cannot see. Both sides of the race are
      // covered — whichever placer runs first, exactly one hold survives with the correct total — and a
      // carrying layer still claims whatever is live at its peak, so the gem keeps delivering its own number.
      // Synchronous, inside this layout effect: no frame can paint the released value.
      replaceHold(d.uid, { attack: d.attack, health: netHealth }, {
        origin: 'effect',
        ttlMs: COMBAT_HOLD_TTL_MS / (combatSpeedRef.current > 0 ? combatSpeedRef.current : 1),
      });
      combatHeldRef.current.push(d.uid);
    }
    // Fix round 1: damage in THIS beat interrupts any live buff roll on its target — see
    // `cancelRollForUid`'s own comment for the worked case (a below-floor print) this closes. Deliberately
    // AFTER the buff-place pass above, not before: a unit buffed AND damaged in the SAME beat (a self-buff-
    // on-attack immediately met by counter-damage, both landing in one attack-exchange beat) would otherwise
    // have its just-placed hold survive this pass, and `frame` already reflects both events regardless of
    // their order within the beat — releasing after placing always nets out at `frame`'s true value. Scans
    // every `dmg` event in the beat, not just this beat's own buff targets: the far more common case is a
    // buff from an EARLIER beat still rolling when a LATER, unrelated beat damages that same unit.
    // `dmg`-only assumption: this scan and the negative-`buff` release pass above are jointly meant to cover
    // EVERY way a held unit's live stat can fall — `dmg` here, a negative-amount `buff` there. That's exhaustive
    // today only because `ascend` transforms are strict stat upgrades and `reborn` is always preceded by the
    // death's own `dmg` event, so nothing else currently moves a stat downward. A future stat-reducing event
    // type (a decay/wither tick, a stat-lowering transform) would slip both nets: neither pass would cancel the
    // in-flight roll, so `live - held` could print below the unit's true floor until the ~2s `COMBAT_HOLD_TTL_MS`
    // fail-open backstop expires. Extend this scan (and/or the release pass above) when such an event lands.
    // Damage ROLLS the HP badge DOWN — the mirror of a buff rolling it up (owner ask 2026-08-07). This result
    // beat is already scheduled to land on CONTACT (see lungeConfig.ts's header), so a `cue` hold placed here
    // with `startAt: 0` counts the badge down from the pre-hit number the instant the blow lands; the shared
    // ticker delivers it with no strike registry, and the ease-out (`fx/statHold`) settles it onto the true
    // HP. `rollMs` is speed-scaled so a sped-up replay tightens the count exactly as `driveRoll` does for buffs.
    //
    // Three targets do NOT take this cue path:
    //  - one BUFFED this same beat — already NETTED into the buff-place pass above (its health delta had the
    //    same-beat damage subtracted), so it rolls once from pre-beat HP to `frame` on the buff's own clock;
    //    a second roll here would double it, so it's marked handled and skipped;
    //  - one with an EARLIER-beat HEALTH roll still live (`heldFor(uid).health !== 0`, and NOT buffed this
    //    beat) — netting a prior beat's live health up-roll against this down-roll is the below-floor case, so
    //    it SNAPS. An attack-only hold does not count (attack is orthogonal to the HP badge), so its HP rolls;
    //  - one that DIES this beat — excluded inside `combatDamageDeltas`, so the death collapse + float own that
    //    moment rather than a counter racing toward 0 under a dissolving card.
    // Every other (clean, survivable) hit rolls.
    const dmgRollMs = COMBAT_ROLL_MS / (combatSpeedRef.current > 0 ? combatSpeedRef.current : 1);
    const rolledDown = new Set<string>();
    for (const d of combatDamageDeltas(beat, events, frame)) {
      if (buffedThisBeat.has(d.uid)) { rolledDown.add(d.uid); continue; } // netted into the buff roll above
      const held = heldFor(d.uid);
      if (held && held.health !== 0) continue;   // an EARLIER-beat health roll is live → fall through to snap
      cancelRollForUid(d.uid);                   // clear any attack-only hold so the cue owns the counter
      holdStat(d.uid, { health: -d.health }, { origin: 'cue', startAt: 0, rollMs: dmgRollMs });
      rolledDown.add(d.uid);
    }
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (e?.type === 'dmg' && !rolledDown.has(e.target)) cancelRollForUid(e.target);
    }
    // `seekNonce`: this is the ONLY installer of these holds, and it's what makes a same-beat re-seek re-run
    // this effect at all (`beatIdx` alone wouldn't change). `frame` can't stand in — it is memoised on
    // `processedEnd`/`beatStart`, both derived from `beatIdx`, so it too is unchanged by a same-index
    // re-seek. Without `seekNonce` the badge shows the POST-buff number for the whole replayed beat instead
    // of holding pre-buff and rolling up at the tendril — the up-then-down-then-up artifact this effect
    // exists to kill.
  }, [active, beatIdx, seekNonce, beats, events, frame, cancelRollForUid]);

  // ── Summon HOLDS, installed in the same pre-paint window and for the same reason ───────────────────────
  //
  // A Rally's summon is committed to the frame the instant its moment becomes current, which puts the cub on
  // the board ahead of the effect that procced it (owner report 2026-08-05, Echohorn Rallying a Manasaber:
  // "the cubs come out immediately, before the timing of the effect"). `fx/summonHold.ts` withholds them from
  // the RENDERED board and the `rallyFx` cue releases each proc's litter as its own sparkle lands.
  //
  // A LAYOUT effect for the identical reason the buff holds above are one: `runMomentCues` runs post-paint,
  // so holding there would paint the cub, remove it, then bring it back — that artifact, one layer over.
  //
  // Cleared wholesale first, so a hold whose release timer was lost (a skip, a seek, a mid-flight speed
  // change) can never outlive its beat and strand a live minion off the board. The module's TTL is the
  // backstop for a replay that stops re-rendering entirely; this is the ordinary path.
  useLayoutEffect(() => {
    releaseAllSummons();
    if (!active || beatIdx === 0) return;
    const beat = beats[beatIdx - 1];
    if (!beat) return;
    for (const uid of rallyDeliveredUids(beat, { events, cardIds })) holdSummon(uid);
    // Errand Fiend (and any unit that summons on its OWN attack): withhold the attacker's own on-attack summons
    // and reveal them a short lead later, so the Imps slide in just after the swing instead of snapping onto the
    // board at wind-up start (owner ask 2026-08-07). Triggered by "summons on its own attack" (`source ===
    // attacker`), NOT the RL keyword — a card's "Rally: summon…" is an onAttack EFFECT and carries no RL keyword
    // (Errand Fiend's keywords are just `['W']`), so an RL gate here never fired. The reveal rides a speed-scaled
    // timer cleared on the next beat/seek; the summon-hold TTL is the fail-open backstop if it is ever lost.
    let impReveal: number | undefined;
    if (beat.kind === 'attackExchange' && beat.primary.type === 'attack') {
      const impUids = attackSummonUids(beat, events, beat.primary.attacker);
      if (impUids.length) {
        for (const uid of impUids) holdSummon(uid);
        const speed = combatSpeedRef.current > 0 ? combatSpeedRef.current : 1;
        impReveal = window.setTimeout(() => releaseSummons(impUids), IMP_SUMMON_LEAD_MS / speed);
      }
    }
    return () => { if (impReveal !== undefined) clearTimeout(impReveal); };
  }, [active, beatIdx, seekNonce, beats, events, cardIds]);

  // The board as it should be DRAWN: `frame` minus anything an effect is still holding back. Kept separate
  // from `frame` rather than filtered in place because `frame` is the TRUTH — the loss-damage tally counts
  // survivors off it, and a withheld cub is a live minion that simply hasn't been revealed yet.
  const summonHeldV = useSyncExternalStore(subscribeSummonHolds, summonHoldVersion, summonHoldVersion);
  const visibleFrame = useMemo(() => {
    // `summonHeldV` is the dep that matters (a release must re-render); referenced so it isn't dropped as
    // unused. The `anySummonHeld` fast path means every fight without a bound Rally returns `frame` BY
    // IDENTITY, so this costs one property read per beat and allocates nothing.
    void summonHeldV;
    if (!anySummonHeld()) return frame;
    return { player: frame.player.filter((u) => !isSummonHeld(u.uid)), enemy: frame.enemy.filter((u) => !isSummonHeld(u.uid)) };
  }, [frame, summonHeldV]);

  // Enemy minions killed so far (deaths landed up to the current beat) — Cassen's Collision counter ticks
  // up live in combat off this; settleCombat banks the same total at the end.
  const enemyDeaths = useMemo(() => {
    // Count enemy-side deaths landed up to the current beat — matches simulate's `minion.side === 'enemy'`
    // tally exactly (the death event now carries `side`), so the live count agrees with the settled total.
    let n = 0;
    for (let i = 0; i < processedEnd; i++) {
      const e = events[i];
      if (e?.type === 'death' && e.side === 'enemy' && !e.rise) n++; // a Rise's death isn't a kill (it returns) — matches sim's enemyDeaths
    }
    return n;
  }, [events, processedEnd]);

  // Run-buff gains telegraphed so far this fight (spell power, max Gold) — folded into the live Buffs window so
  // it ticks up in sync with the replay, then settles into the run state at combat end. Same up-to-the-beat
  // accumulation as `enemyDeaths`.
  const combatBuffs = useMemo(() => combatBuffDelta(events, processedEnd), [events, processedEnd]);

  // Combat quest progress landed so far this fight — for the quest panel to LIVE-TICK. Counts the engine's
  // step-tagged `playerQuestEvents` up to the current step (= the last processed event's step), so it agrees
  // exactly with the settled tally. Same shape as `playerQuestTally` (total + by-tribe per kind).
  const questDelta = useMemo(() => {
    const d = {
      attack: 0, summonCombat: 0, slaughter: 0, slaughterKeyword: 0, deathrattle: 0, friendlyDeath: 0, rally: 0, summonImp: 0,
      attackByTribe: {} as Partial<Record<Tribe, number>>,
      summonCombatByTribe: {} as Partial<Record<Tribe, number>>,
      slaughterByTribe: {} as Partial<Record<Tribe, number>>,
    };
    const qe = combat?.playerQuestEvents;
    if (!qe || processedEnd <= 0) return d;
    const curStep = events[processedEnd - 1]?.step ?? Infinity;
    for (const e of qe) {
      if (e.step > curStep) continue; // not replayed yet
      d[e.kind] += 1;
      if (e.kind !== 'deathrattle' && e.kind !== 'friendlyDeath' && e.kind !== 'rally' && e.kind !== 'summonImp' && e.kind !== 'slaughterKeyword') { // these carry no tribe breakdown
        const by = e.kind === 'attack' ? d.attackByTribe : e.kind === 'summonCombat' ? d.summonCombatByTribe : d.slaughterByTribe;
        for (const t of e.tribes) by[t] = (by[t] ?? 0) + 1;
      }
    }
    return d;
  }, [combat, events, processedEnd]);

  // Quest/rune badges whose COMBAT effect has fired so far this fight (player side): each `questTrigger` event's
  // `flag` resolves to its badge id (via content). The node glows the moment its trigger is REPLAYED (up-to-the-
  // beat, like questDelta), so the player sees e.g. The Bone Throne's Avenge actually go off. Cosmetic only.
  const triggeredQuests = useMemo(
    () => triggerCounts(events, processedEnd, beatIdxIsStale),
    [events, processedEnd, beatIdxIsStale],
  );

  // Quests that COMPLETED mid-combat so far this fight (player side): each `questComplete` event's questId, up to
  // the replayed beat. The quest node doesn't exist in the badge row yet (it only settles as `completed` after
  // the replay), so the QuestBadges row renders + pulses these live off this set — the reward "lights up" the
  // instant its objective crosses, matching the effect (Feeding Line etc.) that just went live in the fight.
  const completedQuests = useMemo(() => {
    if (processedEnd <= 0) return [] as string[];
    const curStep = events[processedEnd - 1]?.step ?? Infinity;
    const ids: string[] = [];
    for (const e of events) {
      if (e.type === 'questComplete' && e.side === 'player' && (e.step ?? 0) <= curStep) ids.push(e.questId);
    }
    return ids;
  }, [events, processedEnd]);

  // Death reflow is CSS-driven (see `.unit.dying` / `.unit.summoned` in styles.css): the dying unit
  // collapses its own flex slot AS it plays its death pop, so the survivors glide in simultaneously
  // (one smooth phase) instead of waiting a beat and then sliding. CSS flex animates the neighbours for
  // free, and — unlike a JS FLIP — it composes cleanly with the GSAP lunge (layout vs transform).

  const currentBeat = beatIdx > 0 ? beats[beatIdx - 1] : undefined;
  const anims: Record<string, string> = {};
  if (currentBeat) {
    // A Rise ATTACKER dying to retaliation gets `returning` too: the fade DELAYS while GSAP pulls the unit
    // back to its slot (see the pull-back in the layout effect), so it dies in place, not mid-lunge.
    const impactAtk = attackerOfImpact(beats, beatIdx - 1);
    for (let i = currentBeat.start; i < currentBeat.end; i++) {
      for (const [uid, cls] of Object.entries(animFor(events[i]))) {
        // The venom-spent flourish lands first in its beat; don't let the poisoner's same-beat
        // retaliation `struck` clobber it. A death still wins (the demise reads over the flourish).
        if (anims[uid] === 'venomspent' && cls === 'struck') continue;
        // A unit SUMMONED this beat keeps its arrival entrance (`summonpop`) against a same-beat soft
        // overlay: Errand Fiend summons an Imp AND buffs your Imps in one swing, so the fresh Imp's uid gets
        // both a `summon` and a `buff` anim — and a unit can't pulse a buff before it has even appeared. The
        // summon wins regardless of event order (it either survives this guard or overwrites below). Death is
        // exempt (`cls === 'dying'` falls through to the demise block), so a summoned-then-killed unit still
        // reads its death rather than its arrival.
        if (anims[uid] === 'summoned' && cls !== 'dying') continue;
        // A Rise body dies SOFT — `dying rising` fades it in place (no bounce/spin/slot collapse; see
        // styles.css) since its spirit bursts over it and the body re-forms in that same slot next beat.
        if (cls === 'dying') {
          const u = frame.player.find((x) => x.uid === uid) ?? frame.enemy.find((x) => x.uid === uid);
          if (u?.keywords.includes('R')) {
            anims[uid] = uid === impactAtk ? 'dying rising returning' : 'dying rising';
          } else if (CARD_INDEX[cardIds.get(uid) ?? '']?.effects?.some((f) => f.on === 'onDeath')) {
            // Deathrattle: fade the card IN PLACE (no bounce) under the skull burst. A Deathrattle ATTACKER
            // that died mid-lunge also gets `returning` — the fade DELAYS while GSAP pulls it home, so the
            // skull pops in its OWN slot (fired at `landed`), not mid-flight.
            const base = uid === impactAtk ? 'dying dr returning' : 'dying dr';
            // A launchOnDeath sprayer (Fel Spikes) keeps spraying for SECONDS after it dies. `holdecho` cancels
            // its slot-collapse (the card still fades) so the survivors don't slide into the gap and then reverse
            // when its ghost re-holds the slot — they wait, and reflow ONCE when the ghost is finally dropped
            // after the last volley (owner report 2026-08-21).
            const echoB = bindingFor(cardIds.get(uid) ?? null, 'damage');
            anims[uid] = echoB?.launchOnDeath && echoWaves(events, uid, i).length > 0 ? `${base} holdecho` : base;
          } else if (uid === impactAtk) {
            // A PLAIN attacker (no Rise, no Deathrattle — e.g. a reborn unit's true death) that died mid-lunge:
            // `dying returning` delays the collapse + pop until GSAP has pulled it home (see styles.css), so it
            // dies in its OWN slot, not mid-flight. A plain DEFENDER death keeps the immediate in-place collapse.
            anims[uid] = 'dying returning';
          } else {
            anims[uid] = cls;
          }
          continue;
        }
        anims[uid] = cls;
      }
    }
  }

  // The attacker's motion is run by GSAP in the layout effect above; here we just apply its glow class.
  const lungeUid = attackUid;
  // Cleave used to add a second `cleaving` class here (a white glare bar swiped across the ATTACKER). Retired
  // 2026-07-21: the keyword's read is now the hit-stop plus the red claw rake on the TARGET, and the two were
  // competing cues on the same swing. Every attacker gets the same glow class again.
  if (lungeUid) anims[lungeUid] = 'attacking';

  let log = 'The boards take their positions…';
  for (let i = processedEnd - 1; i >= 0; i--) {
    const line = narrate(events[i]!, names);
    if (line) { log = line; break; }
  }
  // Floats are handed back as ONE flat list for the board-level overlay to render. There used to be a
  // per-uid bucketing memo here, because each float was a child of its own `<Unit>` and the memoized Unit
  // needed a stable array reference per uid to avoid re-rendering the whole board every beat. Now that a
  // float is board-level DOM, the unit never re-renders for a float at all — the bucketing Map (rebuilt on
  // every float spawn AND every expiry) went with it, and only the small overlay list reconciles.
  const fullLog = useMemo(
    () => events.map((e) => narrateLog(e, names)).filter((l): l is { text: string; kind: string } => l !== null),
    [events, names],
  );
  const procs = useMemo(() => procReport(events, names), [events, names]);
  /* Cards granted to the hand by combat effects (Arcane Weaver → Spirit Fire, a Deathrattle's Patch Job) —
     see `grantsShownThrough` for the beat window and why it is the beat ON SCREEN.

     Gated on `active`, which is false through the shop-closing intro. The hook persists across fights and
     `beatIdx` is reset in an effect, so on the first commit of a new combat it still holds the PREVIOUS
     fight's value — usually past the new `beats` array, where the `?? events.length` fallback means "the
     replay is done" and hands back EVERY grant at once. That painted the whole fight's grants into the hand
     for one frame the instant you pressed Start Combat, coalesce and all, before the reset wiped them (owner
     clip 2026-07-27). `active` only turns true after the intro, by which point the reset has landed. */
  const handGrantsShown = useMemo(
    () => (active ? grantsShownThrough(events, beats, beatIdx) : EMPTY_GRANTS),
    [active, beatIdx, beats, events],
  );

  return {
    frame, visibleFrame, anims, lungeUid, projectiles, floats, deathFloats, log, fullLog, procs, handGrant, handGrantsShown,
    triggerUids: triggers,
    rallyPulseUids: rallyPulse,
    watcherPulseUids: watcherPulse,
    framePulseUids: framePulse,
    done, result: combat ? combat.result : null, shaking, critShaking,
    beatCount: beats.length, enemyDeaths, combatBuffs, questDelta, triggeredQuests, completedQuests, skip: () => setBeatIdx(beats.length),
    // Clamped here rather than at the call site: an out-of-range seek from a stale moment list (the fight
    // was re-staged while the harness still showed the old one) must land somewhere valid, not wedge the
    // replay past its end. The outer `max` also floors the no-combat case (`beats.length === 0`, where the
    // inner `min` yields -1) at 0 — a negative `beatIdx` would read `beats[beatIdx - 1]` off the front AND
    // slip past every `beatIdx === 0` guard, and `replayComplete` (`beatIdx >= beats.length`) would never
    // become true.
    seekTo: (index: number) => {
      setSeekNonce((n) => n + 1); // here, not in `resetTo` — a fresh combat already changes `combat` identity
      resetTo(Math.max(0, Math.min(beats.length - 1, index)));
    },
  };
}
