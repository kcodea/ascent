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
 *   2. MARKER — the owner-authored `choose-one-both` loop rides qualifying cards through the
 *      `data-choose-both` hook, and RETIRES cleanly (a looping player never stops on its own).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
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

/** The three live (Both) sources, each as {run flags, instance, card}. */
const SOURCES = [
  { what: 'a golden Orivax (chooseBothWhenGolden)', id: 'd2_orivax', run: {} as Partial<RunState>, golden: true },
  { what: "Facetwright's Choice under its rune", id: 'facetwright', run: { runeFacetwright: true } as Partial<RunState>, golden: false },
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
    const s = SOURCES[0]!; // a golden Orivax is the one (Both) source that reaches the board as a body
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

/* ─────────────────────────────────────────── the marker FX ──────────────────────────────────────────────── */

const disposers: (() => void)[] = [];
let plays: string[] = [];
vi.mock('./fx/playDef', () => ({
  playDef: (id: string) => {
    plays.push(id);
    const d = vi.fn();
    disposers.push(d);
    return d;
  },
}));

describe('(Both) — the looping marker', () => {
  beforeEach(() => { plays = []; disposers.length = 0; });

  /** A mounted card element carrying the `data-choose-both` hook the marker binds to. */
  const stubCard = (key: string): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'card';
    el.setAttribute('data-choose-both', key);
    el.getBoundingClientRect = () => ({ left: 10, top: 10, width: 100, height: 140, right: 110, bottom: 150, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(el);
    return el;
  };

  it('mounts one loop per qualifying card, and none for a card with no hook', async () => {
    const { useChooseBothFx } = await import('./useChooseBothFx');
    stubCard('a'); stubCard('b');
    const Harness = ({ keys }: { keys: string[] }): null => { useChooseBothFx(keys); return null; };
    const h = mount(<Harness keys={['a', 'b']} />);
    expect(plays).toEqual(['choose-one-both', 'choose-one-both']);
    // A key with no card in the DOM starts nothing — no orphan player.
    plays = [];
    h.render(<Harness keys={['a', 'b', 'ghost']} />);
    expect(plays).toEqual([]);
    h.unmount();
  });

  it('retires the loop the moment the card stops qualifying — no leaked player', async () => {
    const { useChooseBothFx } = await import('./useChooseBothFx');
    stubCard('a'); stubCard('b');
    const Harness = ({ keys }: { keys: string[] }): null => { useChooseBothFx(keys); return null; };
    const h = mount(<Harness keys={['a', 'b']} />);
    const [da, db] = disposers;
    h.render(<Harness keys={['a']} />); // 'b' un-qualified (rune sold, card played, predicate flipped)
    expect(db, 'the dropped card must be retired').toHaveBeenCalledTimes(1);
    expect(da, 'the surviving card keeps looping').not.toHaveBeenCalled();
    h.unmount();
    expect(da, 'unmount tears the rest down').toHaveBeenCalledTimes(1);
  });

  it('an empty list (combat, a covering overlay) is the PAUSE — every loop is torn down', async () => {
    const { useChooseBothFx } = await import('./useChooseBothFx');
    stubCard('a');
    const Harness = ({ keys }: { keys: string[] }): null => { useChooseBothFx(keys); return null; };
    const h = mount(<Harness keys={['a']} />);
    h.render(<Harness keys={[]} />);
    expect(disposers[0]).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it('caps how many loops can run at once, however many cards qualify', async () => {
    const { useChooseBothFx, CHOOSE_BOTH_FX_CAP } = await import('./useChooseBothFx');
    const keys = Array.from({ length: CHOOSE_BOTH_FX_CAP + 3 }, (_, i) => `k${i}`);
    for (const k of keys) stubCard(k);
    const Harness = (): null => { useChooseBothFx(keys); return null; };
    const h = mount(<Harness />);
    expect(plays).toHaveLength(CHOOSE_BOTH_FX_CAP);
    h.unmount();
  });

  it('is a MARKER only — playing the card never fires it (no play-moment binding exists)', async () => {
    // The owner will author a resolution effect separately. The guard is structural: nothing outside the
    // marker hook may call the def, so the FX cannot start riding a beat by accident.
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
    const callers = files.filter((f) => readFileSync(f, 'utf8').includes("'choose-one-both'") || readFileSync(f, 'utf8').includes('"choose-one-both"'));
    expect(callers.map((f) => f.split(/[\\/]/).pop()).sort(), 'only the marker hook (and the FX call-site registry) may name the def')
      .toEqual(['directCalls.ts', 'useChooseBothFx.ts']);
  });
});
