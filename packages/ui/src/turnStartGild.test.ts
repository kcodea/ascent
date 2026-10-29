import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRun, reduce, type BoardCard, type BoardSnapshot, type RunState } from '@game/sim';
import { CARD_INDEX } from '@game/content';
import { gildMustWait, heldGildMayPlay, shopOfferCovering } from './turnStartGild';
import { WIPE_STATES } from './wipeMachine';

/**
 * R-SOT-GILD-01 (player report c49f912b, relayed by the owner 2026-10-24): "when a unit is tripled at the start of
 * turn, it happens while the return to shop transition is happening. this should wait until you return to shop. if it
 * is on a rune select turn, it should wait until the rune is selected".
 *
 * The capsule: Runeguard holding Rune of Unbroken Vein (a Cave Cutter at every Start of Turn), with one Cave Cutter on
 * the board and one in hand. `resolveCombat` (dispatched under the full return curtain) hands over the third, the sim
 * combines them into a golden, and a Runeforge offer is open the same turn.
 */
const card = (id: string, uid: string): BoardCard => {
  const c = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: c.tribe, attack: c.attack, health: c.health, keywords: [...c.keywords], golden: false } as BoardCard;
};
const closed = {
  runeforge: false, forgeMin: false, runeLockIn: false, discover: false, discoverMin: false, quest: false, questMin: false,
  power: false, powerMin: false, chooseOne: false, scouting: false, ancientOffer: false,
};

describe('the capsule: a Start-of-Turn grant completes a triple inside resolveCombat', () => {
  it('the golden lands in the commit the Shop dispatches under the return curtain (state unchanged by this fix)', () => {
    let s = {
      ...createRun(555605319, 'runeguard'), phase: 'recruit', embers: 0, hand: [card('k_veinbreaker', 'h1')],
      board: [card('k_veinbreaker', 'b1'), card('pack', 'p1')], questRecurringGrants: ['k_veinbreaker'],
    } as RunState;
    const foes: BoardSnapshot = { v: 1, wave: s.wave, heroId: 'indy', resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 1, minions: [{ cardId: 'sandbag', attack: 0, health: 1, keywords: [] }], seed: 1, origin: 'self' };
    s = reduce({ ...s, servedBoards: { [s.wave]: foes } }, { type: 'faceOmen' });
    const triplesBefore = s.triplesMade ?? 0;
    s = reduce(s, { type: 'settleCombat' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.phase).toBe('recruit');
    expect(s.triplesMade ?? 0).toBe(triplesBefore + 1);
    const gold = s.hand.find((c) => c.cardId === 'k_veinbreaker' && c.golden);
    expect(gold, 'the golden Cave Cutter is in hand from the commit').toBeDefined();
    // The Start-of-Turn beat's arrival names the GRANTED copy, which the triple consumed: the beat cannot carry the
    // gild, so the Shop needs its own hold for it.
    const gift = (s.sotBeatFx ?? []).find((b) => b.source.kind === 'gift' || b.source.kind === 'rune');
    expect(gift?.handGrants?.length).toBe(1);
    expect(s.hand.some((c) => c.uid === gift!.handGrants![0])).toBe(false);
  });
});

describe('a triple made at Start of Turn waits for the Shop (R-SOT-GILD-01)', () => {
  it('parks only a triple that lands while the wipe is moving (the Start-of-Turn commit), never a hand-made one', () => {
    for (const w of WIPE_STATES) expect(gildMustWait('recruit', w), w).toBe(w !== 'idle');
    expect(gildMustWait('gameover', 'coveredOut')).toBe(false);
  });

  it('plays only on a revealed Shop, after the Start-of-Turn beats, with no offer covering it', () => {
    const ok = { phase: 'recruit', wipe: 'idle' as const, sotPlaying: false, offerCovering: false };
    expect(heldGildMayPlay(ok)).toBe(true);
    for (const w of WIPE_STATES) if (w !== 'idle') expect(heldGildMayPlay({ ...ok, wipe: w }), w).toBe(false);
    expect(heldGildMayPlay({ ...ok, sotPlaying: true }), 'the Start-of-Turn beats play first').toBe(false);
    expect(heldGildMayPlay({ ...ok, offerCovering: true }), 'an open offer covers it').toBe(false);
    expect(heldGildMayPlay({ ...ok, phase: 'combat' })).toBe(false);
  });

  it('on a rune turn it waits until the rune is picked AND has flown to the rack; a peeked Runeforge leaves the Shop in view', () => {
    expect(shopOfferCovering(closed)).toBe(false);
    expect(shopOfferCovering({ ...closed, runeforge: true }), 'the Runeforge is open').toBe(true);
    expect(shopOfferCovering({ ...closed, runeLockIn: true }), 'the picked rune is still flying').toBe(true);
    expect(shopOfferCovering({ ...closed, runeforge: true, forgeMin: true }), 'peeked').toBe(false);
  });

  it('every other covering offer holds it the same way (a Discover, quest, power, Ancient offer, scout, Choose One)', () => {
    expect(shopOfferCovering({ ...closed, discover: true })).toBe(true);
    expect(shopOfferCovering({ ...closed, discover: true, discoverMin: true })).toBe(false);
    expect(shopOfferCovering({ ...closed, quest: true })).toBe(true);
    expect(shopOfferCovering({ ...closed, quest: true, questMin: true })).toBe(false);
    expect(shopOfferCovering({ ...closed, power: true })).toBe(true);
    expect(shopOfferCovering({ ...closed, power: true, powerMin: true })).toBe(false);
    expect(shopOfferCovering({ ...closed, ancientOffer: true })).toBe(true);
    expect(shopOfferCovering({ ...closed, scouting: true })).toBe(true);
    expect(shopOfferCovering({ ...closed, chooseOne: true })).toBe(true);
  });
});

const SRC = (f: string): string => readFileSync(join(dirname(fileURLToPath(import.meta.url)), f), 'utf8');

describe('the Shop wiring (source pins: no jsdom in this repo)', () => {
  const RECRUIT = SRC('Recruit.tsx');
  it('parks DURING RENDER on the triples count, below the wipe state, so no frame paints the golden early', () => {
    const wipeAt = RECRUIT.indexOf('const [wipe, setWipe] = useSwapState<WipeState>');
    const parkAt = RECRUIT.indexOf('if (!swapped && (run.triplesMade ?? 0) !== gildTriplesSeen) {');
    expect(parkAt).toBeGreaterThan(wipeAt);
    const block = RECRUIT.slice(parkAt, parkAt + 1200);
    expect(block).toContain('gildMustWait(run.phase, wipe)');
    expect(block).toContain('setGildHold({ uid: gold.uid, sources });');
  });

  it('holds the golden out of the hand AND the board rows while parked', () => {
    expect(RECRUIT).toContain('|| gildHold?.uid === uid;');
    expect(RECRUIT).toContain('c.uid !== gildOff');
  });

  it('the immediate gild skips a parked triple; the release plays the trail and the triple sound once the Shop is free', () => {
    expect(RECRUIT).toContain("if (tripled && run.phase === 'recruit' && !gildHold) {");
    const i = RECRUIT.indexOf('const gildOfferCovering = shopOfferCovering({');
    expect(i).toBeGreaterThan(-1);
    const block = RECRUIT.slice(i, i + 2200);
    expect(block).toContain('runeforge: !!run.runeforgeOffer, forgeMin, runeLockIn: !!lockIn');
    expect(block).toContain('heldGildMayPlay({ phase: run.phase, wipe, sotPlaying, offerCovering: gildOfferCovering })');
    expect(block).toContain('sfx.triple();');
    expect(block).toContain('playGildTrail(g.sources, el, g.uid);');
  });

  it("the store's action cue stays silent for a triple the Shop parks (no sound over the transition)", () => {
    const STORE = SRC('store.ts');
    expect(STORE).toContain("const shopParksGild = action.type === 'resolveCombat' && next.phase === 'recruit' && !useGame.getState().wipeIdle;");
    expect(STORE).toContain('if (!shopParksGild && countGolden(next) > countGolden(prev)) sfx.triple();');
  });
});
