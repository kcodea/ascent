import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from './state';
import { captureBuffFx, castSpell, applyChooseOne, playCard } from './recruit';

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
    castSpell(s, CARD_INDEX['growth']!); // +3/+4 to the whole board

    const spellFx = s.recruitBuffFx.filter((e) => e.kind === 'spell');
    expect(spellFx.length).toBe(2); // one per buffed minion
    const targets = spellFx.map((e) => e.targetUid).sort();
    expect(targets).toEqual(['a', 'b']);
    for (const e of spellFx) {
      expect(e.sourceUid).toBeUndefined();
      expect(e.attack).toBe(3);
      expect(e.health).toBe(4);
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
