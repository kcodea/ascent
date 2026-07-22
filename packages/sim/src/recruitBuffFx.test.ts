import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from './state';
import { captureBuffFx, castSpell, applyChooseOne, playCard } from './recruit';
import { reduce } from './reducer';

const stray = (uid: string): BoardCard => ({ uid, cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });
const growthInHand = (uid: string): BoardCard => ({ uid, cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });

describe('recruitBuffFx run-state fields', () => {
  it('initialise empty on a fresh run', () => {
    const s = createRun(12345);
    expect(s.recruitBuffFx).toEqual([]);
    expect(s.recruitFxSeq).toBe(0);
  });
});

describe('recruitBuffFx capture (source → target)', () => {
  it('a board-wide buff spell (Growth) records one descend per buffed minion (kind:spell, no source)', () => {
    const s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'a', cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 'b', cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
      ],
    };
    castSpell(s, CARD_INDEX['growth']!); // +1/+1 to the whole board

    const spellFx = s.recruitBuffFx.filter((e) => e.kind === 'spell');
    expect(spellFx.length).toBe(2); // one per buffed minion
    const targets = spellFx.map((e) => e.targetUid).sort();
    expect(targets).toEqual(['a', 'b']);
    for (const e of spellFx) {
      expect(e.sourceUid).toBeUndefined();
      expect(e.attack).toBe(1);
      expect(e.health).toBe(1);
    }
  });

  it('Archmagus Guel records a minion tendril (kind:minion, sourceUid = Guel) when a spell is cast', () => {
    const s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'g', cardId: 'guel', tribe: 'neutral', attack: 2, health: 3, keywords: [], golden: false },
        { uid: 'a', cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
      ],
    };
    castSpell(s, CARD_INDEX['growth']!); // any spell cast → Guel buffs its 'other' friend +1/+1

    const minionFx = s.recruitBuffFx.filter((e) => e.kind === 'minion');
    expect(minionFx.length).toBeGreaterThanOrEqual(1);
    for (const e of minionFx) {
      expect(e.sourceUid).toBe('g');
      expect(e.sourceCardId).toBe('guel');
      expect(e.targetUid).not.toBe('g'); // Guel never targets itself
    }
    // The other friend (stray 'a') was buffed by Guel.
    expect(minionFx.some((e) => e.targetUid === 'a')).toBe(true);
    const guelFx = minionFx.find((e) => e.targetUid === 'a')!;
    expect(guelFx.attack).toBe(1);
    expect(guelFx.health).toBe(1);
  });

  it('nested capture wins: an inner (more-specific) source claims the target; the outer does not double-record it', () => {
    const target: BoardCard = { uid: 't', cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false };
    const inner: BoardCard = { uid: 'in', cardId: 'guel', tribe: 'neutral', attack: 2, health: 3, keywords: [], golden: false };
    const outer: BoardCard = { uid: 'out', cardId: 'karwind', tribe: 'dragon', attack: 2, health: 12, keywords: [], golden: false };
    const s: RunState = { ...createRun(1), board: [target, inner, outer] };

    // The outer capture's run() triggers a deeper (inner) capture that buffs `target`. Without the nested-skip
    // both the inner (source=inner) and the outer (source=outer) would record the same delta on `target`.
    captureBuffFx(s, outer, 'minion', () => {
      captureBuffFx(s, inner, 'minion', () => { target.attack += 2; target.health += 2; });
    });

    const fx = s.recruitBuffFx.filter((e) => e.targetUid === 't');
    expect(fx.length).toBe(1);            // exactly one event — no duplicate
    expect(fx[0]!.sourceUid).toBe('in');  // attributed to the inner (more specific) source
    expect(fx[0]!.attack).toBe(2);
    expect(fx[0]!.health).toBe(2);
  });

  it('Karwind (battlecryTriggered) records its reaction with source = Karwind, not the played minion', () => {
    const karwind: BoardCard = { uid: 'kw', cardId: 'karwind', tribe: 'dragon', attack: 2, health: 12, keywords: [], golden: false };
    const dragon: BoardCard = { uid: 'dr', cardId: 'frontdrake', tribe: 'dragon', attack: 3, health: 3, keywords: [], golden: false };
    // Pennycat's Battlecry summons a Stray (a Beast) — it never buffs Dragons, so Karwind's +2/+2 to `dragon` is
    // the ONLY thing touching it. That isolates the reaction's source.
    const pennycat: BoardCard = { uid: 'pc', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false };
    const s: RunState = { ...createRun(1), board: [karwind, dragon, pennycat] };

    playCard(s, pennycat); // a Battlecry fires → Karwind reacts, buffing your Dragons +2/+2

    const drFx = s.recruitBuffFx.filter((e) => e.targetUid === 'dr');
    expect(drFx.length).toBe(1);              // one reaction event, no duplicate
    expect(drFx[0]!.sourceUid).toBe('kw');    // Karwind, not the played Pennycat
    expect(drFx[0]!.sourceCardId).toBe('karwind');
    expect(drFx[0]!.attack).toBe(2);
    expect(drFx[0]!.health).toBe(2);
    // The played minion never gets attributed the Dragon's gain.
    expect(s.recruitBuffFx.some((e) => e.sourceUid === 'pc')).toBe(false);
  });

  it('Choose One buff-other option records source = the played Choose One minion', () => {
    const shaper: BoardCard = { uid: 'sh', cardId: 'shaper', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false };
    const stray: BoardCard = { uid: 'st', cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false };
    const s: RunState = { ...createRun(1), board: [shaper, stray] };

    // Option 0 of Wildwood Shaper: "Give your Beasts +1/+3".
    applyChooseOne(s, shaper, CARD_INDEX['shaper']!.chooseOne![0]!.effects);

    const stFx = s.recruitBuffFx.filter((e) => e.targetUid === 'st');
    expect(stFx.length).toBe(1);
    expect(stFx[0]!.sourceUid).toBe('sh');       // the played Choose One minion
    expect(stFx[0]!.sourceCardId).toBe('shaper');
    expect(stFx[0]!.attack).toBe(1);
    expect(stFx[0]!.health).toBe(3);
  });
});

describe('recruitBuffFx per-action isolation via reduce (reset + seq bump)', () => {
  it('a buffing action bumps recruitFxSeq once and leaves this action’s events', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [stray('a'), stray('b')],
      hand: [growthInHand('g1')],
    };
    const next = reduce(s, { type: 'play', uid: 'g1' });
    expect(next).not.toBe(s);
    expect(next.recruitFxSeq).toBe(s.recruitFxSeq + 1);
    expect(next.recruitBuffFx.length).toBeGreaterThan(0);
    expect(next.recruitBuffFx.length).toBe(2); // one descend per buffed board minion
  });

  it('a SECOND buffing action carries ONLY its own events (no accumulation) and bumps seq again', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [stray('a'), stray('b')],
      hand: [growthInHand('g1'), growthInHand('g2')],
    };
    const first = reduce(s, { type: 'play', uid: 'g1' });
    const second = reduce(first, { type: 'play', uid: 'g2' });
    // Isolation: the second action's captures are EXACTLY its two buffed targets — NOT 4 (both actions summed).
    expect(second.recruitBuffFx.length).toBe(2);
    expect(second.recruitFxSeq).toBe(first.recruitFxSeq + 1);
  });

  it('a non-buffing action clears recruitBuffFx to [] and leaves recruitFxSeq unchanged', () => {
    const primed: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [stray('a'), stray('b')],
      hand: [growthInHand('g1')],
    };
    // First buff so seq/fx are non-zero, then a reroll (buffs nobody).
    const buffed = reduce(primed, { type: 'play', uid: 'g1' });
    expect(buffed.recruitBuffFx.length).toBeGreaterThan(0);
    const rolled = reduce(buffed, { type: 'roll' });
    expect(rolled).not.toBe(buffed);
    expect(rolled.recruitBuffFx).toEqual([]);
    expect(rolled.recruitFxSeq).toBe(buffed.recruitFxSeq); // unchanged — no buff-others this action
  });

  it('Hunter (onGainAttack) buff-to-others is captured, sourced from Hunter', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [
        { uid: 'hu', cardId: 'hunter', tribe: 'dragon', attack: 5, health: 7, keywords: [], golden: false },
        stray('st'),
      ],
      hand: [growthInHand('g1')],
    };
    // Growth (+3/+4 to all) raises Hunter's Attack → Hunter's onGainAttack gives all minions +Health.
    const next = reduce(s, { type: 'play', uid: 'g1' });
    const hunterFx = next.recruitBuffFx.filter((e) => e.kind === 'minion' && e.sourceCardId === 'hunter');
    expect(hunterFx.length).toBeGreaterThanOrEqual(1);
    expect(hunterFx.some((e) => e.sourceUid === 'hu' && e.targetUid === 'st')).toBe(true);
  });
});
