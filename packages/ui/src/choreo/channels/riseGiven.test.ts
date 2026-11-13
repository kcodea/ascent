import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { replayBeats, replayOrder } from '../replayOrder';
import { bindingFor } from '../bindings';
import { givesRise, risesGivenIn, type RiseGiven } from './riseGiven';
import { isTravelledRise, riseLaunchAtMs, RISE_GIVEN_GAP_MS, RISE_LAND_SFX, RISE_LAUNCH_SFX } from '../../fx/riseGivenLaunch';
import { holdRise, isRiseHeld, RISE_HOLD_MAX_MS } from '../../fx/riseHold';

/**
 * "ON RISE GIVEN" (R-FX-RISE-GIVEN-01, owner 2026-11-12): a minion that gives another minion Rise launches its bound
 * effect from itself, several at once leave one after another, and each Rise dome waits for its own effect. Graded on
 * SIMULATED fights walked the way the live replay walks them (`replayBeats(replayOrder(...))`).
 */
const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...extra });

function given(player: BoardMinion[], enemy: BoardMinion[]): RiseGiven[][] {
  const { events: raw, initial } = simulate(player, enemy, makeRng(7), CARD_INDEX, combatSide({ tier: 4 }), combatSide({ tier: 4 }));
  const ids = new Map([...initial.player, ...initial.enemy].map((m) => [m.uid, m.cardId]));
  const events = replayOrder(raw);
  return replayBeats(raw).map((b) => risesGivenIn(b, events, ids)).filter((g) => g.length > 0);
}

describe('which cards give Rise', () => {
  it('Mumi, Wolvie, Anubis, Gravewarden and Runic Beetle (its Choose One option) do; an Execute giver and a plain minion do not', () => {
    for (const id of ['mumi', 'b2_wolvie', 'anubis', 'gravewarden', 'beetle']) expect(givesRise(id), id).toBe(true);
    expect(givesRise('b2_raven')).toBe(false);
    expect(givesRise('trainingdummy')).toBe(false);
    expect(givesRise(null)).toBe(false);
  });

  it('all five are bound to the owner\'s beam', () => {
    for (const id of ['mumi', 'b2_wolvie', 'anubis', 'gravewarden', 'beetle']) expect(bindingFor(id, 'riseGiven')?.def, id).toBe('rise-beam');
  });
});

describe('the grants in a beat', () => {
  it('a Gilded Wolvie\'s Echo: two grants in its death beat, from the DEAD Wolvie to two different Beasts', () => {
    const beats = given(
      [bm('b2_wolvie', 1, 1, { golden: true }), bm('b2_beev', 1, 60), bm('b2_beev', 1, 60), bm('b2_beev', 1, 60)],
      [bm('trainingdummy', 5, 60)]);
    const first = beats[0]!;
    expect(first).toHaveLength(2);
    expect(first.every((g) => g.source === 'm0' && g.cardId === 'b2_wolvie' && g.died)).toBe(true);
    expect(new Set(first.map((g) => g.target)).size).toBe(2);
    expect(first.every(isTravelledRise)).toBe(true);
  });

  it('a Gilded Gravewarden\'s Start of Combat: two grants from a LIVING giver', () => {
    const first = given([bm('gravewarden', 1, 60, { golden: true }), bm('mumi', 1, 60), bm('mumi', 1, 60)], [bm('trainingdummy', 0, 60)])[0]!;
    expect(first.map((g) => g.target).sort()).toEqual(['m1', 'm2']);
    expect(first.every((g) => g.source === 'm0' && !g.died)).toBe(true);
  });

  it('an Echo FORCED by Spots names the Echo\'s living owner, not Spots', () => {
    const first = given(
      [bm('b2_spots', 1, 60), bm('b2_wolvie', 1, 60, { golden: true }), bm('b2_beev', 1, 60), bm('b2_beev', 1, 60)],
      [bm('trainingdummy', 0, 60)])[0]!;
    expect(first).toHaveLength(2);
    expect(first.every((g) => g.source === 'm1' && g.cardId === 'b2_wolvie' && !g.died)).toBe(true);
  });

  it('a Rise that is not sourced, or that a body gave itself, is not a travel', () => {
    const events = [
      { type: 'keyword', target: 'a', keyword: 'R' },
      { type: 'keyword', target: 'g', keyword: 'R', source: 'g', tint: 'blue' },
      { type: 'keyword', target: 'a', keyword: 'V', source: 'g' },
      { type: 'keyword', target: 'a', keyword: 'R', source: 'g' },
    ] as never[];
    const moment = { start: 0, end: events.length, primary: events[0]!, stepGroups: [[0, 1, 2, 3]], kind: 'buffWave' as const };
    expect(risesGivenIn(moment, events, new Map([['g', 'mumi']]))).toEqual([{ cardId: 'mumi', source: 'g', target: 'a', died: false }]);
  });
});

describe('more than one Rise at once is a cascade (owner 2026-11-12)', () => {
  it('each next effect leaves one gap after the one before', () => {
    expect(riseLaunchAtMs(0)).toBe(0);
    expect(riseLaunchAtMs(1)).toBe(RISE_GIVEN_GAP_MS);
    expect(riseLaunchAtMs(2, 400)).toBe(400 + 2 * RISE_GIVEN_GAP_MS);
    expect(RISE_GIVEN_GAP_MS).toBeGreaterThanOrEqual(120); // far enough apart to read as two
  });

  const src = readFileSync(new URL('../../fx/riseGivenLaunch.ts', import.meta.url), 'utf8');
  it('every launch path spaces its grants: a living giver, an Echo after its skull, the Shop', () => {
    expect(src).toContain('launchAt: riseLaunchAtMs(k, first)');
    expect(src).toContain('launchAt: riseLaunchAtMs(k, firstMs)');
    expect(src).toContain('launchAt: riseLaunchAtMs(k, wait), sound');
    expect(src).toContain('launchCascade(given, RISE_GIVEN_LAUNCH_DELAY_MS, from, speed, register)');
  });
  it('the dome is released by its own effect landing, and the effect follows its receiver', () => {
    expect(src).toContain('holdRise(g.target, (opts.launchAt + arrive) / s + 50)');
    expect(src).toContain('const settle = trackSettledSlot(() => document.querySelector(unitSelector(g.target)));');
    expect(src).toContain('target: settle?.get, onDone: settle?.stop');
  });
  it('an Echo the skull handling skipped is still delivered', () => {
    expect(src).toContain('RISE_GIVEN_FALLBACK_MS / s');
  });
});

describe('both phases call it', () => {
  it('combat: at the beat start and at both Echo skull sites', () => {
    const replay = readFileSync(new URL('../../useCombatReplay.ts', import.meta.url), 'utf8');
    expect(replay).toContain('startRisesGiven(beat, events, cardIds,');
    expect(replay).toContain('if (r) launchRisesGiven(e.target, r, beat, events, cardIds,');
    expect(replay).toContain('if (hasDR) launchRisesGiven(impactAtk, rect, cur, events, cardIds,');
  });
  it('the Shop: the keyword cue launches it in place of the generic flash', () => {
    const recruit = readFileSync(new URL('../../Recruit.tsx', import.meta.url), 'utf8');
    expect(recruit).toContain("if (keyword === 'R' && from && launchShopRiseGiven({ cardId: from.cardId, source: from.uid, target: uid }, from.beatId)) return;");
  });
  it('the card hides a held Rise', () => {
    const card = readFileSync(new URL('../../Card.tsx', import.meta.url), 'utf8');
    expect(card).toContain("card.keywords.includes('R') && !riseHeld && (");
  });
});

describe('the sounds', () => {
  const clips = (id: string): string[] => (JSON.parse(readFileSync(new URL(`../../fx/defs/${id}.json`, import.meta.url), 'utf8')) as { layers: Array<{ params?: { clip?: string } }> })
    .layers.map((l) => String(l.params?.clip));
  it('a wisp as the effect leaves; a wraith and a chime together as it lands', () => {
    expect(clips(RISE_LAUNCH_SFX)).toEqual(['fx/rise-wisp']);
    expect(clips(RISE_LAND_SFX).sort()).toEqual(['fx/rise-chime', 'fx/rise-wraith']);
  });
});

describe('the dome hold', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('hides the dome, releases on demand, and always expires on its own', () => {
    vi.useFakeTimers();
    holdRise('u1', 500);
    expect(isRiseHeld('u1')).toBe(true);
    holdRise('u1', 0);
    expect(isRiseHeld('u1')).toBe(false);
    holdRise('u2', 999_999);
    vi.advanceTimersByTime(RISE_HOLD_MAX_MS + 1);
    expect(isRiseHeld('u2')).toBe(false);
  });
});
