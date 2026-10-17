// @vitest-environment jsdom
/**
 * R-RUNE-LIVE-TEXT-01 (owner report 2026-10-16, Rune of the Wild Hunt): "this rune should show the current value in
 * real time." A self-improving rune's printed number is the value it will produce RIGHT NOW, on every surface: the
 * rack badge in the Shop, the same badge mid-fight (ticking with each Beast attack), the Runeforge offer, the foe's
 * badge, and the stored records (match details, Career, Recent Games). The base reads only when nothing has grown.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { RUNE_INDEX } from '@game/content';
import { createRun, reduce, runeLiveStateOfSnapshot, type RunState } from '@game/sim';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('./store');
const { QuestBadges } = await import('./QuestBadges');
const { RuneCard } = await import('./RuneCard');
const { RuneEmblem } = await import('./RuneEmblem');
const { LbRunes } = await import('./LadderBits');
const { liveRuneText } = await import('./runeText');
const { mount } = await import('./renderedText.mount');

const WILD = RUNE_INDEX['rune_wild_hunt']!;
const withRune = (id: string, extra: Partial<RunState> = {}): RunState =>
  ({ ...(reduce({ ...createRun(3), wave: 7, tier: 6, phase: 'recruit', embers: 40, runeforgeOffer: [id] } as RunState, { type: 'buyRune', index: 0 }) as RunState), ...extra });

describe('liveRuneText: the printed number is the current one', () => {
  it('Wild Hunt reads the base at 0 improvements and the improved value after N', () => {
    expect(WILD.text).toBe('When a **Beast** attacks, give it **+2 Attack** and improve this by **2** permanently.');
    expect(liveRuneText(WILD.id, WILD.text, undefined)).toBe(WILD.text);
    expect(liveRuneText(WILD.id, WILD.text, { wildHunt: 2 })).toContain('**+2 Attack**');
    expect(liveRuneText(WILD.id, WILD.text, { wildHunt: 8 })).toBe('When a **Beast** attacks, give it **+8 Attack** and improve this by **2** permanently.');
  });

  it('the other self-improving runes rewrite their printed value in place, and only that one', () => {
    const t = (id: string): string => RUNE_INDEX[id]!.text;
    expect(liveRuneText('rune_packcraft', t('rune_packcraft'), { packcraft: { attack: 8, health: 4 } })).toContain('give it **+8/+4** and improve this');
    expect(liveRuneText('rune_beastial_swarm', t('rune_beastial_swarm'), { beastialSwarm: 6 })).toContain('Beasts **+6/+6**');
    expect(liveRuneText('rune_seasoned_ledger', t('rune_seasoned_ledger'), { seasonedLedger: { attack: 3, health: 3 } }))
      .toBe('Whenever you play a minion, give it **+3/+3**. Improves by **+1/+1** after every **5** minions played.');
    expect(liveRuneText('rune_compounding_wages', t('rune_compounding_wages'), { compoundingWages: { attack: 6, health: 6 } }))
      .toBe('Every **10 Gold** spent, give your **Dwarves +6/+6** and improve this by **+2/+2**.');
    expect(liveRuneText('rune_wheel', t('rune_wheel'), { wheel: { attack: 6, health: 6 } })).toContain('have **+6/+6**');
    expect(liveRuneText('rune_baller', t('rune_baller'), { baller: { amount: 3, stat: 'Health' } })).toContain('give your minions **+3 Health**');
  });
});

describe('every surface prints the live value', () => {
  const m = mount(null);
  afterAll(() => m.unmount());
  const tip = (): string => m.container.querySelector('.questbadge-tip-reward')?.textContent ?? '';
  beforeEach(() => { act(() => useGame.setState({ combatPlayerRuneProgress: null, combatEnemyRuneProgress: null })); });

  it('the Shop rack badge: base, then the run\'s grown value', () => {
    act(() => useGame.setState({ run: withRune('rune_wild_hunt') }));
    m.render(<QuestBadges />);
    expect(tip()).toContain('give it +2 Attack');
    act(() => useGame.setState({ run: { ...useGame.getState().run, runeWildHuntGrown: 6 } }));
    expect(tip()).toContain('give it +8 Attack');
  });

  it('mid-fight the tooltip ticks +2 per Beast attack replayed, and settle carries it back without double counting', () => {
    act(() => useGame.setState({ run: { ...withRune('rune_wild_hunt'), runeWildHuntGrown: 4, phase: 'combat' } as RunState }));
    m.render(<QuestBadges />);
    expect(tip()).toContain('+6 Attack');
    act(() => useGame.getState().setCombatRuneProgress({ triggers: { runeWildHunt: 1 }, deaths: 0 }, null));
    expect(tip()).toContain('+8 Attack');
    act(() => useGame.getState().setCombatRuneProgress({ triggers: { runeWildHunt: 3 }, deaths: 0 }, null));
    expect(tip()).toContain('+12 Attack');
    // Settle: the run banks 4 + 3×2 = 10 and the live progress clears in the same moment (Recruit's bridge).
    act(() => {
      useGame.setState({ run: { ...useGame.getState().run, runeWildHuntGrown: 10, combatSettled: true } });
      useGame.getState().setCombatRuneProgress(null, null);
    });
    expect(tip()).toContain('+12 Attack');
  });

  it('the Runeforge offer prints the grown value when the run has already grown it, the base when not', () => {
    act(() => useGame.setState({ run: createRun(3, 'runesmith') }));
    m.render(<RuneCard rune={WILD} affordable onBuy={() => {}} />);
    expect(m.container.querySelector('.runecard-txt')?.textContent).toContain('+2 Attack');
    act(() => useGame.setState({ run: { ...withRune('rune_wild_hunt'), runeWildHuntGrown: 14 } as RunState }));
    expect(m.container.querySelector('.runecard-txt')?.textContent).toContain('+16 Attack');
  });

  it('stored records (Career / match details emblem, Recent Games) print the run\'s final value', () => {
    const live = runeLiveStateOfSnapshot({ wildHuntGrown: 20, questMods: { runeWildHunt: 2 } });
    expect(live.wildHunt).toBe(22);
    m.render(<LbRunes runes={['rune_wild_hunt']} live={live} />);
    expect(m.container.querySelector('.runtrophy-tip-body')?.textContent).toContain('+22 Attack');
    m.render(<LbRunes runes={['rune_wild_hunt']} />);
    expect(m.container.querySelector('.runtrophy-tip-body')?.textContent, 'an older record without the value prints the base').toContain('+2 Attack');
    m.render(<RuneEmblem runeId="rune_wild_hunt" live={live} />);
    expect(m.container.querySelector('.cv2-rune')).not.toBeNull();
  });
});

describe('runeProgress: the replay fold the live text advances by', () => {
  it('counts each side by FLAG up to the replayed step (Epic runes included), plus its friendly deaths', async () => {
    const { runeProgress } = await import('./choreo/triggerCounts');
    const ev = [
      { type: 'questTrigger', flag: 'runeWildHunt', side: 'player', step: 1 },
      { type: 'questTrigger', flag: 'runeWildHunt', side: 'enemy', step: 2 },
      { type: 'questTrigger', flag: 'runeWildHunt', side: 'player', step: 3 },
      { type: 'questTrigger', flag: 'runeWildHunt', side: 'player', step: 9 },
    ] as never[];
    const q = [{ step: 2, kind: 'friendlyDeath' }, { step: 8, kind: 'friendlyDeath' }];
    expect(runeProgress(ev, 3, false, 'player', q)).toEqual({ triggers: { runeWildHunt: 2 }, deaths: 1 });
    expect(runeProgress(ev, 3, false, 'enemy', [])).toEqual({ triggers: { runeWildHunt: 1 }, deaths: 0 });
    expect(runeProgress(ev, 3, true, 'player', q), 'a stale render reports nothing').toBeNull();
  });
});
