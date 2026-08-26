/**
 * DOC BOT TRIPWIRE 18 — miss-driven oracles, wave 2. Catalog wave 2 (14 entries) measured 9 CAUGHT / 5
 * MISSED; the four reinjections here were the new misses, each now encoded as its GENERIC class rule.
 * (The fifth standing miss, #1176 avenge-arrival, still awaits the per-instance-counter contract layer.)
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { HEROES, createRun, reduce, type BoardCard, type RunState } from '../index';

const bm = (cardId: string, uid: string, attack: number, health: number, extra: Record<string, unknown> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [], ...extra } as unknown as BoardMinion);

const card = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as BoardCard;
};

describe('Doc Bot — miss-driven oracles, wave 2', () => {
  /** #c8a214d7 — ALL-TYPES IN COMBAT AURAS: a universalTribe body takes every tribe-keyed combat grant.
   *  The tribe-predicate ratchet freezes SOURCE debt; this is the BEHAVIOURAL half it cannot see (removing
   *  `|| !!m.universalTribe` from an existing raw compare changes no ratchet count). */
  it('a universalTribe body receives a Mech-keyed combat aura exactly like a real Mech', () => {
    const allTypes = Object.values(CARD_INDEX).find((c) => c?.universalTribe && !c.spell)!;
    const r = simulate(
      [bm('cryptwolf', 'p0', 3, 22, { rallyMechAtk: 5 }), bm('nanobot', 'p1', 1, 22), bm(allTypes.id, 'p2', 1, 22)],
      [bm('pup', 'e0', 1, 6)],
      makeRng(21), CARD_INDEX, combatSide({ tier: 5 }), combatSide({ tier: 5 }));
    const buffed = new Set(r.events
      .filter((e) => (e as { type?: string; srcCard?: string }).type === 'buff' && JSON.stringify(e).includes('Better Bot'))
      .map((e) => (e as { target?: string }).target));
    expect(buffed.size, 'the Rally-Mech aura must fire for the real Mech at least').toBeGreaterThanOrEqual(1);
    // m-uids are positional: p1 → m1 (the Mech), p2 → m2 (the all-types body).
    expect(buffed.has('m2'), `the Better Bot grant reached ${[...buffed].join(',')} but not the universalTribe body — "All types take every tribal buff" (owner rule, #c8a214d7)`).toBe(true);
  });

  /** #bf996507 — THE TRIBE GATE IS THE REDUCER'S, NOT THE UI'S: a tribe-restricted Battlecry refuses an
   *  off-tribe target uid outright, for EVERY targetTribe card (the aim UI filters, but the reducer must not
   *  trust the uid it is handed — Appetite Agent fed a Beast). */
  it('every targetTribe Battlecry refuses an off-tribe target at the reducer', () => {
    // Scoped to `target: 'friendly'` — that is the flow the picker + battlecryTarget gate owns (a
    // shop-targeting 'any' card like beetle rides a different path; its gate is that path's contract).
    const users = Object.values(CARD_INDEX).filter((c) => c && !c.spell
      && (c as { targetTribe?: string }).targetTribe && (c as { target?: string }).target === 'friendly'
      && c.effects.some((e) => e.on === 'onPlay')); // beetle is a chooseOne shell (effects: []) — different flow, different gate
    expect(users.length).toBeGreaterThanOrEqual(3); // emissary, dw_dorrin, dm_agent, d2_broodwhelp…
    for (const def of users) {
      const tribe = (def as { targetTribe: string }).targetTribe;
      const offTribe = tribe === 'beast' ? 'dragon' : 'beast';
      const s0: RunState = {
        ...createRun(0xba7e, 'aster'), embers: 30,
        board: [card('ok', 'pup', { tribe: tribe as never }), card('bad', 'pup', { tribe: offTribe as never })],
        hand: [card('m', def!.id)], shop: [],
      } as RunState;
      const s1 = reduce(s0, { type: 'play', uid: 'm' });
      expect(s1.pendingTarget?.uid, `${def!.id}: a valid on-tribe target exists — the picker must open`).toBe('m');
      const s2 = reduce(s1, { type: 'battlecryTarget', targetUid: 'bad' });
      const bad = s2.board.find((c) => c.uid === 'bad')!;
      expect([bad.attack, bad.health], `${def!.id} (${tribe}-only): the reducer RESOLVED onto an off-tribe target — the #849 gate is gone`).toEqual([1, 1]);
      expect(s2.pendingTarget?.uid, `${def!.id}: the refused pick must leave the picker open, not swallow the Battlecry`).toBe('m');
    }
  });

  /** #7af61a35 — ABOVE-CAP ECONOMY RIDES ITS OWN CHANNEL: Nadja's +1 max Gold must land on `maxGoldBonus`
   *  (persistent above the natural cap) and never on `maxEmbers` (where natural growth silently re-absorbs
   *  it and the lead evaporates — the owner's report was exactly "powered turns 1–4, stuck at 10"). */
  it("Nadja's Mana Font raises maxGoldBonus, not maxEmbers", () => {
    const nadja = HEROES.find((h) => /nadja/i.test(h.id) || /mana ?font/i.test(h.power.name ?? ''));
    expect(nadja, 'Nadja (Mana Font) must exist for this contract').toBeTruthy();
    const s1: RunState = { ...createRun(0x901d, nadja!.id), wave: 3, embers: 30, board: [card('b0', 'pup')], hand: [], shop: [] } as RunState;
    const s2 = reduce(s1, { type: 'heroPower' });
    expect(s2, 'the power must fire under the fixture').not.toBe(s1);
    expect((s2.maxGoldBonus ?? 0) - (s1.maxGoldBonus ?? 0), 'the grant must land on the persistent above-cap channel (maxGoldBonus)').toBeGreaterThanOrEqual(1);
    expect(s2.maxEmbers, 'maxEmbers must stay untouched — natural growth re-absorbs anything parked there (#642)').toBe(s1.maxEmbers);
  });

  /** #f45525c9 — SELF-TARGET IDENTITY: a `self: true` consume effect feeds THE CARD ITSELF, never a random
   *  tribe-mate. Checked across several rng cursors so a random-pick regression cannot hide behind one seed. */
  it('Chipper-family (`self: true`) consumes into ITSELF across rng cursors', () => {
    const glutton = Object.values(CARD_INDEX).find((c) => c?.effects.some((e) => e.do === 'onTribePlayedConsumeShop' && (e.params as { self?: boolean }).self === true))!;
    const tribe = (glutton.effects.find((e) => e.do === 'onTribePlayedConsumeShop')!.params as { tribe?: string }).tribe ?? 'demon';
    // There is NO genuinely plain demon in content (the sweep's fallback found Heckbinder, which promptly ATE
    // the fixture — the Drakko lesson again). So the tribe-mates are CLEAN TOKENS wearing the tribe: the
    // trigger and the eater-pool both read the body's tribe via isTribe, and `pup` is a validated-clean body.
    // DISTINCT token ids — three same-id bodies auto-TRIPLE and vanish into a golden (this fixture's first
    // cut lost its whole cast to the combine).
    const mate = (uid: string, id: string): BoardCard => ({ ...card(uid, id), tribe: tribe as never } as BoardCard);
    for (const cursor of [1, 977, 5081, 31337]) {
      const s0: RunState = {
        ...createRun(0xc41f, 'aster'), embers: 30, rngCursor: cursor,
        board: [card('g', glutton.id), mate('a1', 'stray'), mate('a2', 'cryptwolf')],
        hand: [mate('m', 'pup')],
        shop: [{ uid: 'food', cardId: 'pup' }],
      } as RunState;
      const s1 = reduce(s0, { type: 'play', uid: 'm' });
      const g = s1.board.find((c) => c.uid === 'g')!;
      const a1 = s1.board.find((c) => c.uid === 'a1')!;
      const a2 = s1.board.find((c) => c.uid === 'a2')!;
      expect(g.attack + g.health, `cursor ${cursor}: ${glutton.id} (self: true) did not grow — it must be the eater`).toBeGreaterThan(glutton.attack + glutton.health);
      expect([a1.attack, a1.health, a2.attack, a2.health], `cursor ${cursor}: a tribe-mate grew — the consume went to a RANDOM friendly instead of self (#803)`)
        .toEqual([CARD_INDEX['stray']!.attack, CARD_INDEX['stray']!.health, CARD_INDEX['cryptwolf']!.attack, CARD_INDEX['cryptwolf']!.health]);
    }
  });
});
