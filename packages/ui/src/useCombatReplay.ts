import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import type { CombatEvent, CombatResult, Keyword, MinionBuff, MinionSnapshot, Tribe } from '@game/core';
import { CARD_INDEX, badgeIdForCombatFlag } from '@game/content';
import { getSpellPowerFxConfig, floatSpellPowerNumber } from './spellPowerFxConfig';
import { getRubyPowerFxConfig, floatRubyPowerNumber } from './rubyPowerFxConfig';
import { fireSpellBuffOnHandSpells, fireSpellBuffOnHandRubies } from './spellBuffFx';
import { useGame } from './store'; // `useGame.getState()` — read the live hand for the mid-combat spell/Ruby buff cue
import { pixiFx } from './pixiFx';
import { getAuraFxConfig } from './auraFxConfig';
import { buffPreset, wavePalette } from './buffPresets';
import { sfx } from './sfx';
import { getChoreoConfig } from './choreo/choreoConfig';
import { attackerOfImpact, meleePairOfImpact, type Beat } from './combatBeats';
import { holdMs } from './choreo/clock';
import type { Moment } from './choreo/compile';
import { replayBeats, replayOrder } from './choreo/replayOrder';
import { runMomentCues } from './choreo/score';
import { groupBuffCasts, type BuffCast } from './choreo/channels/buffCast';
import { groupSelfBuffs, type SelfBuff } from './choreo/channels/buffSelf';
import { runAttackExchangeCues, runRiseReturn } from './choreo/engine';
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
import { anchorsForUnits } from './fx/combatAnchors';
import { combatBuffDeltas, driveRoll } from './fx/combatBuffRoll';
import { DEFAULT_ROLL_MS, holdStat, releaseStat } from './fx/statHold';

/** Card display name from its id (for combat-log lines about generated cards). */
const cardName = (id: string): string => CARD_INDEX[id]?.name ?? id;

/** How long a combat buff's strike-time badge roll takes, in ms (before the combat-speed divide). Starts
 *  equal to the shop's roll (`DEFAULT_ROLL_MS`) so a gem and a combat buff count up at the same pace by
 *  default — its own constant because a fight-paced roll is free to diverge if it ever needs its own tuning. */
const COMBAT_ROLL_MS = DEFAULT_ROLL_MS;

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
 */
const COMBAT_HOLD_TTL_MS = 2000;

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
  golden: boolean;
  /** Live summon-buff bonus (Kennelmaster) — climbs via `improve` events mid-fight. */
  summonBonus: number;
  /** Flowing Monk's flat grant bonus (triple combine) — static; feeds the live card text. */
  overflowBonus?: number;
  /** Crypt Drake: ally attacks seen this combat — drives the live "current buff / N to go" text. */
  attackSeen?: number;
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
        // Itemize the buff under its source for the inspect panel (combat buffs merge alongside recruit ones).
        if (e.attack !== 0 || e.health !== 0) {
          u.buffs ??= [];
          recordBuff(u.buffs, names.get(e.source) ?? 'Combat', e.attack, e.health);
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
  for (const u of player) { u.avengeSeen = deaths.player; u.bleedAttacks = attackCount; }
  for (const u of enemy) { u.avengeSeen = deaths.enemy; u.bleedAttacks = attackCount; }
  return { player: player.filter((u) => !gone.has(u.uid)), enemy: enemy.filter((u) => !gone.has(u.uid)) };
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
  if (generated.size) { out.push({ text: 'Cards generated', kind: 'head' }); for (const [k, c] of generated) out.push({ text: `${k} — ${c}×`, kind: 'summon' }); }
  if (summoned.size) { out.push({ text: 'Summoned', kind: 'head' }); for (const [k, c] of summoned) out.push({ text: `${k} — ${c}×`, kind: 'summon' }); }
  if (buffs.size) { out.push({ text: 'Buffs', kind: 'head' }); for (const [k, t] of buffs) out.push({ text: `${k} — ${t.n}× (+${t.atk}/+${t.hp})`, kind: 'buff' }); }
  if (maxGold.size) { out.push({ text: 'Max Gold', kind: 'head' }); for (const [k, t] of maxGold) out.push({ text: `${k} — +${t.total} (${t.n}×)`, kind: 'buff' }); }
  return out;
}

export interface CombatReplay {
  frame: { player: UnitFrame[]; enemy: UnitFrame[] };
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
  opts: { active: boolean; findEl: (uid: string) => Element | null; combatSpeed?: number; paused?: boolean },
): CombatReplay {
  const { active, findEl, paused = false } = opts;
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
      entry.cancelRoll = driveRoll(uid, COMBAT_ROLL_MS, () => combatSpeedRef.current);
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
  combatSpeedRef.current = combatSpeed;
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
  }, [cancelPendingRolls]);

  // A fresh combat resets the replay to the top (the hook persists across fights).
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
      const cardId = cardIds.get(c.source) ?? '';
      const tribe = (CARD_INDEX[cardId]?.tribe ?? 'neutral') as Tribe;
      const sourceless = isDeathrattleBufferCard(cardId);
      const sEl = sourceless ? null : findEl(c.source);
      if (!sourceless && !sEl) continue; // living-source buff needs a measurable source
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
    let d = holdMs(next, shown, combatSpeed);
    // A Deathrattle summon (skull) or a Rise return (body fade) waits for the death to read — and an attacker
    // to settle home — before the consequence-overlap gap, so the tokens/returned body land AFTER the proc
    // reads, not on top of it.
    const atkUid = attackerOfImpact(beats, beatIdx - 1);
    // Hold for the death cascade's consequence (DR summon / Rise return), OR — with no consequence — for a plain
    // attacker being pulled home to die in its slot. The max: a Rise/DR consequence lead already covers its pull.
    const lead = Math.max(deathConsequenceLead(shown, next, events, cardIds, atkUid), pulledHomeAttackerHold(shown, atkUid, events, cardIds));
    if (lead) d += lead / combatSpeed;
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
    // The player's uids: the initial player board + every player-side summon in the whole log. Enemy-sourced
    // narrations (spell power, auras) are filtered against this so they never draw on the player's board and
    // vice-versa. Cheap — a Set built once per beat effect from data already in scope.
    const playerUids = new Set<string>((combat?.initial.player ?? []).map((u) => u.uid));
    for (const ev of events) if (ev.type === 'summon' && ev.side === 'player') playerUids.add(ev.minion.uid);
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (!e) continue;
      // NB: `rally` is intentionally NOT here — a Rally that fires as a unit attacks pulses YELLOW from the
      // lunge's wind-up pause instead (see the attack layout effect), so it reads at the swing, not beat-start.
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
    // SPELL POWER gained mid-combat: `grantSpellPower` already emits an `sc` narration carrying the SOURCE
    // unit and a "+A/+H Spell Power" text, so the flourish rides that rather than needing a new choreo
    // channel. Fired over the unit that caused it, matching the shop behaviour (owner ask 2026-07-21).
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (!e || e.type !== 'sc' || !e.source || !e.text) continue;
      const m = /^\+(-?\d+)\/\+(-?\d+) Spell Power$/.exec(e.text);
      if (!m) continue;
      const gA = Number(m[1]), gH = Number(m[2]);
      if (gA <= 0 && gH <= 0) continue;
      // PLAYER-SIDE ONLY. The `sc` narration carries no `side`, and an ENEMY spell-power source (an enemy
      // Aeon Guard) resolved to an enemy unit — so the flourish drew on the opponent's half of the board
      // (owner report). Gate on a set of the player's uids: the initial player board plus everything the
      // player summoned this fight. An enemy source isn't in the set, so it's skipped.
      if (!playerUids.has(e.source)) continue;
      const el = findEl(e.source);
      if (!el) continue;
      const { cx, cy, h } = layoutRectOf(el); // SLOT — the source can be mid-lunge when its spell power rises
      pixiFx.spellPower(cx, cy, getSpellPowerFxConfig());
      floatSpellPowerNumber(cx, cy - h * 0.3, gA, gH);
      // …and pop the held SPELLS, whose printed values just moved. Without this the cards themselves only
      // reacted at combat RESOLUTION (owner report): the hand-card cue is driven by a diff of the rendered live
      // text, and run state doesn't change until settle — so mid-fight there is nothing for that diff to see.
      // Firing from the narration beat puts it on the moment the gain actually happens.
      fireSpellBuffOnHandSpells(useGame.getState().run.hand);
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
      const el = findEl(e.source);
      if (!el) continue;
      const { cx, cy, h } = layoutRectOf(el);
      pixiFx.rubyPower(cx, cy, getRubyPowerFxConfig());
      floatRubyPowerNumber(cx, cy - h * 0.3, gA, gH);
      // …and pop the held Rubies themselves, so the player sees WHICH cards the gain lands on. The spell-buff
      // bus is callable from here precisely because it no longer lives in Recruit's state.
      fireSpellBuffOnHandRubies(useGame.getState().run.hand);
    }
    // SHOP BUFF earned mid-combat (Demon Horse and friends). Unlike the Imp buff — which already blooms the
    // board aura-wash off its `tribeAura` event — this one accumulated with NO cue at all and only showed up in
    // the next shop, so the moment it was earned looked like nothing happened (owner report 2026-07-31). Rides
    // the same `sc` narration shape spell power and Ruby power use, with the identical player-side gate.
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (!e || e.type !== 'sc' || !e.source || !e.text) continue;
      const m = /^\+(-?\d+)\/\+(-?\d+) Shop$/.exec(e.text);
      if (!m) continue;
      const gA = Number(m[1]), gH = Number(m[2]);
      if (gA <= 0 && gH <= 0) continue;
      if (!playerUids.has(e.source)) continue;
      const el = findEl(e.source);
      if (!el) continue;
      const { cx, cy, h } = layoutRectOf(el);
      floatSpellPowerNumber(cx, cy - h * 0.3, gA, gH);
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
    if (trig.size === 0) return;
    sfx.triggerPulse(); // once per beat regardless of how many units pulse (the dedupe is built in too)
    // Each triggering unit also plays its OWN effect voiceline (cards/<id>.effect.mp3) — the combat half of the
    // per-card effect sound (the shop half fires from store.ts on a Battlecry). Deduped by cardId so a beat with
    // several copies of one card firing plays that clip once. Silent until the clip is recorded.
    const firedEffect = new Set<string>();
    for (const uid of trig) {
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
      onShake: () => setShake((n) => n + 1),
      // Every float (including the killing-blow one) is anchored from this SLOT reading, taken once at
      // spawn — see spawnFloats' "the position snapshot" note.
      slotRectOf: rectOf,
      attackerUid: attackerOfImpact(beats, beatIdx - 1),
      meleePair: meleePairOfImpact(beats, beatIdx - 1),
      onFloats: (spawned) => {
        setFloats((arr) => [...arr, ...spawned.filter((s) => !arr.some((x) => x.id === s.id))]);
        const ids = new Set(spawned.map((s) => s.id));
        timers.push(window.setTimeout(() => setFloats((arr) => arr.filter((x) => !ids.has(x.id))), getChoreoConfig().floatMs / combatSpeedRef.current));
      },
      onDeathFloats: (deaths) => {
        setDeathFloats((arr) => [...arr, ...deaths.filter((s) => !arr.some((x) => x.id === s.id))]);
        const ids = new Set(deaths.map((s) => s.id));
        timers.push(window.setTimeout(() => setDeathFloats((arr) => arr.filter((x) => !ids.has(x.id))), getChoreoConfig().deathFloatMs / combatSpeedRef.current));
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
          runRiseReturn(el, combatSpeed, () => {
            const rEl = findEl(impactAtk);
            const rect = rEl ? layoutRectOf(rEl) : capRect;
            if (isRise) burstDeathAuras(impactAtk, rect);                       // spirit release, at home
            if (hasDR) pixiFx.deathrattle(rect.cx, rect.cy, rect.w);            // bone-skull shatter — always fires
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
        const tl = runAttackExchangeCues(cur, atkEl, findEl(cur.primary.defender), d.x - a.x, d.y - a.y, {
          combatSpeed, advance: () => setBeatIdx((k) => k + 1),
          onRallyPulse: rallies ? () => {
            sfx.triggerPulse();
            const n = ++rallyNonceRef.current; // a fresh nonce per fire → new medallion key → the pulse restarts
            setRallyPulse((prev) => new Map(prev).set(atkUid, n));
            window.setTimeout(() => setRallyPulse((prev) => { const m = new Map(prev); if (m.get(atkUid) === n) m.delete(atkUid); return m; }), 1150);
          } : undefined,
          onWindupBuffs: (windupCasts.length || windupSelfBuffs.length)
            ? () => { fireBuffCasts(windupCasts); fireSelfBuffs(windupSelfBuffs); }
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
      holdStat(d.uid, { attack: d.attack, health: d.health }, {
        origin: 'effect',
        ttlMs: COMBAT_HOLD_TTL_MS / (combatSpeedRef.current > 0 ? combatSpeedRef.current : 1),
      });
      combatHeldRef.current.push(d.uid);
    }
    // `seekNonce`: this is the ONLY installer of these holds, and it's what makes a same-beat re-seek re-run
    // this effect at all (`beatIdx` alone wouldn't change). `frame` can't stand in — it is memoised on
    // `processedEnd`/`beatStart`, both derived from `beatIdx`, so it too is unchanged by a same-index
    // re-seek. Without `seekNonce` the badge shows the POST-buff number for the whole replayed beat instead
    // of holding pre-buff and rolling up at the tendril — the up-then-down-then-up artifact this effect
    // exists to kill.
  }, [active, beatIdx, seekNonce, beats, events, frame]);

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
  const triggeredQuests = useMemo(() => {
    const counts: Record<string, number> = {};
    if (processedEnd <= 0) return counts;
    const curStep = events[processedEnd - 1]?.step ?? Infinity;
    for (const e of events) {
      if (e.type !== 'questTrigger' || e.side !== 'player' || (e.step ?? 0) > curStep) continue;
      const id = badgeIdForCombatFlag(e.flag);
      if (id) counts[id] = (counts[id] ?? 0) + 1; // how many times it has fired so far — a fresh one-shot pulse per bump
    }
    return counts;
  }, [events, processedEnd]);

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
            anims[uid] = uid === impactAtk ? 'dying dr returning' : 'dying dr';
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
    frame, anims, lungeUid, projectiles, floats, deathFloats, log, fullLog, procs, handGrant, handGrantsShown,
    triggerUids: triggers,
    rallyPulseUids: rallyPulse,
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
