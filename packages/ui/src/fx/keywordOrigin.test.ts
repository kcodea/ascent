import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { replayBeats, replayOrder } from '../choreo/replayOrder';
import { classifyKeywordOrigin } from './keywordOrigin';
import { KEYWORD_BEAMS, KEYWORD_BEAM_GAP_MS, pointRect } from './keywordBeam';
import { combatAnchorsFromRects } from './combatAnchors';
import { RUNE_BEAM_AFTER_RETURN_MS, bankedKeywordGrantsIn, runeKeywordGrantsIn, type RuneCarry, type WaitingGrant } from './runeKeywordBeams';
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

describe('a beam from a point (owner 2026-11-13: Lord of the Risen played the sound and the Rise, no beam)', () => {
  it('the point makes real anchors: the beam starts on it and ends on the receiver', () => {
    const a = combatAnchorsFromRects({ source: pointRect({ x: 100, y: 700 }), target: { left: 400, top: 300, width: 120, height: 160 }, row: null, viewport: { w: 1920, h: 1080 } });
    expect(a?.source).toEqual({ x: 100, y: 700 });
    expect(a?.target).toEqual({ x: 460, y: 380 });
  });
  it('the launcher builds its source from that rect, never a zero-size one', () => {
    const src = readFileSync(new URL('./keywordBeam.ts', import.meta.url), 'utf8');
    expect(src).toContain('source: pointRect(origin), target');
  });
});

describe('a rune giving a keyword in combat, on REAL simulated fights walked as the replay walks them', () => {
  const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
    ({ cardId, attack, health, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...extra });
  /** Every beat's launches, in order: [beat kind, grants]. */
  function launches(flag: string, player: BoardMinion[]): Array<{ kind: string; grants: Array<{ kw: string; target: string; flag: string; side: string }> }> {
    const { events: raw } = simulate(player, [bm('trainingdummy', 5, 60)], makeRng(7), CARD_INDEX,
      combatSide({ tier: 4, questMods: { [flag]: true } } as never), combatSide({ tier: 4 }));
    const events = replayOrder(raw);
    let carry: RuneCarry | null = null;
    let waiting: WaitingGrant[] = [];
    const out: Array<{ kind: string; grants: Array<{ kw: string; target: string; flag: string; side: string }> }> = [];
    for (const beat of replayBeats(raw)) {
      const r = runeKeywordGrantsIn(beat, events, carry, waiting);
      carry = r.carry;
      waiting = r.waiting;
      const all = [...r.returned, ...r.grants];
      if (all.length) out.push({ kind: beat.kind, grants: all });
    }
    return out;
  }

  it('Deathtouched Apple (owner 2026-11-13: "this did not show the tendrils"): the Rise leaves once the body is BACK', () => {
    const got = launches('runeDeathtouchedApple', [bm('mumi', 2, 1, { keywords: ['R', 'T'] }), bm('mumi', 1, 60)]);
    expect(got.length).toBeGreaterThanOrEqual(1);
    // The grant is logged inside the death's beat and the rune fires on the next, but the body is not back yet:
    // the beam waits for the beat the body RETURNS on (owner 2026-11-13: "its hitting a unit that isnt there").
    expect(got[0]).toEqual({ kind: 'reborn', grants: [{ kw: 'R', target: 'm0', flag: 'runeDeathtouchedApple', side: 'player' }] });
    expect(got.every((g) => g.kind === 'reborn' && g.grants.every((x) => x.flag === 'runeDeathtouchedApple'))).toBe(true);
    expect(RUNE_BEAM_AFTER_RETURN_MS).toBeGreaterThanOrEqual(200);
  });

  it('Rising Graves: the fire comes first, and each Rise leaves on its own beat', () => {
    const got = launches('runeRisingGraves', [bm('mumi', 2, 60), bm('mumi', 1, 60), bm('mumi', 1, 60)]);
    const rises = got.flatMap((g) => g.grants);
    expect(rises.map((g) => g.target)).toEqual(['m0', 'm1']);
    expect(rises.every((g) => g.kw === 'R' && g.flag === 'runeRisingGraves')).toBe(true);
    expect(got.every((g) => g.kind !== 'questTrigger')).toBe(true);
  });

  it('Rune of the Vanguard (owner 2026-11-13): Critical Strike AND Ward leave the rune for each of the 3 leftmost', () => {
    const got = launches('runeVanguard', [bm('trainingdummy', 1, 60, { keywords: [] }), bm('trainingdummy', 1, 60, { keywords: [] }), bm('trainingdummy', 1, 60, { keywords: [] }), bm('trainingdummy', 1, 60, { keywords: [] })]).flatMap((g) => g.grants);
    expect(got.every((g) => g.flag === 'runeVanguard')).toBe(true);
    expect(got.filter((g) => g.kw === 'CR').map((g) => g.target)).toEqual(['m0', 'm1', 'm2']);
    expect(got.filter((g) => g.kw === 'DS').map((g) => g.target)).toEqual(['m0', 'm1', 'm2']);
  });

  it('Rune of Centerline: the middle minion of two different types gets both beams', () => {
    const got = launches('runeCenterline', [bm('mumi', 1, 60, { keywords: [] }), bm('trainingdummy', 1, 60, { keywords: [] }), bm('b2_beev', 1, 60, { keywords: [] })]).flatMap((g) => g.grants);
    expect(got.map((g) => g.kw).sort()).toEqual(['CR', 'DS']);
    expect(got.every((g) => g.target === 'm1' && g.flag === 'runeCenterline')).toBe(true);
  });

  it('THE FOE (owner 2026-11-13: "also be reflected on the opponents runes"): its Vanguard sends beams to ITS minions, marked as the foe', () => {
    const { events: raw } = simulate([bm('trainingdummy', 1, 60)], [bm('trainingdummy', 1, 60, { keywords: [] }), bm('trainingdummy', 1, 60, { keywords: [] })], makeRng(7), CARD_INDEX,
      combatSide({ tier: 4 }), combatSide({ tier: 4, questMods: { runeVanguard: true } } as never));
    const events = replayOrder(raw);
    const foeUids = new Set(raw.flatMap((e) => (e.type === 'keyword' || e.type === 'shieldUp' ? [e.target] : [])));
    let carry: RuneCarry | null = null;
    let waiting: WaitingGrant[] = [];
    const got = replayBeats(raw).flatMap((beat) => { const r = runeKeywordGrantsIn(beat, events, carry, waiting); carry = r.carry; waiting = r.waiting; return [...r.returned, ...r.grants]; });
    expect(got.length).toBe(4); // Critical Strike and Ward for each of its two
    expect(got.every((g) => g.side === 'enemy' && g.flag === 'runeVanguard' && foeUids.has(g.target))).toBe(true);
    expect(got.map((g) => g.kw).sort()).toEqual(['CR', 'CR', 'DS', 'DS']);
  });

  it('a minion that already has Critical Strike gets no second one', () => {
    const got = launches('runeVanguard', [bm('trainingdummy', 1, 60, { keywords: ['CR'] })]).flatMap((g) => g.grants);
    expect(got.filter((g) => g.kw === 'CR')).toEqual([]);
  });

  it("Executioner's Edge, banked in the Shop: the Critical Strike leaves on the beat the fight opens with", () => {
    const { events: raw } = simulate([bm('trainingdummy', 1, 60, { keywords: [] }), bm('trainingdummy', 1, 60, { keywords: [] })], [bm('trainingdummy', 5, 60)], makeRng(7), CARD_INDEX,
      combatSide({ tier: 4, questMods: { bankedKeywords: [{ index: 1, keyword: 'CR', critChance: 0.5 }] } } as never), combatSide({ tier: 4 }));
    const events = replayOrder(raw);
    const got = replayBeats(raw).flatMap((beat) => bankedKeywordGrantsIn(beat, events));
    expect(got).toEqual([{ kw: 'CR', target: 'm1', side: 'player' }]);
    // The foe's banked spell shows too, marked as the foe's (its beam leaves the mirrored cast card).
    const foe = simulate([bm('trainingdummy', 1, 60)], [bm('trainingdummy', 5, 60, { keywords: [] })], makeRng(7), CARD_INDEX,
      combatSide({ tier: 4 }), combatSide({ tier: 4, questMods: { bankedKeywords: [{ index: 0, keyword: 'CR', critChance: 0.5 }] } } as never));
    const foeGot = replayBeats(foe.events).flatMap((beat) => bankedKeywordGrantsIn(beat, replayOrder(foe.events)));
    expect(foeGot.map((g) => [g.kw, g.side])).toEqual([['CR', 'enemy']]);
    expect(foeGot[0]!.target).not.toBe('m0'); // a foe body, not the player's
  });

  it('a grant a minion made is never credited to a rune: the Echo of Mumi with no rune held launches nothing here', () => {
    expect(launches('runeNotARealFlag', [bm('mumi', 2, 1, { keywords: ['T'] }), bm('mumi', 1, 60)])).toEqual([]);
  });
});

describe('the call sites', () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');
  it('the store notes every action before it resolves', () => {
    expect(read('../store.ts')).toContain('noteShopActionOrigin(a.type, spell, targeted, a.slot ?? 0);');
  });
  it('the Shop: Rise and Execute mid-turn, Ward with its blast on landing, and a rune or hero End of Turn beat', () => {
    const recruit = read('../Recruit.tsx');
    expect(recruit).toContain('? keywordOriginPoint(shopKeywordOrigin()) : null;');
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
