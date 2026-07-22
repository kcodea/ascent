import { describe, it, expect } from 'vitest';
import { createRun, reduce, type RunState } from './index';

/**
 * End Turn must ALWAYS work — a pending targeted Battlecry can never trap the player.
 *
 * The softlock (owner report 2026-07-22, "turn ended before I could use the shout target and now I cant do
 * anything, end turn doesnt work either"): the round timer pauses for the Discover / quest / Runeforge
 * overlays, but NOT for a battlecry aim (`pendingTarget`). So the timer expires mid-aim, the UI then blocks
 * the target pick (`timeUp`), and the reducer's modal gate ALSO rejected `faceOmen` — nothing left to do, and
 * `pendingTarget` is saved so a reload lands right back in it.
 *
 * `faceOmen` already has the right behaviour — it auto-resolves a pending target onto the highest-Attack legal
 * carry ("never strand a played card"). The only bug was the gate rejecting it before it could run. These pin
 * that End Turn escapes the state.
 */
function stuckWithPendingTarget(): RunState {
  // A run with a targeted Battlecry minion (Twilight Emissary → a friendly Dragon) mid-aim on the board.
  const s: RunState = { ...createRun(1, 'warden'), phase: 'recruit' };
  s.board = [
    { uid: 't', cardId: 'emissary', tribe: 'dragon', attack: 2, health: 3, keywords: ['T'] },
    { uid: 'd', cardId: 'emissary', tribe: 'dragon', attack: 2, health: 3, keywords: ['T'] },
  ] as RunState['board'];
  s.pendingTarget = { uid: 't', cardId: 'emissary' };
  return s;
}

describe('End Turn is never blocked by a pending targeted Battlecry', () => {
  it('faceOmen resolves the pending target and starts combat, instead of being rejected', () => {
    const s = stuckWithPendingTarget();
    const after = reduce(s, { type: 'faceOmen' });
    expect(after).not.toBe(s); // NOT rejected by the modal gate
    expect(after.pendingTarget).toBeUndefined(); // the aim was auto-resolved, not stranded
    expect(after.phase).toBe('combat'); // the turn actually ended
  });

  it("auto-resolves onto a legal carry — the played card's Battlecry still fires", () => {
    const s = stuckWithPendingTarget();
    const after = reduce(s, { type: 'faceOmen' });
    // Twilight Emissary gives a friendly Dragon +2/+2; the other Dragon 'd' is the only legal carry.
    const carry = after.board.find((c) => c.uid === 'd');
    expect(carry?.attack).toBe(4);
    expect(carry?.health).toBe(5);
  });

  it('still works when the pending target has NO legal carry (plays as a plain body)', () => {
    // Only the source Dragon on board → no other Dragon to buff. faceOmen must still end the turn, not hang.
    const s: RunState = { ...createRun(1, 'warden'), phase: 'recruit' };
    s.board = [{ uid: 't', cardId: 'emissary', tribe: 'dragon', attack: 2, health: 3, keywords: ['T'] }] as RunState['board'];
    s.pendingTarget = { uid: 't', cardId: 'emissary' };
    const after = reduce(s, { type: 'faceOmen' });
    expect(after.pendingTarget).toBeUndefined();
    expect(after.phase).toBe('combat');
  });
});
