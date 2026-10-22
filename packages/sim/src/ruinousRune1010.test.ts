import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, RUNES, EPIC_RUNES, RUNE_INDEX, poolFor } from '@game/content';
import { PRESENTATION_POLICIES } from '@game/core';
import { CONFIG, createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { runeforgePool } from './reducer';
import { fireRecruitDeathrattlesForTest } from './recruit';

/**
 * OWNER ADD 2026-10-10 — Rune of the Ruinous (Basic, 4 Gold, Set 2, Demon-gated): "Get a Ruinous Lord."
 * Ruinous Lord (rune-only T4 4/5 Demon): "When a Demon deals damage, give your Demons +1/+1." OWNER RULING: the buff
 * lasts for THIS COMBAT ONLY. Gilded +2/+2. The trigger is Impossible Todd's (`friendlyDemonDealtDamage`), so
 * "deals damage" means a LANDED hit by a friendly Demon, the Lord's own hits included. Every block runs the real
 * reducer / the real `simulate()`. Oracle rule R-RUINOUS-01 points here.
 */

const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const run = (set: 'set2' | 'set3', tribes: string[], extra: Partial<RunState> = {}): RunState => ({
  ...createRun(3, 'runesmith', 'ascent', CONFIG.defaultLine, set),
  tribes, wave: 7, tier: 6, phase: 'recruit', embers: 40, hand: [], board: [], ...extra,
} as RunState);

const LORD: BoardMinion = { cardId: 'dm_ruinouslord', attack: 4, health: 5, sourceUid: 'p0', keywords: [] };
const IMP: BoardMinion = { cardId: 'contractimp', attack: 3, health: 4, sourceUid: 'p1', keywords: [] }; // a vanilla Demon
const BEAST: BoardMinion = { cardId: 'trailforager', attack: 1, health: 4, sourceUid: 'p2', keywords: [] }; // a vanilla non-Demon
const WALL: BoardMinion = { cardId: 'sandbag', attack: 1, health: 400, sourceUid: 'e0', keywords: [] };
const KEY = 'factory:onFriendlyDemonDamageBuffTribe:friendlyDemonDealtDamage';

const fight = (player: BoardMinion[], enemy: BoardMinion[] = [WALL], seed = 7) =>
  simulate(player, enemy, makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide());
type Buff = Extract<CombatEvent, { type: 'buff' }>;
type Dmg = Extract<CombatEvent, { type: 'dmg' }>;

describe('Rune of the Ruinous: the roster', () => {
  it('a Basic (RUNES, appended last), 4 Gold, Set 2 only, Demon-gated, granting Ruinous Lord', () => {
    const r = RUNE_INDEX['rune_ruinous']!;
    expect(RUNES[RUNES.length - 1]!.id, 'appended at the very end of RUNES').toBe('rune_ruinous');
    expect(EPIC_RUNES.some((x) => x.id === 'rune_ruinous')).toBe(false);
    expect([r.name, r.cost, !!r.epic, r.tribes, r.sets, r.text]).toEqual(['Ruinous', 4, false, ['demon'], ['set2'], 'Get a **Ruinous Lord**.']);
    expect(r.reward).toEqual({ kind: 'grant', cards: ['dm_ruinouslord'] });
  });
  it('Ruinous Lord: a rune-only T4 4/5 Demon, never in the Shop pool, resolving globally; plain + gilded text', () => {
    const d = CARD_INDEX['dm_ruinouslord']!;
    expect([d.name, d.tier, d.attack, d.health, d.tribe, d.token]).toEqual(['Ruinous Lord', 4, 4, 5, 'demon', true]);
    expect(poolFor('set2').all.some((c) => c.id === 'dm_ruinouslord' && !c.token), 'never drawn from the tavern').toBe(false);
    expect(d.text).toBe('When a **Demon** deals damage, give your **Demons +1/+1**.');
    expect(d.goldenText).toBe('When a **Demon** deals damage, give your **Demons +2/+2**.');
    for (const t of [d.text, d.goldenText, RUNE_INDEX['rune_ruinous']!.text]) expect(t, 'no em dash in player text').not.toMatch(/—|--/);
  });
  it('its trigger has its own beat policy (one buff-wave beat per trigger)', () => {
    expect(PRESENTATION_POLICIES[KEY]).toEqual({ policy: 'ownBeat', family: 'react' });
  });
});

describe('Rune of the Ruinous: the forge', () => {
  it('buying the rune grants a Ruinous Lord', () => {
    const s = act(run('set2', ['kobold', 'dragon', 'beast', 'demon', 'dwarf'], { runeforgeOffer: ['rune_ruinous'], runeforgeEpic: false }), { type: 'buyRune', index: 0 });
    expect([...s.hand, ...s.board].filter((c) => c.cardId === 'dm_ruinouslord')).toHaveLength(1);
  });
  it('offered only in Set 2 with Demons among the run tribes', () => {
    expect(runeforgePool(run('set2', ['kobold', 'dragon', 'beast', 'demon', 'dwarf']))).toContain('rune_ruinous');
    expect(runeforgePool(run('set2', ['kobold', 'dragon', 'beast', 'dwarf'])), 'no Demons in the run').not.toContain('rune_ruinous');
    expect(runeforgePool(run('set3', ['kobold', 'dwarf', 'undead', 'spirit', 'celestial', 'demon'])), 'Set 3').not.toContain('rune_ruinous');
  });
});

describe('Ruinous Lord in combat', () => {
  it('every landed friendly-Demon hit gives every living friendly Demon +1/+1 (the Lord included); non-Demons untouched', () => {
    const r = fight([LORD, IMP, BEAST]);
    const uid = (cardId: string) => r.initial.player.find((m) => m.cardId === cardId)!.uid;
    const [lord, imp, beast] = [uid('dm_ruinouslord'), uid('contractimp'), uid('trailforager')];
    const lordBuffs = r.events.filter((e): e is Buff => e.type === 'buff' && e.source === lord);
    expect(lordBuffs.length).toBeGreaterThan(0);
    for (const b of lordBuffs) {
      expect([b.attack, b.health]).toEqual([1, 1]);
      expect([lord, imp]).toContain(b.target);
      expect((b as { key?: string }).key, 'stamped with its own policy key').toBe(KEY);
    }
    expect(lordBuffs.some((b) => b.target === beast), 'a Beast is not a Demon').toBe(false);
    // One trigger per landed Demon hit: each landed hit pays the living Demons once. Walk the log in order.
    const demonUids = new Set([lord, imp]);
    let triggers = 0;
    for (const e of r.events) if (e.type === 'dmg' && (e as Dmg).amount > 0 && demonUids.has((e as Dmg).source ?? '')) triggers++;
    expect(triggers).toBeGreaterThan(1);
    const lordSelf = lordBuffs.filter((b) => b.target === lord).length;
    expect(lordSelf, 'the Lord buffs itself once per trigger while alive').toBeLessThanOrEqual(triggers);
    expect(lordSelf).toBeGreaterThan(0);
  });
  it('the Lord\'s OWN hit counts (Todd precedent): a lone Lord grows off its own swings', () => {
    // A harmless 0-Attack wall, so the Lord never dies mid-exchange (a body at 0 Health pays no one).
    const r = fight([LORD], [{ cardId: 'trailforager', attack: 0, health: 400, sourceUid: 'e0', keywords: [] }]);
    const lord = r.initial.player[0]!.uid;
    const swings = r.events.filter((e) => e.type === 'dmg' && (e as Dmg).source === lord && (e as Dmg).amount > 0).length;
    const self = r.events.filter((e): e is Buff => e.type === 'buff' && e.source === lord && e.target === lord).length;
    expect(swings).toBeGreaterThan(0);
    expect(self).toBe(swings);
  });
  it('an ENEMY Demon\'s hit does not trigger the player\'s Lord', () => {
    const r = fight([{ ...LORD, attack: 0 }], [{ cardId: 'contractimp', attack: 1, health: 400, sourceUid: 'e0', keywords: [] }]);
    const lord = r.initial.player[0]!.uid;
    expect(r.events.some((e) => e.type === 'buff' && e.source === lord)).toBe(false);
  });
  it('gilded gives +2/+2', () => {
    const r = fight([{ ...LORD, golden: true }, IMP]);
    const lord = r.initial.player[0]!.uid;
    const buffs = r.events.filter((e): e is Buff => e.type === 'buff' && e.source === lord);
    expect(buffs.length).toBeGreaterThan(0);
    for (const b of buffs) expect([b.attack, b.health]).toEqual([2, 2]);
  });
  it('deterministic: the same seed reproduces the same log', () => {
    expect(JSON.stringify(fight([LORD, IMP, BEAST], [WALL], 11).events)).toBe(JSON.stringify(fight([LORD, IMP, BEAST], [WALL], 11).events));
  });
});

// OWNER RULING 2026-10-10 (on Rad Rachel / Ruinous Lord): "it is combat only if triggered in combat, if a minion is
// engraved, they obviously carry it back, and if the effect is triggered in recruit phase, it would be permanent."
describe('Ruinous Lord: permanence follows the phase (owner ruling 2026-10-10)', () => {
  it('the gains never carry back to the run board', () => {
    const before = run('set2', ['kobold', 'dragon', 'beast', 'demon', 'dwarf'], {
      board: [bc('p0', 'dm_ruinouslord'), bc('p1', 'contractimp')], resolve: 999, maxResolve: 999, armor: 999,
    });
    const fought = act(before, { type: 'faceOmen' });
    const lordUid = fought.lastCombat!.initial.player.find((m) => m.cardId === 'dm_ruinouslord')!.uid;
    expect(fought.lastCombat!.events.some((e) => e.type === 'buff' && e.source === lordUid), 'the Lord fired in the fight').toBe(true);
    const settled = act(fought, { type: 'settleCombat' });
    const stats = (s: RunState) => s.board.map((c) => [c.cardId, c.attack, c.health, (c.buffs ?? []).length]);
    expect(stats(settled)).toEqual(stats(before));
  });
  it('ENGRAVED: an Engraved Demon carries its combat gains back; the plain Demon and the Lord do not', () => {
    // A harmless 0-Attack wall so every body lives; the settle carry-back is exactly `playerPermaBuffs`.
    const r = fight([LORD, { ...IMP, sourceUid: 'p1', keywords: ['EG'] }, { ...IMP, sourceUid: 'p2' }],
      [{ cardId: 'trailforager', attack: 0, health: 400, sourceUid: 'e0', keywords: [] }]);
    const [lord, eg] = [r.initial.player[0]!.uid, r.initial.player[1]!.uid];
    const paid = r.events.filter((e): e is Buff => e.type === 'buff' && e.source === lord && e.target === eg);
    expect(paid.length, 'the Engraved Demon was paid in the fight').toBeGreaterThan(0);
    const carry = r.playerPermaBuffs ?? [];
    expect(carry.filter((c) => c.sourceUid === 'p1')).toEqual([{ sourceUid: 'p1', attack: paid.length, health: paid.length, engraved: true }]);
    expect(carry.some((c) => c.sourceUid === 'p0' || c.sourceUid === 'p2'), 'nothing carries back for a non-Engraved body').toBe(false);
  });
  it('RECRUIT PHASE: a Demon dealing damage in the Shop (the Fel Spikes Echo) gives your board Demons +1/+1 PERMANENTLY', () => {
    const s = run('set2', ['kobold', 'dragon', 'beast', 'demon', 'dwarf'], {
      board: [bc('fs', 'dm_felspikes'), bc('rl', 'dm_ruinouslord'), bc('im', 'contractimp'), bc('bt', 'trailforager', { health: 20 })],
    });
    const felSpikes = s.board.find((c) => c.uid === 'fs')!;
    fireRecruitDeathrattlesForTest(s, felSpikes);
    // Fel Spikes spares Demons, so it lands exactly ONE hit here (the Beast): one trigger, +1/+1 to each board Demon.
    const on = (uid: string) => s.board.find((c) => c.uid === uid)!;
    expect([on('rl').attack, on('rl').health]).toEqual([5, 6]);
    expect([on('im').attack, on('im').health]).toEqual([4, 5]);
    expect((on('im').buffs ?? []).some((b) => b.source === 'Ruinous Lord'), 'a permanent Shop buff entry').toBe(true);
    expect(on('bt').attack, 'the Beast is not a Demon').toBe(1);
  });
  it('RECRUIT PHASE, gilded: +2/+2 per hit', () => {
    const s = run('set2', ['kobold', 'dragon', 'beast', 'demon', 'dwarf'], {
      board: [bc('fs', 'dm_felspikes'), bc('rl', 'dm_ruinouslord', { golden: true, attack: 8, health: 10 }), bc('b1', 'trailforager', { health: 20 }), bc('b2', 'trailforager', { health: 20 })],
    });
    fireRecruitDeathrattlesForTest(s, s.board[0]!);
    const rl = s.board.find((c) => c.uid === 'rl')!;
    expect([rl.attack, rl.health], 'two landed hits, +2/+2 each').toEqual([12, 14]);
  });
});
