import { describe, expect, it } from 'vitest';
import { LHR_DEFAULTS } from './lobbyRevealConfig';
import {
  arcKeyframes, revealEntries, revealLayoutFor, revealPhaseAt, revealTargetSelectors, revealTimeline, shouldPlayLobbyReveal,
  spectatorShouldReveal, SPECTATOR_REVEAL_WINDOW_MS,
} from './lobbyRevealModel';

/** THE LOBBY REVEAL, the pure half (owner ask 2026-10-31): who plays it, who stands where, where each lands, when. */
const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, heroId: `h${i}`, label: `P${i}` }));
const run = (extra: Record<string, unknown> = {}) => ({ mode: 'lobby', wave: 1, phase: 'recruit', lobby: { seats: seats(8) }, ...extra });

describe('which game starts play the reveal', () => {
  it('a lobby, Practice and every Versus match, on round 1', () => {
    expect(shouldPlayLobbyReveal(run())).toBe(true);
    expect(shouldPlayLobbyReveal(run({ mode: 'practice' }))).toBe(true);
    expect(shouldPlayLobbyReveal(run({ mode: 'versus', lobby: { seats: seats(2) } }))).toBe(true);
  });
  it('never the Scene Builder, God Mode, the tutorial, a Gauntlet, a replay, a later round, or with the setting off', () => {
    expect(shouldPlayLobbyReveal(run({ sandbox: true }))).toBe(false);
    expect(shouldPlayLobbyReveal(run({ godMode: true }))).toBe(false);
    expect(shouldPlayLobbyReveal(run({ mode: 'tutorial' }))).toBe(false);
    expect(shouldPlayLobbyReveal(run({ mode: 'gauntlet' }))).toBe(false);
    expect(shouldPlayLobbyReveal(run(), { replaying: true })).toBe(false);
    expect(shouldPlayLobbyReveal(run({ wave: 2 }))).toBe(false);
    expect(shouldPlayLobbyReveal(run(), { enabled: false })).toBe(false);
    expect(shouldPlayLobbyReveal(run({ lobby: { seats: seats(1) } }))).toBe(false);
  });
});

describe('the stage and the slots, per mode', () => {
  it('layouts: a table, Duos in teams, the Versus 1v1 as a duel (a group match never is)', () => {
    expect(revealLayoutFor('lobby', 8)).toBe('table');
    expect(revealLayoutFor('practice', 8)).toBe('table');
    expect(revealLayoutFor('versus', 2)).toBe('duel');
    expect(revealLayoutFor('versus', 2, { group: true })).toBe('table');
    expect(revealLayoutFor('versus', 4, { group: true })).toBe('table');
    expect(revealLayoutFor('versus', 8, { duos: true, group: true })).toBe('teams');
  });

  it('a table: you stand in the middle, your opponents in seat order around you', () => {
    const e = revealEntries(seats(8), 'table');
    expect(e.map((x) => x.seatId)).toEqual(['s1', 's2', 's3', 's0', 's4', 's5', 's6', 's7']);
    expect(e.filter((x) => x.you).map((x) => x.seatId)).toEqual(['s0']);
  });

  it('a duel: you, then your opponent', () => {
    expect(revealEntries(seats(2), 'duel').map((x) => x.seatId)).toEqual(['s0', 's1']);
  });

  it('teams: teammates side by side, your team first', () => {
    const shuffled = [seats(8)[0]!, ...seats(8).slice(1).reverse()];
    const e = revealEntries(shuffled, 'teams');
    expect(e.map((x) => x.seatId)).toEqual(['s0', 's1', 's3', 's2', 's5', 's4', 's7', 's6']);
    expect(e.map((x) => x.team)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('every seat lands on its rail row; in a 1v1 the foe on the opponent block, you on your own portrait', () => {
    expect(revealTargetSelectors({ seatId: 's3', you: false }, 'table')).toEqual(['.lobbyrail .lobbyseat[data-seat="s3"]']);
    expect(revealTargetSelectors({ seatId: 's1', you: false }, 'duel')[0]).toBe('.vsfoe-face[data-seat="s1"]');
    expect(revealTargetSelectors({ seatId: 's0', you: true }, 'duel')[0]).toBe('.statusbar .hero .herolunge');
  });
});

describe('the timeline (the sequence state machine)', () => {
  const t = revealTimeline(LHR_DEFAULTS, 8, false);
  it('entrances, then the hold, then staggered flights, each landing a flight later, then the round slice', () => {
    expect(t.enterAt[0]).toBe(LHR_DEFAULTS.startDelayMs);
    expect(t.enterAt[7]! - t.enterAt[0]!).toBe(7 * LHR_DEFAULTS.revealStaggerMs);
    expect(t.fullAt).toBe(t.enterAt[7]! + LHR_DEFAULTS.entranceMs);
    expect(t.flyAt[0]).toBe(t.fullAt + LHR_DEFAULTS.holdMs);
    expect(t.dimOutAt).toBe(t.flyAt[0]);
    for (let i = 0; i < 8; i++) expect(t.landAt[i]! - t.flyAt[i]!).toBe(LHR_DEFAULTS.flyMs);
    expect(t.headAt).toBe(t.landAt[7]! + LHR_DEFAULTS.landMs);
    expect(t.endAt).toBe(t.headAt + LHR_DEFAULTS.headSettleMs);
  });

  it('is short: the reveal under 2 s, the flight and settle under 2 s', () => {
    expect(t.flyAt[0]).toBeLessThanOrEqual(2000);
    expect(t.endAt - t.flyAt[0]!).toBeLessThanOrEqual(2000);
  });

  it('walks idle → reveal → fly → settle → done', () => {
    expect(revealPhaseAt(-1, t)).toBe('idle');
    expect(revealPhaseAt(0, t)).toBe('reveal');
    expect(revealPhaseAt(t.fullAt, t)).toBe('reveal');
    expect(revealPhaseAt(t.dimOutAt, t)).toBe('fly');
    expect(revealPhaseAt(t.headAt, t)).toBe('settle');
    expect(revealPhaseAt(t.endAt, t)).toBe('done');
  });

  it('reduced motion: one fade in, a short hold, one fade out, no flights (about 1.2 s)', () => {
    const r = revealTimeline({ ...LHR_DEFAULTS, holdMs: 2000 }, 8, true);
    expect(new Set(r.enterAt).size).toBe(1);
    expect(new Set(r.flyAt).size).toBe(1);
    expect(r.flyAt).toEqual(r.landAt);
    expect(r.endAt).toBeLessThanOrEqual(LHR_DEFAULTS.startDelayMs + 1300);
  });
});

describe('a flight', () => {
  const from = { left: 900, top: 500, width: 120, height: 120 };
  const to = { left: 1700, top: 300, width: 60, height: 40 };
  const k = arcKeyframes(from, to, 120, 10);
  const parse = (f: Keyframe) => (f.transform as string).match(/-?[\d.]+/g)!.map(Number);
  it('starts on the stage portrait and ends centred on the slot, shrunk to fit it', () => {
    expect(parse(k[0]!)).toEqual([0, 0, 1]);
    const [x, y, s] = parse(k[k.length - 1]!);
    expect(x).toBeCloseTo(1730 - 960, 1);
    expect(y).toBeCloseTo(320 - 560, 1);
    expect(s).toBeCloseTo(40 / 120, 3);
  });
  it('arcs above the straight line, and is transform only', () => {
    const minY = Math.min(...k.map((f) => parse(f)[1]!));
    expect(minY).toBeLessThan(320 - 560 - 20);
    for (const f of k) expect(Object.keys(f).sort()).toEqual(['offset', 'transform']);
  });
});

describe('the stands', () => {
  it('play it only when they watched the Hero Select just before the opening shop', () => {
    const r = run();
    expect(spectatorShouldReveal(1000, 2000, r)).toBe(true);
    expect(spectatorShouldReveal(null, 2000, r)).toBe(false); // a late joiner never saw the Hero Select
    expect(spectatorShouldReveal(1000, 1000 + SPECTATOR_REVEAL_WINDOW_MS + 1, r)).toBe(false);
    expect(spectatorShouldReveal(1000, 2000, run({ phase: 'combat' }))).toBe(false);
    expect(spectatorShouldReveal(1000, 2000, r, false)).toBe(false);
  });
});
