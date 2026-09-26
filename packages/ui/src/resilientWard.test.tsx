// @vitest-environment jsdom
/**
 * RESILIENT WARD (Ancients POC, owner 2026-09-26): the look and the replay.
 *
 *   · A card carrying `RW` (always beside `DS`) wears the Ward shell re-tinted red-and-orange (`.wardglass.resil`)
 *     with a clean orange outline (`.wg-resil-rim`).
 *   · When the Resilient layer's first hit strips `RW` (combat's `wardDowngrade`), the shell reverts to the plain
 *     Ward and ONE clean shatter plays (`.wg-crack`: a rim flare, the outline kicking out, eight sharp slivers), never
 *     on a plain Ward losing nothing.
 *   · The combat frame folds `wardDowngrade` (drop `RW`, keep the Ward) and it rides the Ward-break beat.
 *   · The pill: "Resilient Ward: Takes 2 hits to break."
 *   · No looping animation on a paint property (the perf rule): the only new loops are none.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Keyword } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { Card, type CardView } from './Card';
import { mount } from './renderedText.mount';
import { KEYWORD_GLOSSARY } from './keywordGlossary';
import { momentKind } from './choreo/kinds';
import { RESULT_TYPES } from './combatBeats';

const m = mount(<div />);
afterEach(() => { m.render(<div />); });

const view = (keywords: Keyword[]): CardView => {
  const def = CARD_INDEX.hm_test_squire!;
  return { name: def.name, cardId: def.id, tribe: def.tribe, attack: 3, health: 3, keywords, golden: false, text: def.text ?? '', tier: def.tier, spell: false };
};

describe('Resilient Ward — the shell', () => {
  it('RW wears the red-and-orange shell with its orange outline; a plain Ward does not', () => {
    m.render(<Card card={view(['DS', 'RW'])} />);
    expect(m.container.querySelector('.wardglass.resil')).not.toBeNull();
    expect(m.container.querySelector('.wg-resil-rim')).not.toBeNull();
    m.render(<div />);
    m.render(<Card card={view(['DS'])} />);
    expect(m.container.querySelector('.wardglass')).not.toBeNull();
    expect(m.container.querySelector('.wardglass.resil')).toBeNull();
    expect(m.container.querySelector('.wg-crack')).toBeNull();
  });

  it('losing RW (the downgrade) plays one clean shatter and reveals the plain Ward', () => {
    m.render(<Card card={view(['DS', 'RW'])} />);
    m.render(<Card card={view(['DS'])} />);
    expect(m.container.querySelector('.wardglass')).not.toBeNull();
    expect(m.container.querySelector('.wardglass.resil')).toBeNull();
    const crack = m.container.querySelector('.wg-crack');
    expect(crack).not.toBeNull();
    // Few, sharp shards (owner: "really clean"), a flash and the outline kick; no crack line, no debris.
    expect(crack!.querySelectorAll('.wg-shard').length).toBe(8);
    expect(crack!.querySelector('.wg-flash')).not.toBeNull();
    expect(crack!.querySelector('.wg-burstring')).not.toBeNull();
    expect(crack!.querySelector('.wg-crackline')).toBeNull();
  });
});

describe('Resilient Ward — glossary + choreography', () => {
  it('the pill reads the owner\'s words', () => {
    const e = KEYWORD_GLOSSARY.find((k) => k.badge === 'RW');
    expect(e).toMatchObject({ name: 'Resilient Ward', def: 'Takes 2 hits to break.' });
  });

  it('the downgrade rides the Ward-break beat (same moment kind, a result event that merges into the impact)', () => {
    expect(momentKind({ type: 'wardDowngrade', target: 'x' })).toBe('shieldPop');
    expect(RESULT_TYPES.has('wardDowngrade')).toBe(true);
  });

  it('perf: the new Resilient Ward CSS has no looping animation (one-shots only)', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'styles.css'), 'utf8');
    const block = css.slice(css.indexOf('/* RESILIENT WARD'), css.indexOf('/* Reborn — wispy'));
    expect(block.length).toBeGreaterThan(100);
    expect(block).not.toMatch(/infinite/);
    // The shatter's keyframes move transform + opacity only (their paint is static).
    for (const name of ['wgshardfly', 'wgshardspin', 'wgburstring', 'wgflash']) {
      const body = block.match(new RegExp(`@keyframes ${name} \\{[\\s\\S]*?\\}\\s*\\}`))?.[0] ?? '';
      expect(body, name).toMatch(/transform|opacity/);
      expect(body, name).not.toMatch(/box-shadow|filter|background|border-radius|clip-path/);
    }
  });
});
