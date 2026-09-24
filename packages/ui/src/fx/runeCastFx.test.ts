// @vitest-environment jsdom
/**
 * SPELLS CAST BY RUNES PLAY THEIR OWN EFFECTS (owner ruling 2026-09-24, verbatim): *"spells cast from runes and
 * cards should use the spell effects, like gilded ledger should show the animations we build for the spells when it
 * is cast. they can stem from the rune if there needs to be a source position."*
 *
 * And ONE SOUND PER BURST (owner 2026-09-24): *"make it so if 2 fatecarvers are down, or the effect is cast twice or
 * something, that it only plays the sound effect one time. give it the same behavior as the undead aura sfx timing."*
 *
 * Presentation half. The sim's tags are pinned in packages/sim/src/runeCastFx.test.ts, the combat announcement in
 * packages/core/src/combat/runeCastSc.test.ts. `playDef` is mocked at the contract; the rune rail is a real DOM node.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playDef } from './playDef';
import {
  playCombatSpellCastFx, playRecordedCastFx, playRuneCastBuffFx, playSpellCastFx, resetSpellCastSoundGate,
  runeNodeCentre, spellCastSoundAllowed,
} from './spellCastFx';
import { castFxReplacesTendril, spellCastFanOutFor } from '../choreo/bindings';
import { presentConsequence } from '../choreographer/consequencePresenters';
import { runRecruitMomentCues } from '../choreo/recruitCues';
import { spellCastMoment } from '../choreo/recruitMoments';
import { spellCastsIn } from '../choreo/channels/castPreview';
import { coalesceBuffFxByTarget, getBuffFxConfig, resetBuffFxConfig, setBuffFxValue } from '../buffFxConfig';
import type { CombatEvent } from '@game/core';

vi.mock('./playDef', () => ({ playDef: vi.fn(() => () => {}), canPlayDefs: vi.fn(() => true) }));
vi.mock('./combatAnchors', () => ({ anchorsForUnits: vi.fn(() => ({ source: { x: 500, y: 500 }, target: { x: 500, y: 500 } })) }));
const mockPlayDef = vi.mocked(playDef);
const plays = (def: string) => mockPlayDef.mock.calls.filter((c) => c[0] === def);
const optsOf = (call: unknown[]) => call[2] as { muteSound?: boolean };
const anchorsOf = (call: unknown[]) => call[1] as { source: { x: number; y: number }; target: { x: number; y: number } };

const NODE = { x: 40 + 20, y: 10 + 20 }; // the rail node's centre (below: a 40x40 box at 40,10)
function mountRune(id: string): HTMLElement {
  const rail = document.createElement('div');
  rail.className = 'questbadges';
  const node = document.createElement('div');
  node.className = 'runebadge';
  node.dataset.sourceId = id;
  node.getBoundingClientRect = () => ({ left: 40, top: 10, width: 40, height: 40, right: 80, bottom: 50, x: 40, y: 10, toJSON: () => ({}) });
  rail.appendChild(node);
  document.body.appendChild(rail);
  return rail;
}

let clock = 1000;
beforeEach(() => {
  mockPlayDef.mockClear();
  resetSpellCastSoundGate();
  resetBuffFxConfig();
  document.body.innerHTML = '';
  clock += 10_000; // every test starts far past any previous sound
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('a rune cast plays the spell\'s own effect, stemming from the rune\'s node', () => {
  it('SHOP: Rune of the Gilded Ledger\'s Growth record plays growth-effect with its source on the rune node', () => {
    mountRune('rune_gilded_ledger');
    expect(runeNodeCentre('rune_gilded_ledger')).toEqual(NODE);
    expect(playRecordedCastFx([{ source: { kind: 'rune', id: 'rune_gilded_ledger' }, spellId: 'growth', phase: 'recruit' }], 'recruit')).toBe(1);
    expect(plays('growth-effect')).toHaveLength(1);
    expect(anchorsOf(plays('growth-effect')[0]!).source).toEqual(NODE);
  });

  it('a rune whose node is not on screen still plays the effect (on the camera, as before)', () => {
    expect(playRecordedCastFx([{ source: { kind: 'rune', id: 'rune_gone' }, spellId: 'growth', phase: 'recruit' }], 'recruit')).toBe(1);
    expect(anchorsOf(plays('growth-effect')[0]!).source).toEqual({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  });

  it('SHOP / END OF TURN: a Growth buff a rune cast is claimed by the effect (no tendril), exactly like a card\'s', () => {
    expect(castFxReplacesTendril('growth')).toBe(true);
    const recruit = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../Recruit.tsx'), 'utf8');
    const replay = recruit.slice(recruit.indexOf('const replayBuffFxEvents = useCallback('));
    // The claim is asked BEFORE the rune trail, and both before the stock tendril.
    expect(replay.indexOf('castFxReplacesTendril(ev.spellId)')).toBeLessThan(replay.indexOf('playRuneCastBuffFx('));
    expect(replay.indexOf('playRuneCastBuffFx(')).toBeLessThan(replay.indexOf('fireBuffFx('));
    // The End-of-Turn authoritative `spellResolved` plays it from the rune too.
    expect(recruit).toContain("playSpellCastFx(cardId, { runeId: source.kind === 'rune' ? source.id : null })");
  });

  it('an UNBOUND spell a rune cast keeps a trail, now from the rune node (it drew nothing before)', () => {
    mountRune('rune_gilded_ledger');
    const target = { x: 300, y: 400 };
    expect(castFxReplacesTendril('spiritfire')).toBe(false);
    expect(playRuneCastBuffFx({ runeId: 'rune_gilded_ledger', spellId: 'spiritfire', target, targetUid: 'a' })).toBe(true);
    const trail = mockPlayDef.mock.calls.filter((c) => String(c[0]).startsWith('tendril-trail'));
    expect(trail).toHaveLength(1);
    expect(anchorsOf(trail[0]!)).toMatchObject({ source: NODE, target });
  });

  it('with no rune node on screen, an unbound rune cast draws nothing (the old sourceless path)', () => {
    expect(playRuneCastBuffFx({ runeId: 'rune_gone', spellId: 'spiritfire', target: { x: 1, y: 1 }, targetUid: 'a' })).toBe(false);
    expect(mockPlayDef).not.toHaveBeenCalled();
  });

  it('a per-buff spell a rune cast plays its own row: an Ale travels node to minion, Dragonflame plays on the minion', () => {
    mountRune('rune_recurrence');
    const target = { x: 300, y: 400 };
    expect(spellCastFanOutFor('wo_attack')?.def).toBe('bloody-ale');
    playRuneCastBuffFx({ runeId: 'rune_recurrence', spellId: 'wo_attack', target, targetUid: 'a' });
    expect(anchorsOf(plays('bloody-ale')[0]!)).toMatchObject({ source: NODE, target });
    playRuneCastBuffFx({ runeId: 'rune_recurrence', spellId: 'sp_dragonflame', target, targetUid: 'a' });
    expect(anchorsOf(plays('dragonflame')[0]!)).toMatchObject({ source: target, target });
  });

  it('END OF TURN (authoritative): a rune-cast gain of a bound spell draws nothing; an unbound one stems from the rune', () => {
    const runeCastGain = vi.fn();
    const questTendril = vi.fn();
    const statGain = vi.fn();
    const ctx = { statGain, questTendril, runeCastGain, spellHasCastFx: castFxReplacesTendril, selfBuff: vi.fn(), heroPowerGain: vi.fn() };
    const beat = { source: { kind: 'spell', id: 'x', label: 'x' } };
    const gain = (spellId: string) => ({ type: 'statsChanged', target: { zone: 'board', uid: 'a', cardId: 'stray', side: 'player' },
      attack: 1, health: 1, permanent: true, channel: 'ordinary', spellId, castByRune: 'rune_recurrence' });
    presentConsequence({ consequence: gain('growth'), beat, ctx, index: 0 } as never);
    expect(runeCastGain).not.toHaveBeenCalled();
    presentConsequence({ consequence: gain('spiritfire'), beat, ctx, index: 1 } as never);
    expect(runeCastGain).toHaveBeenCalledWith('rune_recurrence', 'spiritfire', 'a', 1);
    expect(statGain).not.toHaveBeenCalled();
    expect(questTendril).not.toHaveBeenCalled();
  });

  it('COMBAT: a PLAYER rune\'s cast (Rune of Spellhide) stems from the rune node; an ENEMY one stays on its body', () => {
    mountRune('rune_spellhide');
    const casts = spellCastsIn({ start: 0, end: 2 }, [
      { type: 'sc', source: 'm0', text: 'Rune of Spellhide casts Growth', spellId: 'growth', rune: 'rune_spellhide', side: 'player' },
      { type: 'sc', source: 'm9', text: 'Rune of Spellhide casts Growth', spellId: 'growth', rune: 'rune_spellhide', side: 'enemy' },
    ] as CombatEvent[]);
    expect(casts.map((c) => [c.rune, c.side])).toEqual([['rune_spellhide', 'player'], ['rune_spellhide', 'enemy']]);
    expect(playCombatSpellCastFx(casts)).toBe(2);
    const [mine, theirs] = plays('growth-effect');
    expect(anchorsOf(mine!)).toMatchObject({ source: NODE, target: { x: 500, y: 500 } });
    expect(anchorsOf(theirs!).source).toEqual({ x: 500, y: 500 });
  });

  it('a rune-cast buff out-ranks a sourceless one on the same target when the tendrils are coalesced', () => {
    const out = coalesceBuffFxByTarget([{ targetUid: 'a' }, { targetUid: 'a', sourceRuneId: 'rune_might' }]);
    expect(out).toEqual([{ targetUid: 'a', sourceRuneId: 'rune_might' }]);
  });
});

describe('one sound per burst of the same spell effect (the Undead Aura rule)', () => {
  it('the knob sits beside the aura one, default 120 ms', () => {
    expect(getBuffFxConfig().spellCastSfxGapMs).toBe(120);
    expect(getBuffFxConfig().spellCastSfxGapMs).toBe(getBuffFxConfig().undeadAuraSfxGapMs);
  });

  it('two Growth casts in one frame (two Fatecarvers on one attack): two effects, ONE sound', () => {
    const casts = spellCastsIn({ start: 0, end: 2 }, [
      { type: 'sc', source: 'FC1', text: 'Fatecarver casts Growth', spellId: 'growth' },
      { type: 'sc', source: 'FC2', text: 'Fatecarver casts Growth', spellId: 'growth' },
    ] as CombatEvent[]);
    expect(playCombatSpellCastFx(casts)).toBe(2);
    const p = plays('growth-effect');
    expect(p).toHaveLength(2);
    expect(optsOf(p[0]!).muteSound).toBeUndefined();
    expect(optsOf(p[1]!).muteSound).toBe(true);
  });

  it('casts farther apart than the gap each sound', () => {
    playSpellCastFx('growth');
    clock += 121;
    playSpellCastFx('growth');
    expect(plays('growth-effect').map((c) => optsOf(c).muteSound)).toEqual([undefined, undefined]);
  });

  it('different spells within the gap each get their sound', () => {
    playSpellCastFx('growth');
    playSpellCastFx('sparkplug');
    expect(optsOf(plays('growth-effect')[0]!).muteSound).toBeUndefined();
    expect(optsOf(plays('waking-rift-fx')[0]!).muteSound).toBeUndefined();
  });

  it('a dropped sound does not move the clock (a steady stream slower than the gap keeps ringing)', () => {
    expect(spellCastSoundAllowed('d', 0)).toBe(true);
    expect(spellCastSoundAllowed('d', 100)).toBe(false);
    expect(spellCastSoundAllowed('d', 130)).toBe(true);
  });

  it('the PLAYER\'s cast from hand follows the same gate (a doubled cast inside a widened gap rings once)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setBuffFxValue('spellCastSfxGapMs', 1000);
    runRecruitMomentCues(spellCastMoment('growth', { x: 1, y: 1 }, [], 2), { cardIdOf: () => null, measure: () => null });
    clock += 200;
    vi.runAllTimers();
    vi.useRealTimers();
    expect(plays('growth-effect').map((c) => optsOf(c).muteSound)).toEqual([undefined, true]);
  });
});
