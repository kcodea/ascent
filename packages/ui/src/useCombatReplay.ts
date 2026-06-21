import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import gsap from 'gsap';
import type { CombatEvent, CombatResult, Keyword, MinionSnapshot, Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { sfx } from './sfx';

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

const fromSnap = (s: MinionSnapshot): UnitFrame => ({
  uid: s.uid, cardId: s.cardId, name: s.name, tribe: s.tribe, attack: s.attack, health: s.health,
  keywords: [...s.keywords], divineShield: s.keywords.includes('DS'), alive: true,
  golden: s.golden ?? false, summonBonus: s.summonBonus ?? 0,
  baseAttack: s.attack, baseHealth: s.health, // the stats it entered the fight (or was summoned) with
});

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
      if (u) { u.attack += e.attack; u.health += e.health; }
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
  // action beats (the wind-up / cast)
  attack: 340, sc: 720, summon: 440, buff: 420, reborn: 640, improve: 520, rally: 720, toHand: 820,
  // result beats (the impact — keyed by the first result event). Longer than the wind-up so the hit
  // (recoil + the defender's HP dropping) lands and reads before the next swing.
  dmg: 460, shield: 460, shieldUp: 460, poison: 500, death: 400,
};
const FLOAT_MS = 1450;

/**
 * Combat beats. An action (attack / SC / summon / reborn) is its own beat — the
 * wind-up — and the run of result events it caused (damage, shields, poison,
 * deaths) is the *next* beat, where everything lands at once. So an attacker lunges
 * in (beat 1), then it and its target take damage together (beat 2).
 *
 * A run of consecutive `buff` events is *also* collapsed into one beat: a single
 * effect that buffs many minions at once (Grim's Deathrattle giving every Beast
 * +6/+6, a Rally aura) fires them all together rather than one minion at a time.
 */
const RESULT_TYPES = new Set(['dmg', 'shield', 'shieldUp', 'poison', 'death']);

/** The attack lunge, driven by GSAP: wind up (lean back + tilt), strike toward the defender
 *  (power3.in), knock the defender back at the moment of impact, then settle with an elastic
 *  overshoot. `dx`/`dy` is the full attacker→defender vector; the strike covers ~55% of it so the
 *  attacker taps the defender's edge rather than sliding over its badges. GSAP owns the attacker's
 *  transform for the whole lunge — React renders no transform on combat units, so they never fight. */
function playAttackLunge(attacker: Element, defender: Element | null, dx: number, dy: number): void {
  gsap.killTweensOf(attacker); // a re-attacker (Windfury / Gnasher swinging again) restarts clean
  gsap.set(attacker, { zIndex: 12 }); // ride above its neighbours for the duration
  gsap
    .timeline({ onComplete: () => gsap.set(attacker, { clearProps: 'transform,zIndex' }) })
    .to(attacker, { x: -dx * 0.12, y: -dy * 0.12, rotation: -4, duration: 0.16, ease: 'power1.out' }) // wind up
    .to(attacker, { x: dx * 0.55, y: dy * 0.55, rotation: 0, duration: 0.2, ease: 'power3.in' })       // strike
    .add(() => {
      if (!defender) return; // onHit: the struck minion knocks back along the blow, then recovers
      gsap.killTweensOf(defender);
      gsap.fromTo(defender, { x: 0, y: 0 }, {
        x: dx * 0.09, y: dy * 0.09, duration: 0.1, yoyo: true, repeat: 1, ease: 'power2.out',
        onComplete: () => gsap.set(defender, { clearProps: 'transform' }),
      });
    })
    .to(attacker, { x: 0, y: 0, rotation: 0, duration: 0.55, ease: 'elastic.out(1, 0.45)' });           // settle
}
interface Beat {
  start: number;
  end: number;
  primary: CombatEvent;
}
function buildBeats(events: CombatEvent[]): Beat[] {
  const beats: Beat[] = [];
  let i = 0;
  while (i < events.length) {
    const start = i;
    const t = events[i]!.type;
    if (RESULT_TYPES.has(t)) {
      while (i < events.length && RESULT_TYPES.has(events[i]!.type)) i++; // group the impact
    } else if (t === 'buff') {
      while (i < events.length && events[i]!.type === 'buff') i++; // a multi-target buff lands at once
    } else {
      i++; // a single action
    }
    beats.push({ start, end: i, primary: events[start]! });
  }
  return beats;
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
    case 'reborn': return { [e.target]: 'reborn' };
    case 'buff': return { [e.target]: 'buffed' };
    case 'improve': return { [e.target]: 'buffed' };
    case 'sc': return { [e.source]: 'sccast' };
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
    case 'shield': return { uid: e.target, text: '◇', kind: 'shield' };
    case 'shieldUp': return { uid: e.target, text: '◇', kind: 'shieldup' };
    case 'reborn': return { uid: e.target, text: '♻', kind: 'reborn' };
    case 'buff': return { uid: e.target, text: `+${e.attack}/+${e.health}`, kind: 'buff' };
    case 'improve': return { uid: e.target, text: '✦', kind: 'buff' };
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
    case 'shield': return { text: `${n(e.target)}'s Divine Shield absorbs the hit.`, kind: 'shield' };
    case 'shieldUp': return { text: `${n(e.target)} gains a Divine Shield.`, kind: 'shield' };
    case 'poison': return { text: `Poison destroys ${n(e.target)}.`, kind: 'poison' };
    case 'reborn': return { text: `${n(e.target)} is Reborn at ${e.hp} HP.`, kind: 'reborn' };
    case 'reveal': return { text: `${n(e.target)} breaks Stealth.`, kind: 'reveal' };
    case 'death': return { text: `${n(e.target)} is destroyed.`, kind: 'death' };
    case 'summon': return { text: `${e.minion.name} (${e.minion.attack}/${e.minion.health}) is summoned.`, kind: 'summon' };
    case 'buff': return { text: `${n(e.target)} grows +${e.attack}/+${e.health}.`, kind: 'buff' };
    case 'improve': return { text: `${n(e.target)}'s summon aura strengthens by +${e.amount}/+${e.amount}.`, kind: 'buff' };
    case 'rally': return { text: `${n(e.source)}'s Rally triggers ${n(e.target)}'s Deathrattle.`, kind: 'sc' };
    case 'toHand': return { text: `${cardName(e.cardId)} is added to your hand.`, kind: 'summon' };
    default: return null;
  }
}

function narrate(e: CombatEvent, names: Map<string, string>): string | null {
  const n = (uid: string) => names.get(uid) ?? 'a minion';
  switch (e.type) {
    case 'sc': return e.text;
    case 'attack': return `${n(e.attacker)} strikes ${n(e.defender)}.`;
    case 'shield': return 'A Divine Shield absorbs the blow!';
    case 'shieldUp': return `${n(e.target)} gains a Divine Shield.`;
    case 'poison': return `Poison! ${n(e.target)} is destroyed.`;
    case 'reborn': return `${n(e.target)} is Reborn at 1 Health.`;
    case 'death': return `${n(e.target)} falls.`;
    case 'summon': return `${e.minion.name} joins the fray.`;
    case 'buff': return `${n(e.target)} grows +${e.attack}/+${e.health}.`;
    case 'improve': return `${n(e.target)}'s aura strengthens (+${e.amount}/+${e.amount}).`;
    case 'rally': return `${n(e.source)}'s Rally fires ${n(e.target)}'s Deathrattle!`;
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
  const echoed = new Map<string, number>(); // extra copies Echo Warden spun off your summons
  const startCombat = new Map<string, number>(); // Start-of-Combat effects that fired (by source)
  const buffs = new Map<string, { n: number; atk: number; hp: number }>();
  for (const e of events) {
    if (e.type === 'attack') attacks++;
    else if (e.type === 'dmg') dmg += e.amount;
    else if (e.type === 'death') deaths++;
    else if (e.type === 'reborn') reborn++;
    else if (e.type === 'poison') poison++;
    else if (e.type === 'shieldUp') shieldUp++;
    else if (e.type === 'shield') shieldBreak++;
    else if (e.type === 'rally') inc(rally, `${n(e.source)} → ${n(e.target)}'s Deathrattle`);
    else if (e.type === 'sc') inc(startCombat, n(e.source));
    else if (e.type === 'toHand') inc(generated, e.source ? `${n(e.source)} → ${cardName(e.cardId)}` : cardName(e.cardId));
    else if (e.type === 'summon') {
      if (e.echo) inc(echoed, e.minion.name); // Echo Warden's bonus copies — attributed to the engine, not the original
      else inc(summoned, e.source ? `${n(e.source)} → ${e.minion.name}` : e.minion.name);
    }
    else if (e.type === 'buff') {
      const k = n(e.source);
      const t = buffs.get(k) ?? { n: 0, atk: 0, hp: 0 };
      t.n++; t.atk += e.attack; t.hp += e.health;
      buffs.set(k, t);
    }
  }
  const out: { text: string; kind: string }[] = [];
  out.push({ text: `${attacks} attacks · ${dmg} damage dealt · ${deaths} deaths`, kind: 'total' });
  const kw: string[] = [];
  if (shieldUp) kw.push(`${shieldUp} shields gained`);
  if (shieldBreak) kw.push(`${shieldBreak} shields broken`);
  if (poison) kw.push(`${poison} poison kills`);
  if (reborn) kw.push(`${reborn} reborns`);
  if (kw.length) out.push({ text: kw.join(' · '), kind: 'total' });
  if (startCombat.size) { out.push({ text: 'Start of Combat', kind: 'head' }); for (const [k, c] of startCombat) out.push({ text: c > 1 ? `${k} — ${c}×` : k, kind: 'sc' }); }
  if (rally.size) { out.push({ text: 'Rally', kind: 'head' }); for (const [k, c] of rally) out.push({ text: `${k} — ${c}×`, kind: 'rally' }); }
  if (generated.size) { out.push({ text: 'Cards generated', kind: 'head' }); for (const [k, c] of generated) out.push({ text: `${k} — ${c}×`, kind: 'summon' }); }
  if (summoned.size) { out.push({ text: 'Summoned', kind: 'head' }); for (const [k, c] of summoned) out.push({ text: `${k} — ${c}×`, kind: 'summon' }); }
  if (echoed.size) { out.push({ text: 'Echoed · Echo Warden', kind: 'head' }); for (const [k, c] of echoed) out.push({ text: `${k} — +${c}×`, kind: 'summon' }); }
  if (buffs.size) { out.push({ text: 'Buffs', kind: 'head' }); for (const [k, t] of buffs) out.push({ text: `${k} — ${t.n}× (+${t.atk}/+${t.hp})`, kind: 'buff' }); }
  return out;
}

export interface CombatReplay {
  frame: { player: UnitFrame[]; enemy: UnitFrame[] };
  anims: Record<string, string>;
  lungeUid: string | null;
  projectiles: { id: number; x: number; y: number; dx: number; dy: number; kind?: string }[];
  floatsFor: (uid: string) => Float[];
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
  done: boolean;
  result: CombatResult['result'] | null;
  shaking: boolean;
  beatCount: number;
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
  opts: { active: boolean; findEl: (uid: string) => Element | null },
): CombatReplay {
  const { active, findEl } = opts;
  const events = useMemo(() => combat?.events ?? [], [combat]);
  const beats = useMemo(() => buildBeats(events), [events]);
  const [beatIdx, setBeatIdx] = useState(0);
  const [floats, setFloats] = useState<Float[]>([]);
  const [shake, setShake] = useState(0);
  const [shaking, setShaking] = useState(false);
  // Which minion is mid-attack — drives the `attacking` glow class. The lunge MOTION is run
  // imperatively by GSAP (see the layout effect below); React never sets a transform on a unit.
  const [attackUid, setAttackUid] = useState<string | null>(null);
  const [projectiles, setProjectiles] = useState<{ id: number; x: number; y: number; dx: number; dy: number; kind?: string }[]>([]);
  // A card a combat effect just granted to the hand (Arcane Weaver → Spirit Fire) — shown flying to the
  // hand for the duration of its beat, so the player sees it happen instead of it just appearing later.
  const [handGrant, setHandGrant] = useState<{ cardId: string; key: number } | null>(null);
  const done = beatIdx >= beats.length;

  // A fresh combat resets the replay to the top (the hook persists across fights).
  useEffect(() => {
    setBeatIdx(0);
    setFloats([]);
    setAttackUid(null);
    gsap.killTweensOf('[data-zone] .unit'); // stop any lunge left mid-flight by the previous fight
    setProjectiles([]);
    setShake(0);
    setHandGrant(null);
  }, [combat]);

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

  // Advance one beat at a time (a beat = an action + all its result events) — only
  // once `active` (the intro animation has finished and the fight is on).
  useEffect(() => {
    if (!active || beatIdx >= beats.length) return;
    const beat = beats[beatIdx]!;
    let d = (DELAY[beat.primary.type] ?? 300) * SPEED;
    // A short breath after an impact before the next swing, so attacks don't blur into each other.
    if (RESULT_TYPES.has(beat.primary.type) && beats[beatIdx + 1]?.primary.type === 'attack') d += 200;
    const id = window.setTimeout(() => setBeatIdx((k) => k + 1), d);
    return () => window.clearTimeout(id);
  }, [active, beatIdx, beats]);

  // Spawn floats for every damage/poison/shield in the beat just resolved — all at once.
  // Buff events are *summed per target* so a multi-proc deathrattle (e.g. Grim re-procced by
  // Sylus for +18/+18) shows one correct "+18/+18" per minion, not three "+6/+6".
  useEffect(() => {
    if (beatIdx === 0) return;
    const beat = beats[beatIdx - 1];
    if (!beat) return;
    const spawned: Float[] = [];
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
      if (f) spawned.push({ id: i, ...f });
    }
    for (const [uid, { a, h, id }] of buffByTarget) {
      spawned.push({ id, uid, text: `+${a}/+${h}`, kind: 'buff' });
    }
    if (spawned.length === 0) return;
    setFloats((arr) => [...arr, ...spawned.filter((s) => !arr.some((x) => x.id === s.id))]);
    const ids = new Set(spawned.map((s) => s.id));
    const t = window.setTimeout(() => setFloats((arr) => arr.filter((x) => !ids.has(x.id))), FLOAT_MS);
    return () => window.clearTimeout(t);
  }, [beatIdx, beats, events]);

  // Combat SFX — one sound per notable event type in the beat just resolved.
  useEffect(() => {
    if (beatIdx === 0) return;
    const beat = beats[beatIdx - 1];
    if (!beat) return;
    const done2 = new Set<string>();
    const once = (k: string, fn: () => void): void => {
      if (!done2.has(k)) { done2.add(k); fn(); }
    };
    let kill = false;
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (!e) continue;
      if (e.type === 'attack') once('attack', sfx.attack);
      else if (e.type === 'dmg') once('hit', sfx.hit);
      else if (e.type === 'death') { once('death', sfx.death); kill = true; }
      else if (e.type === 'shieldUp') once('shield', sfx.shield);
      else if (e.type === 'buff') once('buff', sfx.buff);
    }
    if (kill) setShake((n) => n + 1); // a death shakes the board (hit-stop feel)
  }, [beatIdx, beats, events]);

  // Verdict sting when the replay finishes.
  useEffect(() => {
    if (!active || !done || !combat) return;
    if (combat.result === 'win') sfx.win();
    else if (combat.result === 'lose') sfx.lose();
  }, [active, done, combat]);

  // uid → cardId (for spotting which dying minion is a Blaster, to fire its purple blast bolts).
  const cardIds = useMemo(() => {
    const m = new Map<string, string>();
    if (!combat) return m;
    for (const u of [...combat.initial.player, ...combat.initial.enemy]) m.set(u.uid, u.cardId);
    for (const e of combat.events) if (e.type === 'summon') m.set(e.minion.uid, e.minion.cardId);
    return m;
  }, [combat]);

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
        playAttackLunge(atkEl, findEl(cur.primary.defender), d.x - a.x, d.y - a.y);
      }
    } else {
      setAttackUid(null);
    }

    // Projectiles: Start-of-Combat bolts (caster → its next-beat dmg targets), plus Blaster's Deathrattle
    // — purple bolts from the dying Blaster to every minion its AOE hit (the dmg events in the same beat).
    const ps: { id: number; x: number; y: number; dx: number; dy: number; kind?: string }[] = [];
    if (cur?.primary.type === 'sc') {
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

  const processedEnd = beatIdx === 0 ? 0 : beats[beatIdx - 1]!.end;
  // Mid-replay, keep the current beat's dying minions one beat; once done, drop
  // every dead minion so the result shows only survivors.
  const beatStart = done ? processedEnd : beatIdx === 0 ? 0 : beats[beatIdx - 1]!.start;
  const frame = useMemo(
    () => (combat ? computeFrame(combat.initial, events, processedEnd, beatStart) : { player: [], enemy: [] }),
    [combat, events, processedEnd, beatStart],
  );

  // Death reflow is CSS-driven (see `.unit.dying` / `.unit.summoned` in styles.css): the dying unit
  // collapses its own flex slot AS it plays its death pop, so the survivors glide in simultaneously
  // (one smooth phase) instead of waiting a beat and then sliding. CSS flex animates the neighbours for
  // free, and — unlike a JS FLIP — it composes cleanly with the GSAP lunge (layout vs transform).

  const currentBeat = beatIdx > 0 ? beats[beatIdx - 1] : undefined;
  const anims: Record<string, string> = {};
  if (currentBeat) {
    for (let i = currentBeat.start; i < currentBeat.end; i++) Object.assign(anims, animFor(events[i]));
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
  const floatsFor = (uid: string): Float[] => floats.filter((f) => f.uid === uid);
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
    frame, anims, lungeUid, projectiles, floatsFor, log, fullLog, procs, handGrant, handGrantsShown,
    done, result: combat ? combat.result : null, shaking,
    beatCount: beats.length, skip: () => setBeatIdx(beats.length),
  };
}
