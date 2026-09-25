/**
 * GRIM prints its Echo's LIVE TOTAL in place (owner ruling 2026-09-25, replacing the 2026-09-24 static-text
 * exception): "fix grim so that it updates in real time with the current value of the echo."
 *
 * The text reads "Echo: Give your Beast Aura {{+X/+Y}}. Improves by +3/+2 for every Echo triggered this game." with +X/+Y = (Echoes triggered this game + 1 for its
 * own Echo) x (+3/+2), gilded x2. The contract pinned here is the one that matters: what the card SAYS equals
 * what the Echo PAYS, at several tally values, in the Shop (the real reducer, Ossuary Rite proc'ing a living
 * Grim) and in combat (the real simulator, the tally the UI folds in = the run tally + the fight's Echoes
 * replayed before Grim's own). See R-ECHOTALLY-01.
 */
import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from '@game/sim';
import { echoTallyText } from './cardText';
import { instView, liveCardText } from './instView';

/** The live "+X/+Y" a Grim text prints (green `{{…}}` marker), as numbers. */
const printed = (text: string): [number, number] => {
  const m = /\{\{\+(\d+)\/\+(\d+)\}\}/.exec(text);
  if (!m) throw new Error(`no live total in: ${text}`);
  return [Number(m[1]), Number(m[2])];
};
const bag = (tally: number, golden = false) =>
  ({ tier: 6, golden, spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0, spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: tally, undeadBuyAtk: 0, soulsmanGold: 0 });

describe('Grim text: the live total in place (owner ruling 2026-09-25)', () => {
  it('prints (tally + 1) x (+3/+2) in the owner-picked format', () => {
    expect(liveCardText('grim', bag(0)).text).toBe('**Echo:** Give your **Beast Aura** **{{+3/+2}}**. Improves by **+3/+2** for every **Echo** triggered this game.');
    expect(liveCardText('grim', bag(4)).text).toBe('**Echo:** Give your **Beast Aura** **{{+15/+10}}**. Improves by **+3/+2** for every **Echo** triggered this game.'); // the owner's example
    expect(liveCardText('grim', bag(9)).text).toBe('**Echo:** Give your **Beast Aura** **{{+30/+20}}**. Improves by **+3/+2** for every **Echo** triggered this game.');
  });

  it('GILDED doubles the per-Echo value (+6/+4 each), on the golden variant', () => {
    expect(liveCardText('grim', bag(4, true)).goldenText).toBe('**Echo:** Give your **Beast Aura** **{{+30/+20}}**. Improves by **+6/+4** for every **Echo** triggered this game.');
    expect(liveCardText('grim', bag(0, true)).goldenText).toBe('**Echo:** Give your **Beast Aura** **{{+6/+4}}**. Improves by **+6/+4** for every **Echo** triggered this game.');
  });

  it('an ENEMY Grim prints its frozen snapshot tally with no self bump (the simulator never bumps it mid-fight)', () => {
    expect(echoTallyText('grim', 4, false, false)).toBe('**Echo:** Give your **Beast Aura** **{{+12/+8}}**. Improves by **+3/+2** for every **Echo** triggered this game.');
  });

  it('the printed card text (Compendium, Doc Bot) is the same sentence at its base value (0 Echoes so far)', () => {
    expect(CARD_INDEX['grim']!.text).toBe('**Echo:** Give your **Beast Aura** **+3/+2**. Improves by **+3/+2** for every **Echo** triggered this game.');
    expect(CARD_INDEX['grim']!.goldenText).toBe('**Echo:** Give your **Beast Aura** **+6/+4**. Improves by **+6/+4** for every **Echo** triggered this game.');
    expect(liveCardText('grim', bag(0)).text.replace(/\{\{|\}\}/g, '')).toBe(CARD_INDEX['grim']!.text);
  });

  it('is null for every non-tally card', () => {
    expect(echoTallyText('alley', 5)).toBeNull();
    expect(echoTallyText('b2_wolvie', 5)).toBeNull();
  });
});

const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as BoardCard;
};

describe('Grim text == Grim payout, SHOP (Ossuary Rite procs a living Grim through the real reducer)', () => {
  for (const tally of [0, 2, 4, 9]) {
    for (const golden of [false, true]) {
      it(`tally ${tally}${golden ? ', gilded' : ''}`, () => {
        const grim = bc('g', 'grim', { golden });
        const ally = bc('a', 'alley', { health: 50 });
        let s: RunState = {
          ...createRun(1), tier: 6, phase: 'recruit', embers: 30, deathrattlesTriggered: tally,
          board: [grim, ally], hand: [bc('or', 'ossuaryrite')],
        } as RunState;
        // What the board card says right now (the same instView the recruit board renders).
        const view = instView(grim, s.tier, undefined, 0, 0, 0, s.deathrattlesTriggered);
        const said = printed(golden ? view.goldenText! : view.text);
        s = reduce(s, { type: 'play', uid: 'or', targetUid: 'g' });
        const a = s.board.find((c) => c.uid === 'a')!;
        expect([a.attack - ally.attack, a.health - ally.health]).toEqual(said);
        expect(s.deathrattlesTriggered, 'the proc ticked the run tally').toBe(tally + 1);
      });
    }
  }
});

describe('Grim text == Grim payout, COMBAT (the tally the UI folds in, ticking as Echoes fire)', () => {
  const bm = (cardId: string, attack: number, health: number, golden = false): BoardMinion =>
    ({ cardId, attack, health, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], golden });
  const buffs = (events: CombatEvent[]) => events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff');

  for (const tally of [0, 2, 4, 9]) {
    for (const golden of [false, true]) {
      it(`run tally ${tally}${golden ? ', gilded' : ''}: an earlier Echo this fight ticks the text before Grim fires`, () => {
        // T-Rex dies first (one Echo this fight), then Grim (its own) — the owner-batch scenario.
        const r = simulate(
          [bm('b2_trex', 1, 1), bm('grim', 1, 1, golden), bm('alley', 1, 900)],
          [{ cardId: 'sandbag', attack: 1, health: 900, keywords: [] }],
          makeRng(3), CARD_INDEX, combatSide({ tier: 6, tribes: ['beast', 'dragon'], deathrattles: tally }), combatSide({ tier: 1 }),
        );
        const grimUid = r.initial.player.find((m) => m.cardId === 'grim')!.uid;
        const allyUid = r.initial.player.find((m) => m.cardId === 'alley')!.uid;
        const paid = buffs(r.events).filter((b) => b.source === grimUid && b.target === allyUid);
        expect(paid).toHaveLength(1);
        // What a LIVING Grim reads on its last beat: the replay's Echo count up to (not including) the step it dies
        // on (Unit.tsx reads `combatQuestDelta.deathrattle`, which counts `playerQuestEvents` up to the current
        // step). Its own Echo is bumped on its death step, so the +1 the text adds is exactly that bump.
        const deathStep = r.events.find((e) => e.type === 'death' && e.target === grimUid)!.step!;
        const replayed = (r.playerQuestEvents ?? []).filter((q) => q.kind === 'deathrattle' && q.step < deathStep).length;
        expect(replayed, 'T-Rex\'s Echo landed first').toBe(1);
        const said = printed(liveCardText('grim', bag(tally + replayed, golden))[golden ? 'goldenText' : 'text']!);
        expect([paid[0]!.attack, paid[0]!.health]).toEqual(said);
      });
    }
  }
});
