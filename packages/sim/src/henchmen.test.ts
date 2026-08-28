import { describe, it, expect } from 'vitest';
import { CARD_INDEX, HENCHMEN } from '@game/content';
import { HEROES } from './heroes';
import { createRun, henchmanOffer, type RunState } from './state';
import { reduce } from './reducer';

/**
 * HENCHMEN — ARCHIVED 2026-08-28 (owner triage, `q-conv-global-henchman-pricing`: *"henchmen are not in the
 * game and are extremely WIP / being removed for now"*).
 *
 * The system it was built for (owner spec 2026-08-03): every hero has a hero-bound minion, never shop-offered,
 * recruitable once per run at a Gold cost that FALLS each round — win −3, loss −2, floored at 0.
 *
 * What this file asserts now is the ARCHIVE, in the shape the archived-content contract demands, and it is
 * three separate claims that must not be collapsed into one:
 *
 *   1. INERT — `henchmanOffer` is the single producer of an offer, so with it gated there is no offer for any
 *      hero on any turn, `buyHenchman` no-ops even when the Gold is there, and the StatusBar chip (which
 *      renders only on a non-null offer) never appears.
 *   2. RESOLVABLE — `HENCHMEN` and every hero's `henchman` link still resolve through `CARD_INDEX`, so a save
 *      or replay in which a henchman was already recruited still loads and the minion is still a real minion.
 *   3. REVERSIBLE — the decay STATE machinery is untouched and still accrues, so flipping `HENCHMEN_ARCHIVED`
 *      back to false restores a correctly-priced offer rather than a broken one. This is the claim that keeps
 *      the archive an archive instead of a slow deletion.
 *
 * ⚠️ Corrected while archiving: the old comment here said the placeholder "rides the WIP Warden (withheld from
 * the picker)". Warden is not and never was `wip` — it is the FIRST hero in the registry and fully playable,
 * so the placeholder henchman chip was live in Play for every Warden run. That, not tidiness, is why this
 * needed a switch rather than a comment.
 */

const HERO = 'warden'; // the only hero with a `henchman` link authored (placeholder `hm_test_squire`)

const withCombat = (s: RunState, result: 'win' | 'lose' | 'draw'): RunState => {
  // Drive the real settle path: a minimal fake CombatResult through the same reducer action the game uses.
  const r = reduce({ ...s, phase: 'combat', combatSettled: false, lastCombat: { result, events: [], playerDamage: 0, initial: { player: [], enemy: [] } } as never }, { type: 'resolveCombat' });
  return { ...r, phase: 'recruit' };
};

describe('the henchman system is ARCHIVED', () => {
  it('offers nothing — for the one hero that has a henchman authored, or any other, on any turn', () => {
    let s = createRun(1, HERO);
    expect(henchmanOffer(s), 'the archived system must mint no offer at run start').toBeNull();
    // …and it stays null across rounds, so no amount of decay can bring the chip back.
    for (const result of ['win', 'lose', 'draw', 'win'] as const) {
      s = withCombat(s, result);
      expect(henchmanOffer(s), `an offer appeared after a ${result}`).toBeNull();
    }
    expect(henchmanOffer(createRun(1, 'soren')), 'a hero with no henchman authored offers nothing either').toBeNull();
  });

  it('`buyHenchman` no-ops — even with the Gold, and even fully decayed', () => {
    // Both refusal paths through the reducer: rich enough to have afforded the base cost, and a discount large
    // enough that the henchman would have been FREE. Neither can produce the card.
    const rich: RunState = { ...createRun(1, HERO), embers: 20 };
    expect(reduce(rich, { type: 'buyHenchman' }), 'a funded buy must be refused').toBe(rich);
    const free: RunState = { ...createRun(1, HERO), embers: 0, henchmanDiscount: 99 };
    expect(reduce(free, { type: 'buyHenchman' }), 'a free buy must be refused').toBe(free);
    for (const s of [rich, free]) {
      expect(s.hand.some((c) => c.cardId === 'hm_test_squire'), 'no henchman reached the hand').toBe(false);
      expect(s.henchmanBought).toBeFalsy();
    }
  });

  it('the decay STATE still accrues — the archive is reversible, not a slow deletion', () => {
    // `henchmanDiscount` is banked at combat settle regardless of hero (reducer, resolveCombat). Keeping that
    // alive is what makes un-archiving restore a correctly-priced offer instead of one stuck at base cost.
    let s = createRun(1, HERO);
    expect(s.henchmanDiscount ?? 0).toBe(0);
    s = withCombat(s, 'win');
    expect(s.henchmanDiscount, 'a WIN banks 3').toBe(3);
    s = withCombat(s, 'lose');
    expect(s.henchmanDiscount, 'a LOSS banks 2 on top').toBe(5);
  });
});

describe('henchman registry doctrine (unchanged by the archive — resolvable, in no pool)', () => {
  it('every henchman card carries the flag and appears in NO set pool', () => {
    expect(HENCHMEN.length).toBeGreaterThan(0);
    for (const h of HENCHMEN) {
      expect(h.henchman, `${h.id} must be flagged`).toBe(true);
      expect(CARD_INDEX[h.id], `${h.id} must resolve globally`).toBeDefined();
    }
  });

  it('every hero henchman link resolves to a real flagged card', () => {
    for (const hero of HEROES) {
      if (!hero.henchman) continue;
      const def = CARD_INDEX[hero.henchman.cardId];
      expect(def, `${hero.id}'s henchman card must exist`).toBeDefined();
      expect(def!.henchman, `${hero.id}'s henchman must be a flagged henchman card`).toBe(true);
      expect(hero.henchman.cost).toBeGreaterThan(0);
    }
  });
});
