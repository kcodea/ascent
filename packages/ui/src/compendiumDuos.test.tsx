// @vitest-environment jsdom
/**
 * THE COMPENDIUM'S DUOS TOGGLE (owner ask 2026-10-30, R-COMPENDIUM-DUOS-TOGGLE-01: "add a duos flag next to gilded in
 * compendium to view duos cards in addition to regular"). Off (the default) the book is a regular run's codex: no
 * Duos-only card, Whisper or rune. On, the shown set's Duos pool (`duosPoolFor`) joins the gallery ALONGSIDE the regular
 * cards, the Duos Whispers join Gifts, the Duos runes join the Runes tab, and every Duos-only thing wears a "Duos" tag.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { CARD_INDEX, DUOS_CARDS, RUNES, EPIC_RUNES, SETS, duosPoolFor, poolFor, type SetId } from '@game/content';
import { MinionBook } from './MinionBook';
import { runeRewardCardsFor } from './compendiumRewards';
import { useGame } from './store';
import { mount, type Mounted } from './renderedText.mount';

describe('Compendium Duos toggle', () => {
  let m: Mounted;
  let prev: { showTitle: boolean };
  const click = (el: Element | null | undefined): void => { act(() => { (el as HTMLElement).click(); }); };
  const names = (): string[] => [...m.container.querySelectorAll('.book-grid .book-cell .cn')].map((n) => n.textContent ?? '');
  const tags = (): number => m.container.querySelectorAll('.book-grid .book-cell .book-duos-tag').length;
  const duosBtn = (): HTMLButtonElement => m.container.querySelector('button.book-duos') as HTMLButtonElement;
  const gildedBtn = (): HTMLButtonElement => m.container.querySelector('button.book-gilded:not(.book-duos)') as HTMLButtonElement;
  const cat = (label: string): void => click(m.container.querySelector(`.book-rail .book-cat[aria-label="${label}"]`));
  const pickSet = (id: SetId): void => {
    click(m.container.querySelector('.book-setpick-btn'));
    click([...m.container.querySelectorAll('.book-setpick-opt')].find((o) => o.textContent?.startsWith(SETS[id].name)));
  };
  const nameOf = (id: string): string => CARD_INDEX[id]!.name;

  beforeEach(() => {
    prev = { showTitle: useGame.getState().showTitle };
    useGame.setState({ showTitle: true });
    m = mount(<MinionBook />);
    pickSet('set2');
  });
  afterEach(() => {
    m.unmount();
    useGame.setState(prev);
  });

  it('sits right after Gilded, off by default, with no title tooltip', () => {
    const btn = duosBtn();
    expect(btn).toBeTruthy();
    expect(gildedBtn().nextElementSibling).toBe(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.hasAttribute('title')).toBe(false);
  });

  it('off: the minion gallery is the regular pool, with no Duos card and no tag', () => {
    const shown = names();
    for (const c of DUOS_CARDS) expect(shown, c.name).not.toContain(c.name);
    expect(tags()).toBe(0);
  });

  it('on: the Duos minions of the shown set join the regular ones, each tagged', () => {
    const before = names();
    click(duosBtn());
    expect(duosBtn().getAttribute('aria-pressed')).toBe('true');
    const shown = names();
    for (const n of before) expect(shown, n).toContain(n); // in ADDITION to regular
    const duosMinions = duosPoolFor('set2').buyable.filter((c) => c.duos);
    expect(duosMinions.length).toBeGreaterThan(0);
    for (const c of duosMinions) expect(shown, c.name).toContain(c.name);
    expect(shown).toContain(nameOf('duo_monstrocity')); // the All-type Duos minion joins every set
    expect(tags()).toBe(duosMinions.length);
    expect(shown.length).toBe(before.length + duosMinions.length);
  });

  it('on: the tier chips narrow the Duos cards like any other', () => {
    click(duosBtn());
    click(m.container.querySelector('.book-tier[aria-label="Tier 1"]'));
    const shown = names();
    const t1 = duosPoolFor('set2').buyable.filter((c) => c.duos && c.tier === 1);
    for (const c of t1) expect(shown, c.name).toContain(c.name);
    for (const c of duosPoolFor('set2').buyable.filter((c) => c.duos && c.tier !== 1)) expect(shown, c.name).not.toContain(c.name);
  });

  it('on: a Duos card of a tribe the set lacks never shows (membership is by tribe, like the Duos pool)', () => {
    click(duosBtn());
    const shown = names();
    const regular = new Set(poolFor('set2').all.map((c) => c.id));
    const pool = new Set(duosPoolFor('set2').all.map((c) => c.id));
    for (const c of DUOS_CARDS.filter((c) => !c.token && !c.spell && !pool.has(c.id) && !regular.has(c.id))) expect(shown, c.name).not.toContain(c.name);
  });

  it('Spells: the Duos spells join only with the toggle on', () => {
    cat('Spells');
    const duosSpells = DUOS_CARDS.filter((c) => c.spell && !c.token);
    for (const c of duosSpells) expect(names(), c.name).not.toContain(c.name);
    click(duosBtn());
    for (const c of duosSpells) expect(names(), c.name).toContain(c.name);
  });

  it('Gifts: CueBee\'s Pass Whisper joins only with the toggle on', () => {
    cat('Gifts');
    expect(names()).not.toContain(nameOf('duo_w_pass'));
    click(duosBtn());
    expect(names()).toContain(nameOf('duo_w_pass'));
    expect(tags()).toBe(1);
  });

  it('Runes + Rune Rewards: the Duos runes (and the Megamimic) ride the toggle', () => {
    const duosRunes = [...RUNES, ...EPIC_RUNES].filter((r) => r.duos);
    expect(duosRunes.length).toBeGreaterThan(0);
    expect(runeRewardCardsFor('set2').map((c) => c.id)).not.toContain('duo_megamimic');
    expect(runeRewardCardsFor('set2', true).map((c) => c.id)).toContain('duo_megamimic');
    cat('Runes');
    const runeNames = (): string[] => [...m.container.querySelectorAll('.book-grid.is-runes .runecard-name')].map((n) => n.textContent ?? '');
    for (const r of duosRunes) expect(runeNames(), r.name).not.toContain(r.name);
    expect(duosBtn().disabled).toBe(false); // live on the Runes tab, unlike Gilded
    click(duosBtn());
    for (const r of duosRunes) expect(runeNames(), r.name).toContain(r.name);
    expect(m.container.querySelectorAll('.book-grid.is-runes .book-duos-tag').length).toBe(duosRunes.length);
  });

  it('Gilded + Duos shows the Duos cards in their Gilded form', () => {
    click(duosBtn());
    click(gildedBtn());
    const cell = [...m.container.querySelectorAll('.book-grid .book-cell')].find((el) => el.querySelector('.book-duos-tag'));
    expect(cell).toBeTruthy();
    expect(cell!.querySelector('.card.golden, .golden')).toBeTruthy();
  });
});
