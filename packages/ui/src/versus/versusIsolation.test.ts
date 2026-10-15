/**
 * VERSUS is separate and unranked (blueprint 10 + 13 "Persistence and integration"; owner ruling 9: no rank, rating
 * or MMR change, ever). Every existing persistence/upload gate is asked about a Versus run here, so a gate that
 * starts treating "not practice" as "rated" fails this test rather than reaching a player's rank.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { createVersusRun, reduce, resolveVersusFight, telemetrySourceOf } from '@game/sim';
import { goldClockOf } from '../goldClock';
import { poolNeededFor } from '../opponentPool/poolGate';
import { isRealPlayRun } from '../perfCaptureScope';
import { rankedAbandonOf, rankedRunIdForFinish } from '../rank/ratedRun';
import { runRecordsDraft } from '../replay/replayDraft';
import { isResumableRun } from '../store';
import { standardTurnSeconds } from '../turnClock';
import { installVersusHandlers, versusAction, versusLand } from './versusHooks';

const run = () => createVersusRun(9, 'warden', 'set2');

describe('Versus never touches the ladder or the save slot', () => {
  it('no save slot, no rank request, no abandon settlement, no replay draft, no pool, no Gold Fuse, no perf share', () => {
    const r = run();
    expect(isResumableRun(r)).toBe(false); // ascent.save and the cloud saved_runs row never hold a Versus run
    expect(rankedRunIdForFinish(r, 1)).toBeNull();
    expect(rankedAbandonOf({ ...r, phase: 'recruit' }, true)).toBeNull();
    expect(runRecordsDraft(r)).toBe(false);
    expect(poolNeededFor(r.mode)).toBe(false);
    expect(goldClockOf(r, 1)).toBeNull();
    expect(isRealPlayRun(r)).toBe(false);
    expect(telemetrySourceOf(r)).toBe('versus');
  });
});

describe('Versus commit seam', () => {
  it('End Turn parks the side for the server; the commit lands the round\'s fight when it is in', () => {
    const r = run();
    expect(versusAction(r, { type: 'faceOmen' })).toEqual({ type: 'faceOmen', deferFight: true });
    expect(versusAction({ ...r, mode: 'lobby' }, { type: 'faceOmen' })).toEqual({ type: 'faceOmen' });
    const parked = reduce(r, { type: 'faceOmen', deferFight: true });
    const fight = resolveVersusFight({ matchSeed: 1, round: 1, p1: parked.pendingCombatSide!, p2: parked.pendingCombatSide! });
    installVersusHandlers(null);
    expect(versusLand(reduce, { type: 'faceOmen', deferFight: true }, parked)).toBe(parked); // no session: untouched
    installVersusHandlers({ fightFor: (w) => (w === 1 ? fight.p1 : null), afterCommit: () => undefined });
    const landed = versusLand(reduce, { type: 'faceOmen', deferFight: true }, parked);
    expect(landed.pendingCombatSide).toBeUndefined();
    expect(landed.lastCombat?.result).toBe(fight.p1.result);
    expect(landed.phase).toBe('combat');
    installVersusHandlers(null);
  });
});

describe('Versus SQL round timer = the client schedule', () => {
  it('versus_turn_seconds(r) equals standardTurnSeconds(r) for rounds 1-80', async () => {
    const db = new PGlite();
    const sql = readFileSync(join(__dirname, '../../../../supabase/migrations/2026-10-13-versus.sql'), 'utf8');
    const fn = /create or replace function public\.versus_turn_seconds[\s\S]*?\$\$;/.exec(sql)![0];
    await db.exec(fn);
    const r = await db.query<{ r: number; s: number }>('select r, public.versus_turn_seconds(r) s from generate_series(1, 80) r');
    for (const row of r.rows) expect(row.s, `round ${row.r}`).toBe(standardTurnSeconds(row.r));
    await db.close();
  });
});
