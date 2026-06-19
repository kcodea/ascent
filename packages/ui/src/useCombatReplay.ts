import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CombatEvent, CombatResult, Keyword, MinionSnapshot, Tribe } from '@game/core';
import { sfx } from './sfx';

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
  attack: 340, sc: 720, summon: 440, buff: 420, reborn: 640, improve: 520,
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
    default: return null;
  }
}

function narrate(e: CombatEvent, names: Map<string, string>): string | null {
  const n = (uid: string) => names.get(uid) ?? 'a minion';
  switch (e.type) {
    case 'sc': return e.text;
    case 'attack': return `${n(e.attacker)} strikes ${n(e.defender)}.`;
    case 'shield': return '◇ A Divine Shield absorbs the blow!';
    case 'shieldUp': return `◇ ${n(e.target)} gains a Divine Shield.`;
    case 'poison': return `☠ Poison! ${n(e.target)} is destroyed.`;
    case 'reborn': return `♻ ${n(e.target)} is Reborn at 1 Health.`;
    case 'death': return `${n(e.target)} falls.`;
    case 'summon': return `${e.minion.name} joins the fray.`;
    case 'buff': return `${n(e.target)} grows +${e.attack}/+${e.health}.`;
    case 'improve': return `${n(e.target)}'s aura strengthens (+${e.amount}/+${e.amount}).`;
    default: return null;
  }
}

export interface CombatReplay {
  frame: { player: UnitFrame[]; enemy: UnitFrame[] };
  anims: Record<string, string>;
  lungeUid: string | null;
  lungeTransform: string | undefined;
  projectiles: { id: number; x: number; y: number; dx: number; dy: number }[];
  floatsFor: (uid: string) => Float[];
  log: string;
  /** The whole fight narrated in detail (every attack, hit, shield, death…) for the
   *  post-combat Combat Log — each line tagged with its kind for styling. */
  fullLog: { text: string; kind: string }[];
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
  const [lunge, setLunge] = useState<{ uid: string; transform: string } | null>(null);
  // The current lunge's raw direction (set on the attack beat), so the following impact beat can
  // recoil the attacker back along the same vector without re-measuring its (already-moved) element.
  const lungeVec = useRef<{ uid: string; dx: number; dy: number } | null>(null);
  const [projectiles, setProjectiles] = useState<{ id: number; x: number; y: number; dx: number; dy: number }[]>([]);
  const done = beatIdx >= beats.length;

  // A fresh combat resets the replay to the top (the hook persists across fights).
  useEffect(() => {
    setBeatIdx(0);
    setFloats([]);
    setLunge(null);
    setProjectiles([]);
    setShake(0);
  }, [combat]);

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

  // Measure lunge + SC projectiles AFTER the beat commits, so positions reflect the
  // frame on screen (not the previous one). Runs synchronously before paint.
  useLayoutEffect(() => {
    const cur = beatIdx > 0 ? beats[beatIdx - 1] : undefined;
    const prev = beatIdx > 1 ? beats[beatIdx - 2] : undefined;
    const center = (uid: string): { x: number; y: number } | null => {
      const el = findEl(uid);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };

    // The attacker leans in on its attack beat — only ~40% of the way, so it taps the defender's edge
    // instead of sliding over its stat badges. Then on the following impact beat it RECOILS back (along
    // the same vector, from the stashed direction) so the struck defender + its dropping HP read clearly.
    if (cur?.primary.type === 'attack') {
      const a = center(cur.primary.attacker);
      const d = center(cur.primary.defender);
      if (a && d) {
        const dx = Math.round((d.x - a.x) * 0.4);
        const dy = Math.round((d.y - a.y) * 0.4);
        lungeVec.current = { uid: cur.primary.attacker, dx, dy };
        setLunge({ uid: cur.primary.attacker, transform: `translate(${dx}px, ${dy}px) scale(1.05)` });
      }
    } else if (cur && RESULT_TYPES.has(cur.primary.type) && prev?.primary.type === 'attack' && lungeVec.current) {
      const { uid, dx, dy } = lungeVec.current; // recoil: pull most of the way back off the defender
      setLunge({ uid, transform: `translate(${Math.round(dx * 0.15)}px, ${Math.round(dy * 0.15)}px) scale(1)` });
    } else {
      setLunge(null);
    }

    // Start-of-Combat bolts fly from the caster to each target its next-beat damage hits.
    if (cur?.primary.type === 'sc') {
      const src = center(cur.primary.source);
      const next = beats[beatIdx];
      const ps: { id: number; x: number; y: number; dx: number; dy: number }[] = [];
      if (src && next) {
        for (let i = next.start; i < next.end; i++) {
          const ev = events[i];
          if (ev?.type === 'dmg') {
            const t = center(ev.target);
            if (t) ps.push({ id: i, x: src.x, y: src.y, dx: t.x - src.x, dy: t.y - src.y });
          }
        }
      }
      setProjectiles(ps);
    } else {
      setProjectiles([]);
    }
  }, [beatIdx, beats, events, findEl]);

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

  const currentBeat = beatIdx > 0 ? beats[beatIdx - 1] : undefined;
  const anims: Record<string, string> = {};
  if (currentBeat) {
    for (let i = currentBeat.start; i < currentBeat.end; i++) Object.assign(anims, animFor(events[i]));
  }

  // The lunging attacker is measured in the layout effect above (correct, current
  // positions); here we just apply its anim class.
  const lungeUid = lunge?.uid ?? null;
  const lungeTransform = lunge?.transform;
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

  return {
    frame, anims, lungeUid, lungeTransform, projectiles, floatsFor, log, fullLog,
    done, result: combat ? combat.result : null, shaking,
    beatCount: beats.length, skip: () => setBeatIdx(beats.length),
  };
}
