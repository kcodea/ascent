import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCIENT_IDS, createRun, enableAncients, reduce, type BoardSnapshot, type RunState, type SotBeatFx } from '@game/sim';
import { CARD_INDEX } from '@game/content';
import {
  SOT_BEAT_TAIL_MS, SOT_POST_WIPE_PAD_MS, SOT_PULSE_LEAD_MS, holdSotGains, planSotBeats, releaseSotGain, sotBeatsMayPlay, sotShownStats,
} from './sotBeats';
import { WIPE_STATES } from './wipeMachine';

/**
 * START OF TURN BEATS (owner 2026-09-26, R-SOT-BEAT-01): "this also does not have a start of turn beat, please wire one
 * in and make sure we bake time for the screen wipe transition." The plan is pure (below); the Shop's player is a hook
 * over live DOM (no jsdom in this repo), so its wiring is source-pinned at the end.
 */
const hero = { kind: 'hero' as const, id: 'risen', label: 'Ancient of Time' };
const beat = (gains: [string, number, number][]): SotBeatFx => ({ source: hero, gains: gains.map(([uid, attack, health]) => ({ uid, attack, health })) });

describe('a Start-of-Turn beat waits for the return wipe', () => {
  it('may play only on a revealed Shop: the recruit phase with the wipe fully at rest', () => {
    for (const w of WIPE_STATES) expect(sotBeatsMayPlay('recruit', w), w).toBe(w === 'idle');
    expect(sotBeatsMayPlay('combat', 'idle')).toBe(false);
    expect(sotBeatsMayPlay('gameover', 'idle')).toBe(false);
  });

  it('its first cue lands a pad AFTER the wipe rests, the source pulses before any gain, and beats never overlap', () => {
    const { cues, durationMs } = planSotBeats([beat([['a', 9, 6], ['b', 9, 6]]), beat([['a', 3, 2]])]);
    expect(Math.min(...cues.map((c) => c.at))).toBeGreaterThanOrEqual(SOT_POST_WIPE_PAD_MS);
    expect(cues.map((c) => `${c.beat}:${c.kind}`)).toEqual(['0:pulse', '0:gain', '0:gain', '1:pulse', '1:gain']);
    const pulse0 = cues[0]!.at, lastGain0 = cues[2]!.at, pulse1 = cues[3]!.at;
    expect(cues[1]!.at - pulse0).toBe(SOT_PULSE_LEAD_MS);
    expect(lastGain0).toBeGreaterThan(cues[1]!.at); // one recipient after another
    expect(pulse1 - lastGain0).toBe(SOT_BEAT_TAIL_MS);
    expect(durationMs).toBeGreaterThan(cues[cues.length - 1]!.at); // the beat reserves its tail
    expect(planSotBeats([]).cues).toEqual([]);
  });

  it('holds each gain off the shown stats until its own cue lands it (a delta, so a mid-beat Shop action still reads right)', () => {
    let held = holdSotGains(null, [beat([['a', 9, 6], ['b', 9, 6]])]);
    expect(sotShownStats(held, 'a', 12, 10)).toEqual({ attack: 3, health: 4 });
    held = releaseSotGain(held, 'a', 9, 6);
    expect(sotShownStats(held, 'a', 12, 10), 'released: the real stats show').toBeUndefined();
    expect(sotShownStats(held, 'b', 20, 20)).toEqual({ attack: 11, health: 14 });
    expect(releaseSotGain(held, 'b', 9, 6), 'nothing held').toBeNull();
  });
});

describe("Lord of the Risen × Ancient of Time's grant rides the Start-of-Turn beat end to end", () => {
  it('resolveCombat hands the Shop one beat whose cues pulse the power then land every minion\'s gain', () => {
    const d = (id: string, uid: string, attack?: number, health?: number) => {
      const c = CARD_INDEX[id]!;
      return { uid, cardId: id, tribe: c.tribe, attack: attack ?? c.attack, health: health ?? c.health, keywords: attack === undefined ? [...c.keywords] : [], golden: false };
    };
    let s = enableAncients({ ...createRun(7, 'risen'), phase: 'recruit', embers: 60, hand: [], board: [d('pack', 'p'), d('shaper', 'b', 0, 500), d('hm_test_squire', 'a', 2, 2)] } as RunState);
    s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: ['time', ...ANCIENT_IDS.filter((a) => a !== 'time').slice(0, 2)] } };
    s = reduce(s, { type: 'pickAncient', id: 'time' });
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    const foes: BoardSnapshot = { v: 1, wave: s.wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 400, minions: [{ cardId: 'sandbag', attack: 3, health: 400, keywords: [] }], seed: 1, origin: 'self' };
    s = reduce({ ...s, servedBoards: { [s.wave]: foes } }, { type: 'faceOmen' });
    const n = s.lastCombat!.playerSummonsMade!;
    s = reduce(s, { type: 'resolveCombat' });
    const { cues } = planSotBeats(s.sotBeatFx ?? []);
    expect(cues[0]).toMatchObject({ kind: 'pulse', source: hero });
    const gains = cues.filter((c) => c.kind === 'gain');
    expect(gains.map((c) => (c.kind === 'gain' ? [c.uid, c.attack, c.health] : null))).toEqual(s.board.map((c) => [c.uid, 3 * n, 2 * n]));
  });
});

const RECRUIT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Recruit.tsx'), 'utf8');

describe('the Shop plays the beat after the wipe (source pins)', () => {
  it('queues the batch on its seq and holds the gains in a layout effect (no frame shows the raised numbers)', () => {
    const i = RECRUIT.indexOf('const prevSotSeq = useRef(run.sotBeatFxSeq ?? 0);');
    expect(i).toBeGreaterThan(-1);
    const block = RECRUIT.slice(i, i + 900);
    expect(block).toContain('useLayoutEffect(() => {');
    expect(block).toContain('setSotHeld((prev) => holdSotGains(prev, beats));');
  });

  it('plays only when sotBeatsMayPlay (the wipe at rest), pulsing the power button and landing each gain', () => {
    const i = RECRUIT.indexOf('if (!sotBeatsMayPlay(run.phase, wipe)');
    expect(i).toBeGreaterThan(-1);
    const block = RECRUIT.slice(i, i + 2400);
    expect(block).toContain('pixiFx.heroPowerBurst(');
    expect(block).toContain('sfx.heroPower(cue.source.id)');
    expect(block).toContain('releaseSotGain(prev, cue.uid, cue.attack, cue.health)');
    expect(block).toContain('planSotBeats(beats).cues');
    expect(block).toContain('}, [inCombat, wipe, run.phase, sotQueued]);');
  });

  it('the board shows the held stats', () => {
    expect(RECRUIT).toContain('eotAnimStats?.[m.uid] ?? sotShownStats(sotHeld, m.uid, m.attack, m.health)');
  });

  it('the shared per-action buff wave captured under the return curtain waits for the wipe too', () => {
    expect(RECRUIT).toContain("if (inCombat || wipe !== 'idle') { settleFxRef.current = [...settleFxRef.current, ...events]; return; }");
  });
});
