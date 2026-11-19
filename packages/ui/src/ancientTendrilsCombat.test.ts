/**
 * R-FX-ANCIENT-TENDRIL-01, COMBAT half (owner 2026-11-16: "When ancients buff things like that, they should have a tendril
 * animation. Make sure this is wired."). Every Ancient pairing that gives a friendly minion stats in a fight, driven
 * through the real `faceOmen`: each grant it makes must resolve to the hero-power tendril (`heroPowerBuffLabelFor`), or
 * to an authored label def that outranks it (Gorun's Blade Mastery, `gorun-hp`, authored: kept).
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import { reduce, type AncientId, type BoardCard, type RunState } from '@game/sim';
import { body, combatVerdict, foes, pickedRun, type CombatVerdict } from './ancientTendrils.testkit';

type Def = { spell?: boolean; ruby?: boolean; token?: boolean; effects: unknown[]; keywords: unknown[] } | undefined;
const plain = (c: Def): boolean => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && c.id !== 'sandbag').map((c) => c.id);
const N = (i: number): string => NEUTRALS[i % NEUTRALS.length]!;
const ECHO = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && c.keywords.length === 0
  && c.effects.length === 1 && c.effects[0]!.on === 'onDeath' && c.effects[0]!.do === 'deathrattleSummon'
  && !(c.effects[0]!.params as { fixed?: boolean }).fixed)!.id;
const T1 = 'hm_test_squire';
const pup = (uid: string, attack: number, health: number, keywords: BoardCard['keywords'] = []): BoardCard =>
  body(uid, N(uid.charCodeAt(0)), { attack, health, keywords });
/** Patch the run's Ancient block (a count the pairing reads, as the Shop would have left it). */
const anc = (s: RunState, patch: Record<string, unknown>): RunState => ({ ...s, ancients: { ...s.ancients!, ...patch } } as RunState);
const fight = (s: RunState, attack = 0, health = 400, n = 1, extraLabels: string[] = []): CombatVerdict =>
  combatVerdict(s, foes(s.wave, attack, health, n), extraLabels).verdict;
const P = (hero: string, id: AncientId, over: Partial<RunState> = {}): RunState => pickedRun(hero, id, over);
const power = (s: RunState, uid: string): RunState => reduce(s, { type: 'heroPower', uid });

interface Case { pairing: string; run: () => CombatVerdict; authored?: true }

const CASES: Case[] = [
  { pairing: 'indy.war', run: () => fight(P('indy', 'war', { board: [body('g', 'alley', { golden: true, attack: 0, health: 400, keywords: [] }), body('f1', 'alley', { attack: 1, health: 1 }), body('f2', 'alley', { attack: 1, health: 1 })] }), 3, 200) },
  { pairing: 'indy.time', run: () => fight(P('indy', 'time', { board: [body('a', 'sandbag', { health: 50 }), body('r', 'gnash')] }), 0, 5) },
  { pairing: 'warden.bonds', run: () => fight(P('warden', 'bonds', { board: [body('t', 'taragosa', { health: 900, keywords: ['DS'] }), pup('a', 1, 900, ['DS']), pup('b', 1, 900, ['DS'])] })) },
  { pairing: 'warden.time', run: () => fight(P('warden', 'time', { board: [body('t', 'taragosa', { health: 900 }), pup('a', 1, 900, ['DS']), pup('b', 1, 900, ['DS'])] })) },
  { pairing: 'bram.bonds', run: () => fight(P('bram', 'bonds', { board: [body('n', 'n2_spellsword', { attack: 3, health: 40 }), body('w', 'whelpling', { attack: 2, health: 40 })] })) },
  { pairing: 'bram.war', run: () => fight(anc(P('bram', 'war', { board: [pup('a', 1, 50), pup('b', 1, 50)] }), { bramGildedPlays: 2 })) },
  { pairing: 'drakko.bonds', run: () => fight(P('drakko', 'bonds', { board: [body('d', 'drummer', { health: 90 }), body('a', 'alley', { health: 90 }), body('r', 'ryme', { attack: 1, health: 1, keywords: ['T'] })] }), 3, 200) },
  { pairing: 'drakko.war', run: () => fight(P('drakko', 'war', { board: [pup('a', 1, 50), pup('b', 1, 50)], shoutFiresThisTurn: 3 } as Partial<RunState>)) },
  { pairing: 'flint.war', run: () => fight(anc(P('flint', 'war', { board: [body('x', 'dw_edward', { health: 50 }), body('y', 'dw_brakka', { health: 50 })] }), { flintDwarvesBought: 3 })) },
  { pairing: 'gorun.death', run: () => fight(P('gorun', 'death', { board: [pup('a', 10, 1), pup('b', 1, 900)] }), 5, 4000) },
  { pairing: 'gorun.time', authored: true, run: () => fight(P('gorun', 'time', { board: [pup('a', 10, 1), pup('b', 1, 900)] }), 5, 4000, 1, ['Blade Mastery']) },
  { pairing: 'gorun.war', authored: true, run: () => fight(P('gorun', 'war', { board: [pup('a', 1, 900), pup('b', 1, 900), pup('c', 1, 900)] }), 0, 4000, 1, ['Blade Mastery']) },
  { pairing: 'gorun.bonds', run: () => fight(P('gorun', 'bonds', { board: [pup('a', 1, 900), pup('b', 1, 900), pup('c', 1, 900)] }), 0, 4000, 1, ['Blade Mastery']) },
  { pairing: 'midas.bonds', run: () => fight(P('midas', 'bonds', { board: [body('a', 'beatboxer', { golden: true, health: 300 }), body('b', 'dw_edward', { golden: true, health: 300 }), body('t', 'taragosa', { golden: true, health: 900 })] })) },
  { pairing: 'merrin.bonds', run: () => fight(P('merrin', 'bonds', { board: [body('t', 'taragosa', { health: 900 }), body('a', 'beatboxer', { health: 900 }), body('b', 'dw_edward', { health: 900 })] })) },
  { pairing: 'rayse.bonds', run: () => fight(P('rayse', 'bonds', { board: [body('e', ECHO, { attack: 1, health: 1 }), pup('x', 1, 90), pup('y', 1, 90)] }), 100, 5000) },
  { pairing: 'rayse.fortune', run: () => fight(P('rayse', 'fortune', { board: [body('e', ECHO, { attack: 1, health: 1 }), pup('x', 1, 90)], goldSpentThisTurn: 4 } as Partial<RunState>), 100, 5000) },
  { pairing: 'soren.war', run: () => fight(power(P('soren', 'war', { board: [body('a', T1, { health: 40 })] }), 'a')) },
  { pairing: 'soren.bonds', run: () => fight(power(P('soren', 'bonds', { board: [body('l', N(1), { health: 40 }), body('a', T1, { attack: 6, health: 40 }), body('r', N(2), { health: 40 })] }), 'a')) },
  { pairing: 'vale.bonds', run: () => fight(P('vale', 'bonds', { tier: 3, spellsCast: 3, board: [body('m1', 'beatboxer', { attack: 1, health: 5000 }), body('dw', 'dw_brakka', { attack: 1, health: 5000 }), body('n', 'sandbag', { attack: 1, health: 5000 })] }), 0, 400, 1, ['United Front']) },
  { pairing: 'vale.war', run: () => fight(P('vale', 'war', { tier: 3, spellsCast: 3, board: [body('m1', 'beatboxer', { attack: 1, health: 5000 }), body('dw', 'dw_brakka', { attack: 1, health: 5000 })] }), 0, 400, 1, ['United Front']) },
  { pairing: 'vale.death', run: () => fight(P('vale', 'death', { tier: 3, spellsCast: 3, board: [...['a', 'b', 'c', 'd'].map((u) => body(u, 'sandbag', { attack: 1, health: 1 })), body('m1', 'beatboxer', { attack: 1, health: 5000 })] }), 100, 100000, 1, ['United Front']) },
  { pairing: 'brackus.death', run: () => fight(anc(P('brackus', 'death', { wave: 3, discover: undefined, discoverQueue: undefined, discoverLockGold: undefined, board: [body('a', 'drummer', { attack: 1, health: 500 }), body('z', 'zyff', { health: 500 }), pup('f', 1, 1), pup('g', 1, 1), pup('h', 1, 1)] } as Partial<RunState>), { brackusDeaths: 2 }), 2, 600) }, // three deaths IN the fight (R-AVENGE-PER-COMBAT-01),
  { pairing: 'xerox.bonds', run: () => fight(power(P('xerox', 'bonds', { board: [body('a', T1, { attack: 2, health: 90 }), body('t', 'taragosa', { health: 900 })] }), 'a')) },
  { pairing: 'cindy.war', run: () => fight(P('cindy', 'war', { board: [body('a', 'gnash', { health: 50 }), pup('b', 1, 50)] })) },
];

/** Every friendly `keyword` event and every buff source seen, for the keyword-only / uid-sourced pairings. */
function inspect(s: RunState, attack = 0, health = 400, n = 1, extra: Parameters<typeof foes>[4] = {}): { keywords: string[]; buffSources: string[] } {
  const r = combatVerdict(s, foes(s.wave, attack, health, n, extra)).s;
  const ev = (r.lastCombat?.events ?? []) as CombatEvent[];
  const mine = new Set((r.lastCombat?.initial.player ?? []).map((m) => m.uid));
  const kw = ev.filter((e): e is Extract<CombatEvent, { type: 'keyword' }> => e.type === 'keyword' && mine.has(e.target))
    .map((e) => `${e.keyword}<-${e.source === undefined ? 'none' : mine.has(e.source) ? 'unit' : e.source}`);
  const src = [...new Set(ev.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && mine.has(e.target))
    .map((e) => (mine.has(e.source) ? 'unit' : e.source)))];
  const wards = ev.filter((e) => e.type === 'shieldUp' && mine.has((e as { target: string }).target))
    .map((e) => `Ward<-${(e as { source?: string }).source ?? 'none'}`);
  return { keywords: [...new Set([...kw, ...wards])], buffSources: src };
}

// KEYWORD / Gild-free grants and minion-sourced pairings: what each presents TODAY. None is a `buff`, so none takes the
// tendril route; a label-less keyword (`W<-none`, a `shieldUp`) is what `fx/runeKeywordBeams.ts` beams from a rune slot,
// and a unit-sourced one is the minion's own. Pinned so a later wiring change is a visible diff, not a silent one.
describe('Ancient combat KEYWORD grants and minion-sourced pairings (reported, not wired here)', () => {
  it.each([
    { pairing: 'risen.death', run: () => inspect(power(P('risen', 'death', { board: [pup('a', 2, 2)] }), 'a'), 50, 400), keywords: ['R<-unit'], buffs: [] },
    { pairing: 'risen.war', run: () => inspect(power(P('risen', 'war', { board: [pup('a', 2, 2), pup('b', 0, 500)] }), 'a'), 50, 400, 3), keywords: [], buffs: [] },
    { pairing: 'gorun.genesis', run: () => inspect(P('gorun', 'genesis', { board: [pup('a', 1, 900), pup('b', 1, 900), pup('c', 1, 900)] })), keywords: ['W<-none', 'Ward<-none'], buffs: ['Blade Mastery'] },
    { pairing: 'midas.war', run: () => inspect(P('midas', 'war', { board: ['a', 'b', 'c', 'd', 'e'].map((u, i) => ({ ...pup(u, 1, 50), golden: i < 2 })) }), 0, 400, 2), keywords: ['Ward<-none'], buffs: [] }, // owner 2026-11-18: it counts Midas's OWN Gilded board minions (two here)
    { pairing: 'nadja.war', run: () => inspect(P('nadja', 'war', { board: [pup('a', 2, 50), pup('b', 1, 50)], goldSpentThisTurn: 3 } as Partial<RunState>)), keywords: ['RL<-unit'], buffs: ['unit'] },
  ])('$pairing', ({ run, keywords, buffs }) => {
    const r = run();
    expect(r.keywords).toEqual(keywords);
    expect(r.buffSources).toEqual(buffs);
  });
});

describe('Ancient combat grants play the hero-power tendril (R-FX-ANCIENT-TENDRIL-01)', () => {
  it.each(CASES)('$pairing', ({ run, authored }) => {
    const v = run();
    expect(v.grants, 'the pairing made a grant in this fight').toBeGreaterThan(0);
    expect(v.missing, 'no Ancient grant falls through to the sourceless descend').toEqual([]);
    if (authored) expect(v.authored.length).toBeGreaterThan(0);
  });
});
