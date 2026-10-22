// @vitest-environment jsdom
/**
 * (BOTH) — the rendered contract for a Choose One that will resolve as BOTH branches (owner ruling 2026-08-28).
 *
 * Two halves, and they share ONE predicate (`chooseBothActive` in `@game/sim`) with the reducer's decision to
 * skip the prompt — so the card can never say "Choose One:" about a card that will not ask, nor "(Both)" about
 * one that will:
 *
 *   1. TEXT — the leading label becomes a coloured (Both) and BOTH option texts print after it, on EVERY
 *      render chain: shop offer (minion and spell), hand/board (`instView`), Discover, Compendium and combat
 *      (`Unit`). Swept by mounting the real `Card`, so a marker that stopped styling would fail here.
 *   2. MARKER — a card carrying `chooseBothKey` renders its own silhouette glow (`.bothglow`, remade
 *      2026-10-22), compositor-only, and nothing plays the retired Pixi ring.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { act } from 'react';
import type { Keyword } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { chooseBothActive, createRun, type BoardCard, type RunState } from '@game/sim';
import { Card, type CardView } from './Card';
import { Unit } from './Unit';
import { instView, liveCardText } from './instView';
import { chooseBothText } from './cardText';
import { useGame } from './store';
import { descTextOf, mount, plainOf } from './renderedText.mount';

/** The live (Both) sources, each as {run flags, instance, card}. A golden Orivax (`chooseBothWhenGolden`) was the
 *  third until 2026-10-07, when Orivax became a board aura with no Choose One. */
const SOURCES = [
  { what: "Facetwright under its rune", id: 'facetwright', run: { runeFacetwright: true } as Partial<RunState>, golden: false },
  { what: 'Veinbreaker under the Rune of the Unbroken Vein', id: 'k_veinbreaker', run: { runeUnbrokenVein: true } as Partial<RunState>, golden: false },
] as const;

const runFor = (over: Partial<RunState>): RunState => ({ ...createRun(21, 'drakko'), setId: 'set2', ...over } as RunState);
const instOf = (id: string, golden: boolean): BoardCard => ({
  uid: `u-${id}`, cardId: id, tribe: CARD_INDEX[id]!.tribe,
  attack: CARD_INDEX[id]!.attack, health: CARD_INDEX[id]!.health, keywords: [], golden,
});

describe('(Both) — the printed text', () => {
  it('replaces the "Choose One:" label with a coloured (Both) and prints BOTH branches', () => {
    for (const s of SOURCES) {
      const def = CARD_INDEX[s.id]!;
      const text = chooseBothText(s.id, s.golden)!;
      // `<<…>>` is the TRIBE-coloured marker (owner 2026-08-28), not the green `{{…}}` "modified value" one.
      expect(text, `${s.id}: the (Both) label must be the tribe-coloured marker`).toMatch(/^<<\(Both\)>> /);
      expect(text.toLowerCase(), `${s.id}: no choice is being offered any more`).not.toContain('choose one');
      for (const opt of def.chooseOne!) {
        expect(text, `${s.id}: every branch must print`).toContain(s.golden ? (opt.goldenText ?? opt.text) : opt.text);
      }
    }
  });

  it('is golden-aware — a golden instance reads each branch at its doubled magnitude', () => {
    // Veinbreaker's branches carry explicit goldenText (+2/+2 and 8 Rubies), so plain vs golden must differ.
    const plain = chooseBothText('k_veinbreaker', false)!;
    const gold = chooseBothText('k_veinbreaker', true)!;
    expect(gold).not.toBe(plain);
    expect(gold).toContain(CARD_INDEX['k_veinbreaker']!.chooseOne![0]!.goldenText!);
  });

  it('is null for a card with no Choose One at all', () => {
    expect(chooseBothText('alley', false)).toBeNull();
  });

  it('the shared live-text chain returns it — and only when the predicate says so', () => {
    const base = { tier: 6, golden: false, spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0, spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0, undeadBuyAtk: 0, soulsmanGold: 0 };
    expect(liveCardText('facetwright', { ...base, chooseBoth: true }).text).toBe(chooseBothText('facetwright', false));
    expect(liveCardText('facetwright', base).text).not.toContain('(Both)');
  });

  it('a SPELL Choose One under (Both) prints each branch with spell power folded, never the authored base', () => {
    // Crest of the Climb in hand off a forked charge, under +0/+1 spell power: the cast lands BOTH branches
    // through the folding factories (+4/+1 then +5 Health, 6/11 on a 2/5), so the (Both) text must say so on the
    // hand / shop / hover card, exactly as the Choose One window would (review finding 2026-09-22, bug 23c340fb).
    const base = { tier: 6, golden: false, spellBonus: 0, spellBonusH: 1, frontToBackBonus: 0, spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0, undeadBuyAtk: 0, soulsmanGold: 0 };
    const t = liveCardText('crestclimb', { ...base, chooseBoth: true }).text;
    expect(t).toMatch(/^<<\(Both\)>> /);
    expect(t).toContain('{{+4/+1}}');
    expect(t).toContain('{{+5 Health}}');
    expect(t).not.toContain('+4 Health');
    expect(t).toBe(chooseBothText('crestclimb', false, 0, 1));
    // At zero power the authored branches print verbatim, and a minion Choose One never folds spell power.
    expect(chooseBothText('crestclimb', false, 0, 0)).toBe(chooseBothText('crestclimb', false));
    expect(chooseBothText('k_veinbreaker', false, 2, 3)).toBe(chooseBothText('k_veinbreaker', false));
  });

  it('a body that ALREADY resolved one branch keeps printing that branch, even once a rune arrives', () => {
    // Ordering guard: `chosenOption` wins over `chooseBoth`. A Veinbreaker played before the rune was forged
    // only ever did the branch it picked — printing (Both) on it would be a lie about that body.
    const base = { tier: 6, golden: false, spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0, spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0, undeadBuyAtk: 0, soulsmanGold: 0 };
    const t = liveCardText('k_veinbreaker', { ...base, chooseBoth: true, chosenOption: 0 }).text;
    expect(t).toBe(CARD_INDEX['k_veinbreaker']!.chooseOne![0]!.text);
  });
});

describe('(Both) — every render chain agrees', () => {
  const m = mount(<div />);
  afterEach(() => { m.render(<div />); });

  const viewOf = (id: string, golden: boolean, text: string): CardView => {
    const def = CARD_INDEX[id]!;
    return {
      name: def.name, cardId: id, tribe: def.tribe, tribe2: def.tribe2,
      attack: def.attack, health: def.health, keywords: def.keywords as Keyword[],
      golden, text, tier: def.tier, spell: !!def.spell,
    };
  };

  it("the DOM renders the (Both) string, with the label styled in the card's TRIBE colour", () => {
    for (const s of SOURCES) {
      const text = chooseBothText(s.id, s.golden)!;
      m.render(<Card card={viewOf(s.id, s.golden, text)} forceFull />);
      expect(descTextOf(m.container), `${s.id}: the DOM must show the helper string`).toBe(plainOf(text));
      const tinted = [...m.container.querySelectorAll('.desc .descboth')].map((el) => el.textContent);
      expect(tinted, `${s.id}: (Both) must render as a tribe-coloured span`).toContain('(Both)');
    }
  });

  it('HAND / board chain (instView) prints it for a card still waiting to be played', () => {
    for (const s of SOURCES) {
      const run = runFor(s.run);
      const view = instView(
        instOf(s.id, s.golden), run.tier, undefined, 0, 0, 0, 0, 0, 0, 0, run.wave, 0, undefined, undefined,
        { chooseBothState: { runeFacetwright: run.runeFacetwright, runeUnbrokenVein: run.runeUnbrokenVein } },
      );
      expect(view.text, `${s.id} in hand`).toBe(chooseBothText(s.id, s.golden));
    }
  });

  it('COMBAT chain (Unit) prints the same string as the hand chain', () => {
    const s = SOURCES[0]!; // Facetwright under its rune, on the board as a body
    const run = runFor(s.run);
    const inst = instOf(s.id, s.golden);
    const def = CARD_INDEX[s.id]!;
    act(() => { useGame.setState({ run, compactCards: false }); });
    m.render(<Unit u={{
      uid: inst.uid, cardId: s.id, name: def.name, tribe: def.tribe, attack: def.attack, health: def.health,
      keywords: [] as Keyword[], divineShield: false, alive: true, golden: s.golden, summonBonus: 0,
      baseAttack: def.attack, baseHealth: def.health,
    }} side="you" />);
    expect(descTextOf(m.container)).toBe(plainOf(chooseBothText(s.id, s.golden)!));
  });

  it('a card the run does NOT make do both still reads as a Choose One everywhere', () => {
    const run = runFor({}); // no runes, not golden
    expect(chooseBothActive(run, instOf('facetwright', false), CARD_INDEX['facetwright'])).toBe(false);
    const view = instView(
      instOf('facetwright', false), run.tier, undefined, 0, 0, 0, 0, 0, 0, 0, run.wave, 0, undefined, undefined,
      { chooseBothState: {} },
    );
    expect(view.text).not.toContain('(Both)');
    expect(view.chooseBothKey, 'no marker either').toBeUndefined();
  });
});

/* ─────────────────────────────────────────── the marker ──────────────────────────────────────────────── */

/**
 * (BOTH) MARKER, remade 2026-10-22 (owner: "it's really sloppy right now"). The old marker was a looping Pixi ring
 * (`choose-one-both`, ~215 blurred particles per card on a 230 px circle) followed by rect every frame and capped at
 * four cards. It is now a glow on the card's OWN silhouette, rendered by `Card` itself whenever the card carries a
 * `chooseBothKey`: no particles, no per-frame layout read, no cap, and it can never be on a card that is not (Both).
 */
describe('(Both) — the silhouette marker', () => {
  const m = mount(<div />);
  afterEach(() => m.render(<div />));
  const def = CARD_INDEX['k_veinbreaker']!;
  const view = (over: Partial<CardView> = {}): CardView => ({
    name: def.name, cardId: def.id, tribe: def.tribe, attack: def.attack, health: def.health,
    keywords: [] as Keyword[], golden: false, text: chooseBothText(def.id, false)!, tier: def.tier, ...over,
  });

  it('a (Both) card renders its marker layer; a card without the key renders none', () => {
    m.render(<Card card={view({ chooseBothKey: 'u-1' })} forceFull />);
    const root = m.container.querySelector('.card') as HTMLElement;
    expect(root.dataset.chooseBoth).toBe('u-1');
    expect(m.container.querySelectorAll('.bothglow').length, 'the marker rides the card itself').toBeGreaterThan(0);
    m.render(<Card card={view()} forceFull />);
    expect(m.container.querySelectorAll('.bothglow')).toHaveLength(0);
  });

  it('the marker sits BEHIND the art and is never a hover target', () => {
    m.render(<Card card={view({ chooseBothKey: 'u-1' })} forceFull />);
    for (const el of m.container.querySelectorAll('.bothglow')) {
      expect(el.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('every marker layer animates only compositor properties, the loop is opacity only, and reduced motion stills it', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'styles.css'), 'utf8');
    const frames = (name: string): string => {
      const at = css.indexOf(`@keyframes ${name} {`);
      expect(at, `@keyframes ${name} exists`).toBeGreaterThan(-1);
      let depth = 0; let i = css.indexOf('{', at);
      const start = i;
      for (; i < css.length; i++) { if (css[i] === '{') depth++; else if (css[i] === '}' && --depth === 0) break; }
      return css.slice(start, i + 1);
    };
    const props = (block: string): string[] => [...block.matchAll(/([a-z-]+)\s*:/g)].map((x) => x[1]!);
    for (const name of ['bothin', 'bothin-plate']) {
      expect(props(frames(name)).every((p) => ['opacity', 'scale', 'transform'].includes(p)), `${name}: transform/opacity only`).toBe(true);
    }
    expect([...new Set(props(frames('bothbreathe')))], 'the LOOP touches opacity and nothing else').toEqual(['opacity']);
    // Reduced motion: the glow HOLDS (a still, opacity-only fill) with no arrival and no breathing.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\.card \.bothglow[^{]*\{ animation: bothstill 0s both; \}/);
    expect([...new Set(props(frames('bothstill')))]).toEqual(['opacity']);
  });

  it('nothing plays the retired Pixi ring any more: one cue, no second marker on top of the glow', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = dirname(fileURLToPath(import.meta.url));
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { if (name !== 'node_modules' && name !== 'defs') walk(full); }
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(full);
      }
    };
    walk(root);
    const callers = files.filter((f) => /['"]choose-one-both['"]/.test(readFileSync(f, 'utf8')));
    expect(callers.map((f) => f.split(/[\/]/).pop())).toEqual([]);
  });
});
