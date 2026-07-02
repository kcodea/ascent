import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import gsap from 'gsap';
import type { CombatEvent, CombatResult, Keyword, MinionBuff, MinionSnapshot, Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { sfx } from './sfx';
import { pixiFx } from './pixiFx';
import { getLungeConfig } from './lungeConfig';
import { getTrailConfig } from './trailConfig';
import { buildBeats, RESULT_TYPES } from './combatBeats';
import { combatBuffDelta, type CombatBuffDelta } from './runBuffs';

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
  /** Crypt Drake: ally attacks seen this combat — drives the live "current buff / N to go" text. */
  attackSeen?: number;
  /** Tara: how many stat-grants have accumulated toward ascension this combat. */
  ascendProgress?: number;
  /** Sergeant: accumulated HP bonus on the Deathrattle (grows each time Sergeant gains Attack). */
  hpGrantBonus?: number;
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

interface Float {
  id: number;
  uid: string;
  text: string;
  kind: string;
}

/** A damage float for a minion that DIES this beat. Its unit collapses (`.unit.dying`, width→0) and is
 *  removed next beat, which would clip an in-unit float — so the killing-blow number is rendered in a
 *  board-level overlay at the unit's captured screen position instead, where it survives + lingers. */
export interface DeathFloat {
  id: number;
  x: number;
  y: number;
  text: string;
  kind: string;
}

/** Shared empty array for float-less units, so their `floats` prop keeps a stable reference across
 *  beats and the memoized Unit can skip re-rendering them (a fresh `[]` each render would defeat it). */
const EMPTY_FLOATS: Float[] = [];

const fromSnap = (s: MinionSnapshot): UnitFrame => ({
  uid: s.uid, cardId: s.cardId, name: s.name, tribe: s.tribe, attack: s.attack, health: s.health,
  keywords: [...s.keywords], divineShield: s.keywords.includes('DS'), alive: true,
  golden: s.golden ?? false, summonBonus: s.summonBonus ?? 0,
  hpGrantBonus: s.hpGrantBonus, // Sergeant: seed the live combat text from the run-board accrual (frame 1)
  ascendProgress: s.ascendProgress, // Tara: seed the ascend tracker from the run-board total, then count up
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
function computeFrame(
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
  for (let i = 0; i < Math.min(upto, events.length); i++) {
    const e = events[i];
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
      }
    } else if (e.type === 'reveal') {
      const u = find(e.target);
      if (u) u.keywords = u.keywords.filter((k) => k !== 'ST'); // Stealth lost on attack
    } else if (e.type === 'venomLost') {
      const u = find(e.target);
      if (u) u.keywords = u.keywords.filter((k) => k !== 'V'); // Venomous spent on its first proc
    } else if (e.type === 'death') {
      const u = find(e.target);
      if (u) { u.alive = false; u.health = 0; }
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
    } else if (e.type === 'improve') {
      const u = find(e.target);
      if (u) u.summonBonus += e.amount; // Kennelmaster's aura climbs mid-fight → live card text
    } else if (e.type === 'summon') {
      const arr = e.side === 'player' ? player : enemy;
      arr.splice(Math.min(e.index, arr.length), 0, fromSnap(e.minion));
    }
  }
  return { player: player.filter((u) => !gone.has(u.uid)), enemy: enemy.filter((u) => !gone.has(u.uid)) };
}

// Per-beat lengths (ms), keyed by the beat's first event. SPEED scales it all
// (higher = slower; 1.5 is ~25% slower than the previous 1.2).
const SPEED = 1.5;
const DELAY: Record<string, number> = {
  // action beats (the wind-up / cast). `attack` is tuned so the RESULT beat (smack sound + damage floats +
  // recoil) lands right at the lunge's connection (~530ms = windup 0.37s + strike 0.16s; 353 × SPEED 1.5),
  // not after. Keep `attack` × SPEED ≈ (windupDur + strikeDur) from lungeConfig.ts when retuning the lunge.
  attack: 353, sc: 720, summon: 440, buff: 420, reborn: 640, improve: 520, rally: 720, toHand: 820, maxGold: 560, hpGrant: 0,
  // result beats (the impact — keyed by the first result event). Longer than the wind-up so the hit
  // (recoil + the defender's HP dropping) lands and reads before the next swing.
  dmg: 460, shield: 460, shieldUp: 460, poison: 500, venomLost: 500, death: 400,
};
const FLOAT_MS = 1500; // how long a combat float lingers before it's cleared (kept ≥ the floatup CSS anim)
const DEATH_FLOAT_MS = 1000; // a killing-blow float clears faster — a lone number over a vanished unit shouldn't hang
const FINAL_HOLD_MS = 900; // hold on the last beat (death anim + damage float) before the replay reports `done`

/** The attack lunge, driven by GSAP: wind up (lean back + tilt), strike toward the defender
 *  (power3.in), knock the defender back at the moment of impact, then settle with an elastic
 *  overshoot. `dx`/`dy` is the full attacker→defender vector; the strike covers ~100% of it so the
 *  attacker drives all the way into the defender — a full connecting hit. GSAP owns the attacker's
 *  transform for the whole lunge — React renders no transform on combat units, so they never fight. */
function playAttackLunge(attacker: Element, defender: Element | null, dx: number, dy: number, speed = 1): void {
  const c = getLungeConfig(); // live-tunable (DEV Lunge tuner) → applies to the next attack
  // Motion trail: one up-front rect read gives the resting center; per-frame positions come from GSAP's
  // animated x/y (no per-frame getBoundingClientRect). Wisps fire during windup + strike only — the slow
  // elastic settle shouldn't smear. Gold when the attacker currently has Divine Shield (the `.dscard`
  // marker class the aura tracker also reads).
  const rest = attacker.getBoundingClientRect();
  const cx0 = rest.left + rest.width / 2;
  const cy0 = rest.top + rest.height / 2;
  const gold = attacker.classList.contains('dscard');
  let trailLast = { x: cx0, y: cy0 };
  const trailCutoff = c.windupDur + c.strikeDur;
  gsap.killTweensOf(attacker); // a re-attacker (Windfury / Gnasher swinging again) restarts clean
  gsap.set(attacker, { zIndex: 12 }); // ride above its neighbours for the duration
  const tl = gsap
    .timeline({
      onComplete: () => gsap.set(attacker, { clearProps: 'transform,zIndex' }),
      onUpdate: () => {
        if (tl.time() > trailCutoff) return; // no trail on the elastic settle
        const cx = cx0 + Number(gsap.getProperty(attacker, 'x'));
        const cy = cy0 + Number(gsap.getProperty(attacker, 'y'));
        const tdx = cx - trailLast.x;
        const tdy = cy - trailLast.y;
        if (Math.hypot(tdx, tdy) >= getTrailConfig().emitSpacing) {
          pixiFx.trail(cx, cy, tdx, tdy, gold);
          trailLast = { x: cx, y: cy };
        }
      },
    })
    .to(attacker, { x: -dx * c.windupDepth, y: -dy * c.windupDepth, rotation: -5, scale: c.windupScale, duration: c.windupDur, ease: 'power1.out' })  // wind up (anticipation lean-back + swell)
    .to(attacker, { x: dx * c.strikeDist, y: dy * c.strikeDist, rotation: 0, scale: 1, duration: c.strikeDur, ease: 'power3.in' })          // strike (overdrives into the target → a full, overlapping connecting hit)
    .add(() => {
      // Smack lands HERE — frame-accurate at the moment of contact. The beat-driven sfx (a React
      // effect ~2 frames behind setBeatIdx) ran late and drifted further as the lunge grew; firing
      // from GSAP's timeline closes that gap so the impact sounds off exactly on connection.
      sfx.hit();
      if (!defender) return; // onHit: the struck minion knocks back harder along the blow, then recovers
      // WebGL impact: a flash + spark spray at the defender's center, fired along the blow direction.
      const r = defender.getBoundingClientRect();
      pixiFx.impact(r.left + r.width / 2, r.top + r.height / 2, dx, dy);
      gsap.killTweensOf(defender);
      gsap.fromTo(defender, { x: 0, y: 0 }, {
        x: dx * 0.14, y: dy * 0.14, duration: 0.1 / speed, yoyo: true, repeat: 1, ease: 'power2.out',
        onComplete: () => gsap.set(defender, { clearProps: 'transform' }),
      });
    }, `-=${c.smackLead}`)                                                                                 // …fired smackLead seconds BEFORE the strike completes
    .to(attacker, { x: 0, y: 0, rotation: 0, duration: c.settleDur, ease: 'elastic.out(1, 0.45)' });       // settle
  // The user's combat-speed multiplier: scale the whole lunge so its connection time tracks the (also-scaled)
  // beat clock — they divide the same windup+strike by `speed`, so the impact beat still lands on contact.
  tl.timeScale(speed);
}
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
    case 'maxGold': return { [e.target]: 'goldproc' };
    case 'sc': return e.cast ? { [e.source]: 'sccast' } : {}; // only a genuine SoC cast flashes; narration (spell power, etc.) is silent
    case 'death': return { [e.target]: 'dying' };
    case 'summon': return { [e.minion.uid]: 'summoned' };
    case 'rally': return { [e.source]: 'sccast', [e.target]: 'flare' }; // Deathsayer pulses; the Deathrattle minion flares
    default: return {};
  }
}

/** A floating number/glyph over the unit the active event acts on. */
function floatFor(e: CombatEvent | undefined): { uid: string; text: string; kind: string } | null {
  if (!e) return null;
  switch (e.type) {
    case 'dmg': return { uid: e.target, text: `−${e.amount}`, kind: 'dmg' };
    case 'poison': return { uid: e.target, text: '☠', kind: 'poison' };
    // Divine-Shield-break (◇) + Reborn (♻) floats removed — the break/reborn ring animation reads on its
    // own, and the glyph popped up late + confusing. (shieldUp's ◇ stays — it marks gaining a shield.)
    case 'shieldUp': return { uid: e.target, text: '◇', kind: 'shieldup' };
    case 'buff': return { uid: e.target, text: `+${e.attack}/+${e.health}`, kind: 'buff' };
    case 'improve': return { uid: e.target, text: '✦', kind: 'buff' };
    case 'maxGold': return { uid: e.target, text: `+${e.amount} max gold`, kind: 'gold' };
    case 'rally': return { uid: e.target, text: '☠', kind: 'rally' }; // marks whose Deathrattle is firing
    default: return null;
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
    case 'poison': return { text: `Toxin destroys ${n(e.target)}.`, kind: 'poison' };
    case 'venomLost': return { text: `${n(e.target)}'s Toxin is spent.`, kind: 'poison' };
    case 'reborn': return { text: `${n(e.target)} rises at ${e.hp} HP.`, kind: 'reborn' };
    case 'reveal': return { text: `${n(e.target)} breaks Stealth.`, kind: 'reveal' };
    case 'death': return { text: `${n(e.target)} is destroyed.`, kind: 'death' };
    case 'summon': return { text: `${e.minion.name} (${e.minion.attack}/${e.minion.health}) is summoned.`, kind: 'summon' };
    case 'buff': return { text: `${n(e.target)} grows +${e.attack}/+${e.health}.`, kind: 'buff' };
    case 'improve': return { text: `${n(e.target)}'s summon aura strengthens by +${e.amount}/+${e.amount}.`, kind: 'buff' };
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
    case 'poison': return `Toxin! ${n(e.target)} is destroyed.`;
    case 'reborn': return `${n(e.target)} rises at 1 Health.`;
    case 'death': return `${n(e.target)} falls.`;
    case 'summon': return `${e.minion.name} joins the fray.`;
    case 'buff': return `${n(e.target)} grows +${e.attack}/+${e.health}.`;
    case 'improve': return `${n(e.target)}'s aura strengthens (+${e.amount}/+${e.amount}).`;
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
    else if (e.type === 'death') deaths++;
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
  if (poison) kw.push(`${poison} Toxin kills`);
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
  done: boolean;
  result: CombatResult['result'] | null;
  shaking: boolean;
  beatCount: number;
  /** Enemy minions killed so far in the replay (up to the current beat) — drives Cassen's live counter. */
  enemyDeaths: number;
  /** Run-buff gains telegraphed so far this fight (spell power, max Gold) — drives the live Buffs window. */
  combatBuffs: CombatBuffDelta;
  skip: () => void;
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
  opts: { active: boolean; findEl: (uid: string) => Element | null; combatSpeed?: number },
): CombatReplay {
  const { active, findEl } = opts;
  // User-controlled replay speed (in-combat slider). 1 = the tuned default; >1 faster, <1 slower. Every
  // beat delay / float lifetime / final hold is divided by it, and each lunge is timeScaled to match.
  const combatSpeed = opts.combatSpeed && opts.combatSpeed > 0 ? opts.combatSpeed : 1;
  const events = useMemo(() => combat?.events ?? [], [combat]);
  const beats = useMemo(() => buildBeats(events), [events]);
  const [beatIdx, setBeatIdx] = useState(0);
  const [floats, setFloats] = useState<Float[]>([]);
  const [deathFloats, setDeathFloats] = useState<DeathFloat[]>([]); // damage on dying units (board overlay)
  const [triggers, setTriggers] = useState<Set<string>>(new Set()); // uids whose effect just fired → medallion pulse
  const [shake, setShake] = useState(0);
  const [shaking, setShaking] = useState(false);
  // Which minion is mid-attack — drives the `attacking` glow class. The lunge MOTION is run
  // imperatively by GSAP (see the layout effect below); React never sets a transform on a unit.
  const [attackUid, setAttackUid] = useState<string | null>(null);
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
    setFinished(false);
    setAttackUid(null);
    gsap.killTweensOf('[data-zone] .unit'); // stop any lunge left mid-flight by the previous fight
    setProjectiles([]);
    setShake(0);
    setHandGrant(null);
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

  // Advance one beat at a time (a beat = an action + all its result events) — only once `active` (the intro
  // animation has finished and the fight is on), and NOT while the tab is hidden (so beats + GSAP lunges
  // don't pile up in the background and fire as one loud burst on tab-in; the clock resumes on return).
  useEffect(() => {
    if (!active || hidden || beatIdx >= beats.length) return;
    const beat = beats[beatIdx]!;
    let d = (DELAY[beat.primary.type] ?? 300) * SPEED;
    // The beat on screen is beats[beatIdx-1]; the scheduler controls how long it stays before beats[beatIdx]
    // shows. The lunge config tunes two combat-feel beats (live via the DEV Lunge tuner):
    const shown = beatIdx > 0 ? beats[beatIdx - 1] : undefined;
    const c = getLungeConfig();
    if (shown?.primary.type === 'attack') {
      // The ATTACK (wind-up) hands off to its impact the instant the lunge CONNECTS — not after the attacker
      // settles. Connection = windup+strike (GSAP seconds, NOT ×SPEED); the smack fires `smackLead` before
      // that. Hold the wind-up only until the smack, then advance → the damage beat lands right on contact.
      d = Math.max(120, (c.windupDur + c.strikeDur - c.smackLead) * 1000);
    } else if (shown && RESULT_TYPES.has(shown.primary.type) && beat.primary.type === 'attack') {
      // A breather AFTER an impact, before the next swing, so back-to-back attacks don't blur together.
      d += c.attackGap * 1000;
    }
    d /= combatSpeed; // user speed multiplier — the lunge timeScale divides the same connection time, so they stay in sync
    const id = window.setTimeout(() => setBeatIdx((k) => k + 1), d);
    return () => window.clearTimeout(id);
  }, [active, hidden, beatIdx, beats, combatSpeed]);

  // Hold on the final beat: once the clock reaches the end, wait FINAL_HOLD_MS before reporting `done` — so
  // the last kill's death collapse + damage float fully play before cleanup + the round-end UI take over.
  useEffect(() => {
    if (!active || !replayComplete) return;
    const t = window.setTimeout(() => setFinished(true), FINAL_HOLD_MS / combatSpeed);
    return () => window.clearTimeout(t);
  }, [active, replayComplete, combatSpeed]);

  // Spawn floats for every damage/poison/shield in the beat just resolved — all at once.
  // Buff events are *summed per target* so a multi-proc deathrattle (e.g. Grim re-procced by
  // Sylus for +18/+18) shows one correct "+18/+18" per minion, not three "+6/+6".
  useEffect(() => {
    if (!active || beatIdx === 0) return; // only during the live replay — not on a stale beat at a phase swap
    const beat = beats[beatIdx - 1];
    if (!beat) return;
    // Units that DIE this beat — their unit collapses (width→0) and is gone next beat, which would clip an
    // in-unit float. So their killing-blow damage number is captured at the unit's screen position and
    // rendered in a board overlay instead (it survives the unit + lingers).
    const dying = new Set<string>();
    for (let i = beat.start; i < beat.end; i++) { const e = events[i]; if (e?.type === 'death') dying.add(e.target); }
    const spawned: Float[] = [];
    const deaths: DeathFloat[] = [];
    const buffByTarget = new Map<string, { a: number; h: number; id: number }>();
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (e?.type === 'buff') {
        const cur = buffByTarget.get(e.target) ?? { a: 0, h: 0, id: i };
        cur.a += e.attack;
        cur.h += e.health;
        buffByTarget.set(e.target, cur);
        continue;
      }
      const f = floatFor(e);
      if (!f) continue;
      // A damage number on a dying unit → the board overlay, anchored where the unit is right now.
      if (f.kind === 'dmg' && dying.has(f.uid)) {
        const r = findEl(f.uid)?.getBoundingClientRect();
        if (r) { deaths.push({ id: i, x: r.left + r.width / 2, y: r.top + r.height * 0.32, text: f.text, kind: f.kind }); continue; }
      }
      spawned.push({ id: i, ...f });
    }
    for (const [uid, { a, h, id }] of buffByTarget) {
      spawned.push({ id, uid, text: `+${a}/+${h}`, kind: 'buff' });
    }
    if (spawned.length === 0 && deaths.length === 0) return;
    const timers: number[] = [];
    if (spawned.length) {
      setFloats((arr) => [...arr, ...spawned.filter((s) => !arr.some((x) => x.id === s.id))]);
      const ids = new Set(spawned.map((s) => s.id));
      timers.push(window.setTimeout(() => setFloats((arr) => arr.filter((x) => !ids.has(x.id))), FLOAT_MS / combatSpeed));
    }
    if (deaths.length) {
      setDeathFloats((arr) => [...arr, ...deaths.filter((s) => !arr.some((x) => x.id === s.id))]);
      const ids = new Set(deaths.map((s) => s.id));
      timers.push(window.setTimeout(() => setDeathFloats((arr) => arr.filter((x) => !ids.has(x.id))), DEATH_FLOAT_MS / combatSpeed));
    }
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [active, beatIdx, beats, events, findEl, combatSpeed]);

  // Trigger-medallion pulse — when a unit's EFFECT fires this beat (Start-of-Combat, Deathrattle/summon,
  // buff/aura, Rally, Avenge, Sergeant's HP-grant, Reborn), its trigger icon releases a ring of energy.
  // We tag the acting unit's uid, then clear it after the pulse animation so it always completes (and a
  // re-trigger restarts it). Held a fixed ~1.15s (glow flash + delayed ring) regardless of combat speed.
  useEffect(() => {
    if (!active || beatIdx === 0) return;
    const beat = beats[beatIdx - 1];
    if (!beat) return;
    const trig = new Set<string>();
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (!e) continue;
      if ((e.type === 'sc' || e.type === 'buff' || e.type === 'rally') && e.source) trig.add(e.source);
      else if ((e.type === 'summon' || e.type === 'toHand') && e.source) trig.add(e.source);
      else if (e.type === 'improve' || e.type === 'maxGold' || e.type === 'hpGrant' || e.type === 'reborn') trig.add(e.target);
      // A death whose unit has a Deathrattle/Avenge effect: its trigger just fired (the cleanest signal —
      // the resulting summon/buff events don't reliably carry the dying unit as their source).
      else if (e.type === 'death') {
        const effs = CARD_INDEX[cardIds.get(e.target) ?? '']?.effects;
        if (effs?.some((f) => f.on === 'onDeath' || f.on === 'avenge')) trig.add(e.target);
      }
    }
    if (trig.size === 0) return;
    sfx.triggerPulse(); // once per beat regardless of how many units pulse (the dedupe is built in too)
    setTriggers((prev) => new Set([...prev, ...trig]));
    const t = window.setTimeout(() => setTriggers((prev) => {
      const next = new Set(prev);
      for (const uid of trig) next.delete(uid);
      return next;
    }), 1150);
    return () => window.clearTimeout(t);
  }, [active, beatIdx, beats, events, cardIds]);

  // Combat SFX — one sound per notable event type in the beat just resolved.
  useEffect(() => {
    if (!active || beatIdx === 0) return; // only during the live replay — fixes a phantom "smack" at the next
    const beat = beats[beatIdx - 1];      // shop phase, when new beats swap in while beatIdx is briefly stale
    if (!beat) return;
    // The physical "smack" is fired ONLY from the attack lunge's GSAP timeline, at the exact contact frame
    // (see playAttackLunge) — never from a `dmg` beat. So we don't double-hit, and non-attack damage (SC
    // bolts, deathrattle AOE, poison) no longer borrows the melee smack — those effects get their own cues
    // (e.g. Start-of-Combat → `cast`). Add a dedicated sound here when one's available, not a default smack.
    const done2 = new Set<string>();
    const once = (k: string, fn: () => void): void => {
      if (!done2.has(k)) { done2.add(k); fn(); }
    };
    let kill = false;
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (!e) continue;
      if (e.type === 'attack') once('attack', sfx.attack);
      else if (e.type === 'sc' && e.cast) once('cast', sfx.cast); // Start-of-Combat zap — only a genuine cast, not a narration (spell-power telegraph etc.)
      else if (e.type === 'death') { once('death', sfx.death); kill = true; }
      else if (e.type === 'shieldUp') once('shield', sfx.shield);
      else if (e.type === 'buff') once('buff', sfx.buff);
      else if (e.type === 'maxGold') once('maxgold', sfx.maxGold);
      else if (e.type === 'summon') once('summon', () => sfx.summon(e.minion.cardId));
    }
    if (kill) setShake((n) => n + 1); // a death shakes the board (hit-stop feel)
  }, [active, beatIdx, beats, events]);

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

    // On the attack beat the attacker is marked (the glow) and GSAP runs the whole lunge — wind up,
    // strike toward the defender, recoil the defender, then an elastic settle (see playAttackLunge).
    if (cur?.primary.type === 'attack') {
      const atkEl = findEl(cur.primary.attacker);
      const a = center(cur.primary.attacker);
      const d = center(cur.primary.defender);
      if (atkEl && a && d) {
        setAttackUid(cur.primary.attacker);
        playAttackLunge(atkEl, findEl(cur.primary.defender), d.x - a.x, d.y - a.y, combatSpeed);
      }
    } else {
      setAttackUid(null);
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
  }, [beatIdx, beats, events, findEl, cardIds]);

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

  // Enemy minions killed so far (deaths landed up to the current beat) — Cassen's Collision counter ticks
  // up live in combat off this; settleCombat banks the same total at the end.
  const enemyDeaths = useMemo(() => {
    // Count enemy-side deaths landed up to the current beat — matches simulate's `minion.side === 'enemy'`
    // tally exactly (the death event now carries `side`), so the live count agrees with the settled total.
    let n = 0;
    for (let i = 0; i < processedEnd; i++) {
      const e = events[i];
      if (e?.type === 'death' && e.side === 'enemy') n++;
    }
    return n;
  }, [events, processedEnd]);

  // Run-buff gains telegraphed so far this fight (spell power, max Gold) — folded into the live Buffs window so
  // it ticks up in sync with the replay, then settles into the run state at combat end. Same up-to-the-beat
  // accumulation as `enemyDeaths`.
  const combatBuffs = useMemo(() => combatBuffDelta(events, processedEnd), [events, processedEnd]);

  // Death reflow is CSS-driven (see `.unit.dying` / `.unit.summoned` in styles.css): the dying unit
  // collapses its own flex slot AS it plays its death pop, so the survivors glide in simultaneously
  // (one smooth phase) instead of waiting a beat and then sliding. CSS flex animates the neighbours for
  // free, and — unlike a JS FLIP — it composes cleanly with the GSAP lunge (layout vs transform).

  const currentBeat = beatIdx > 0 ? beats[beatIdx - 1] : undefined;
  const anims: Record<string, string> = {};
  if (currentBeat) {
    for (let i = currentBeat.start; i < currentBeat.end; i++) {
      for (const [uid, cls] of Object.entries(animFor(events[i]))) {
        // The venom-spent flourish lands first in its beat; don't let the poisoner's same-beat
        // retaliation `struck` clobber it. A death still wins (the demise reads over the flourish).
        if (anims[uid] === 'venomspent' && cls === 'struck') continue;
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
    done, result: combat ? combat.result : null, shaking,
    beatCount: beats.length, enemyDeaths, combatBuffs, skip: () => setBeatIdx(beats.length),
  };
}
