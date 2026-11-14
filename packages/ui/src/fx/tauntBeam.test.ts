import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { replayBeats, replayOrder } from '../choreo/replayOrder';
import { KEYWORD_BEAMS, KEYWORD_LAND_AT_MS, holdKeywordLook, isBeamKeyword, keywordLandAtMs } from './keywordBeam';
import { bankedKeywordGrantsIn, minionTauntGrantsIn, runeKeywordGrantsIn } from './runeKeywordBeams';
import { isTauntHeld } from './tauntHold';
import { getDef } from './fxDefs';
import { defArrivalMs } from './defArrival';

/**
 * THE TAUNT BEAM (R-FX-TAUNT-GIVEN-01, owner 2026-11-13: "now im making a taunt beam"): Taunt given by a spell, a hero
 * power or a rune travels on `taunt-beam`, and the shield frame appears when it lands.
 */
describe('the Taunt beam', () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');
  it('is in the library, travels, and is the beam for Taunt', () => {
    expect(isBeamKeyword('T')).toBe(true);
    expect(KEYWORD_BEAMS.T.def).toBe('taunt-beam');
    expect(getDef('taunt-beam')).toBeDefined();
    expect(defArrivalMs(JSON.parse(read('./defs/taunt-beam.json')))).toBeGreaterThan(0);
    expect(KEYWORD_BEAMS.T.launchSfx).toBe('sfx-taunt-whoosh');
    expect(getDef('sfx-taunt-whoosh')).toBeDefined();
  });
  it('the shield frame appears 240 ms after the beam leaves (owner 2026-11-13), whatever the beam travel says', () => {
    expect(KEYWORD_LAND_AT_MS).toEqual({ T: 240 });
    expect(keywordLandAtMs('T', 140)).toBe(240);
    expect(keywordLandAtMs('T', 380)).toBe(240);
    // Every other keyword still lands when its tip arrives.
    for (const kw of ['R', 'V', 'DS', 'W', 'CR'] as const) expect(keywordLandAtMs(kw, 380)).toBe(380);
    const kb = read('./keywordBeam.ts');
    expect(kb).toContain('const landAt = keywordLandAtMs(kw, arrive);');
    expect(kb).toContain('hold(kw, targetUid, (launchAt + landAt) / s + 50);'); // the hold outlasts a late landing
  });
  it('the Taunt sound rings as the beam LANDS, and the Shop does not also ring it at the grant', () => {
    const kb = read('./keywordBeam.ts');
    expect(kb).toContain("const ringTaunt = (): void => { if (sound && kw === 'T' && !tauntRang) { tauntRang = true; sfx.taunt(); } };");
    // ...100 ms ahead of the frame, and still rung at the landing if that timer never ran.
    expect(kb).toContain('const ringAt = Math.min(TAUNT_SOUND_AT_MS, landAt);');
    expect(kb).toContain('export const TAUNT_SOUND_AT_MS = 55;');
    const store = read('../store.ts');
    expect(store).toContain("const tauntBeamComing = !!shopKeywordOrigin() && canPlayDefs() && !!getDef(KEYWORD_BEAMS.T.def);");
    expect(store).toContain("if (!tauntBeamComing && next.board.some((m) => m.keywords.includes('T') && wasTaunt.get(m.uid) === false)) sfx.taunt();");
  });
  it('the launcher holds the shield frame, and the card draws the Taunt frame only when it is not held', () => {
    holdKeywordLook('T', 't1', 500);
    expect(isTauntHeld('t1')).toBe(true);
    holdKeywordLook('T', 't1', 0);
    expect(isTauntHeld('t1')).toBe(false);
    const card = read('../Card.tsx');
    expect(card).toContain("const tauntShown = card.keywords.includes('T') && !tauntHeld;");
    expect(card.split("card.keywords.includes('T')").length).toBe(2); // every other read goes through tauntShown
    // The shield frame is fetched and decoded while the beam flies, not when it lands.
    expect(card).toContain("useEffect(() => { if (tauntHeld) requestArt(tauntFrameSrcFor(card.tribe, !!card.golden), 'now'); }, [tauntHeld, card.tribe, card.golden]);");
  });
  it('the Shop sends it mid-turn (a board read) and at End of Turn (a rune or the hero)', () => {
    const recruit = read('../Recruit.tsx');
    expect(recruit).toContain("if (prevT!.get(c.uid) === false && c.keywords.includes('T')) gains.push('T');");
    expect(recruit).toContain("keyword === 'CR' || keyword === 'T')) {");
  });
  it('Arena Heckler on a REAL fight (owner 2026-11-13): the Taunt leaves Heckler for the enemy minion opposite it', () => {
    const bm = (cardId: string, attack: number, health: number): BoardMinion => ({ cardId, attack, health, keywords: [] });
    const { events: raw } = simulate([bm('arenaheckler', 1, 60), bm('trainingdummy', 1, 60)], [bm('trainingdummy', 1, 60), bm('trainingdummy', 1, 60)], makeRng(7), CARD_INDEX,
      combatSide({ tier: 4 }), combatSide({ tier: 4 }));
    const events = replayOrder(raw);
    const beats = replayBeats(raw);
    const got = beats.flatMap((beat) => minionTauntGrantsIn(beat, events));
    expect(got).toHaveLength(1);
    const logged = raw.find((e) => e.type === 'keyword' && e.keyword === 'T') as { target: string; source: string };
    expect(got[0]).toEqual({ source: logged.source, target: logged.target });
    expect(got[0]!.source).toBe('m0'); // Heckler himself, the left-most player body
    expect(got[0]!.target).not.toBe('m1'); // an enemy body, not his neighbour
    // The rune and banked-spell readers leave a minion's grant alone, so it never plays twice.
    expect(beats.flatMap((beat) => bankedKeywordGrantsIn(beat, events))).toEqual([]);
    expect(beats.flatMap((beat) => runeKeywordGrantsIn(beat, events, null, []).grants)).toEqual([]);
  });
  it('a minion that already has Taunt gets no second one from Heckler', () => {
    const { events: raw } = simulate([{ cardId: 'arenaheckler', attack: 1, health: 60, keywords: [] }], [{ cardId: 'trainingdummy', attack: 1, health: 60, keywords: ['T'] }], makeRng(7), CARD_INDEX,
      combatSide({ tier: 4 }), combatSide({ tier: 4 }));
    expect(replayBeats(raw).flatMap((beat) => minionTauntGrantsIn(beat, replayOrder(raw)))).toEqual([]);
  });
  it('Marked Target, banked in the Shop, on a REAL fight: the Taunt leaves the caster for the FOE minion it marks', () => {
    const bm = (cardId: string, attack: number, health: number): BoardMinion => ({ cardId, attack, health, keywords: [] });
    const { events: raw } = simulate([bm('trainingdummy', 1, 60)], [bm('trainingdummy', 1, 60), bm('trainingdummy', 1, 60)], makeRng(7), CARD_INDEX,
      combatSide({ tier: 4, questMods: { markFoeRightmostTaunt: true } } as never), combatSide({ tier: 4 }));
    const events = replayOrder(raw);
    const got = replayBeats(raw).flatMap((beat) => bankedKeywordGrantsIn(beat, events));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ kw: 'T', side: 'player' }); // the player cast it...
    const taunt = raw.find((e) => e.type === 'keyword' && e.keyword === 'T') as { target: string };
    expect(got[0]!.target).toBe(taunt.target); // ...and it lands on the minion the engine marked
    expect(got[0]!.target).not.toBe('m0');
  });
});
