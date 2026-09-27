import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCIENT_IDS, createRun, enableAncients, reduce, type BoardSnapshot, type RunState, type SotBeatFx } from '@game/sim';
import { CARD_INDEX } from '@game/content';
import {
  type SotCue,
  NO_SOT_HOLDS, SOT_ARRIVE_STAGGER_MS, SOT_BEAT_TAIL_MS, SOT_GAIN_STAGGER_MS, SOT_POST_WIPE_PAD_MS, SOT_PULSE_LEAD_MS, SOT_QUIET_TAIL_MS,
  holdSotBeats, holdSotGains, planSotBeats, releaseSotCue, releaseSotGain, sotBeatsMayPlay, sotHolding, sotShownStats,
} from './sotBeats';
import { heldSotRuneProcs } from './sotRuneHold';
import { turnClockMayTick } from './turnClock';
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
    const heroBeats = (s.sotBeatFx ?? []).filter((b) => b.source.kind === 'hero');
    expect(heroBeats).toHaveLength(1);
    const { cues } = planSotBeats(heroBeats);
    expect(cues[0]).toMatchObject({ kind: 'pulse', source: hero });
    const gains = cues.filter((c) => c.kind === 'gain');
    expect(gains.map((c) => (c.kind === 'gain' ? [c.uid, c.attack, c.health] : null))).toEqual(s.board.map((c) => [c.uid, 3 * n, 2 * n]));
  });
});

const RECRUIT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Recruit.tsx'), 'utf8');

describe('every Start of Turn source gets its own beat, and the turn waits for them (owner 2026-09-27)', () => {
  const rune = { kind: 'rune' as const, id: 'rune_resonance', label: 'Rune of Resonance' };
  const minion = { kind: 'minion' as const, uid: 'fc', cardId: 'd2_felconjurer', label: 'Fel Conjurer' };
  const key = (c: SotCue): string => `${c.beat}:${c.kind}${c.kind === 'arrive' ? `:${c.zone}:${c.uid}` : ''}`;

  it('a batch is a SEQUENCE of beats in batch (sim) order: pulse, gains, then arrivals; never one merged wave', () => {
    const beats: SotBeatFx[] = [
      { source: rune, gains: [], handGrants: ['h1'], procs: { rune_resonance: 1 } },
      { source: minion, gains: [{ uid: 'a', attack: 2, health: 2 }], handGrants: ['h2'], summons: ['s1'] },
      { source: { kind: 'equipment', uid: 'e', cardId: 'x', label: 'x' }, gains: [] },
    ];
    const { cues, durationMs } = planSotBeats(beats);
    expect(cues.map(key)).toEqual([
      '0:pulse', '0:arrive:hand:h1',
      '1:pulse', '1:gain', '1:arrive:board:s1', '1:arrive:hand:h2',
      '2:pulse',
    ]);
    // The rune's pulse carries its procs: the badge bursts on ITS beat.
    expect(cues[0]).toMatchObject({ kind: 'pulse', procs: { rune_resonance: 1 } });
    // Beats never overlap: each pulse waits for the previous beat's last consequence + its tail.
    const at = (k: string): number => cues.find((c) => key(c) === k)!.at;
    expect(at('0:arrive:hand:h1')).toBe(SOT_POST_WIPE_PAD_MS + SOT_PULSE_LEAD_MS);
    expect(at('1:pulse')).toBe(at('0:arrive:hand:h1') + SOT_BEAT_TAIL_MS);
    expect(at('1:arrive:board:s1')).toBe(at('1:gain') + SOT_GAIN_STAGGER_MS);
    expect(at('1:arrive:hand:h2')).toBe(at('1:arrive:board:s1') + SOT_ARRIVE_STAGGER_MS);
    // A pulse-only beat (a re-equip) is its pulse plus a short tail, and the batch ends after it.
    expect(durationMs).toBe(at('2:pulse') + SOT_QUIET_TAIL_MS);
  });

  it('a turn with no Start of Turn effect plans nothing and adds no delay', () => {
    expect(planSotBeats([])).toEqual({ cues: [], durationMs: 0 });
  });

  it('holds every consequence until its cue: stats as a delta, new cards out of their rows', () => {
    const beats: SotBeatFx[] = [{ source: minion, gains: [{ uid: 'a', attack: 2, health: 3 }], handGrants: ['h'], summons: ['s'], shopAdds: ['o'] }];
    let h = holdSotBeats(NO_SOT_HOLDS, beats);
    expect(sotShownStats(h.stats, 'a', 5, 5)).toEqual({ attack: 3, health: 2 });
    expect([h.hand?.has('h'), h.board?.has('s'), h.shop?.has('o')]).toEqual([true, true, true]);
    for (const cue of planSotBeats(beats).cues) h = releaseSotCue(h, cue);
    expect(sotHolding(h), 'every cue released everything it held').toBe(false);
    expect(releaseSotCue(NO_SOT_HOLDS, { at: 0, kind: 'arrive', beat: 0, source: minion, zone: 'hand', uid: 'zz' })).toBe(NO_SOT_HOLDS);
  });

  it('a Start-of-Turn rune proc is held off the badge until the beat releases it', () => {
    expect(heldSotRuneProcs('k', { rune_resonance: 2 }, 'rune_resonance', {})).toBe(2);
    expect(heldSotRuneProcs('k', { rune_resonance: 2 }, 'rune_resonance', { rune_resonance: 1 })).toBe(1);
    expect(heldSotRuneProcs('k', undefined, 'rune_resonance', {})).toBe(0);
  });

  it('THE TURN TIMER does not tick until the return wipe has rested AND the Start of Turn beats have played', () => {
    const base = { recruitPhase: true, decisionOpen: false, heroSelecting: false, overlayOpen: false, introPlaying: false };
    expect(turnClockMayTick({ ...base, transitionPlaying: true, startOfTurnPlaying: false }), 'the wipe is still up').toBe(false);
    expect(turnClockMayTick({ ...base, transitionPlaying: false }), 'the clock does not wait for the beats (owner 2026-09-27)').toBe(true);
    expect(turnClockMayTick({ ...base, transitionPlaying: false, startOfTurnPlaying: false }), 'no beats: starts at the wipe rest').toBe(true);
  });
});

describe('the Shop plays the beats after the wipe (source pins)', () => {
  it('derives the holds DURING RENDER on the seq (no frame shows the raised numbers or the new cards) and marks the turn busy', () => {
    const i = RECRUIT.indexOf('if ((run.sotBeatFxSeq ?? 0) !== sotSeqSeen) {');
    expect(i).toBeGreaterThan(-1);
    const block = RECRUIT.slice(i, i + 500);
    expect(block).toContain('setSotHolds((prev) => holdSotBeats(prev, batch));');
    expect(block).toContain('setSotPlaying(true);');
    expect(RECRUIT).toContain('|| !!sotHolds.hand?.has(uid);');
    expect(RECRUIT).toContain('displayShop = displayShop.filter((o) => !off.has(o.uid));');
    expect(RECRUIT).toContain('const board = sotOff?.size ? run.board.filter((c) => !sotOff.has(c.uid)) : run.board;');
  });

  it('queues the batch on its seq and plays it only when sotBeatsMayPlay (the wipe at rest), source first', () => {
    expect(RECRUIT).toContain('const prevSotSeq = useRef(run.sotBeatFxSeq ?? 0);');
    const i = RECRUIT.indexOf('if (!sotBeatsMayPlay(run.phase, wipe)');
    expect(i).toBeGreaterThan(-1);
    const block = RECRUIT.slice(i, i + 7000);
    expect(block).toContain('pixiFx.heroPowerBurst(');
    expect(block).toContain('sfx.heroPower(src.id)');
    expect(block).toContain('pulseUnit(src.uid)');
    expect(block).toContain('releaseSotRuneProcs(runKey, cue.procs)');
    expect(block).toContain('setSotHolds((prev) => releaseSotCue(prev, cue));');
    expect(block).toContain('const plan = planSotBeats(beats);');
    expect(block).toContain('setSotPlaying(false);');
    expect(block).toContain('}, [inCombat, wipe, run.phase, sotQueued]);');
  });

  it('the turn timer waits for the wipe and the beats; the offers wait for the beats', () => {
    expect(RECRUIT).toContain("transitionPlaying: wipe !== 'idle',");
    expect(RECRUIT).not.toContain('startOfTurnPlaying: sotPlaying,');
    expect(RECRUIT).toContain("const overlaysHeld = !inCombat && (wipe !== 'idle' || sotPlaying);");
  });

  it('leaving the Shop resets the holds ONLY when something is queued or playing (the coveredOut race)', () => {
    const i = RECRUIT.indexOf('// Left the Shop before (or while) the batch played');
    expect(i).toBeGreaterThan(-1);
    const block = RECRUIT.slice(i, RECRUIT.indexOf('return;', i));
    const guard = block.indexOf('if (sotQueueRef.current.length || sotTimersRef.current.length) {');
    expect(guard).toBeGreaterThan(-1);
    // Both resets sit INSIDE the guard: nothing after the guard's closing brace but the return.
    expect(block.indexOf('setSotHolds(NO_SOT_HOLDS);')).toBeGreaterThan(guard);
    expect(block.indexOf('setSotPlaying(false);')).toBeGreaterThan(guard);
    expect(block.slice(block.indexOf('setSotPlaying(false);') + 'setSotPlaying(false);'.length).replace(/\s/g, '')).toBe('}');
  });

  it('the board shows the held stats', () => {
    expect(RECRUIT).toContain('eotAnimStats?.[m.uid] ?? sotShownStats(sotHeld, m.uid, m.attack, m.health)');
  });

  it('the per-action buff wave and equip cues leave a beat\'s records to that beat', () => {
    expect(RECRUIT).toContain("if (inCombat || wipe !== 'idle') { settleFxRef.current = [...settleFxRef.current, ...events]; return; }");
    expect(RECRUIT).toContain('new Set(run.sotBeatFx.flatMap((b) => b.buffFx ?? []))');
    expect(RECRUIT).toContain('new Set(run.sotBeatFx.flatMap((b) => b.equipFx ?? []))');
  });
});
