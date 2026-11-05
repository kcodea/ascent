import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { rulesHtml } from './Card';

// R-TEXT-SPELL-BUFF-BLUE-01 (owner 2026-11-05: "can we make all spell buff number text the same light blue color we
// use for the "Shop Spell" text below? ... and add a very slight glow?"). A bolded stat buff in rules text is tagged
// `.buffnum`, and on a SPELL card that tag paints in the Shop Spell kind-line blue with a slight static glow.

const CSS = readFileSync(join(__dirname, 'styles.css'), 'utf8');

describe('R-TEXT-SPELL-BUFF-BLUE-01: spell buff numbers wear the Shop Spell blue', () => {
  it('tags bolded stat buffs, and only stat buffs', () => {
    expect(rulesHtml(CARD_INDEX.sp_blessing!.text)).toContain('<b class="buffnum">+3/+4</b>');
    expect(rulesHtml('Give a minion **+2 Attack** and **+1 Health**.')).toBe(
      'Give a minion <b class="buffnum">+2 Attack</b> and <b class="buffnum">+1 Health</b>.',
    );
    expect(rulesHtml('Give it **-1/-1**.')).toContain('<b class="buffnum">-1/-1</b>');
    for (const notABuff of ['**2 Gold**', '**3**', '**2 Rubies**', '**Tier 1**', '**Avenge (3):**']) {
      expect(rulesHtml(notABuff)).not.toContain('buffnum');
    }
  });

  it('paints the tag in the Shop Spell blue, with a glow, on spell cards only', () => {
    const shopSpellBlue = /\.spellkind\[data-kind='spell'\][^{]*\{\s*color:\s*(#[0-9a-f]{6})/i.exec(CSS)?.[1];
    expect(shopSpellBlue).toBeTruthy();
    const rule = /\.card\.compact\.showtext\.spellcard \.drawer \.desc b\.buffnum \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(rule).toContain(`color: ${shopSpellBlue}`);
    expect(rule).toMatch(/text-shadow:\s*0 0 /);
  });

  it('paints every other bold word on a spell the same blue, with no glow', () => {
    const rule = /\.card\.compact\.showtext\.spellcard \.drawer \.desc b:not\(\.buffnum\) \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(rule).toMatch(/color:\s*#7cc4ff/);
    expect(rule).toMatch(/text-shadow:\s*none/);
  });

  it('outlines both blues with a 1.5px black stroke behind the fill', () => {
    const rule = /\.card\.compact\.showtext\.spellcard \.drawer \.desc b \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(rule).toMatch(/-webkit-text-stroke:\s*1\.5px #000/);
    expect(rule).toMatch(/paint-order:\s*stroke fill/);
  });
});
