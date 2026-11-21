/**
 * R-FX-ANCIENT-TENDRIL-02 (owner 2026-11-21): "create bespoke tendril effects for each of the 6 ancients when they trigger
 * a combat or shop effect". Each Ancient's grant plays its own `ancient-tendril-<id>` def once one is saved, wherever the
 * grant starts (the hero-power button, or the minion that set it off), and the generic gold trail until then.
 *
 * Pins the three seams: the resolver (`fx/ancientTendrils.ts`), the renderer (`fireBuffFx`'s `ancient`), and the sim tag
 * (`BuffFxEvent.ancient` on the Shop's hero-power AND `trigger`-origin records; the combat label for both origins).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./fx/playDef', () => ({ playDef: vi.fn(() => null) }));
import { playDef } from './fx/playDef';
// The primitives register the way `ensureDefsReady()` does in the game; without them every def reads as layerless.
import './fx/primitives';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import { ANCIENTS, ANCIENT_IDS, reduce } from '@game/sim';
import { ancientBurstIndex, fireBuffFx, TENDRIL_TRAIL_TRAVEL_MS } from './buffFxRender';
import { registerSavedDef } from './fx/fxDefs';
import type { StoredFxDef } from './fx/defStore';
import {
  ANCIENT_TENDRIL_DEF_IDS, ancientOfLabel, ancientTendrilDef, ancientTendrilDefId, ancientTendrilLandingMs,
} from './fx/ancientTendrils';
import { body, combatVerdict, foes, pickedRun, shopRun } from './ancientTendrils.testkit';
import { groupBuffCasts } from './choreo/channels/buffCast';
import type { Moment } from './choreo/compile';

const mockPlayDef = playDef as unknown as ReturnType<typeof vi.fn>;

/** A minimal saved def: one ribbon that flies for `travelMs`. */
const ribbonDef = (id: string, travelMs: number): StoredFxDef => ({
  version: 1, id, duration: 900,
  layers: [{ primitive: 'ribbon', anchor: 'travel', at: 0, travelMs, params: {} }],
} as unknown as StoredFxDef);

describe('R-FX-ANCIENT-TENDRIL-02: the resolver', () => {
  it('names one def per Ancient', () => {
    expect(ANCIENT_TENDRIL_DEF_IDS).toEqual([
      'ancient-tendril-death', 'ancient-tendril-fortune', 'ancient-tendril-war',
      'ancient-tendril-genesis', 'ancient-tendril-time', 'ancient-tendril-bonds',
    ]);
  });
  it('maps every Ancient name, and the three power-name combat labels, to its Ancient', () => {
    for (const id of ANCIENT_IDS) expect(ancientOfLabel(ANCIENTS[id].name)).toBe(id);
    expect(ancientOfLabel('Rounded Spellbook')).toBe('bonds');
    expect(ancientOfLabel('Pocket Magic')).toBe('bonds');
    // "Aegis" is Warden × Bonds AND Warden × Time: only the side's pick settles it.
    expect(ancientOfLabel('Aegis')).toBeUndefined();
    expect(ancientOfLabel('Aegis', 'time')).toBe('time');
    expect(ancientOfLabel('Aegis', 'bonds')).toBe('bonds');
    // An Ancient's own name never defers to the side's pick, and a non-Ancient label never takes it.
    expect(ancientOfLabel(ANCIENTS.war.name, 'bonds')).toBe('war');
    expect(ancientOfLabel('United Front', 'bonds')).toBeUndefined();
    expect(ancientOfLabel('Blade Mastery')).toBeUndefined();
    expect(ancientOfLabel(undefined)).toBeUndefined();
  });
  it('lands the roll on the ribbon, else the first target layer, else the fallback', () => {
    expect(ancientTendrilLandingMs(ribbonDef('x', 333), 1)).toBe(333);
    const burst = { version: 1, id: 'y', duration: 500, layers: [{ primitive: 'burst', anchor: 'target', at: 140, params: {} }] } as unknown as StoredFxDef;
    expect(ancientTendrilLandingMs(burst, 1)).toBe(140);
    const none = { version: 1, id: 'z', duration: 500, layers: [{ primitive: 'burst', anchor: 'source', at: 0, params: {} }] } as unknown as StoredFxDef;
    expect(ancientTendrilLandingMs(none, 77)).toBe(77);
  });
});

describe('R-FX-ANCIENT-TENDRIL-02: fireBuffFx', () => {
  beforeEach(() => mockPlayDef.mockClear());
  const at = { source: { x: 0, y: 0 }, target: { x: 5, y: 5 } };

  it('every saved Ancient tendril resolves, with a positive landing time', () => {
    for (const id of ANCIENT_IDS) {
      const def = ancientTendrilDef(id);
      if (def) expect(ancientTendrilLandingMs(def, -1), def.id).toBeGreaterThan(0);
    }
  });
  it('an Ancient with no saved def keeps the stock trail (generic, or the minion tribe)', () => {
    // Whichever Ancient is still unauthored; once all six ship, the fallback is pinned by a made-up unsaved def id.
    const unsaved = ANCIENT_IDS.find((id) => !ancientTendrilDef(id));
    if (!unsaved) return;
    const ms = fireBuffFx({ ...at, cardId: '', tribe: 'neutral', sourceless: false, ancient: unsaved });
    expect(mockPlayDef).toHaveBeenCalledWith('rune-buff-trail', expect.anything(), expect.anything());
    expect(ms).toBe(TENDRIL_TRAIL_TRAVEL_MS);
    fireBuffFx({ ...at, cardId: 'x', tribe: 'beast', sourceless: false, ancient: unsaved });
    expect(mockPlayDef).toHaveBeenLastCalledWith('tendril-trail-beast', expect.anything(), expect.anything());
  });
  it('a saved def plays in place of the stock trail, from a tribe minion too, and times the roll', () => {
    registerSavedDef(ribbonDef(ancientTendrilDefId('war'), 444));
    const ms = fireBuffFx({ ...at, cardId: 'x', tribe: 'beast', sourceless: false, ancient: 'war', uids: { source: 's', target: 't' } });
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    expect(mockPlayDef).toHaveBeenCalledWith('ancient-tendril-war', at, expect.objectContaining({ uids: { source: 's', target: 't' } }));
    expect(ms).toBe(444);
  });
  it('STAGGER: one burst numbers its tendrils per Ancient, and each roll waits for its own staggered landing', () => {
    const staggered = {
      version: 1, id: ancientTendrilDefId('bonds'), duration: 900,
      layers: [{ primitive: 'burst', anchor: 'target', at: 140, stagger: 100, params: {} }],
    } as unknown as StoredFxDef;
    registerSavedDef(staggered);
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000_000);
    try {
      // A board-wide grant: three tendrils in one frame are recipients 0, 1, 2.
      const ms = [0, 1, 2].map(() => fireBuffFx({ ...at, cardId: '', tribe: 'neutral', sourceless: false, ancient: 'bonds' }));
      expect(ms).toEqual([140, 240, 340]);
      expect(mockPlayDef.mock.calls.map((c) => (c[2] as { index?: number }).index)).toEqual([undefined, 1, 2]);
      // A later grant is a new burst: recipient 0 again.
      now.mockReturnValue(1_005_000);
      expect(fireBuffFx({ ...at, cardId: '', tribe: 'neutral', sourceless: false, ancient: 'bonds' })).toBe(140);
    } finally {
      now.mockRestore();
    }
  });
  it('STAGGER: the burst window is per Ancient, and an unstaggered landing layer never moves', () => {
    expect([ancientBurstIndex('time', 50), ancientBurstIndex('time', 50), ancientBurstIndex('death', 50)]).toEqual([0, 1, 0]);
    expect(ancientBurstIndex('time', 160)).toBe(2); // chained: within the window of the LAST tendril
    expect(ancientBurstIndex('time', 900)).toBe(0);
    expect(ancientTendrilLandingMs(ribbonDef('x', 333), 1, 3)).toBe(333);
    const ribbon = { ...ribbonDef('r', 300), layers: [{ primitive: 'ribbon', anchor: 'travel', at: 0, travelMs: 300, stagger: 50, params: {} }] } as unknown as StoredFxDef;
    expect(ancientTendrilLandingMs(ribbon, 1, 2)).toBe(400);
  });
  it('a sourceless grant still draws nothing', () => {
    registerSavedDef(ribbonDef(ancientTendrilDefId('time'), 200));
    fireBuffFx({ target: at.target, cardId: '', tribe: 'neutral', sourceless: true, ancient: 'time' });
    expect(mockPlayDef).not.toHaveBeenCalled();
  });
});

describe('R-FX-ANCIENT-TENDRIL-02: the Shop tags each Ancient grant with its Ancient', () => {
  it('hero-power origin (Albus x Bonds): every hero-power record names Bonds', () => {
    const { s } = shopRun(pickedRun('albus', 'bonds', {
      board: [body('a', 'hm_test_squire'), body('b', 'n2_spellsword'), body('c', 'tara'), body('d', 'dw_brakka')], hand: [body('h', 'c3_binary')],
    }), [{ type: 'play', uid: 'h' }]);
    const hero = s.recruitBuffFx.filter((r) => r.fromHeroPower);
    expect(hero.length).toBeGreaterThan(0);
    expect(hero.every((r) => r.ancient === 'bonds')).toBe(true);
  });
  it('trigger origin (Frank x Bonds): the minion-sourced record still names Bonds', () => {
    let s = pickedRun('frank', 'bonds', { board: [body('x', 'hm_test_squire', { attack: 1, health: 1 })] });
    s = reduce(s, { type: 'heroPower' });
    const o = s.shop.find((x) => { const d = CARD_INDEX[x.cardId]; return !!d && !d.spell && !d.ruby && !x.starform; })!;
    s = reduce(s, { type: 'buy', uid: o.uid });
    const sold = s.hand[s.hand.length - 1]!.uid;
    s = reduce(s, { type: 'play', uid: sold });
    s = reduce(s, { type: 'sell', uid: sold });
    expect(s.recruitBuffFx).toEqual([expect.objectContaining({ sourceUid: sold, targetUid: 'x', ancient: 'bonds' })]);
  });
});

describe('R-FX-ANCIENT-TENDRIL-02: combat names the Ancient for both origins', () => {
  const whole = (events: CombatEvent[]): Moment => ({ start: 0, end: events.length } as Moment);
  it('trigger origin (Warden x Bonds): the minion-sourced cast keeps the label, which the pick resolves to Bonds', () => {
    const { s } = combatVerdict(pickedRun('warden', 'bonds', {
      board: [body('t', 'taragosa', { health: 900, keywords: ['DS'] }), body('a', 'hm_test_squire', { attack: 1, health: 900, keywords: ['DS'] }), body('b', 'hm_test_squire', { attack: 1, health: 900, keywords: ['DS'] })],
    }), foes(1, 0, 400));
    const ev = s.lastCombat!.events as CombatEvent[];
    const labelled = groupBuffCasts(whole(ev), ev).filter((c) => c.label !== undefined);
    expect(labelled.length).toBeGreaterThan(0);
    for (const c of labelled) expect(ancientOfLabel(c.label, 'bonds')).toBe('bonds');
  });
});
