import { describe, it, expect } from 'vitest';
import { createRun, reduce, type RunState } from './index';

/**
 * Better Bot's Rally (`rallyMechAtk`: +N Attack to your other Mechs when the host attacks in combat) welds onto
 * a host and STACKS. The direct path is covered in run.test.ts ("Better Bot magnetizes its Rally … and it
 * stacks"). These pin the CARRIER path Mike hit (owner report 2026-07-22): a magnetic that has itself absorbed a
 * Better Bot, then re-welded onto another host, must pass the accrued rally along — it was being silently
 * dropped because the hand-play weld read the rally off the card DEF only, ignoring the instance's accrued value.
 */
describe('Better Bot rally transfers through a carrier magnetic', () => {
  it("a magnetic carrying an accrued Better Bot rally passes it to the host it's welded onto", () => {
    // A Speedy (its own def has NO rallyMechAtk) that already absorbed a Better Bot → instance rallyMechAtk 5.
    // Play it onto Banksly: Banksly must inherit the 5, not lose it.
    let s: RunState = {
      ...createRun(1),
      hand: [{ uid: 'sp', cardId: 'speedy', tribe: 'mech', attack: 4, health: 4, keywords: ['W', 'M'], golden: false, rallyMechAtk: 5 }] as RunState['hand'],
      board: [{ uid: 'bk', cardId: 'banksly', tribe: 'mech', attack: 5, health: 5, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp', toIndex: 0 });
    expect(s.board.length).toBe(1); // welded onto Banksly, not a new slot
    expect(s.board[0]!.rallyMechAtk).toBe(5); // the accrued Better Bot rally rode along
  });

  it('stacks the accrued rally on top of the host’s existing one', () => {
    // Host already carries a rally 5; weld a carrier Speedy (accrued 5) → 10.
    let s: RunState = {
      ...createRun(1),
      hand: [{ uid: 'sp', cardId: 'speedy', tribe: 'mech', attack: 4, health: 4, keywords: ['W', 'M'], golden: false, rallyMechAtk: 5 }] as RunState['hand'],
      board: [{ uid: 'bk', cardId: 'banksly', tribe: 'mech', attack: 5, health: 5, keywords: [], golden: false, rallyMechAtk: 5 }],
    };
    s = reduce(s, { type: 'play', uid: 'sp', toIndex: 0 });
    expect(s.board[0]!.rallyMechAtk).toBe(10);
  });

  it('a freshly-bought Better Bot still welds exactly its base +5 (no double-count from the new instance term)', () => {
    // Regression guard for the fix: a normal hand Better Bot has NO instance rallyMechAtk (its base is on the
    // def), so def×golden + instance must still be exactly 5 — not 10.
    let s: RunState = {
      ...createRun(1),
      hand: [{ uid: 'bb', cardId: 'betterbot', tribe: 'mech', attack: 5, health: 5, keywords: ['M', 'RL'], golden: false }] as RunState['hand'],
      board: [{ uid: 'd', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'bb', toIndex: 0 });
    expect(s.board[0]!.rallyMechAtk).toBe(5);
  });

  it('golden carrier: def base doubles, accrued stays single (like every other welded aura)', () => {
    // A golden Better Bot from hand: def 5 × 2 = 10, no instance term. Confirms the golden multiplier still only
    // hits the def base, never the accrued instance value.
    let s: RunState = {
      ...createRun(1),
      hand: [{ uid: 'bb', cardId: 'betterbot', tribe: 'mech', attack: 10, health: 10, keywords: ['M', 'RL'], golden: true }] as RunState['hand'],
      board: [{ uid: 'd', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'bb', toIndex: 0 });
    expect(s.board[0]!.rallyMechAtk).toBe(10);
  });
});
