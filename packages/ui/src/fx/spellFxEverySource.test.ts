// @vitest-environment jsdom
/**
 * SPELL EFFECTS FROM EVERY SOURCE, PRESENTATION HALF (owner report 2026-09-24, verbatim): *"dragonflame animation is
 * not playing from the gilded ledger etc. why? all spell animations and sfx should be wired to play whenever a spell
 * or minion is cast/played from any source. can you find the disconnect?"*
 *
 * One per-buff play for every non-player caster (`playCastFanOutBuffFx`): a rune (from its node), a minion in the
 * Shop / at End of Turn / in combat (from its body). Dragonflame's column plays ON the minion from any source and
 * rings its sound; a travelling row (an Ale, Great Pot) leaves the caster. The 120 ms burst gap holds everywhere,
 * the player's own volley included. Great Pot (owner def 2026-09-24, `greatpot`) is bound like the Ales.
 *
 * The sim's tags are pinned in packages/sim/src/spellFxEverySource.test.ts. `playDef` and `sfx` are mocked.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playDef } from './playDef';
import { sfx } from '../sfx';
import { playCastFanOutBuffFx, playRuneCastBuffFx, resetSpellCastSoundGate } from './spellCastFx';
import { castFxReplacesTendril, spellCastFanOutFor, spellCastFxFor } from '../choreo/bindings';
import { presentConsequence } from '../choreographer/consequencePresenters';
import { runRecruitMomentCues } from '../choreo/recruitCues';
import { spellCastMoment } from '../choreo/recruitMoments';
import { resetBuffFxConfig } from '../buffFxConfig';
import { resetCastPreviewConfig, setCastPreviewValue } from '../castPreviewConfig';

vi.mock('./playDef', () => ({ playDef: vi.fn(() => () => {}), canPlayDefs: vi.fn(() => true) }));
vi.mock('../sfx', () => ({ sfx: new Proxy({} as Record<string, unknown>, { get: (t, k: string) => (t[k] ??= vi.fn()) }) }));
const mockPlayDef = vi.mocked(playDef);
const plays = (def: string) => mockPlayDef.mock.calls.filter((c) => c[0] === def);
const anchorsOf = (call: unknown[]) => call[1] as { source: { x: number; y: number }; target: { x: number; y: number } };
const muted = (call: unknown[]) => (call[2] as { muteSound?: boolean }).muteSound === true;
const dragonflameSfx = () => vi.mocked((sfx as unknown as Record<string, () => void>).dragonflame);

const NODE = { x: 60, y: 30 };
function mountRune(id: string): void {
  const rail = document.createElement('div');
  rail.className = 'questbadges';
  const node = document.createElement('div');
  node.className = 'runebadge';
  node.dataset.sourceId = id;
  node.getBoundingClientRect = () => ({ left: 40, top: 10, width: 40, height: 40, right: 80, bottom: 50, x: 40, y: 10, toJSON: () => ({}) });
  rail.appendChild(node);
  document.body.appendChild(rail);
}

let clock = 1000;
beforeEach(() => {
  mockPlayDef.mockClear();
  dragonflameSfx().mockClear();
  resetSpellCastSoundGate();
  resetBuffFxConfig();
  setCastPreviewValue('runeFlourishOn', 0); // synchronous rune casts (the flourish's delays are pinned elsewhere)
  document.body.innerHTML = '';
  clock += 10_000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); resetCastPreviewConfig(); });

const A = { x: 300, y: 400 };
const B = { x: 500, y: 400 };
const CASTER = { x: 100, y: 400 };

describe('Dragonflame from every source', () => {
  it('RUNE (Gilded Ledger, Shop / legacy End of Turn): each buff plays the column ON the minion, one sound per burst', () => {
    mountRune('rune_gilded_ledger');
    expect(playRuneCastBuffFx({ runeId: 'rune_gilded_ledger', spellId: 'sp_dragonflame', target: A, targetUid: 'a' })).toBe(true);
    expect(playRuneCastBuffFx({ runeId: 'rune_gilded_ledger', spellId: 'sp_dragonflame', target: B, targetUid: 'b' })).toBe(true);
    const df = plays('dragonflame');
    expect(df.map((c) => anchorsOf(c).target)).toEqual([A, B]);
    expect(df.map((c) => anchorsOf(c).source)).toEqual([A, B]); // buffedOn: on the minion, not from the node
    expect(dragonflameSfx(), 'the spell\'s sound rings once for the burst').toHaveBeenCalledTimes(1);
  });

  it('a later repeat wave (past the 120 ms gap) rings again, as the player\'s own cast does', () => {
    playCastFanOutBuffFx({ spellId: 'sp_dragonflame', from: null, target: A, targetUid: 'a' });
    clock += 300;
    playCastFanOutBuffFx({ spellId: 'sp_dragonflame', from: null, target: A, targetUid: 'a' });
    expect(dragonflameSfx()).toHaveBeenCalledTimes(2);
  });

  it('MINION (Mage-Pup / shop Rally): the column plays ON the minion and rings, where the descend used to be', () => {
    expect(playCastFanOutBuffFx({ spellId: 'sp_dragonflame', from: CASTER, target: A, targetUid: 'a' })).toBe(true);
    expect(anchorsOf(plays('dragonflame')[0]!)).toMatchObject({ source: A, target: A });
    expect(dragonflameSfx()).toHaveBeenCalledTimes(1);
  });
});

describe('Great Pot is bound like the Ales (owner def 2026-09-24)', () => {
  it('its per-buff row is the owner\'s `greatpot` def, travelling (cursor / travel / target), and it replaces the tendril', () => {
    expect(spellCastFanOutFor('greatpot')).toMatchObject({ def: 'greatpot', fanOut: 'buffed' });
    expect(spellCastFxFor('greatpot'), 'not a single camera play').toBeNull();
    expect(castFxReplacesTendril('greatpot'), 'the per-buff row itself replaces the tendril, per buff').toBe(false);
  });

  it('PLAYER (hand): the volley leaves the release point to each minion, and its bloodpot Sound layer rings ONCE', () => {
    const pt = { x: 700, y: 900 };
    const at: Record<string, { x: number; y: number }> = { a: A, b: B };
    runRecruitMomentCues(spellCastMoment('greatpot', pt, [{ uid: 'a', count: 1 }, { uid: 'b', count: 1 }]), { cardIdOf: () => null, measure: (u) => at[u] ?? null });
    const gp = plays('greatpot');
    expect(gp.map((c) => anchorsOf(c))).toEqual([expect.objectContaining({ source: pt, target: A }), expect.objectContaining({ source: pt, target: B })]);
    expect(gp.map(muted)).toEqual([false, true]);
  });

  it('RUNE (Gilded Ledger / Spell Market): from the rune node to each minion, one sound', () => {
    mountRune('rune_gilded_ledger');
    playRuneCastBuffFx({ runeId: 'rune_gilded_ledger', spellId: 'greatpot', target: A, targetUid: 'a' });
    playRuneCastBuffFx({ runeId: 'rune_gilded_ledger', spellId: 'greatpot', target: B, targetUid: 'b' });
    const gp = plays('greatpot');
    expect(gp.map((c) => anchorsOf(c))).toEqual([expect.objectContaining({ source: NODE, target: A }), expect.objectContaining({ source: NODE, target: B })]);
    expect(gp.map(muted)).toEqual([false, true]);
  });

  it('MINION: from the caster\'s body; with the caster gone, it lands on the minion', () => {
    playCastFanOutBuffFx({ spellId: 'greatpot', from: CASTER, target: A, targetUid: 'a' });
    playCastFanOutBuffFx({ spellId: 'greatpot', from: null, target: B, targetUid: 'b' });
    const gp = plays('greatpot');
    expect(anchorsOf(gp[0]!)).toMatchObject({ source: CASTER, target: A });
    expect(anchorsOf(gp[1]!)).toMatchObject({ source: B, target: B });
  });

  it('an unbound spell has no per-buff row: the caller keeps its own path', () => {
    expect(playCastFanOutBuffFx({ spellId: 'spiritfire', from: CASTER, target: A, targetUid: 'a' })).toBe(false);
    expect(mockPlayDef).not.toHaveBeenCalled();
  });
});

describe('every phase reaches the per-buff play', () => {
  it('END OF TURN (authoritative): a MINION\'s Dragonflame / Great Pot gain goes to castFanOutGain with its caster', () => {
    const castFanOutGain = vi.fn(() => true);
    const statGain = vi.fn();
    const ctx = { statGain, questTendril: vi.fn(), runeCastGain: vi.fn(), castFanOutGain, spellHasCastFx: castFxReplacesTendril, selfBuff: vi.fn(), heroPowerGain: vi.fn() };
    const beat = { source: { kind: 'spell', id: 'x', label: 'x' } };
    const gain = (spellId: string) => ({ type: 'statsChanged', target: { zone: 'board', uid: 'a', cardId: 'stray', side: 'player' },
      attack: 4, health: 4, permanent: true, channel: 'ordinary', spellId, castByUid: 'fb' });
    presentConsequence({ consequence: gain('sp_dragonflame'), beat, ctx, index: 0 } as never);
    presentConsequence({ consequence: gain('greatpot'), beat, ctx, index: 1 } as never);
    expect(castFanOutGain.mock.calls).toEqual([['sp_dragonflame', 'fb', 'a', 0], ['greatpot', 'fb', 'a', 1]]);
    expect(statGain).not.toHaveBeenCalled();
  });

  it('SHOP / legacy End of Turn / combat all route a tagged buff through the shared play before the stock tendril', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const recruit = readFileSync(join(here, '../Recruit.tsx'), 'utf8');
    const replay = recruit.slice(recruit.indexOf('const replayBuffFxEvents = useCallback('));
    expect(replay.indexOf('playCastFanOutBuffFx(')).toBeGreaterThan(0);
    expect(replay.indexOf('playCastFanOutBuffFx(')).toBeLessThan(replay.indexOf('fireBuffFx('));
    expect(recruit).toContain('castFanOutGain: (spellId, casterUid, uid, index)');
    // The player's own volley never claims a minion's cast in the same action.
    expect(recruit).toContain("e.kind === 'spell' && !e.sourceRuneId && !e.castByUid");
    const combat = readFileSync(join(here, '../useCombatReplay.ts'), 'utf8');
    const casts = combat.slice(combat.indexOf('const fireBuffCasts = useCallback('));
    expect(casts.indexOf('playCastFanOutBuffFx(')).toBeGreaterThan(0);
    expect(casts.indexOf('playCastFanOutBuffFx(')).toBeLessThan(casts.indexOf('fireBuffFx('));
  });
});
