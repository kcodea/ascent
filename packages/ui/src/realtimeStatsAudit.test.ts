import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CARD_INDEX, SETS, poolFor, type SetId } from '@game/content';
import {
  combatSide, fuzzCombatBoard, fuzzCombatSide, makeRng, simulate,
  type BoardMinion, type CombatEvent, type CombatResult, type CombatSideState, type FuzzPool, type Minion, type Side,
} from '@game/core';
import { computeFrame } from './useCombatReplay';
import { replayBeats, replayOrder } from './choreo/replayOrder';
import { undeliveredBuffUids, undeliveredRollPlan } from './choreo/buffDelivery';
import { combatBuffDeltas } from './fx/combatBuffRoll';

/**
 * R-REALTIME-STATS-01 — EVERY STAT CHANGE SHOWS IN REAL TIME IN COMBAT (owner 2026-10-14):
 *
 *   *"can you make sure our buffs update in real time in combat? i believe ive seen some that dont, like veinstorm
 *   but im sure there are others."*
 *
 * Two layers, both swept over random fights of every set (random boards, random run contexts, random rune / quest /
 * hero combat mods: the R-SYMMETRY-01 fixture generator, `fuzzCombatBoard` / `fuzzCombatSide`):
 *
 *  1. THE FOLD. `simulate` hands a probe the LIVE boards at every resolution-step boundary (`CombatConfig.probe`).
 *     At each one, the replay's fold of the log so far (`computeFrame` over `replayOrder`, exactly what the combat
 *     screen paints) must show every living body at the engine's Attack and Health. A stat change the engine makes
 *     without an event, or an event the fold reads wrong, fails here with the step that caused it.
 *     Found and fixed (2026-10-14): a risen body kept the OVERKILL DEBT of the blow that killed it, so its first
 *     Health buffs were swallowed on screen (every Rise minion; Second Wind, Rising Tide, Revenant, Echoes on a
 *     risen body); and Rune of Unity's Undead Aura landed on bodies with no event at all.
 *  2. THE DELIVERY. The replay withholds each buffed unit's number until a cue rolls it in. Every withheld unit must
 *     have a deliverer on its own beat (a tendril / pulse cue, the wind-up, or `undeliveredRollPlan`), never "the next
 *     beat". Found and fixed: every RUBY outside a wind-up (Gemstorm's Avenge, Blazer, Kobaby Boldies, a Shout that
 *     casts Rubies) sat at the old number until the next beat, because the gem carries no number.
 */

const SET_IDS: SetId[] = ['set1', 'set2', 'set3', 'set4'];
const fp = (set: SetId): FuzzPool => ({ ...poolFor(set), tribes: SETS[set].tribes });
const SEEDS = Number(process.env.RT_AUDIT_SEEDS ?? 250); // raise locally for a deeper sweep

interface Probe { count: number; stats: Map<string, { cardId: string; attack: number; health: number }> }

function probed(A: BoardMinion[], B: BoardMinion[], sA: CombatSideState, sB: CombatSideState, seed: number): { res: CombatResult; probes: Probe[] } {
  const probes: Probe[] = [];
  const res = simulate(A, B, makeRng(seed), CARD_INDEX, sA, sB, {
    probe: (count, boards) => {
      const stats = new Map<string, { cardId: string; attack: number; health: number }>();
      for (const side of ['player', 'enemy'] as Side[]) {
        for (const m of boards[side] as readonly Minion[]) if (!m.dead && m.health > 0) stats.set(m.uid, { cardId: m.cardId, attack: m.attack, health: m.health });
      }
      probes.push({ count, stats });
    },
  });
  return { res, probes };
}

const FIGHTS = new Map<string, { res: CombatResult; probes: Probe[] }>(); // each fixture fight resolves once per file
function fight(set: SetId, seed: number): { res: CombatResult; probes: Probe[] } {
  const key = `${set}:${seed}`;
  const hit = FIGHTS.get(key);
  if (hit) return hit;
  const f = fightUncached(set, seed);
  FIGHTS.set(key, f);
  return f;
}
function fightUncached(set: SetId, seed: number): { res: CombatResult; probes: Probe[] } {
  const r = makeRng(seed * 7919 + set.length * 31 + set.charCodeAt(3));
  const A = fuzzCombatBoard(r, fp(set), 'A');
  const B = fuzzCombatBoard(r, fp(set), 'B');
  const sA = fuzzCombatSide(r, fp(set), 'A', A);
  const sB = fuzzCombatSide(r, fp(set), 'B', B);
  return probed(A, B, sA, sB, seed);
}

/** Every displayed-vs-engine stat mismatch in one fight: the FIRST per body, with the step that caused it. */
function foldMismatches(res: CombatResult, probes: Probe[]): string[] {
  const raw = res.events;
  const ev = replayOrder(raw);
  // The opening cast beats are unshifted onto the log after the fight resolved (see `CombatConfig.probe`).
  const offset = raw.length - (probes[probes.length - 1]?.count ?? raw.length);
  // The replay reorders WITHIN a clash / wave / Avenge run, so only a prefix that holds exactly the same events as the
  // raw prefix is a moment the engine's state describes: `prefixMax[n - 1] === n - 1`.
  const rawIdx = new Map<CombatEvent, number>(raw.map((e, i) => [e, i]));
  const prefixMax: number[] = [];
  let mx = -1;
  for (let k = 0; k < ev.length; k++) { mx = Math.max(mx, rawIdx.get(ev[k]!) ?? k); prefixMax.push(mx); }
  const out: string[] = [];
  const bad = new Set<string>();
  let prev = offset;
  for (const p of probes) {
    const upto = p.count + offset;
    if (upto > 0 && prefixMax[upto - 1] !== upto - 1) continue; // mid-reorder: not a moment the screen rests on
    const frame = computeFrame(res.initial, ev, upto, upto, new Map());
    const shown = new Map([...frame.player, ...frame.enemy].filter((u) => u.alive && !u.ghost).map((u) => [u.uid, u]));
    for (const [uid, s] of p.stats) {
      if (bad.has(uid)) continue;
      const u = shown.get(uid);
      // Not presented YET (a Rise between its death and its `reborn`, a summon whose event is still to come):
      // presence timing, not a stat.
      if (!u && ev.slice(upto).some((e) => (e.type === 'reborn' && e.target === uid) || (e.type === 'summon' && e.minion.uid === uid))) continue;
      const sh = u ? `${u.attack}/${u.health}` : 'absent';
      if (sh === `${s.attack}/${s.health}`) continue;
      bad.add(uid);
      const step = ev.slice(prev, upto).map((e) => `${e.type}${e.srcCard ? `[${e.srcCard}]` : ''}`).join(' ');
      out.push(`${uid} ${s.cardId}: engine ${s.attack}/${s.health}, screen ${sh} after [${step}]`);
    }
    prev = upto;
  }
  return out;
}

describe('R-REALTIME-STATS-01: the combat screen shows every stat change on the beat it happens', () => {
  for (const set of SET_IDS) {
    it(`${set}: after every resolution step, every living body shows the engine's Attack and Health`, () => {
      const fails: string[] = [];
      let checked = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const { res, probes } = fight(set, seed);
        checked += probes.length;
        for (const f of foldMismatches(res, probes)) fails.push(`${set} seed ${seed}: ${f}`);
      }
      expect(checked, 'the probe saw the fights').toBeGreaterThan(SEEDS * 5);
      expect(fails.slice(0, 15)).toEqual([]);
    });

    it(`${set}: every withheld stat change has a deliverer on its own beat`, () => {
      const fails: string[] = [];
      let buffedBeats = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const { res } = fight(set, seed);
        const ev = replayOrder(res.events);
        replayBeats(res.events).forEach((m, k) => {
          const frame = computeFrame(res.initial, ev, m.end, m.start, new Map());
          const held = combatBuffDeltas(m, ev, frame).map((d) => d.uid);
          if (held.length === 0) return;
          buffedBeats++;
          // What a cue delivers: the wind-up rolls everything it absorbed; a buff wave / Shout rolls every non-Ruby buff.
          const cued = new Set<string>();
          for (let i = m.start; i < m.end; i++) {
            const e = ev[i];
            if (e?.type !== 'buff') continue;
            if (m.kind === 'attackExchange' || ((m.kind === 'buffWave' || m.kind === 'shout') && !e.ruby)) cued.add(e.target);
          }
          const planned = new Set(undeliveredRollPlan(m, ev, 1, 140).map((p) => p.uid));
          for (const uid of held) {
            if (!cued.has(uid) && !planned.has(uid)) fails.push(`${set} seed ${seed} beat ${k} (${m.kind}): ${uid} is held with no deliverer`);
          }
        });
      }
      expect(buffedBeats).toBeGreaterThan(SEEDS);
      expect(fails.slice(0, 15)).toEqual([]);
    });
  }

  it('a risen body takes its Health buffs on screen (the overkill debt of its death is spent by the Rise)', () => {
    // A Rise Footman takes 9 into 1 Health (8 overkill), rises at 1, then Rune of the Second Wind gives it +2/+2.
    const A: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 30, sourceUid: 'A0' }];
    const B: BoardMinion[] = [{ cardId: 'footman', attack: 1, health: 1, keywords: ['R'], sourceUid: 'B0' }];
    const { res, probes } = probed(A, B, combatSide(), combatSide({ questMods: { runeSecondWind: true } }), 3);
    const ev = replayOrder(res.events);
    const reborn = ev.findIndex((e) => e.type === 'reborn');
    const buff = ev.findIndex((e, i) => i > reborn && e.type === 'buff' && e.source === 'Rune of the Second Wind');
    expect(reborn).toBeGreaterThan(-1);
    expect(buff).toBeGreaterThan(reborn);
    const target = (ev[buff] as Extract<CombatEvent, { type: 'buff' }>).target;
    const f = computeFrame(res.initial, ev, buff + 1, buff + 1, new Map());
    const rebornHp = (ev[reborn] as Extract<CombatEvent, { type: 'reborn' }>).hp;
    expect(f.enemy.find((u) => u.uid === target)!.health).toBe(rebornHp + 2);
    expect(foldMismatches(res, probes)).toEqual([]);
  });

  it('Rune of Unity: the Undead Aura a body takes on joining the full house mid-fight moves its badge on that beat', () => {
    let seen = 0;
    for (const set of SET_IDS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const { res, probes } = fight(set, seed);
        if (!res.events.some((e) => e.type === 'buff' && e.source === 'Rune of Unity')) continue;
        seen++;
        expect(foldMismatches(res, probes), `${set} seed ${seed}`).toEqual([]);
      }
    }
    expect(seen, 'the sweep forms a Unity full house mid-fight').toBeGreaterThan(0);
  });

  it('a Ruby in a buff wave (Gemstorm-style Avenge) is rolled in as its gem lands, not on the next beat', () => {
    const events: CombatEvent[] = [
      { type: 'buff', target: 'm1', attack: 1, health: 1, source: 'm9', ruby: true },
      { type: 'buff', target: 'm2', attack: 1, health: 1, source: 'm9', ruby: true },
      { type: 'buff', target: 'm3', attack: 2, health: 0, source: 'm9' },
    ];
    const m = { start: 0, end: 3, kind: 'buffWave' as const };
    expect(undeliveredBuffUids(m, events)).toEqual(['m1', 'm2']);
    // The cascade walks the gems 100 ms apart; each number lands with its gem plus the authored lead, speed-scaled.
    expect(undeliveredRollPlan(m, events, 1, 140)).toEqual([{ uid: 'm1', atMs: 140 }, { uid: 'm2', atMs: 240 }]);
    expect(undeliveredRollPlan(m, events, 2, 140)).toEqual([{ uid: 'm1', atMs: 70 }, { uid: 'm2', atMs: 120 }]);
    // A wind-up rolls its own Rubies.
    expect(undeliveredBuffUids({ ...m, kind: 'attackExchange' }, events)).toEqual([]);
  });

  it('the replay hands the undelivered numbers to the roll registry on every beat', () => {
    const src = fs.readFileSync(path.join(__dirname, 'useCombatReplay.ts'), 'utf8');
    expect(src).toContain('for (const r of undeliveredRollPlan(beat, events, combatSpeedRef.current, AUTHORED_BUFF_ROLL_MS)) scheduleRoll(r.uid, r.atMs);');
  });
});
