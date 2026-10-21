import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatResult, type QuestCombatMods } from '../index';

/**
 * ENGRAVED KEEPS COMBAT KEYWORDS (owner 2026-10-21, R-ENGRAVE-03).
 *
 * "change the engrave mechanic to also include keywords gained in combat. Therefore if a minion is engraved and gains
 * ward, they gain that ward permanently, so they would carry it back from combat. Remember, if a risen minion gains
 * something like ward or stats, that is technically a new copy of that minion and that would not carry back. [...]
 * This does not include the spells that grant a next combat only keyword, since those are technically cast during
 * recruit phase."
 *
 * Owner confirmations (2026-10-21): "1. Yes carries back 2. Correct 3. Yes 4. Yes": a keyword gained then lost in the
 * same fight still carries back; losing a keyword it already had never does; the Shop card shows it; a Gild keeps it.
 *
 * The combat-time grant used throughout is Rune of the Vanguard (Start of Combat: the 3 left-most minions gain
 * Critical Strike and Ward), the "Start of Combat keyword" case the owner said counts.
 */
const sim = (player: BoardMinion[], enemy: BoardMinion[], pMods: Partial<QuestCombatMods> = {}, eMods: Partial<QuestCombatMods> = {}, seed = 7): CombatResult =>
  simulate(player, enemy, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, questMods: pMods as QuestCombatMods }), combatSide({ tier: 6, questMods: eMods as QuestCombatMods }));
const bag = (sourceUid: string | undefined, attack: number, health: number, keywords: BoardMinion['keywords'] = []): BoardMinion =>
  ({ cardId: 'sandbag', attack, health, keywords, ...(sourceUid ? { sourceUid } : {}) });
const kept = (r: CombatResult, uid: string) => r.playerPermaKeywords?.find((p) => p.sourceUid === uid)?.keywords ?? [];

describe('an Engraved minion keeps the keywords its primary body gains in combat', () => {
  it('a Start of Combat keyword grant carries back (Vanguard: Critical Strike + Ward)', () => {
    const r = sim([bag('E', 1, 60, ['EG'])], [bag(undefined, 1, 30)], { runeVanguard: true });
    expect([...kept(r, 'E')].sort()).toEqual(['CR', 'DS']);
  });

  it('a minion that is NOT Engraved keeps none of them (the contrast)', () => {
    const r = sim([bag('N', 1, 60)], [bag(undefined, 1, 30)], { runeVanguard: true });
    expect(r.playerPermaKeywords).toBeUndefined();
  });

  it('owner ruling 1: a Ward gained and then broken in the same fight still carries back', () => {
    const r = sim([bag('E', 1, 60, ['EG'])], [bag(undefined, 1, 30)], { runeVanguard: true });
    const uid = r.initial.player[0]!.uid;
    expect(r.events.some((e) => e.type === 'shield' && e.target === uid), 'the gained Ward broke').toBe(true);
    expect(kept(r, 'E')).toContain('DS');
  });

  it('owner ruling 2: a keyword it already had is neither duplicated nor reported, broken or not', () => {
    const r = sim([bag('E', 1, 60, ['EG', 'DS'])], [bag(undefined, 1, 30)], { runeVanguard: true });
    const uid = r.initial.player[0]!.uid;
    expect(r.events.some((e) => e.type === 'shield' && e.target === uid), 'its own Ward broke').toBe(true);
    expect(kept(r, 'E')).toEqual(['CR']);
  });

  it('a "next combat only" keyword cast in the Shop (a banked keyword) never becomes permanent', () => {
    const r = sim([bag('E', 1, 60, ['EG'])], [bag(undefined, 1, 30)], { bankedKeywords: [{ index: 0, keyword: 'T' }] });
    expect(r.events.some((e) => e.type === 'keyword' && e.keyword === 'T'), 'the banked Taunt was granted').toBe(true);
    expect(r.playerPermaKeywords).toBeUndefined();
  });

  it('a RISEN copy that gains Ward does not carry it back (it is a fresh combat-only copy)', () => {
    // Rune of the Undertow wards bodies summoned in combat, and a Rise return is a summon. Taragosa's Heir PRINTS
    // Engraved, so the risen copy (the printed body) is still Engraved when it gains the Ward.
    const r = sim([{ cardId: 'taragosaheir', attack: 0, health: 1, keywords: ['EG', 'R'], sourceUid: 'E' }], [bag(undefined, 5, 400)], { runeUndertow: 4 });
    const uid = r.initial.player[0]!.uid;
    const back = r.events.find((e) => e.type === 'reborn' && e.target === uid);
    expect(back && back.type === 'reborn' && back.keywords.includes('DS'), 'the risen copy came back Warded').toBe(true);
    expect(r.playerPermaKeywords).toBeUndefined();
  });

  it('the primary body\'s gain made BEFORE it died and Rose still carries back', () => {
    const r = sim([bag('E', 0, 1, ['EG', 'R'])], [bag(undefined, 5, 400)], { runeVanguard: true });
    const uid = r.initial.player[0]!.uid;
    expect(r.events.some((e) => e.type === 'reborn' && e.target === uid), 'it Rose').toBe(true);
    expect([...kept(r, 'E')].sort()).toEqual(['CR', 'DS']);
  });

  it('a summon with no run card never reports anything', () => {
    const r = sim([bag(undefined, 1, 60, ['EG'])], [bag(undefined, 1, 30)], { runeVanguard: true });
    expect(r.playerPermaKeywords).toBeUndefined();
  });

  it('is symmetric: the enemy side reports the same carry-back through enemyCarry', () => {
    const r = sim([bag(undefined, 1, 30)], [bag('E', 1, 60, ['EG'])], {}, { runeVanguard: true });
    expect([...(r.enemyCarry?.permaKeywords?.find((p) => p.sourceUid === 'E')?.keywords ?? [])].sort()).toEqual(['CR', 'DS']);
    expect(r.playerPermaKeywords).toBeUndefined();
  });

  it('is deterministic: the same seed gives the same log and the same carry-back', () => {
    const a = sim([bag('E', 1, 60, ['EG'])], [bag(undefined, 1, 30)], { runeVanguard: true });
    const b = sim([bag('E', 1, 60, ['EG'])], [bag(undefined, 1, 30)], { runeVanguard: true });
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.playerPermaKeywords).toEqual(b.playerPermaKeywords);
  });
});
