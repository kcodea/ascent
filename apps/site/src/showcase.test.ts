// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { initAncients, initRunes } from './ancients';
import { initChests, TIER_FX } from './chests';

const INDEX = resolve(dirname(fileURLToPath(import.meta.url)), '../index.html');
const IDS = ['bonds', 'death', 'fortune', 'genesis', 'time', 'war'];

beforeEach(() => {
  document.documentElement.innerHTML = readFileSync(INDEX, 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
});

const shown = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('[data-ancient-panel]')].filter((p) => !p.hidden).map((p) => p.getAttribute('data-ancient-panel')!);

describe('the Ancients showcase', () => {
  it('has a portrait button and a card for each of the six, with a blurb and an example', () => {
    expect([...document.querySelectorAll('button[data-ancient]')].map((b) => b.getAttribute('data-ancient'))).toEqual(IDS);
    for (const id of IDS) {
      const panel = document.querySelector(`[data-ancient-panel="${id}"]`)!;
      expect(panel.id).toBe(`ancient-${id}`);
      expect(document.querySelector(`[data-ancient="${id}"]`)!.getAttribute('aria-controls')).toBe(panel.id);
      expect(panel.querySelector('.ashow__name')!.textContent).toMatch(/^Ancient of /);
      expect(panel.querySelector('.ashow__blurb')!.textContent!.length).toBeGreaterThan(30);
      expect(panel.querySelector('.ashow__eg-label')!.textContent).toBe('In-game Example');
      expect(panel.querySelector('.ashow__eg-hero')!.getAttribute('src')).toBe('/art/heroes/indy.webp');
      expect(panel.querySelector('.ashow__eg-name')!.textContent).toBe('Indy');
      expect(panel.querySelector('.ashow__eg-text')!.textContent!.length).toBeGreaterThan(20);
    }
  });

  it('shows the first Ancient with no script, and only that one', () => {
    expect(shown()).toEqual(['bonds']);
    expect(document.querySelector('[data-ancient="bonds"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it.each(['mouseenter', 'focus', 'click'])('%s on a portrait brings up its card and marks it chosen', (type) => {
    initAncients(document);
    document.querySelector('[data-ancient="time"]')!.dispatchEvent(new Event(type));
    expect(shown()).toEqual(['time']);
    expect(document.querySelector('[data-ancient-panel="time"]')!.classList.contains('is-on')).toBe(true);
    expect(document.querySelector('[data-ancient-panel="bonds"]')!.classList.contains('is-on')).toBe(false);
    expect([...document.querySelectorAll('[data-ancient][aria-pressed="true"]')].map((b) => b.getAttribute('data-ancient'))).toEqual(['time']);
  });
});

describe('the rune rewards', () => {
  const RUNE_IDS = ['chimerus', 'voidmother', 'bucky', 'portrait', 'yazzus', 'gemsage'];
  const up = (): string[] =>
    [...document.querySelectorAll<HTMLElement>('[data-rune-panel]')].filter((p) => !p.hidden).map((p) => p.getAttribute('data-rune-panel')!);

  it('has a tile and a card for each rune, naming the card it gives', () => {
    expect([...document.querySelectorAll('#runeforge button[data-rune]')].map((t) => t.getAttribute('data-rune'))).toEqual(RUNE_IDS);
    for (const id of RUNE_IDS) {
      const panel = document.querySelector(`#runeforge [data-rune-panel="${id}"]`)!;
      expect(document.querySelector(`[data-rune="${id}"]`)!.getAttribute('aria-controls')).toBe(panel.id);
      expect(document.querySelector(`[data-rune="${id}"] img`)!.getAttribute('src')).toBe(`/art/runes/${id}.webp`);
      expect(panel.querySelector('.ashow__art img')!.getAttribute('src')).toBe(`/art/cards/${id}.webp`);
      expect(panel.querySelector('.ashow__blurb')!.textContent).toMatch(/^Get an? /);
      expect(panel.querySelector('.ashow__eg-label')!.textContent).toBe('Card Reward');
      const card = panel.querySelector('.ashow__eg-name')!.textContent!;
      expect(panel.querySelector('.ashow__blurb')!.textContent).toContain(card);
      expect(panel.querySelector('.ashow__eg-meta')!.textContent).toMatch(/^Tier \d.* · \d+ Attack · \d+ Health$/);
    }
  });

  it('shows the first rune with no script, and browsing runes leaves the Ancients alone', () => {
    expect(up()).toEqual([RUNE_IDS[0]]);
    initAncients(document);
    initRunes(document);
    document.querySelector('[data-rune="yazzus"]')!.dispatchEvent(new Event('mouseenter'));
    expect(up()).toEqual(['yazzus']);
    expect(shown()).toEqual(['bonds']);
    expect([...document.querySelectorAll('[data-rune][aria-pressed="true"]')].map((t) => t.getAttribute('data-rune'))).toEqual(['yazzus']);
  });
});

describe('the chests', () => {
  it('each tier is a button with a body and a lid, and Epic and Ancient redraw the lock point over the lid', () => {
    for (const tier of Object.keys(TIER_FX)) {
      const chest = document.querySelector(`button[data-chest="${tier}"]`)!;
      expect(chest.classList.contains(`t-${tier}`)).toBe(true);
      expect(chest.querySelector('.chestpic__body')!.getAttribute('src')).toBe(`/art/chests/${tier}.webp`);
      expect(chest.querySelector('.chestpic__lid')!.getAttribute('src')).toBe(`/art/chests/${tier}-lid.webp`);
      expect(!!chest.querySelector('.chestpic__spike')).toBe(tier === 'epic' || tier === 'ancient');
    }
  });

  it('a click hops the chest and throws the tier\'s burst', () => {
    initChests(document, { reducedMotion: false, random: () => 0.5 });
    for (const [tier, fx] of Object.entries(TIER_FX)) {
      const chest = document.querySelector<HTMLElement>(`[data-chest="${tier}"]`)!;
      chest.click();
      expect(chest.hasAttribute('data-pop')).toBe(true);
      expect(chest.querySelectorAll('.chest-ring')).toHaveLength(fx.rings);
      expect(chest.querySelectorAll('.chest-spark')).toHaveLength(fx.sparks);
      expect(chest.querySelectorAll('.chest-mote')).toHaveLength(fx.motes);
    }
  });

  it('a burst piece removes itself when its animation ends', () => {
    initChests(document, { reducedMotion: false, random: () => 0.5 });
    const chest = document.querySelector<HTMLElement>('[data-chest="standard"]')!;
    chest.click();
    const ring = chest.querySelector('.chest-ring')!;
    ring.dispatchEvent(new Event('animationend'));
    expect(chest.querySelectorAll('.chest-ring')).toHaveLength(0);
  });

  it('with reduced motion a click does nothing', () => {
    initChests(document, { reducedMotion: true });
    const chest = document.querySelector<HTMLElement>('[data-chest="ancient"]')!;
    chest.click();
    expect(chest.hasAttribute('data-pop')).toBe(false);
    expect(chest.querySelectorAll('[data-burst] > *')).toHaveLength(0);
  });
});
