import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { compileMoments, DEFAULT_RULES } from './compile';
import { groupBuffCasts } from './channels/buffCast';
import { groupSelfBuffs } from './channels/buffSelf';

/**
 * A SWING'S CONSEQUENCES BELONG TO ITS WIND-UP (owner ask 2026-09-01).
 *
 *   *"the flame beat winds up and attacks, and completes the lunge, no damage is dealt or taken, and all the
 *   animations trigger. once they finish, damage is dealt and stats reconcile. this is half correct, but we
 *   need all of the animations and stats to reconcile while the flamebeat is paused in his pre-attack
 *   animation, like echohorn does. we need this to be the case for all cases where buffs are applying or
 *   animations are firing from an attack."*
 *
 * Two halves make that true, and this file pins the one that can be executed here.
 *
 *  1. GROUPING (`compileMoments`): everything the swing caused must land in the attack's OWN moment. The
 *     absorb loop used to stop at a mid-combat `sc`, which orphaned a cast AND every buff behind it into
 *     post-lunge beats — that is the symptom above, and it is measurable on a real fight's event log.
 *  2. THE PARK (`useCombatReplay`): a wind-up moment wider than the `attack` event itself holds the lunge at
 *     the top of its pose until those consequences resolve. That lives in a React hook driving GSAP and
 *     cannot run here; what CAN be checked is that its signal is still derived from the moment's width, which
 *     is the link between the two halves.
 *
 * Grading on a SIMULATED fight rather than a hand-written log on purpose: the ordering this depends on
 * (attack → rally → cast → buffs → damage) is the simulator's, and a hand-written log would keep passing if
 * the sim ever emitted them in a different order.
 */

const bm = (cardId: string, uid: string, attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords } as unknown as BoardMinion);

/** Flamebeat Drake's Rally casts Dragonflame; it swings with `RL`, so its own attack is the Rally. */
const flamebeatFight = () => simulate(
  [bm('d2_flamebeat', 'F', 4, 400, ['RL']), bm('d2_ashscribe', 'D', 0, 400)],
  [{ cardId: 'sandbag', attack: 0, health: 9999 } as unknown as BoardMinion], makeRng(5), CARD_INDEX,
  combatSide({ tier: 6 }), combatSide({ tier: 1 }));

describe('an on-attack cast resolves inside the wind-up, not after the lunge', () => {
  it('the fixture actually casts (a fight that never cast would pass vacuously)', () => {
    const casts = flamebeatFight().events.filter((e) => e.type === 'sc' && e.spellId === 'sp_dragonflame');
    expect(casts.length, 'Flamebeat Drake never cast Dragonflame — re-check the fixture').toBeGreaterThan(0);
  });

  it('the cast and its buffs land in the attacker’s OWN moment', () => {
    const { events } = flamebeatFight();
    const moments = compileMoments(events, DEFAULT_RULES);
    const castIdx = events.findIndex((e) => e.type === 'sc' && e.spellId === 'sp_dragonflame');
    const owner = moments.find((m) => castIdx >= m.start && castIdx < m.end)!;
    expect(owner.primary.type, 'the cast is its own beat again — it fell out of the wind-up').toBe('attack');

    // …and so does EVERY buff that cast produced. This is the half that actually broke: the sim emits the
    // cast's counter, then its buffs, then its narration, and any one of those falling out of the absorb loop
    // strands the rest behind it. The buffs are identified by the spell that caused them, not by position, so
    // the assertion survives the sim reordering them.
    // The Drake swings more than once in this fight, so this is asserted as an INVARIANT over the whole log
    // rather than against one moment: no buff Dragonflame caused may live anywhere but inside an attack's
    // wind-up. Any one of them landing in its own beat is the bug.
    const caused = events
      .map((e, i) => [e, i] as const)
      .filter(([e]) => e.type === 'buff' && (e as { spellId?: string }).spellId === 'sp_dragonflame');
    expect(caused.length, 'the cast granted nothing to group').toBeGreaterThan(0);
    for (const [, i] of caused) {
      const home = moments.find((m) => i >= m.start && i < m.end)!;
      expect(home.primary.type, `a buff the swing caused landed in a ${home.primary.type} beat of its own`).toBe('attack');
    }
  });

  it('the damage still lands AFTER the wind-up — the swing is not collapsed into one beat', () => {
    // The fix must not go the other way: the attacker's own hit is the resume, so it has to stay a later beat.
    const { events } = flamebeatFight();
    const moments = compileMoments(events, DEFAULT_RULES);
    const attackMoment = moments.find((m) => m.primary.type === 'attack')!;
    for (let i = attackMoment.start; i < attackMoment.end; i++) {
      expect(events[i]!.type, 'damage was absorbed into the wind-up').not.toBe('dmg');
    }
  });
});

/**
 * THE AUDIT (owner ask 2026-09-01: *"make sure this logic and timing applies across the board for any buffs
 * that happen from attacks … traveling skald, fatecarver, boulderdash rubies, anything like that"*).
 *
 * Every on-attack stat change must be ABSORBED into the swing's moment (so it plays in the wind-up) and must
 * turn the wind-up PAUSE on (so the numbers land before the strike). The two are separate mechanisms and a
 * card can pass one and fail the other — Boulderdash did exactly that: its Ruby was absorbed, but the pause is
 * gated on the stock buff cues and those deliberately skip a Ruby, so it rolled its stats with no hold.
 *
 * Graded per CARD on a real fight, because "which events does this card actually emit" is the whole question.
 */
describe('every on-attack stat change is absorbed AND pauses the wind-up', () => {
  const STAT_CHANGE = new Set(['buff', 'tribeAura']);

  /** A one-sided fight where `board` swings freely into an unkillable sandbag. */
  const fightOf = (board: BoardMinion[]) => simulate(
    board, [{ cardId: 'sandbag', attack: 0, health: 99999 } as unknown as BoardMinion], makeRng(5), CARD_INDEX,
    combatSide({ tier: 6 }), combatSide({ tier: 1 }));

  const CASES: [string, () => BoardMinion[]][] = [
    // Rally → 3 permanent Rubies on itself. The `ruby` flag is why this one was missed.
    ['Boulderdash (on-attack Rubies)', () => [bm('k_boulderdash', 'B', 3, 400, ['RL'])]],
    // When another friendly Dragon attacks, buff IT — a buff-other on someone else's swing.
    ['Traveling Skald (on-ally-attack buff)', () => [bm('d2_skald', 'S', 0, 400), bm('d2_ashscribe', 'D', 4, 400)]],
    // Rally → casts Dragonflame, the case the whole thread started from.
    ['Flamebeat Drake (on-attack cast)', () => [bm('d2_flamebeat', 'F', 4, 400, ['RL']), bm('d2_ashscribe', 'D', 0, 400)]],
  ];

  it.each(CASES)('%s: its stat changes ride the attacker’s own moment', (_name, board) => {
    const { events } = fightOf(board());
    const moments = compileMoments(events, DEFAULT_RULES);
    const changes = events.map((e, i) => [e, i] as const).filter(([e]) => STAT_CHANGE.has(e.type));
    // Every fixture must actually produce one, or the case is grading nothing.
    expect(changes.length, 'this fixture produced no stat change at all').toBeGreaterThan(0);
    // A stat change caused BY a swing sits inside that swing's moment. The defender's own on-damaged buff is
    // a consequence of the DAMAGE, not the wind-up, so it legitimately lives in the damage moment — hence
    // "at least one rides an attack" rather than "all of them do".
    const inAttack = changes.filter(([, i]) => {
      const home = moments.find((m) => i >= m.start && i < m.end);
      return home?.primary.type === 'attack';
    });
    expect(inAttack.length, 'no stat change was absorbed into a wind-up').toBeGreaterThan(0);
  });

  it.each(CASES)('%s: the swing carrying it turns the wind-up pause on', (_name, board) => {
    const { events } = fightOf(board());
    const moments = compileMoments(events, DEFAULT_RULES);
    // Mirrors `windupStatChange` in `useCombatReplay`: the pause is on when the wind-up carries a stat change
    // of ANY kind — including a Ruby, which the stock buff cues skip.
    const carries = (m: { start: number; end: number }): boolean => {
      for (let i = m.start; i < m.end; i++) if (STAT_CHANGE.has(events[i]!.type)) return true;
      return false;
    };
    const attacksWithChanges = moments.filter((m) => m.primary.type === 'attack' && carries(m));
    expect(attacksWithChanges.length, 'no attack moment carries a stat change to pause for').toBeGreaterThan(0);
  });

  it('the hook gates its pause on the stat change, not on the stock cues', () => {
    // The compile-level checks above prove the EVENTS are in the right moment; this is the other half — that
    // the replay actually pauses for them. Read from source (comments stripped) because the hook cannot run
    // here. `windupStatChange` is the name of the rule; gating `onWindupBuffs` back on the two cue lists is
    // the regression, and it is what left Boulderdash with no hold.
    const replay = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../useCombatReplay.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(replay.includes('onWindupBuffs: windupStatChange'),
      'the pause must be gated on the stat change, not on the stock cue lists').toBe(true);
    expect(replay.includes("e?.type === 'buff' || e?.type === 'tribeAura'"),
      'a Ruby buff and a run-wide aura must both count as a stat change').toBe(true);
  });

  it('a Ruby-on-attack also gets its badge ROLLED during the pause', () => {
    // Pausing is only half of it. A Ruby's hold is placed by the `rubyFx` cue and released by whatever
    // delivers the number — and `ruby-gem-apply`'s `react` layer does not carry it, so nothing does and the
    // hold waits out `HOLD_TTL_MS` (1200ms), which lands just past the end of the pause. The wind-up path
    // rolls them by hand instead, on the same lead the authored buff defs use.
    const replay = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../useCombatReplay.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(replay.includes('windupRubyUids'), 'the swing must collect the units it Rubied').toBe(true);
    expect(/for \(const uid of windupRubyUids\) scheduleRoll\(uid, AUTHORED_BUFF_ROLL_MS\);/.test(replay),
      'their badges must be rolled on the wind-up clock, not left to the hold expiring').toBe(true);
  });

  it('and the gem def still has no `carries` layer — which is WHY the roll is driven by hand', () => {
    // The alternative fix was to tick `carries` on `ruby-gem-apply`'s `react` layer. That is the owner's
    // tuning surface, so the code does the work instead. If the def ever DOES start carrying the number, this
    // fails — and the hand-rolled release should come out rather than fight it.
    const def = JSON.parse(readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../fx/defs/ruby-gem-apply.json'), 'utf8')) as
      { layers: { primitive: string; params?: Record<string, unknown> }[] };
    const react = def.layers.find((l) => l.primitive === 'react');
    expect(react, 'the gem lost its react layer entirely').toBeTruthy();
    expect(react!.params?.carries, 'the gem now delivers its own number — drop the hand-rolled release').toBeFalsy();
  });

  it('a Ruby-on-attack counts, even though the stock buff cues skip it', () => {
    // The specific miss. `groupBuffCasts`/`groupSelfBuffs` drop `ruby` buffs on purpose (the gem tells it), so
    // a pause gated on their output alone leaves Boulderdash with none — which is what this asserts is fixed.
    const { events } = fightOf([bm('k_boulderdash', 'B', 3, 400, ['RL'])]);
    const rubies = events.filter((e) => e.type === 'buff' && (e as { ruby?: true }).ruby);
    expect(rubies.length, 'Boulderdash cast no Rubies — re-check the fixture').toBeGreaterThan(0);
    expect(groupBuffCasts(compileMoments(events, DEFAULT_RULES)[0]!, events).length
      + groupSelfBuffs(compileMoments(events, DEFAULT_RULES)[0]!, events).length,
    'if the stock cues ever stop skipping Rubies this test is measuring the wrong thing').toBe(0);
  });
});

describe('an absorbed swing lengthens its wind-up — it does NOT park', () => {
  /** The hook and the lunge timeline cannot run here; their decision lines can still be read. */
  const HERE2 = dirname(fileURLToPath(import.meta.url));
  /** COMMENTS STRIPPED. The comment above this very decision explains why the widened form was reverted, and
   *  quotes it — so an un-stripped read would find the rejected rule in the prose that rejects it (the
   *  `rallyGuard` trap, 2026-08-31, in its purest form). */
  const REPLAY = readFileSync(join(HERE2, '../useCombatReplay.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const ENGINE = readFileSync(join(HERE2, './engine.ts'), 'utf8');

  it('the park stays the FORCED-ECHO signal', () => {
    // Parking is beat-spanning: it advances the clock at the top of the wind-up and resumes the strike on a
    // LATER beat. A forced Echo needs that (its consequences are their own beats); an ABSORBED cast does not
    // (its consequences are inside this moment), and parking it let the damage beat start while the strike was
    // still held — *"the damage is being dealt from the attack slightly too early, before the unit actually
    // lunges into the attack"* (owner, 2026-09-01). Widening this back to the moment's width is the regression.
    expect(REPLAY.includes('let heldWindup = false;'),
      'the park must be the forced-Echo signal, not "did this swing absorb anything"').toBe(true);
    expect(/cur\.end > cur\.start \+ 1/.test(REPLAY),
      'the moment-width park is what dealt damage before the lunge').toBe(false);
  });

  it('the absorbed case is paid for in the WIND-UP PAUSE instead', () => {
    // Which is where it belongs: fire the consequences, hold the pose, then strike. Everything after the pause
    // — the lunge, its speed, contact, the damage riding it — keeps the timing it always had.
    const line = ENGINE.slice(ENGINE.indexOf('rallyPauseMs:'), ENGINE.indexOf('rallyPauseMs:') + 220);
    expect(line.includes('cfg.buffLeadMs'), 'the buff lead must still extend the pause').toBe(true);
    expect(line.includes('cfg.windupSettleMs'), 'the settle beat must extend it too').toBe(true);
  });

  it('a float’s removal outlives the beat that spawned it', () => {
    // *"dmg values being left behind from fel spike's trigger"* — owner, 2026-09-01.
    //
    // A float lives ~1.5s and is removed by its own timer. Those timers sat in the beat effect's `timers`
    // array, whose cleanup clears everything on each beat change — so any float still on screen when the beat
    // advanced lost its removal and stayed forever. Latent all along; splitting a swing's results into their
    // own beats made the beats short enough to lose the race routinely.
    //
    // Same rule `scheduleRoll` and `echoVolleyTimersRef` already follow: a timer whose job outlives the beat
    // that scheduled it does not belong to that beat.
    expect(REPLAY.includes('floatTimersRef.current.push(window.setTimeout'),
      'float removal must be scheduled on the combat-lifetime registry').toBe(true);
    const spawn = REPLAY.slice(REPLAY.indexOf('onFloats: (spawned)'), REPLAY.indexOf('onAuraBurst:'));
    expect(/timers\.push\(window\.setTimeout/.test(spawn),
      'a float removal on the per-beat timers is cancelled the moment the beat advances').toBe(false);
  });

  it('a parked attacker waits a beat before committing its swing', () => {
    // *"we need a slight delay after the final resolution before the echohorn actually commits its attack"* —
    // owner, 2026-09-01. Its Echo has just finished (a spray, a charger's whole exchange) and the swing it has
    // been holding should read as a deliberate act, not the tail of that.
    //
    // ADDITIVE, through the same `lead` path every other consequence hold uses. An earlier attempt REPLACED
    // the hold and fired the release from the clock while the park was also driving the advance — two owners
    // of one clock, which desynced the frame. This only lengthens a beat: no callbacks move, nothing else
    // changes about who advances.
    expect(REPLAY.includes('parkedCommitLead(next, events),'),
      'the parked attacker’s damage beat must take the commit lead').toBe(true);
    expect(REPLAY.includes('if (lead) d += lead / combatSpeedRef.current;'),
      'and it must be ADDED to the hold, never replace it').toBe(true);
  });

  it('and both dials are OFF for a swing with no buffs', () => {
    // `ctx.onWindupBuffs` is only supplied when the moment actually carries buffs, so an ordinary swing pays
    // neither — the whole point of keeping them as dials rather than folding them into the base pause.
    const line = ENGINE.slice(ENGINE.indexOf('rallyPauseMs:'), ENGINE.indexOf('rallyPauseMs:') + 220);
    expect(/ctx\.onWindupBuffs \? cfg\.buffLeadMs \+ cfg\.windupSettleMs : 0/.test(line)).toBe(true);
  });
});
