// @vitest-environment jsdom
/**
 * A CARD THAT LEFT (owner 2026-10-11: "lets grey out the card and say 'missing or removed'"). A guide keeps a card
 * that was archived out of the set, or that no longer exists: its portrait stays in the row, greyed, labelled, with
 * no hover preview, and its name in the write-up is plain text.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CARD_INDEX, SETS, poolFor } from '@game/content';
import { mount, type Mounted } from '../renderedText.mount';
import { CompendiumGuides } from './CompendiumGuides';
import { GUIDES, type Guide } from './guides';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const inSet2 = new Set(poolFor('set2').all.map((c) => c.id));
/** A real minion with a definition that is NOT in set 2: what an archived card looks like to a guide. */
const archived = Object.values(CARD_INDEX).find((c) => !inSet2.has(c.id) && !c.spell && !c.token)!;
const present = CARD_INDEX['b2_sunmane']!;

const guide: Guide = {
  ...GUIDES[0]!,
  id: 'test-missing',
  body: `Play ${present.name} with ${archived.name}.`,
  core: [present.id, archived.id],
  enablers: ['card_that_never_existed'],
  mentions: undefined,
  aliases: undefined,
};

const render = (): HTMLElement => {
  ui = mount(<CompendiumGuides guides={[guide]} tribes={SETS.set2.tribes} run={undefined} setId="set2" />);
  return ui.container;
};

describe('missing or removed cards in a guide', () => {
  it('an archived card keeps its slot, greyed and labelled; a card that no longer exists gets a blank slot', () => {
    const c = render();
    const units = [...c.querySelectorAll('.lobbyguide-unit')];
    expect(units).toHaveLength(3);
    const missing = units.filter((u) => u.classList.contains('missing'));
    expect(missing).toHaveLength(2);
    expect(missing.every((u) => u.textContent?.includes('Missing or removed'))).toBe(true);
    expect(missing[0]!.getAttribute('aria-label')).toBe(`${archived.name}: missing or removed`);
    expect(missing[0]!.querySelector('.lobbyguide-unitscale')).not.toBeNull(); // the greyed art
    expect(missing[1]!.getAttribute('aria-label')).toBe('Missing or removed card');
    expect(missing[1]!.querySelector('.lobbyguide-blank')).not.toBeNull();
    expect(missing[1]!.querySelector('.lobbyguide-unitscale')).toBeNull();
  });
  it('a card that is still in the set is untouched', () => {
    const c = render();
    const ok = [...c.querySelectorAll('.lobbyguide-unit')].filter((u) => !u.classList.contains('missing'));
    expect(ok).toHaveLength(1);
    expect(ok[0]!.textContent).not.toContain('Missing or removed');
  });
  it('the write-up links the present card\'s name and leaves the missing card\'s name as plain text', () => {
    const c = render();
    const links = [...c.querySelectorAll('.lobbyguide-text .lobbyguide-name')].map((n) => n.textContent);
    expect(links).toEqual([present.name]);
    expect(c.querySelector('.lobbyguide-text')!.textContent).toContain(archived.name);
  });
  it('a nickname for the present card links, and a nickname for the missing card stays plain text', () => {
    const presentNick = 'zzpresentnick';
    const missingNick = 'zzmissingnick';
    const aliased: Guide = {
      ...guide,
      body: `Lead with ${presentNick}, then ${missingNick}.`,
      aliases: { [presentNick]: present.id, [missingNick]: archived.id },
    };
    ui = mount(<CompendiumGuides guides={[aliased]} tribes={SETS.set2.tribes} run={undefined} setId="set2" />);
    const c = ui.container;
    const links = [...c.querySelectorAll('.lobbyguide-text .lobbyguide-name')].map((n) => n.textContent);
    expect(links).toEqual([presentNick]);
    expect(c.querySelector('.lobbyguide-text')!.textContent).toContain(missingNick);
  });
  it('an id that every plain object answers to ("constructor", "__proto__") is a blank missing slot, never a crash', () => {
    // CARD_INDEX is a plain object, so these two resolve to Object's own members unless the lookup asks for an OWN key.
    const hostile: Guide = { ...guide, id: 'test-proto', body: `Play ${present.name}.`, iconCard: 'constructor', core: [present.id, 'constructor'], enablers: ['__proto__'] };
    expect(() => {
      ui = mount(<CompendiumGuides guides={[hostile]} tribes={SETS.set2.tribes} run={undefined} setId="set2" />);
    }).not.toThrow();
    const c = ui!.container;
    const units = [...c.querySelectorAll('.lobbyguide-unit')];
    expect(units).toHaveLength(3);
    expect(units[0]!.classList.contains('missing')).toBe(false);
    for (const u of units.slice(1)) {
      expect(u.classList.contains('missing')).toBe(true);
      expect(u.getAttribute('aria-label')).toBe('Missing or removed card');
      expect(u.querySelector('.lobbyguide-blank')).not.toBeNull();
      expect(u.querySelector('.lobbyguide-unitscale')).toBeNull();
    }
    // The emblem never hands the art pipe anything but a URL: no art for an id that is not a card.
    expect(c.querySelector('.lobbyguide-art')!.getAttribute('src')).toBeNull();
  });
  it('carries no native tooltip', () => {
    const c = render();
    expect(c.querySelector('[title]')).toBeNull();
  });
});
