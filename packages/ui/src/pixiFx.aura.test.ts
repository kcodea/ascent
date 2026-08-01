import { describe, expect, it } from 'vitest';
import { pixiFx } from './pixiFx';

// pixiFx's WebGL app never initializes in the node test env (`this.ready` stays false). The aura channel calls
// these unconditionally on every death/break, so they must SAFELY no-op rather than throw when there is no
// renderer — that "no-op before ready" contract is what this file pins.
//
// The registry queries that used to live here (hasAura / auraRect) went with the persistent Pixi bubbles: the
// Ward/Reborn auras are CSS dome stacks now, so Pixi owns only the one-shot break/summon bursts.
describe('pixiFx aura bursts', () => {
  it('shatterAt is a safe no-op before the WebGL app is ready (headless test env)', () => {
    expect(() => pixiFx.shatterAt(100, 100, 80, 100, 'shield')).not.toThrow();
  });
  it('shatterAt routes the reborn kind without throwing', () => {
    expect(() => pixiFx.shatterAt(100, 100, 80, 100, 'reborn')).not.toThrow();
  });
  it('rebornSummon is a safe no-op before the WebGL app is ready', () => {
    expect(() => pixiFx.rebornSummon(100, 100, 80, 100)).not.toThrow();
  });
});
