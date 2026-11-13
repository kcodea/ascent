import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CombatEvent } from '@game/core';
import { classifyKeywordOrigin } from './keywordOrigin';
import { KEYWORD_BEAMS, KEYWORD_BEAM_GAP_MS } from './keywordBeam';
import { runeKeywordGrantsIn } from './runeKeywordBeams';
import { getDef } from './fxDefs';

/**
 * WHERE A GIVEN KEYWORD'S BEAM STARTS when no minion gave it (R-FX-KEYWORD-ORIGIN-01, owner 2026-11-13): a targeted
 * spell = the pointer, an untargeted spell = the hero portrait, a hero power = its slot, a rune = its own slot.
 */
describe('which origin an action implies', () => {
  it('a targeted spell leaves the pointer; an untargeted spell leaves the hero portrait', () => {
    expect(classifyKeywordOrigin('play', true, true)).toEqual({ kind: 'pointer' });
    expect(classifyKeywordOrigin('battlecryTarget', true, true)).toEqual({ kind: 'pointer' });
    expect(classifyKeywordOrigin('play', true, false)).toEqual({ kind: 'portrait' });
    expect(classifyKeywordOrigin('buy', true, false)).toEqual({ kind: 'portrait' });
  });
  it('a hero power leaves its own slot (Lord of the Risen), whichever slot fired', () => {
    expect(classifyKeywordOrigin('heroPower', false, true)).toEqual({ kind: 'heroPower', slot: 0 });
    expect(classifyKeywordOrigin('heroPower', false, true, 1)).toEqual({ kind: 'heroPower', slot: 1 });
  });
  it('a minion play, a buy or a sell borrows no origin', () => {
    expect(classifyKeywordOrigin('play', false, true)).toBeNull();
    expect(classifyKeywordOrigin('battlecryTarget', false, true)).toBeNull();
    expect(classifyKeywordOrigin('sell', false, false)).toBeNull();
  });
});

describe('the beams', () => {
  it('each keyword sends its own beam, and every beam is in the library', () => {
    expect(KEYWORD_BEAMS.R.def).toBe('rise-beam');
    expect(KEYWORD_BEAMS.V.def).toBe('execute-beam');
    expect(KEYWORD_BEAMS.DS.def).toBe('lastlight-beam');
    for (const b of Object.values(KEYWORD_BEAMS)) expect(getDef(b.def), b.def).toBeDefined();
    expect(KEYWORD_BEAM_GAP_MS).toBeGreaterThanOrEqual(120);
  });
});

describe('a rune giving a keyword in combat', () => {
  const ev = (e: Record<string, unknown>): CombatEvent => e as unknown as CombatEvent;
  const moment = (start: number, end: number) => ({ start, end, primary: ev({ type: 'keyword' }), stepGroups: [], kind: 'keyword' as const });
  const events = [
    ev({ type: 'questTrigger', flag: 'runeRisingGraves', side: 'player' }),
    ev({ type: 'keyword', target: 'a', keyword: 'R', source: 'a' }),
    ev({ type: 'keyword', target: 'b', keyword: 'R', source: 'b' }), // the next beat: no trigger of its own
    ev({ type: 'keyword', target: 'c', keyword: 'R', source: 'giver' }), // a minion gave this one
    ev({ type: 'questTrigger', flag: 'runeX', side: 'enemy' }),
    ev({ type: 'shieldUp', target: 'd' }),
  ];
  it('a sourceless grant beside a player rune fire is the rune\'s', () => {
    const out = runeKeywordGrantsIn(moment(0, 2), events, null);
    expect(out.grants).toEqual([{ kw: 'R', target: 'a', flag: 'runeRisingGraves' }]);
    expect(out.carry).toEqual({ flag: 'runeRisingGraves', end: 2 });
  });
  it('the fire carries into the very next beat when it holds only such grants (Rising Graves, one Rise per beat)', () => {
    const out = runeKeywordGrantsIn(moment(2, 3), events, { flag: 'runeRisingGraves', end: 2 });
    expect(out.grants).toEqual([{ kw: 'R', target: 'b', flag: 'runeRisingGraves' }]);
    expect(runeKeywordGrantsIn(moment(2, 3), events, { flag: 'runeRisingGraves', end: 1 }).grants).toEqual([]);
  });
  it('a minion\'s grant and the foe\'s rune are left alone', () => {
    expect(runeKeywordGrantsIn(moment(3, 4), events, { flag: 'runeRisingGraves', end: 3 }).grants).toEqual([]);
    expect(runeKeywordGrantsIn(moment(4, 6), events, null).grants).toEqual([]);
  });
});

describe('the call sites', () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');
  it('the store notes every action before it resolves', () => {
    expect(read('../store.ts')).toContain('noteShopActionOrigin(a.type, spell, targeted, a.slot ?? 0);');
  });
  it('the Shop: Rise and Execute mid-turn, Ward with its blast on landing, and a rune or hero End of Turn beat', () => {
    const recruit = read('../Recruit.tsx');
    expect(recruit).toContain('const at = prev && prevV ? keywordOriginPoint(shopKeywordOrigin()) : null;');
    expect(recruit).toContain("launchKeywordBeam('DS', wardFrom, c.uid, { launchAt: wardBeams * KEYWORD_BEAM_GAP_MS, sound: wardBeams < KEYWORD_BEAM_SOUND_MAX, onLand: blast })");
    expect(recruit).toContain("const at = origin.kind === 'rune' ? runeSlotPoint(origin.id) : origin.kind === 'hero' || origin.kind === 'heroPower' ? heroPowerPoint() : null;");
  });
  it('the Rise beam replaces the giver\'s buff tendril on the same minion (Runic Beetle)', () => {
    expect(read('../Recruit.tsx')).toContain("run.recruitBuffFx.filter((e) => !(e.kind === 'minion' && riseOwned.has(`${e.sourceUid}|${e.targetUid}`)))");
  });
  it('combat: every beat checks for a rune-given keyword', () => {
    expect(read('../useCombatReplay.ts')).toContain('startRuneKeywordBeams(beat, events, combatSpeedRef.current,');
  });
});
