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
    // A LIVE value (`{{…}}`, the green modified-number span) carries its buff un-bolded — Lantern Light's per-Tier
    // total. Its stat token is tagged too, once, inside the span.
    expect(rulesHtml('Give a minion {{+1/+1}}.')).toBe('Give a minion <span class="descup"><b class="buffnum">+1/+1</b></span>.');
    expect(rulesHtml('Give your Beasts {{+3/+3}} and {{2 Gold}}.')).toBe(
      'Give your <b class="term tribe">Beasts</b> <span class="descup"><b class="buffnum">+3/+3</b></span> and <span class="descup">2 Gold</span>.',
    );
    expect(rulesHtml('Give a minion {{**+2/+2**}}.')).toBe('Give a minion <span class="descup"><b class="buffnum">+2/+2</b></span>.');
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

  it('a tagged live buff on a MINION keeps the live green; the spell rule comes after and wins on spells', () => {
    const guard = '.card.compact.showtext .drawer .desc .descup b.buffnum';
    const at = CSS.indexOf(guard);
    expect(at).toBeGreaterThan(-1);
    expect(CSS.slice(at, CSS.indexOf('}', at))).toMatch(/color:\s*inherit/);
    expect(at).toBeLessThan(CSS.indexOf('.card.compact.showtext.spellcard .drawer .desc b.buffnum {'));
  });

  it('paints every other bold word on a spell #0B7AEE, no glow, with a 1.5px black outline behind the fill', () => {
    const rule = /\.card\.compact\.showtext\.spellcard \.drawer \.desc b:not\(\.buffnum\) \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(rule).toMatch(/color:\s*#0b7aee/i);
    expect(rule).toMatch(/text-shadow:\s*none/);
    expect(rule).toMatch(/-webkit-text-stroke:\s*1\.5px #000/);
    expect(rule).toMatch(/paint-order:\s*stroke fill/);
  });

  it('the buffs carry no outline, just the glow', () => {
    for (const r of CSS.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
      const sel = r[1]!;
      if (!/\.spellcard[^,{]*\.desc b(?!:not)/.test(sel)) continue;
      expect(r[2], sel.trim()).not.toMatch(/text-stroke/);
    }
  });
});
