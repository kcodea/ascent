import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';

/**
 * HAWKUS TRIGGERED SILENTLY (owner report 2026-08-19).
 *
 * Hawkus reacts to ANY friendly Rally — so unlike Echohorn Stag (which procs off its OWN attack) its `rally`
 * event is emitted while a DIFFERENT minion is the attacker, and the moment compiler absorbs it into that
 * attacker's wind-up. The presentation side then drops it: `rallyFx` (choreo/score.ts) resolves a binding per
 * rallier CARD and skips unbound ralliers, and `b2_hawkus` had no row in `bindings.json` — so the proc played
 * no cue at all.
 *
 * The fix (owner call 2026-08-19, after trying an authored gust and not liking it) is the WATCHER PULSE the
 * other reaction cards already use — `rally` now counts as "acting" in `choreo/channels/watcherPulse.ts`, so
 * Hawkus lights up light-blue on the beat it answers, with no bespoke FX at all.
 *
 * What THIS pins is the half that pulse depends on: the simulator really does emit a `rally` event sourced at
 * HAWKUS (the uid the pulse scan reads) when an ally rallies — with no Dawnclaw or other re-trigger card
 * present, which is the exact case the owner saw fail.
 */
const bm = (cardId: string, uid: string, attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: keywords as BoardMinion['keywords'] });

const fight = (board: BoardMinion[]) => simulate(
  board, [bm('sandbag', 'W', 0, 40000)],
  makeRng(4), CARD_INDEX,
  combatSide({ tier: 6, tribes: ['beast', 'demon'] }), combatSide({ tier: 1 }),
);

/** The `rally` cues a given source uid produced — one per Echo proc, the event `rallyFx` keys off. */
const ralliesFrom = (r: ReturnType<typeof simulate>, uid: string) =>
  r.events.filter((e) => e.type === 'rally' && (e as { source: string }).source === uid);

describe('Hawkus emits its own rally cue off an ALLY’s Rally', () => {
  // left-most is an Echo body (Hawkus's proc target), then Hawkus, then the ally that actually rallies.
  const board = () => [
    bm('spore', 'ECHO', 0, 400),          // a plain Echo for Hawkus to trigger
    bm('b2_hawkus', 'HAWK', 0, 400),
    bm('b2_echohorn', 'ALLY', 6, 400, ['RL']), // the rallying attacker (NOT Hawkus, and no Dawnclaw anywhere)
  ];

  // Combat renumbers by board position: m0 = the Echo, m1 = Hawkus, m2 = the rallying ally.
  const HAWK = 'm1', ECHO = 'm0';

  it('produces rally events sourced at HAWKUS — the uid the FX binding resolves by', () => {
    expect(ralliesFrom(fight(board()), HAWK).length, 'Hawkus never emitted a rally cue').toBeGreaterThan(0);
  });

  it('aims each cue at the left-most Echo, so the FX has a real source→target pair', () => {
    const cues = ralliesFrom(fight(board()), HAWK) as unknown as { target: string }[];
    expect(cues.length).toBeGreaterThan(0);
    expect(cues.every((c) => c.target === ECHO), 'every proc should point at the left-most Echo').toBe(true);
  });

  it('stays silent when no ALLY has Rally — the trigger is a reaction, not a passive', () => {
    // Hawkus itself swings here, but it has no Rally keyword of its own, so nothing should proc.
    const r = fight([bm('spore', 'ECHO', 0, 400), bm('b2_hawkus', 'HAWK', 6, 400), bm('sandbag', 'X', 4, 400)]);
    expect(ralliesFrom(r, HAWK).length).toBe(0);
  });
});
