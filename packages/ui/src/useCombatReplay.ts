import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import type { CombatEvent, CombatResult, Keyword, MinionBuff, MinionSnapshot, Tribe } from '@game/core';
import { CARD_INDEX, badgeIdForCombatFlag } from '@game/content';
import { getSpellPowerFxConfig, floatSpellPowerNumber } from './spellPowerFxConfig';
import { pixiFx } from './pixiFx';
import { getAuraFxConfig } from './auraFxConfig';
import { buffPreset, wavePalette } from './buffPresets';
import { sfx } from './sfx';
import { getChoreoConfig } from './choreo/choreoConfig';
import { attackerOfImpact, meleePairOfImpact } from './combatBeats';
import { holdMs } from './choreo/clock';
import { compileMoments, type Moment } from './choreo/compile';
import { deferClashBuffs } from './choreo/clashOrder';
import { deferAvengeAfterSummons } from './choreo/avengeOrder';
import { runMomentCues } from './choreo/score';
import { groupBuffCasts, type BuffCast } from './choreo/channels/buffCast';
import { groupSelfBuffs, type SelfBuff } from './choreo/channels/buffSelf';
import { runAttackExchangeCues, runRiseReturn } from './choreo/engine';
import { burstDeathAuras, breakShieldAura, reformReborn } from './choreo/channels/aura';
import { type Float, type DeathFloat, KW_FLOAT } from './choreo/channels/float';
import { combatBuffDelta, type CombatBuffDelta } from './runBuffs';
import { PULSE_PRESETS, pulsePreset } from './pulsePresets';
import { ASCEND_PRESETS, ascendPreset } from './ascendPresets';
import { isDeathrattleBufferCard } from './deathrattleBuffers';
import { fireBuffFx } from './buffFxRender';

/** Card display name from its id (for combat-log lines about generated cards). */
const cardName = (id: string): string => CARD_INDEX[id]?.name ?? id;

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
}

/** Shared empty array for float-less units, so their `floats` prop keeps a stable reference across
 *  beats and the memoized Unit can skip re-rendering them (a fresh `[]` each render would defeat it). */
const EMPTY_FLOATS: Float[] = [];

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
      if (!e.rise && (e.side === 'player' || e.side === 'enemy')) deaths[e.side] += 1; // friendly-death tally → Avenge counter
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
    case 'improve': return { text: `${n(e.target)}'s summon aura strengthens by +${e.amount}/+${e.amount}.`, kind: 'buff' };
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
    case 'improve': return `${n(e.target)}'s aura strengthens (+${e.amount}/+${e.amount}).`;
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
  floatsFor: (uid: string) => Float[];
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
  /** While a buff tendril is in flight to this unit, its PRE-buff displayed stats (held until the strike). */
  statHoldFor: (uid: string) => { atk: number; hp: number } | undefined;
  /** On the strike, which badge(s) just changed → flash them. Cleared shortly after. */
  statFlashFor: (uid: string) => { atk: boolean; hp: boolean } | undefined;
  done: boolean;
  result: CombatResult['result'] | null;
  shaking: boolean;
  critShaking: boolean;
  beatCount: number;
  /** Enemy minions killed so far in the replay (up to the current beat) — drives Cassen's live counter. */
  enemyDeaths: number;
  /** Run-buff gains telegraphed so far this fight (spell power, max Gold) — drives the live Buffs window. */
  combatBuffs: CombatBuffDelta;
  skip: () => void;
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
  // event log is untouched (see deferClashBuffs). Both compileMoments AND computeFrame fold THIS array.
  // …then hold every Avenge payoff beat until AFTER the death cascade's summons deploy (deferAvengeAfterSummons):
  // a multi-death clash or a deferred attack-on-summon token would otherwise show the Avenge (a buff pulse, a
  // coin burst) before the token pops in. Composed on the clash-normalized copy; both folds see THIS array.
  const events = useMemo(() => deferAvengeAfterSummons(deferClashBuffs(combat?.events ?? [])), [combat]);
  // Moments are Beat-shaped (choreographer phase 1): identical grouping to the old buildBeats (equivalence-
  // tested), now carrying stepGroups for later phases. buildBeats itself remains only as the test oracle.
  const beats = useMemo(() => compileMoments(events), [events]);
  const [beatIdx, setBeatIdx] = useState(0);
  const [floats, setFloats] = useState<Float[]>([]);
  const [deathFloats, setDeathFloats] = useState<DeathFloat[]>([]); // damage on dying units (board overlay)
  const [triggers, setTriggers] = useState<Set<string>>(new Set()); // uids whose effect just fired → medallion pulse
  // uid → a monotonic nonce, bumped on EACH Rally fire. The nonce is used as a React `key` on the medallion
  // (see Card) so it REMOUNTS every fire and the gold pulse animation restarts — a rally unit's own Rally also
  // sets the normal trigger pulse, so `.pulsing` never leaves the element between swings and a plain class
  // re-add wouldn't replay the CSS animation (that's why the 2nd Rally in a combat pinged sound but no visual).
  const [rallyPulse, setRallyPulse] = useState<Map<string, number>>(new Map());
  const rallyNonceRef = useRef(0);
  // Buff-tendril hold/flash: while a buff tendril flies to a target, HOLD its displayed Attack/Health at the
  // PRE-buff value; on strike, release (delete → real value shows) and flash the changed badge(s). Keyed by uid.
  const [statHold, setStatHold] = useState<Map<string, { atk: number; hp: number }>>(new Map());
  const [statFlash, setStatFlash] = useState<Map<string, { atk: boolean; hp: boolean }>>(new Map());
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

  // A fresh combat resets the replay to the top (the hook persists across fights).
  useEffect(() => {
    setBeatIdx(0);
    setFloats([]);
    setDeathFloats([]);
    setTriggers(new Set());
    setRallyPulse(new Map());
    setFinished(false);
    setAttackUid(null);
    gsap.killTweensOf('[data-zone] .unit'); // stop any lunge left mid-flight by the previous fight
    setProjectiles([]);
    setShake(0);
    setHandGrant(null);
    setStatHold(new Map());
    setStatFlash(new Map());
  }, [combat]);

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
  // a Deathrattle buffer), then HOLD each target's pre-buff badge value and flash it to the new value at the
  // strike/landing. Shared by the `buffWave` path (`onBuffCasts`) and the attack-wind-up path (on-attack / Rally
  // buffers, launched from the lunge timeline so the beat reads pulse → tendril → lunge). `timers` collects the
  // flash timeouts so the caller's effect can clear them on teardown.
  const fireBuffCasts = useCallback((casts: BuffCast[], timers: number[]): void => {
    const perTarget = new Map<string, { atk: number; hp: number; strikeMs: number }>();
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
      const agg = perTarget.get(c.target);
      if (agg) { agg.atk += c.attack; agg.hp += c.health; }
      else perTarget.set(c.target, { atk: c.attack, hp: c.health, strikeMs });
    }
    const unitOf = (uid: string) =>
      frameRef.current?.player.find((u) => u.uid === uid) ?? frameRef.current?.enemy.find((u) => u.uid === uid);
    for (const [target, { atk: sumAtk, hp: sumHp, strikeMs }] of perTarget) {
      const tgt = unitOf(target);
      if (!tgt) continue;
      const held = { atk: tgt.attack - sumAtk, hp: tgt.health - sumHp };
      setStatHold((m) => new Map(m).set(target, held));
      const ms = strikeMs / (combatSpeedRef.current > 0 ? combatSpeedRef.current : 1);
      timers.push(window.setTimeout(() => {
        setStatHold((m) => { const n = new Map(m); n.delete(target); return n; });
        setStatFlash((m) => new Map(m).set(target, { atk: sumAtk !== 0, hp: sumHp !== 0 }));
        timers.push(window.setTimeout(() =>
          setStatFlash((m) => { const n = new Map(m); n.delete(target); return n; }), 360));
      }, ms));
    }
  }, [findEl, cardIds]);

  // Fire a moment's SELF-buffs (a unit empowering ITSELF): one in-place pulse per unit, then HOLD its pre-buff
  // badge value and, after holdMs, release the hold + flash the changed badge(s) to the new value — the blast
  // "causes" the tick. Shared by the `buffWave` path (`onSelfBuffs`) and the attack-wind-up path (on-attack /
  // on-ally-attack self-buffers absorbed into the exchange, which `groupBuffCasts` deliberately skips). `timers`
  // collects the hold/flash timeouts so the caller's effect can clear them on teardown.
  const fireSelfBuffs = useCallback((selfBuffs: SelfBuff[], timers: number[]): void => {
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
      if (!tgt) continue; // no frame entry → fall back to normal display (no negative held value)
      const held = { atk: tgt.attack - s.attack, hp: tgt.health - s.health };
      setStatHold((m) => new Map(m).set(s.uid, held));
      const holdMs = cfg.holdMs / (combatSpeedRef.current > 0 ? combatSpeedRef.current : 1);
      timers.push(window.setTimeout(() => {
        setStatHold((m) => { const n = new Map(m); n.delete(s.uid); return n; });
        setStatFlash((m) => new Map(m).set(s.uid, { atk: s.attack !== 0, hp: s.health !== 0 }));
        timers.push(window.setTimeout(() =>
          setStatFlash((m) => { const n = new Map(m); n.delete(s.uid); return n; }), 360));
      }, holdMs));
    }
  }, [findEl, cardIds]);

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
  }, [active, beatIdx, beats]);

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
  }, [active, hidden, paused, beatIdx, beats, combatSpeed, events, cardIds]);

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
    const t = window.setTimeout(() => setTriggers((prev) => {
      const next = new Set(prev);
      for (const uid of trig) next.delete(uid);
      return next;
    }), 1150);
    return () => window.clearTimeout(t);
  }, [active, beatIdx, beats, events, cardIds]);

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
      findEl,
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
      // buff-OTHER casts (source ≠ target) → tendril/descend + badge flash (shared with the attack-wind-up path).
      onBuffCasts: (casts) => fireBuffCasts(casts, timers),
      onSelfBuffs: (selfBuffs) => fireSelfBuffs(selfBuffs, timers),
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
          pixiFx.coins(cx, cy);
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
          pixiFx.damageBurst(cx, cy);
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
          pixiFx.dust(cx, cy, w, h);
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
      if (!CARD_INDEX[cardIds.get(e.target) ?? '']?.effects?.some((f) => f.on === 'onDeath')) continue;
      const r = rectOf(e.target);
      if (r) pixiFx.deathrattle(r.cx, r.cy, r.w);
    }
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      // Release any statHold whose flash timer we just cancelled — otherwise a buff whose tendril hadn't
      // "landed" when the beat advances (or the replay ends) leaves its target STUCK at its pre-buff value.
      // Repro: Kennelmaster + a Deathrattle that summons several Beasts — only the first summon's hold released,
      // the rest stayed at base (e.g. 2/2, 1/1, 1/1). The folded frame already carries the real stats, so
      // dropping the holds simply shows them.
      setStatHold((m) => (m.size ? new Map() : m));
      setStatFlash((m) => (m.size ? new Map() : m));
      stop();
    };
  }, [active, beatIdx, beats, events, findEl, cardIds, fireBuffCasts, fireSelfBuffs]);

  // Verdict sting when the replay finishes.
  useEffect(() => {
    if (!active || !done || !combat) return;
    if (combat.result === 'win') sfx.win();
    else if (combat.result === 'lose') sfx.lose();
  }, [active, done, combat]);

  // Measure lunge + SC projectiles AFTER the beat commits, so positions reflect the
  // frame on screen (not the previous one). Runs synchronously before paint.
  useLayoutEffect(() => {
    const windupTimers: number[] = []; // badge-flash timeouts for attack-wind-up tendrils (cleared on teardown)
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
            ? () => { fireBuffCasts(windupCasts, windupTimers); fireSelfBuffs(windupSelfBuffs, windupTimers); }
            : undefined,
          onImpactAuras: breakWards,
          onCritImpact: cur.primary.crit ? () => setCritShake((n) => n + 1) : undefined,
          // Flurry (W): the engine fires the wind-slash gust on the EXTRA swing (swing ≥ 1). Check the unit's
          // LIVE keywords (covers Flurry granted mid-combat), then the printed keyword off the card index.
          flurry: !!atkUnit?.keywords.includes('W') || !!CARD_INDEX[cardIds.get(atkUid) ?? '']?.keywords?.includes('W'),
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
    return () => { windupTimers.forEach((id) => window.clearTimeout(id)); };
  }, [beatIdx, beats, events, findEl, cardIds, fireBuffCasts, fireSelfBuffs]);

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
  if (lungeUid) {
    const atk = frame.player.find((u) => u.uid === lungeUid) ?? frame.enemy.find((u) => u.uid === lungeUid);
    anims[lungeUid] = atk?.keywords.includes('C') ? 'attacking cleaving' : 'attacking';
  }

  let log = 'The boards take their positions…';
  for (let i = processedEnd - 1; i >= 0; i--) {
    const line = narrate(events[i]!, names);
    if (line) { log = line; break; }
  }
  // Bucket the current floats by uid ONCE (memoized on `floats`), handing each unit a stable array
  // reference — float-less units share EMPTY_FLOATS — so the memoized Unit only re-renders the units
  // whose floats actually changed this beat, instead of all ~14 on every render.
  const floatsByUid = useMemo(() => {
    const m = new Map<string, Float[]>();
    for (const f of floats) {
      const arr = m.get(f.uid);
      if (arr) arr.push(f);
      else m.set(f.uid, [f]);
    }
    return m;
  }, [floats]);
  const floatsFor = (uid: string): Float[] => floatsByUid.get(uid) ?? EMPTY_FLOATS;
  const fullLog = useMemo(
    () => events.map((e) => narrateLog(e, names)).filter((l): l is { text: string; kind: string } => l !== null),
    [events, names],
  );
  const procs = useMemo(() => procReport(events, names), [events, names]);
  // Cards granted to the hand by combat effects (Arcane Weaver → Spirit Fire) that have already
  // "landed" — every `toHand` before the current beat. The recruit hand stays the pre-combat hand until
  // `resolveCombat`, so the combat view appends these so the hand visibly grows as cards arrive.
  const handGrantsShown = useMemo(() => {
    const before = beats[beatIdx]?.start ?? events.length;
    return events.slice(0, before).flatMap((e) => (e.type === 'toHand' ? [e.cardId] : []));
  }, [beatIdx, beats, events]);

  return {
    frame, anims, lungeUid, projectiles, floatsFor, deathFloats, log, fullLog, procs, handGrant, handGrantsShown,
    triggerUids: triggers,
    rallyPulseUids: rallyPulse,
    statHoldFor: (uid: string) => statHold.get(uid),
    statFlashFor: (uid: string) => statFlash.get(uid),
    done, result: combat ? combat.result : null, shaking, critShaking,
    beatCount: beats.length, enemyDeaths, combatBuffs, questDelta, triggeredQuests, completedQuests, skip: () => setBeatIdx(beats.length),
  };
}
