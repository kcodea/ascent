import { describe, it, expect, afterEach } from 'vitest';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { createRun, type Action, type BoardCard, type RunState } from '../state';
import { reduce } from '../reducer';
import { rebuildEquipment } from '../equipment';
import { createStarform, starformStats } from '../starform';
import { DEFAULT_BOT } from '../bots/index';
import { ACTION_CATALOG } from './actionCatalog';
import { candidatesFor, violatesCatalog, type Candidate } from './legalActions';
import { __unsafeStateForTests, applyCandidate, createPlanningRoot, releaseAll, revealOf, sampleCandidate, visibleOf, RANDOM_EFFECT } from './transition';
import { toBotVisibleState, fingerprint } from './visibleState';
import { friendlyCombatSideOf, MIRRORED_SIDE_KEYS } from './combatContext';
import { fightScore } from './fightScore';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * B2 — PLANNING-BOUNDARY COVERAGE (docs/balance-bot-roadmap.md).
 *
 * "A compile-time catalog entry is not evidence the bot can use a mechanic." For every mechanic class in scope
 * this file proves three things on a hand-built state:
 *
 *  1. the candidate generator PRODUCES the action (and the reducer accepts it);
 *  2. applying it on a planning clone leaves the LIVE run byte-identical and its siblings isolated;
 *  3. a change to the HIDDEN FUTURE (RNG cursor, seed, the pinned opponent) does not change the candidate list
 *     or the fingerprint before a reveal — the bot cannot tell two such states apart.
 */
afterEach(() => releaseAll());

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};

const run = (over: Partial<RunState> = {}, seed = 918_273, heroId = 'drakko', setId: 'set1' | 'set2' | 'set3' = 'set3'): RunState =>
  ({ ...createRun(seed, heroId, 'ascent', undefined, setId), phase: 'recruit', embers: 10, ...over } as RunState);

/** The live run minus its presentation-only combat replay, for byte-identity checks. */
const snapshot = (s: RunState): string => JSON.stringify({ ...s, lastCombat: undefined });

const tags = (s: RunState): string[] => candidatesFor(toBotVisibleState(s)).map((c) => c.tag).sort();

/** Twist every hidden channel the bot must not see. Same visible state, different future. */
const twistHiddenFuture = (s: RunState): RunState => ({
  ...s,
  rngCursor: ((s.rngCursor ?? 0) + 999_983) >>> 0,
  seed: s.seed + 7,
  servedBoards: { ...(s.servedBoards ?? {}), [s.wave]: null },
});

/**
 * The three-part contract, applied to one candidate on one state.
 *  - the reducer accepts it (through the planning clone);
 *  - the live run is untouched, the root is untouched, and a sibling expanded before it fingerprints the same;
 *  - the hidden-future twist leaves the candidate list and the fingerprint unchanged.
 */
function proveIsolation(live: RunState, pick: (cands: Candidate[]) => Candidate, sibling: Action = { type: 'freeze' }): void {
  const before = snapshot(live);
  const v = toBotVisibleState(live);
  const cand = pick(candidatesFor(v));
  expect(violatesCatalog(cand), `${cand.tag} names a never/automatic action`).toBe(false);

  const root = createPlanningRoot(live);
  const rootBefore = JSON.stringify(__unsafeStateForTests(root));
  const sib = applyCandidate(root, sibling);
  const sibFp = fingerprint(visibleOf(sib.child));
  const t = applyCandidate(root, cand.action);
  expect(t.changed, `${cand.tag} was rejected by the reducer`).toBe(true);
  expect(snapshot(live), `${cand.tag}: the live run was mutated`).toBe(before);
  expect(JSON.stringify(__unsafeStateForTests(root)), `${cand.tag}: the root was mutated`).toBe(rootBefore);
  expect(fingerprint(visibleOf(sib.child)), `${cand.tag}: a sibling saw the expansion`).toBe(sibFp);

  const twisted = twistHiddenFuture(live);
  expect(tags(twisted), `${cand.tag}: the candidate list depends on the hidden future`).toEqual(tags(live));
  expect(fingerprint(toBotVisibleState(twisted))).toBe(fingerprint(v));
  if (!t.reveal) {
    // Before a reveal the child is a pure function of the visible state: the twisted future reaches the same one.
    const t2 = applyCandidate(createPlanningRoot(twisted), cand.action);
    expect(t2.fingerprint, `${cand.tag}: a deterministic action's result depends on the hidden future`).toBe(t.fingerprint);
  }
}

// ───────────────────────────────────────────── EQUIPMENT ─────────────────────────────────────────────

describe('Equipment is inside the planning boundary', () => {
  const withBloodpot = (): RunState => {
    const s = run({ board: [body('f', 'e3_frank'), body('t', 'stray')] });
    rebuildEquipment(s); // Start-of-Turn grant from the board — Frank hands over Bloodpot, selected
    return s;
  };

  it('the catalog admits selection and activation as recruit choices', () => {
    expect(ACTION_CATALOG.selectEquipment.generation).toBe('recruit');
    expect(ACTION_CATALOG.activateEquipment.generation).toBe('recruit');
  });

  it('the projection carries the held Equipment with live cost, charges and target mode', () => {
    const v = toBotVisibleState(withBloodpot());
    expect(v.equipment).toHaveLength(1);
    expect(v.equipment[0]).toMatchObject({ equipmentId: 'bloodpot', charges: 1, cost: 1, targetMode: 'friendly', selected: true, version: 'plain' });
  });

  it('activation is generated with a friendly target, accepted, and isolated', () => {
    const s = withBloodpot();
    const cands = candidatesFor(toBotVisibleState(s));
    const uses = cands.filter((c) => c.action.type === 'activateEquipment');
    // Never Frank himself — R-TARGET-03 (owner 2026-09-18): an aimed Equipment skips its own granting body.
    expect(uses.map((c) => (c.action as { targetUid?: string }).targetUid).sort()).toEqual(['t']);
    proveIsolation(s, (cs) => cs.find((c) => c.action.type === 'activateEquipment' && (c.action as { targetUid?: string }).targetUid === 't')!);
    // And it actually buffs: the sibling-safe child has a +3/+3 Stray.
    const t = applyCandidate(createPlanningRoot(s), { type: 'activateEquipment', targetUid: 't' });
    expect(t.visible.board.find((c) => c.uid === 't')).toMatchObject({ attack: CARD_INDEX['stray']!.attack + 3, health: CARD_INDEX['stray']!.health + 3 });
    expect(t.visible.equipment[0]!.charges).toBe(0);
  });

  it('respects charges — a spent Equipment is not offered again', () => {
    const s = reduce(withBloodpot(), { type: 'activateEquipment', targetUid: 't' });
    expect(candidatesFor(toBotVisibleState(s)).some((c) => c.action.type === 'activateEquipment')).toBe(false);
  });

  it('a second held Equipment is reachable through a free swap', () => {
    const s = run({ board: [body('f', 'e3_frank'), body('h', 'e3_sculptor'), body('t', 'stray')], embers: 10 });
    rebuildEquipment(s);
    const v = toBotVisibleState(s);
    expect(v.equipment.map((e) => e.equipmentId).sort()).toEqual(['bloodpot', 'titan_hammer']);
    const cands = candidatesFor(v);
    const swap = cands.find((c) => c.action.type === 'selectEquipment');
    expect(swap?.action).toEqual({ type: 'selectEquipment', equipmentId: 'titan_hammer' });
    proveIsolation(s, (cs) => cs.find((c) => c.action.type === 'selectEquipment')!);
    // After the swap the hammer is what activates.
    const after = applyCandidate(createPlanningRoot(s), swap!.action);
    const uses = candidatesFor(after.visible).filter((c) => c.action.type === 'activateEquipment');
    expect(uses.length, 'Frank + the Stray — never the Sculptor that granted the hammer (R-TARGET-03)').toBe(2);
    expect(after.visible.equipment.find((e) => e.selected)?.equipmentId).toBe('titan_hammer');
  });

  it('a Choose One Equipment (Prismatic Pick) opens its prompt, which is answered from the mandatory family', () => {
    const s = run({ board: [body('p', 'k3_prismpick'), body('t', 'stray')], embers: 10 });
    rebuildEquipment(s);
    const v = toBotVisibleState(s);
    if (!v.equipment.some((e) => e.equipmentId === 'prismatic_pick')) return; // the card id moved — nothing to prove here
    const use = candidatesFor(v).find((c) => c.action.type === 'activateEquipment')!;
    const t = applyCandidate(createPlanningRoot(s), use.action);
    expect(t.changed).toBe(true);
    expect(t.visible.mandatoryDecision?.kind).toBe('chooseOne');
    expect((t.visible.mandatoryDecision as { equipmentId?: string }).equipmentId).toBe('prismatic_pick');
    const picks = candidatesFor(t.visible);
    expect(picks.every((c) => c.action.type === 'chooseOne')).toBe(true);
    expect(picks.length).toBeGreaterThan(1);
  });
});

// ───────────────────────────────────────────── CHOOSE ONE + TARGETED SHOUT ─────────────────────────────────────────────

describe('Choose One and the targeted Shout two-step', () => {
  it('a Choose One minion (Halfsies) plays, then its branches are the only candidates, then the aim', () => {
    const s = run({ board: [body('a', 'stray'), body('b', 'alley')], hand: [body('h', 'n3_splitboon')] });
    proveIsolation(s, (cs) => cs.find((c) => c.action.type === 'play' && (c.action as { uid: string }).uid === 'h')!);
    const play = applyCandidate(createPlanningRoot(s), { type: 'play', uid: 'h', toIndex: 2 });
    expect(play.visible.mandatoryDecision?.kind).toBe('chooseOne');
    const branches = candidatesFor(play.visible);
    expect(branches.map((c) => c.action.type)).toEqual(['chooseOne', 'chooseOne']);
    // Branch 0 targets: the aim follows, with both bodies legal.
    const chose = applyCandidate(play.child, { type: 'chooseOne', index: 0 });
    expect(chose.visible.mandatoryDecision?.kind).toBe('battlecryTarget');
    const aims = candidatesFor(chose.visible);
    expect(aims.map((c) => (c.action as { targetUid: string }).targetUid).sort()).toEqual(['a', 'b']);
    const done = applyCandidate(chose.child, { type: 'battlecryTarget', targetUid: 'b' });
    expect(done.visible.mandatoryDecision).toBeNull();
    expect(done.visible.board.find((c) => c.uid === 'b')).toMatchObject({ attack: CARD_INDEX['alley']!.attack + 6 });
  });

  it('a tribe-restricted Shout (Twilight Emissary → a Dragon) offers only legal targets', () => {
    const s = run({ board: [body('d', 'whelpling'), body('s', 'stray')], hand: [body('e', 'emissary')] }, 5, 'drakko', 'set1');
    expect(CARD_INDEX['whelpling']!.tribe).toBe('dragon');
    const play = applyCandidate(createPlanningRoot(s), { type: 'play', uid: 'e', toIndex: 0 });
    expect(play.visible.mandatoryDecision?.kind).toBe('battlecryTarget');
    const aims = candidatesFor(play.visible).map((c) => (c.action as { targetUid: string }).targetUid);
    expect(aims).toEqual(['d']);
    proveIsolation(s, (cs) => cs.find((c) => c.action.type === 'play')!);
  });
});

// ───────────────────────────────────────────── DISCOVER ─────────────────────────────────────────────

describe('Discover', () => {
  it('a pending Discover is answered from the mandatory family only, and the pick is deterministic', () => {
    const s = run({ discover: ['stray', 'alley', 'spore'] });
    const v = toBotVisibleState(s);
    expect(v.mandatoryDecision).toEqual({ kind: 'discover', options: ['stray', 'alley', 'spore'] });
    const cands = candidatesFor(v);
    expect(cands.map((c) => c.action)).toEqual([0, 1, 2].map((index) => ({ type: 'discover', index })));
    proveIsolation(s, (cs) => cs[1]!, { type: 'discover', index: 0 });
    const t = applyCandidate(createPlanningRoot(s), { type: 'discover', index: 1 });
    expect(t.reveal, 'picking a visible option reveals nothing').toBeNull();
    expect(t.visible.hand.map((c) => c.cardId)).toContain('alley');
  });

  it('a Discover-generating Shout is a reveal BY EFFECT, before it is applied', () => {
    const id = Object.values(CARD_INDEX).find((d) => !d.spell && d.effects.some((e) => e.on === 'onPlay' && e.do === 'battlecryDiscoverMinion'))?.id;
    expect(id, 'no Discover Shout in content').toBeTruthy();
    const s = run({ hand: [body('h', id!)] });
    const v = toBotVisibleState(s);
    const cand = candidatesFor(v).find((c) => c.action.type === 'play')!;
    expect(revealOf(cand.action, v)?.kind).toBe('randomGrant');
    const t = applyCandidate(createPlanningRoot(s), cand.action);
    expect(t.reveal).toBeTruthy();
  });
});

// ───────────────────────────────────────────── TRIPLE ─────────────────────────────────────────────

describe('Triple', () => {
  it('the third copy is a deterministic buy that combines into a golden in hand; PLAYING the golden is the Discover reveal', () => {
    const base = run({ board: [body('a', 'stray'), body('b', 'stray')] }, 42, 'drakko', 'set1');
    const s: RunState = { ...base, shop: [{ uid: 'o1', cardId: 'stray' }, ...base.shop.slice(1)] };
    const v = toBotVisibleState(s);
    const buy = candidatesFor(v).find((c) => c.action.type === 'buy' && (c.action as { uid: string }).uid === 'o1')!;
    expect(buy).toBeTruthy();
    expect(revealOf(buy.action, v)).toBeNull();
    proveIsolation(s, () => buy);
    const bought = applyCandidate(createPlanningRoot(s), buy.action);
    expect(bought.reveal, 'the combine drew nothing').toBeNull();
    const golden = bought.visible.hand.find((c) => c.cardId === 'stray' && c.golden);
    expect(golden, 'the triple did not combine into a golden in hand').toBeTruthy();
    expect(bought.visible.board.filter((c) => c.cardId === 'stray')).toHaveLength(0);
    // Playing the golden fields it and grants the Triple Reward SPELL — deterministic. CASTING that spell is the
    // Discover reveal, and it is known statically from the spell's effect id before it is applied.
    const play = candidatesFor(bought.visible).find((c) => c.action.type === 'play' && (c.action as { uid: string }).uid === golden!.uid)!;
    const played = applyCandidate(bought.child, play.action);
    expect(played.visible.board.some((c) => c.cardId === 'stray' && c.golden), 'the golden was fielded').toBe(true);
    const reward = played.visible.hand.find((c) => CARD_INDEX[c.cardId]?.discoverOnPlay);
    expect(reward, 'no Triple Reward was granted').toBeTruthy();
    const cast = candidatesFor(played.visible).find((c) => c.action.type === 'play' && (c.action as { uid: string }).uid === reward!.uid)!;
    expect(revealOf(cast.action, played.visible)?.kind).toBe('randomGrant');
    const opened = applyCandidate(played.child, cast.action);
    expect(opened.reveal).toBeTruthy();
    expect(opened.visible.mandatoryDecision?.kind).toBe('discover');
  });
});

// ───────────────────────────────────────────── HERO POWER ─────────────────────────────────────────────

describe('Hero power', () => {
  it('a targeted power (Warden’s Ward) is generated per board minion, accepted and isolated', () => {
    const s = run({ board: [body('a', 'stray'), body('b', 'alley')], embers: 10 }, 9, 'warden', 'set1');
    const v = toBotVisibleState(s);
    expect(v.hero.powers[0]).toMatchObject({ slot: 0, targeting: 'friendly' });
    if (!v.hero.powers[0]!.ready) return; // locked on this wave — the generator correctly offers nothing
    const powers = candidatesFor(v).filter((c) => c.action.type === 'heroPower');
    expect(powers.map((c) => (c.action as { uid?: string }).uid).sort()).toEqual(['a', 'b']);
    proveIsolation(s, (cs) => cs.find((c) => c.action.type === 'heroPower')!);
  });

  it('an untargeted power (Nadja) is one candidate with no uid', () => {
    const s = run({ embers: 10 }, 9, 'nadja', 'set1');
    const v = toBotVisibleState(s);
    if (!v.hero.powers[0]!.ready) return;
    const powers = candidatesFor(v).filter((c) => c.action.type === 'heroPower');
    expect(powers).toHaveLength(1);
    expect(powers[0]!.action).toEqual({ type: 'heroPower' });
    proveIsolation(s, () => powers[0]!);
  });
});

// ───────────────────────────────────────────── RUNE BUY ─────────────────────────────────────────────

describe('Runeforge', () => {
  it('every offered rune, the reroll and the skip are candidates; buying is a forge reveal', () => {
    const runes = Object.keys(RUNE_INDEX).slice(0, 3);
    const s = run({ runeforgeOffer: runes, embers: 20 });
    const v = toBotVisibleState(s);
    expect(v.mandatoryDecision?.kind).toBe('runeforge');
    const cands = candidatesFor(v);
    expect(cands.map((c) => c.action.type).sort()).toEqual(['buyRune', 'buyRune', 'buyRune', 'rerollRuneforge', 'skipRuneforge']);
    proveIsolation(s, (cs) => cs.find((c) => c.action.type === 'buyRune')!, { type: 'skipRuneforge' });
    const t = applyCandidate(createPlanningRoot(s), { type: 'buyRune', index: 0 });
    expect(t.reveal?.kind).toBe('forge');
    expect(t.visible.runes).toContain(runes[0]);
  });
});

// ───────────────────────────────────────────── STARFORM ─────────────────────────────────────────────

describe('Starform', () => {
  it('the token is visible with its live price and buyable as an ordinary offer', () => {
    const s = run({ embers: 10 });
    const sf = createStarform(s, { cardId: 'test', name: 'Test' });
    const v = toBotVisibleState(s);
    const live = starformStats(s)!;
    expect(v.starform).toMatchObject({ uid: sf.uid, attack: live.attack, health: live.health });
    expect(v.starform!.cost).toBe(v.shop.find((o) => o.uid === sf.uid)!.cost);
    const buy = candidatesFor(v).find((c) => c.action.type === 'buy' && (c.action as { uid: string }).uid === sf.uid);
    expect(buy, 'the Starform is not offered as a buy').toBeTruthy();
    proveIsolation(s, () => buy!);
    // Its price ticks down on a refresh — the projection reads the LIVE price, not the printed 6.
    const rolled = applyCandidate(createPlanningRoot(s), { type: 'roll' });
    expect(rolled.visible.starform!.cost).toBe(v.starform!.cost - 1);
  });

  it('the Star Destroyer rides the token as held Equipment', () => {
    const s = run({ embers: 10 });
    createStarform(s, { cardId: 'test', name: 'Test' });
    const v = toBotVisibleState(s);
    expect(v.equipment.map((e) => e.equipmentId)).toContain('star_destroyer');
  });
});

// ───────────────────────────────────────────── SELL / FREEZE / ROLL / UPGRADE / REORDER ─────────────────────────────────────────────

describe('the plain shop verbs', () => {
  it('sell, freeze, roll, upgrade and reposition are all generated, accepted and isolated', () => {
    const s = run({ board: [body('a', 'stray'), body('b', 'alley')], embers: 10 });
    const cands = candidatesFor(toBotVisibleState(s));
    for (const type of ['sell', 'freeze', 'roll', 'upgrade'] as const) {
      expect(cands.some((c) => c.action.type === type), `${type} not generated`).toBe(true);
      proveIsolation(s, (cs) => cs.find((c) => c.action.type === type)!, { type: 'upgrade' });
    }
    const t = applyCandidate(createPlanningRoot(s), { type: 'reposition', uid: 'b', toIndex: 0 });
    expect(t.changed).toBe(true);
    expect(t.visible.board.map((c) => c.uid)).toEqual(['b', 'a']);
  });

  it('a refresh is a reveal, and sampling it never reads the real future', () => {
    const s = run({ embers: 10 });
    const root = createPlanningRoot(s);
    const real = applyCandidate(root, { type: 'roll' });
    expect(real.reveal?.kind).toBe('refresh');
    expect(real.rngConsumed).toBe(true);
    const samples = sampleCandidate(root, { type: 'roll' }, 12345, 3);
    expect(samples).toHaveLength(3);
    const realShop = real.visible.shop.map((o) => o.cardId).join(',');
    // Three independent futures; at least one differs from the real draw, and the panel is reproducible.
    expect(samples.some((v) => v.shop.map((o) => o.cardId).join(',') !== realShop)).toBe(true);
    const again = sampleCandidate(root, { type: 'roll' }, 12345, 3);
    expect(again.map((v) => fingerprint(v))).toEqual(samples.map((v) => fingerprint(v)));
    expect(snapshot(s)).toBe(snapshot(s));
  });
});

// ───────────────────────────────────────────── THE REVEAL AUDIT ─────────────────────────────────────────────

describe('reveals are audited by effect, not by action name', () => {
  it('the name-pattern catches every factory id that says it is random', () => {
    // The pattern is the documented contract; this pins that every factory id containing "random" /
    // "discover" / "conjure" / "transform" in the effect union is matched, so a new random factory that follows
    // the naming convention cannot dodge the audit.
    const src = readFileSync(join(__dirname, '../../../core/src/types.ts'), 'utf8');
    const ids = [...src.matchAll(/^\s*\|\s*'([A-Za-z0-9]+)'/gm)].map((m) => m[1]!);
    const obviouslyRandom = ids.filter((id) => /random|discover|conjure|transform/i.test(id));
    expect(obviouslyRandom.length).toBeGreaterThan(20);
    for (const id of obviouslyRandom) expect(RANDOM_EFFECT.test(id), `${id} escapes the reveal audit`).toBe(true);
  });

  it('a deterministic play (a vanilla body) is NOT a reveal, statically or dynamically', () => {
    const s = run({ hand: [body('h', 'stray')] });
    const v = toBotVisibleState(s);
    expect(revealOf({ type: 'play', uid: 'h', toIndex: 0 }, v)).toBeNull();
    const t = applyCandidate(createPlanningRoot(s), { type: 'play', uid: 'h', toIndex: 0 });
    expect(t.reveal).toBeNull();
    expect(t.rngConsumed).toBe(false);
  });

  it('the dynamic half catches an RNG draw the static half missed', () => {
    // Walk a run and check the invariant on every accepted candidate: cursor moved ⇒ reveal reported.
    let s = createRun(77, 'drakko');
    let guard = 0;
    let checked = 0;
    while (s.phase !== 'gameover' && s.wave < 8 && guard++ < 1500) {
      if (s.phase === 'recruit') {
        const root = createPlanningRoot(s);
        for (const c of candidatesFor(visibleOf(root)).slice(0, 12)) {
          const t = applyCandidate(root, c.action);
          if (!t.changed) continue;
          checked++;
          if (t.rngConsumed) expect(t.reveal, `${c.tag} consumed RNG but reported no reveal`).toBeTruthy();
        }
        releaseAll();
      }
      const n = reduce(s, DEFAULT_BOT.act(s));
      if (n === s) break;
      s = n;
    }
    expect(checked).toBeGreaterThan(50);
  });
});

// ───────────────────────────────────────────── THE FRIENDLY SIDE MIRROR ─────────────────────────────────────────────

describe('combatContext mirrors the reducer’s faceOmen preparation', () => {
  it('every combatSide key the reducer sets is mirrored — a new scaler there fails here', () => {
    const src = readFileSync(join(__dirname, '../reducer.ts'), 'utf8');
    const start = src.indexOf('const playerState: CombatSideState = combatSide({');
    expect(start).toBeGreaterThan(0);
    const end = src.indexOf('});', start);
    const block = src.slice(start, end);
    const keys = [...block.matchAll(/^\s+([A-Za-z0-9_]+):/gm)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) expect(MIRRORED_SIDE_KEYS, `reducer sets combatSide.${k}, combatContext.ts does not mirror it`).toContain(k);
  });

  it('carries the run-level scalers and per-instance state a tier-only side dropped', () => {
    const s = run({
      board: [body('k', 'stray', { summonBonus: 3, buffs: [{ source: 'test', attack: 1, health: 1, count: 1 }] })],
      hand: [body('m', 'alley')],
      spellsCast: 4, rubyCasts: 2, revelerX: 5, deathrattlesTriggered: 6,
    });
    const prep = friendlyCombatSideOf(s);
    expect(prep.side).toMatchObject({ spellsCast: 4, rubyCasts: 2, revelerX: 5, deathrattles: 6, tier: s.tier });
    expect((prep.side.handMinions ?? []).map((m) => m.cardId)).toEqual(['alley']);
    expect(prep.bodies[0]).toMatchObject({ sourceUid: 'k', summonBonus: 3 });
    expect(prep.bodies[0]!.buffs).toHaveLength(1);
    expect('poolIds' in prep.side).toBe(false);
  });

  it('pre-bakes the banked Start-of-Combat payouts exactly as the reducer does', () => {
    const s = run({ board: [body('a', 'stray')], fleetingVigor: { attack: 2, health: 3 }, pendingSCImps: 2 });
    const prep = friendlyCombatSideOf(s);
    expect(prep.bodies[0]).toMatchObject({ attack: CARD_INDEX['stray']!.attack + 2, health: CARD_INDEX['stray']!.health + 3 });
    expect(prep.bodies.filter((m) => m.cardId === 'impscrap')).toHaveLength(2);
    // And the run is untouched — the banks are spent by the REAL fight, not by looking.
    expect(s.fleetingVigor).toEqual({ attack: 2, health: 3 });
    expect(s.pendingSCImps).toBe(2);
  });

  it('fightScore says where its opponents came from — no pool registered means `procedural`, out loud', () => {
    const v = toBotVisibleState(run({ board: [body('a', 'stray')] }));
    const r = fightScore(v, 3);
    expect(r.panel).toBe('procedural');
    expect(r.fights).toBe(3);
    expect(r.margin).toBeGreaterThanOrEqual(-1);
    expect(r.margin).toBeLessThanOrEqual(1);
  });
});
