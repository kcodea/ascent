/**
 * @vitest-environment jsdom
 *
 * R-RAIL-SCOUT-SHOWCASE-01: the Docked rail's scout card opens in the hero showcase's language: the hero's portrait, the
 * player's name, Health / Armor pills, the hero power (its disc cracked open with the seat's picked Ancient, the same
 * settled split the player's own button shows), the power's name, fact pills (Passive for a passive power), its text,
 * and the Ancient's name + pairing text. The old card's lower half (chips, runes, fights) is kept as children. The combat
 * foe's power icon wears the same split when its board carries an Ancient (R-COMBAT-FOE-ANCIENT-ICON-01).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ANCIENTS, HEROES, ancientOfferText, getHero } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';
import { RailScoutShowcase } from './RailScoutShowcase';

const plain = (md: string): string => md.replace(/\*\*/g, '');
const passive = HEROES.find((h) => h.power.passive)!;
const active = HEROES.find((h) => !h.power.passive)!;

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
const q = (sel: string): Element | null => ui!.container.querySelector(sel);

describe('the rail scout card, hero showcase top (R-RAIL-SCOUT-SHOWCASE-01)', () => {
  it('a seat with an Ancient: name, vitals, the split power disc, the power, Passive pill and the Ancient line', () => {
    ui = mount(
      <RailScoutShowcase name="Rooks" heroId={passive.id} portrait="/hero.webp" hp={{ alive: true, resolve: 21, armor: 4 }} ancient={{ id: 'fortune', heroId: passive.id }}>
        <div className="kept">chips</div>
      </RailScoutShowcase>,
    );
    expect(q('.rsc-name')?.textContent).toBe('Rooks');
    expect(q('.rsc-hero')?.textContent).toBe(getHero(passive.id).name);
    expect(q('.rsc-stat.is-hp b')?.textContent).toBe('21');
    expect(q('.rsc-stat.is-armor b')?.textContent).toBe('4');
    expect(q('.rsc-art img')?.getAttribute('src')).toBe('/hero.webp');
    expect(q('.heropowerbtn.rsc-disc .anc-split')).not.toBeNull();
    expect(q('.rsc-pwname')?.textContent).toBe(passive.power.name);
    expect([...ui.container.querySelectorAll('.rsc-fact')].map((e) => e.textContent)).toContain('Passive');
    expect(q('.rsc-pwtext')?.textContent).toBe(plain(passive.power.text));
    expect(q('.rsc-anc .foe-ancient-name')?.textContent).toBe(ANCIENTS.fortune.name);
    expect(q('.rsc-anc .foe-ancient-rule')?.textContent).toBe(plain(ancientOfferText(passive.id, 'fortune')));
    expect(q('.rsc-rest .kept')?.textContent).toBe('chips');
    expect(ui.container.querySelector('[title]')).toBeNull();
  });

  it('no Ancient: the plain disc, no Ancient line; an active power has no Passive pill; a fallen seat has no vitals', () => {
    ui = mount(<RailScoutShowcase name="Lemon" heroId={active.id} portrait="/hero.webp" hp={{ alive: false, resolve: 0, armor: 0 }} ancient={undefined} />);
    expect(q('.heropowerbtn.rsc-disc')).not.toBeNull();
    expect(q('.anc-split')).toBeNull();
    expect(q('.rsc-anc')).toBeNull();
    expect([...ui.container.querySelectorAll('.rsc-fact')].map((e) => e.textContent)).not.toContain('Passive');
    expect(q('.rsc-vitals')).toBeNull();
  });

  it('an unknown Ancient id from another build reads as no Ancient', () => {
    ui = mount(<RailScoutShowcase name="X" heroId={active.id} portrait={undefined} ancient={{ id: 'nope' as never, heroId: active.id }} />);
    expect(q('.anc-split')).toBeNull();
    expect(q('.rsc-anc')).toBeNull();
    expect(q('.rsc-art')).toBeNull();
  });

  it('the combat foe power icon renders the settled split when its board carries an Ancient', () => {
    const src = readFileSync(join(__dirname, 'CombatOpponent.tsx'), 'utf8');
    expect(src).toMatch(/className="heropowerbtn opp-power passive">[\s\S]*?\{foeAncient && <AncientSplitStatic id=\{foeAncient\.id\} \/>\}/);
  });
});
