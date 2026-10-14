import { describe, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { replayBeats, replayOrder } from '../choreo/replayOrder';
import type { Moment } from '../choreo/compile';
import { holdMs } from '../choreo/clock';
import { groupBuffCasts } from '../choreo/channels/buffCast';
import { wavesAheadOf } from '../choreo/channels/windupWaves';

/**
 * TIMING PROBE (diagnosis instrumentation, 2026-10-13 demon-damage timing; NOT a regression test).
 * Runs only with PROBE=1: `PROBE=1 npx vitest run packages/ui/src/choreographer/timingProbe.test.ts`.
 * Prints, per scenario, the replay's moment list around the trigger under study: kind, primary event, wave,
 * hit-reaction flag, the base-speed hold the clock places BEFORE the moment (`holdMs`, 1x), and what lands inside
 * the moment in ONE frame commit (dmg count, buff events, distinct effect fires, tendril casts, summed deltas).
 */
const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [], ...extra });
const wall = (n: number, hp = 40): BoardMinion[] => Array.from({ length: n }, () => bm('trainingdummy', 0, hp));

function fight(p: BoardMinion[], e: BoardMinion[], seed = 7) {
  return simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
}

function name(uid: string, events: CombatEvent[], init: Map<string, string>): string {
  const id = init.get(uid);
  return id ? `${uid}:${CARD_INDEX[id]?.name ?? id}` : uid;
}

/** Distinct effect FIRES inside a moment: a fire = a maximal run of buff events with the same (key, source). */
function fires(events: CombatEvent[], m: Moment): Record<string, number> {
  const out: Record<string, number> = {};
  let prev = '';
  for (let i = m.start; i < m.end; i++) {
    const e = events[i]!;
    if (e.type !== 'buff') { prev = ''; continue; }
    const k = `${(e.key ?? 'nokey').replace(/^factory:/, '').split(':')[0]}@${e.source}`;
    if (k !== prev) out[k] = (out[k] ?? 0) + 1;
    prev = k;
  }
  return out;
}

function dump(label: string, r: ReturnType<typeof fight>, from: (m: Moment, i: number, ev: CombatEvent[]) => boolean, span = 8): void {
  const order = replayOrder(r.events);
  const moments = replayBeats(r.events);
  const init = new Map<string, string>();
  for (const u of [...r.initial.player, ...r.initial.enemy]) init.set(u.uid, u.cardId);
  for (const e of r.events) if (e.type === 'summon') init.set(e.minion.uid, e.minion.cardId);
  const at = moments.findIndex((m, i) => from(m, i, order));
  const lines: string[] = [`\n=== ${label} (moments ${moments.length}, events ${r.events.length}) ===`];
  if (at < 0) { lines.push('  trigger not found'); console.log(lines.join('\n')); return; }
  let t = 0;
  for (let i = Math.max(0, at - 1); i < Math.min(moments.length, at + span); i++) {
    const m = moments[i]!;
    const prev = i > 0 ? moments[i - 1] : undefined;
    const h = Math.round(holdMs(m, prev, 1));
    if (i > at - 1) t += h;
    const ev = order.slice(m.start, m.end);
    const cnt: Record<string, number> = {};
    for (const e of ev) cnt[e.type] = (cnt[e.type] ?? 0) + 1;
    const casts = groupBuffCasts(m, order);
    const sumCasts = casts.map((c) => `${name(c.source, order, init).split(':')[1]}>${c.target}+${c.attack}/${c.health}`).slice(0, 6).join(' ');
    const p = m.primary as CombatEvent & { attacker?: string; target?: string; source?: string };
    const who = p.type === 'attack' ? name(p.attacker!, order, init) : p.target ? name(p.target, order, init) : p.source ? name(String(p.source), order, init) : '';
    const park = p.type === 'attack' && wavesAheadOf(m, order, p.attacker!) ? ' PARKED' : '';
    lines.push(
      `  #${i} hold-before=${h}ms (t~${t}) kind=${m.kind}${m.hitReaction ? ' [hitReaction]' : ''}${p.wave !== undefined ? ` wave=${p.wave}` : ''} primary=${p.type} ${who}${park}\n` +
      `      events=${JSON.stringify(cnt)} fires=${JSON.stringify(fires(order, m))}\n` +
      `      tendrilCasts=${casts.length} ${sumCasts}${casts.length > 6 ? ' ...' : ''}`,
    );
  }
  console.log(lines.join('\n'));
}

const attackBy = (uid: string) => (m: Moment) => m.primary.type === 'attack' && m.primary.attacker === uid;
const deathOf = (uid: string) => (m: Moment, _i: number, ev: CombatEvent[]) => ev.slice(m.start, m.end).some((e) => e.type === 'death' && e.target === uid);

describe.skipIf(process.env.PROBE !== '1')('timing probe', () => {
  it('Dragonflame Rally (reference)', () => {
    // Flamebeat (Rally: cast Dragonflame), 4 more Dragons, Captain Flamus (every Dragon attack casts Dragonflame).
    dump('Flamebeat Drake swing, 5 Dragons on board', fight(
      [bm('d2_flamebeat', 6, 50, { keywords: ['RL'] }), bm('d2_chorus', 0, 50), bm('d2_scalechanter', 0, 50), bm('d2_riverdrake', 0, 50), bm('trainingdummy', 0, 50)],
      wall(7, 80)), attackBy('m0'), 4);
    dump('Flamebeat Drake swing + Captain Flamus (two casts in one swing)', fight(
      [bm('d2_flamebeat', 6, 50, { keywords: ['RL'] }), bm('d2_warflame', 0, 50), bm('d2_scalechanter', 0, 50), bm('d2_riverdrake', 0, 50)],
      wall(7, 80)), attackBy('m0'), 4);
    dump('GILDED Flamebeat + GILDED Flamus (4 casts in one swing)', fight(
      [bm('d2_flamebeat', 6, 50, { keywords: ['RL'], golden: true }), bm('d2_warflame', 0, 50, { golden: true }), bm('d2_scalechanter', 0, 50), bm('d2_riverdrake', 0, 50)],
      wall(7, 80)), attackBy('m0'), 4);
  });

  it('Gasket alone', () => {
    dump('Gasket (plain) vs 7, with 2 friendly non-Demons', fight(
      [bm('dm_gasket', 7, 3, { keywords: ['RL'] }), bm('trainingdummy', 0, 40), bm('trainingdummy', 0, 40)],
      wall(7)), attackBy('m0'), 5);
    dump('Gasket (GILDED) vs 7', fight(
      [bm('dm_gasket', 7, 3, { keywords: ['RL'], golden: true }), bm('trainingdummy', 0, 40), bm('trainingdummy', 0, 40)],
      wall(7)), attackBy('m0'), 7);
  });

  it('Gasket + Demon-damage reactors', () => {
    dump('Gasket + Rad Rachel + 2 neutrals vs 7', fight(
      [bm('dm_gasket', 7, 3, { keywords: ['RL'] }), bm('dm_radrachel', 0, 40), bm('trainingdummy', 0, 40), bm('trainingdummy', 0, 40)],
      wall(7)), attackBy('m0'), 5);
    dump('GILDED Gasket + Rachel + Ruinous Lord + Leech + Axeman + Todd vs 7', fight(
      [bm('dm_gasket', 7, 3, { keywords: ['RL'], golden: true }), bm('dm_radrachel', 0, 40), bm('dm_ruinouslord', 0, 40), bm('dm_leech', 0, 40), bm('dm_chosenfiend', 0, 40), bm('dm_todd', 0, 40)],
      wall(7)), attackBy('m0'), 7);
  });

  it('Fel Spikes alone / with reactors', () => {
    // Fel Spikes in front (Taunt) with low health so the first enemy swing kills it.
    dump('Fel Spikes Echo (plain) vs 7 (enemy kills it)', fight(
      [bm('dm_felspikes', 0, 1, { keywords: ['T'] }), bm('trainingdummy', 0, 40), bm('trainingdummy', 0, 40)],
      [bm('trainingdummy', 5, 40), ...wall(6)], 3), deathOf('m0'), 6);
    dump('Fel Spikes Echo (GILDED) vs 7', fight(
      [bm('dm_felspikes', 0, 1, { keywords: ['T'], golden: true }), bm('trainingdummy', 0, 40), bm('trainingdummy', 0, 40)],
      [bm('trainingdummy', 5, 40), ...wall(6)], 3), deathOf('m0'), 8);
    dump('Fel Spikes Echo (plain) + Rad Rachel + Leech', fight(
      [bm('dm_felspikes', 0, 1, { keywords: ['T'] }), bm('dm_radrachel', 0, 40), bm('dm_leech', 0, 40), bm('trainingdummy', 0, 40)],
      [bm('trainingdummy', 5, 40), ...wall(6)], 3), deathOf('m0'), 6);
    dump('Fel Spikes Echo (GILDED) + Rachel + Ruinous Lord', fight(
      [bm('dm_felspikes', 0, 1, { keywords: ['T'], golden: true }), bm('dm_radrachel', 0, 40), bm('dm_ruinouslord', 0, 40), bm('trainingdummy', 0, 40)],
      [bm('trainingdummy', 5, 40), ...wall(6)], 3), deathOf('m0'), 8);
  });

  it('Gasket + Rachel edge cases (does the reaction split survive?)', () => {
    dump('Gasket + Rachel + Impossible Todd (tribeAura per hit)', fight(
      [bm('dm_gasket', 7, 3, { keywords: ['RL'] }), bm('dm_radrachel', 0, 40), bm('dm_todd', 0, 40), bm('trainingdummy', 0, 40)],
      wall(7)), attackBy('m0'), 4);
    dump('Gasket + Rachel, the pass KILLS 2-health victims (deaths in the pass)', fight(
      [bm('dm_gasket', 7, 3, { keywords: ['RL'] }), bm('dm_radrachel', 0, 40), bm('trainingdummy', 0, 40)],
      [...wall(3, 2), ...wall(4)]), attackBy('m0'), 5);
    dump('Gasket + Rachel, a victim has a Ward', fight(
      [bm('dm_gasket', 7, 3, { keywords: ['RL'] }), bm('dm_radrachel', 0, 40), bm('trainingdummy', 0, 40)],
      [bm('trainingdummy', 0, 40, { keywords: ['DS'] }), ...wall(4)]), attackBy('m0'), 5);
    dump('Gasket + Rachel + Rune of Ruins (questTrigger per hit)', simulate(
      [bm('dm_gasket', 7, 3, { keywords: ['RL'] }), bm('dm_radrachel', 0, 40), bm('trainingdummy', 0, 40)],
      wall(5), makeRng(7), CARD_INDEX, combatSide({ tier: 6, questMods: { runeRuins: true } }), combatSide({ tier: 6 })), attackBy('m0'), 4);
    dump('Gasket + Rachel, a victim is Void Panther-like Echo summoner (deaths + summons)', fight(
      [bm('dm_gasket', 7, 3, { keywords: ['RL'] }), bm('dm_radrachel', 0, 40), bm('dm_knocked', 0, 2)],
      wall(5)), attackBy('m0'), 6);
  });

  it('Melee Demon hit + Rachel (reference: clash reaction)', () => {
    dump('Rad Rachel swings (melee) with Leech + neutral', fight(
      [bm('dm_radrachel', 8, 40), bm('dm_leech', 0, 40), bm('trainingdummy', 0, 40)],
      wall(3)), attackBy('m0'), 3);
  });

  it('Echo chains', () => {
    dump('Armadiyo Echo (buff all Beasts) dies', fight(
      [bm('b2_armadiyo', 0, 1, { keywords: ['T'] }), bm('b2_trex', 0, 40), bm('b2_mammoth', 0, 40), bm('trainingdummy', 0, 40)],
      [bm('trainingdummy', 5, 40), ...wall(3)], 3), deathOf('m0'), 5);
    dump('Knocked Echo (summon Imp) dies', fight(
      [bm('dm_knocked', 0, 1, { keywords: ['T'] }), bm('trainingdummy', 0, 40)],
      [bm('trainingdummy', 5, 40), ...wall(3)], 3), deathOf('m0'), 4);
    dump('Echohorn Rally -> left-most Echo (Armadiyo)', fight(
      [bm('b2_armadiyo', 0, 40), bm('b2_echohorn', 6, 40, { keywords: ['RL'] }), bm('b2_trex', 0, 40)],
      wall(3)), attackBy('m1'), 4);
    dump('GILDED Echohorn Rally -> Armadiyo (2 procs)', fight(
      [bm('b2_armadiyo', 0, 40), bm('b2_echohorn', 6, 40, { keywords: ['RL'], golden: true }), bm('b2_trex', 0, 40)],
      wall(3)), attackBy('m1'), 4);
    dump('Echohorn Rally -> Fel Spikes Echo (+ Rachel)', fight(
      [bm('dm_felspikes', 0, 40), bm('b2_echohorn', 6, 40, { keywords: ['RL'] }), bm('dm_radrachel', 0, 40)],
      wall(4)), attackBy('m1'), 6);
    dump('Dawn Sentinel Echo dies', fight(
      [bm('ce3_dawnsentinel', 0, 1, { keywords: ['T'] }), bm('trainingdummy', 0, 40), bm('trainingdummy', 0, 40)],
      [bm('trainingdummy', 5, 40), ...wall(3)], 3), deathOf('m0'), 4);
  });
});
