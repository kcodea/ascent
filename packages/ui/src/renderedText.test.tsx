// @vitest-environment jsdom
/**
 * RENDERED-TEXT RECONCILIATION — the DOM shows what the sim computed.
 *
 * The live-text rule (CLAUDE.md, owner rulings 2026-07-02/08) is wired through two chains that could drift
 * independently: `liveCardText` (shop / board / hand / Discover / end screen, via `instView`) and the combat
 * card text (`Unit.tsx`, which maps run + snapshot state into the SAME `liveCardText`). Helper-level tests
 * (`liveTextAudit`, `docbotLiveText`) prove the helpers compute the right string — but nothing proved the
 * RENDERED output equals the helper output. This harness mounts the real components under jsdom and closes
 * that gap:
 *
 *   1. SUBJECTS are derived from `cardText.ts`'s own dispatch (factory ids + explicit card-id gates +
 *      structural gates), so a new scaling card is auto-swept.
 *   2. SHOP CHAIN — every armed subject is mounted through the real `Card` and the `.desc` textContent must
 *      equal the helper's computed string (modulo the sanctioned marker→style transforms in `plainOf`).
 *   3. COMBAT CHAIN — exemplar subjects are mounted through the real `Unit` against a store run.
 *   4. CROSS-CHAIN — for those exemplars, the combat-rendered text must equal the SHOP chain's
 *      (`liveBoardView`) text for the same underlying state: exactly where the two param-mapping sites drift.
 *   5. BADGES — rendered attack/health digits equal state, buffed exemplars read green.
 *   6. Subjects the exemplar bags can't arm need an entry in `renderedText.registry.ts` (excuse + ratchet,
 *      the phaseRegistry discipline).
 *   7. SABOTAGE — a deliberately stale string must trip the reconciler.
 *
 * `beats:audit` fold: NOT here — `packages/tools/src/beat-audit.ts` is a top-level CLI script (argv + print
 * side effects at module scope), not an importable function; its CI-enforcing half already lives in
 * `packages/content/src/presentationPolicies.test.ts`. Folding the CLI is deferred to the integration pass.
 */
import { describe, expect, it, afterAll } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Keyword } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from '@game/sim';
import { Card, type CardView } from './Card';
import { Unit } from './Unit';
import { liveBoardView, liveCardText, type LiveTextParams } from './instView';
import { useGame } from './store';
import { badgeValuesOf, descTextOf, mount, normWs, plainOf } from './renderedText.mount';
import { RENDER_EXCUSED } from './renderedText.registry';
import type { UnitFrame } from './useCombatReplay';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ────────────────────────────── 1. the subject list, derived from cardText.ts ───────────────────────────── */

const SRC = readFileSync(join(HERE, 'cardText.ts'), 'utf8');
/** Factory ids the live-text chain keys on (`e.do === '…'`). */
const FACTORY_REFS = new Set([...SRC.matchAll(/e\.do === '([A-Za-z0-9_]+)'/g)].map((m) => m[1]!));
/** Set-literal ids (IMP_SUMMON_DOS and friends) — each is either a factory id or a card/rune id. */
for (const m of SRC.matchAll(/new Set(?:<[^>]*>)?\(\[([^\]]*)\]/g)) {
  for (const x of m[1]!.matchAll(/'([A-Za-z0-9_-]+)'/g)) FACTORY_REFS.add(x[1]!);
}
/** Explicit card-id gates (`cardId === '…'` / `cardId !== '…'` / `c.id === '…'`). */
const ID_GATES = new Set([...SRC.matchAll(/(?:cardId|c\.id)\s*[!=]==\s*'([A-Za-z0-9_-]+)'/g)].map((m) => m[1]!));

/** Structural gates in cardText.ts that don't key on a factory id — mirrored here, cited to their helper. */
const structuralSubject = (id: string): boolean => {
  const c = CARD_INDEX[id];
  if (!c) return false;
  // cadenceProgressText / escalatingCastText: any "every N turns" End-of-Turn effect.
  if (c.effects.some((e) => e.on === 'endOfTurn' && (e.params as { every?: number } | undefined)?.every !== undefined)) return true;
  // ascendProgressText: Tara-style ascension threshold.
  if (c.ascendAt && c.ascendInto) return true;
  // engraveTallyText: Engrave keyword accrues permanent mid-combat stats.
  if (c.keywords.includes('EG')) return true;
  return false;
};

/** Does this effect actually reach a cardText.ts branch? Mirrors the guards the helpers themselves apply, so
 *  a card whose factory is referenced only under a param guard it does not meet is not a false subject:
 *   - `deathrattleSummon` / `onFriendDeathSummon` count only for the Imp token (`cardSummonsImp`'s gate);
 *   - `buffShopPermanent` counts only with an `improve` param (`shopBuffImproveText`'s gate). */
const effectReachesHelper = (e: { do: string; params?: Record<string, unknown> }): boolean => {
  if (!FACTORY_REFS.has(e.do)) return false;
  if (e.do === 'deathrattleSummon' || e.do === 'onFriendDeathSummon') return e.params?.tokenId === 'impscrap';
  if (e.do === 'buffShopPermanent') return !!e.params?.improve;
  return true;
};

/** Every card the live-text system considers scaling. Spells and Rubies are out of scope here: their text
 *  goes through `spellDisplayText` (@game/sim) / the Ruby branch of `instView`, a different chain. */
const SUBJECTS = Object.values(CARD_INDEX)
  .filter((c) => !!c && !c.spell && !c.ruby && c.id !== 'discoverspell')
  .filter((c) => c!.effects.some(effectReachesHelper) || ID_GATES.has(c!.id) || structuralSubject(c!.id))
  .map((c) => c!.id)
  .sort();

/* ─────────────────────────────────── the arming bags (all scalers hot) ──────────────────────────────────── */

/** Every scaler hot, every counter mid-run, values distinctive (nothing 0/1) — same design as
 *  `docbotLiveText.test.ts`'s RICH bag. Per-card because `cardBuffs` keys by card id.
 *  Deliberately ABSENT: `taughtSpellId`, `chosenOption`, `rebirthOwner` — those early-return/append for ANY
 *  card and would rewrite every subject's text instead of arming its own scaler. */
const richBag = (id: string): LiveTextParams => ({
  tier: 5, golden: false,
  spellBonus: 2, spellBonusH: 3, frontToBackBonus: 2, frontToBackBonusH: 2, growthBonus: 2,
  spellsThisTurn: 3, spellsCast: 7, deathrattlesTriggered: 5, rubyCasts: 4, improveReps: 1,
  clingEnchant: { attack: 2, health: 3 }, fodderConsumed: { attack: 2, health: 2 },
  undeadBuyAtk: 2, soulsmanGold: 6,
  cardBuffs: { [id]: { attack: 2, health: 3 } }, impAura: { attack: 2, health: 3 },
  spellProgress: 5, ascendProgress: 2, summonBonus: 6, /* ≥ Hunter's every-5 improve step */ overflowBonus: 2, hpGrantBonus: 2,
  eotTick: 2, eotBonus: 2, sellBonus: 2, soldProgress: 2,
  playedThisTurn: ['alley', 'alley', 'alley'], attackSeen: 9, permaGain: { attack: 2, health: 2 },
  squirlScoutBuff: 3, conductorBuff: 3, onBoard: true,
  goldSpent: 6, goldSpentRun: 13, goldPouchValue: 2,
  alesThisTurn: 2, zooSummons: 2, rallySpreadAtk: 5,
  rubyBonus: { attack: 2, health: 2 },
  lastSpellName: 'Spirit Fire', rememberedSpellNames: ['Spirit Fire', 'Growth'],
  impBank: { attack: 2, health: 3 }, firstSpellThisTurnName: 'Growth', lastSpellThisTurnName: 'Spirit Fire',
  keeperFirstSpellName: 'Growth',
  runeFlags: { matriarch: true, brokerage: true, livingTreasure: true },
});

/** Per-card additions the generic bags must not set globally: `taughtSpellId` early-returns for ANY card, so
 *  it arms only its own owner here. Scoped by card id — safe by construction. */
const BAG_OVERRIDES: Readonly<Record<string, Partial<LiveTextParams>>> = {
  b2_magepup: { taughtSpellId: 'spiritfire' }, // Mage-Pup prints the taught spell's live rule
};

/** Bag variants: some gates are mutually exclusive (Skybound Ascendant arms WITHOUT Tier-7 access, Beyond
 *  the Summit arms WITH it), so a subject is armed if ANY bag moves its text off the printed base. */
const bagsFor = (id: string): LiveTextParams[] => [
  { ...richBag(id), ...BAG_OVERRIDES[id] },
  { ...richBag(id), tier7Access: true },
  { ...richBag(id), runeMammoth: true },
];

interface Armed { id: string; bag: LiveTextParams; text: string }
const armedOf = (id: string): Armed | null => {
  const def = CARD_INDEX[id]!;
  for (const bag of bagsFor(id)) {
    const { text } = liveCardText(id, bag);
    if (text !== def.text) return { id, bag, text };
  }
  return null;
};
const ARMED: Armed[] = SUBJECTS.map(armedOf).filter((a): a is Armed => a !== null);
const NOT_ARMED = SUBJECTS.filter((id) => !ARMED.some((a) => a.id === id));

/* ───────────────────────────────────────────── the harness ─────────────────────────────────────────────── */

const m = mount(null);
afterAll(() => m.unmount());

describe('rendered-text reconciliation — subjects', () => {
  it('the derivation finds a real worklist (guards against a vacuous sweep)', () => {
    // ~60 as of 2026-08-26. A refactor of cardText.ts that changes how helpers key on factories must fail
    // loudly here rather than let the sweep silently go blind.
    expect(SUBJECTS.length).toBeGreaterThanOrEqual(40);
    expect(ARMED.length).toBeGreaterThanOrEqual(35);
  });

  it('every subject arms under an exemplar bag, or carries a verifiable excuse (phaseRegistry discipline)', () => {
    const unexcused = NOT_ARMED.filter((id) => !RENDER_EXCUSED[id]);
    expect(
      unexcused.map((id) => `${id} (${CARD_INDEX[id]!.name})`),
      `Subject(s) the exemplar bags cannot arm and no excuse covers:\n  ${unexcused.join('\n  ')}\nEnrich the bags in this file until the card's live text engages, or register a RenderExcuse in renderedText.registry.ts with a verifiable reason.`,
    ).toEqual([]);
  });

  it('excuses are real: each names a current subject that genuinely does not arm', () => {
    const stale: string[] = [];
    for (const id of Object.keys(RENDER_EXCUSED)) {
      if (!SUBJECTS.includes(id)) stale.push(`${id}: excused but no longer a subject — delete the entry`);
      else if (ARMED.some((a) => a.id === id)) stale.push(`${id}: excused but the bags DO arm it now — delete the entry (the sweep wins)`);
    }
    expect(stale, `Stale excuse(s):\n  ${stale.join('\n  ')}`).toEqual([]);
  });

  it('the needs-triage backlog can only shrink (ratchet: 0 as of 2026-08-26)', () => {
    const triage = Object.entries(RENDER_EXCUSED).filter(([, e]) => e.kind === 'needs-triage');
    expect(triage.length, `needs-triage entries: ${triage.map(([d]) => d).join(', ')} — resolving one? lower this ratchet. Adding one? that needs a ruling, not a bigger number.`).toBeLessThanOrEqual(0);
  });
});

/** The shop-chain CardView for an armed subject, exactly as `instView` would shape the text fields. */
const shopViewOf = (a: Armed, golden = false): CardView => {
  const def = CARD_INDEX[a.id]!;
  const live = golden ? liveCardText(a.id, { ...a.bag, golden: true }) : { text: a.text, goldenText: liveCardText(a.id, a.bag).goldenText };
  return {
    name: def.name, cardId: a.id, tribe: def.tribe, tribe2: def.tribe2,
    attack: def.attack, health: def.health, keywords: def.keywords as Keyword[],
    golden, text: live.text, goldenText: live.goldenText ?? def.goldenText, tier: def.tier,
  };
};

describe('rendered-text reconciliation — shop chain (Card)', () => {
  it('every armed subject renders EXACTLY the helper string in .desc (numbers included)', () => {
    const mismatches: string[] = [];
    for (const a of ARMED) {
      m.render(<Card card={shopViewOf(a)} forceFull />);
      const rendered = descTextOf(m.container);
      const expected = plainOf(a.text);
      if (rendered !== expected) mismatches.push(`${a.id} (${CARD_INDEX[a.id]!.name}):\n    helper  "${expected}"\n    rendered "${rendered}"`);
    }
    expect(mismatches, `The DOM does not show what the helper computed:\n  ${mismatches.join('\n  ')}`).toEqual([]);
  });

  it('every live {{…}} payload renders inside a green .descup span (the marker must style, not leak)', () => {
    const failures: string[] = [];
    for (const a of ARMED) {
      const payloads = [...a.text.matchAll(/\{\{(.+?)\}\}/g)].map((x) => plainOf(x[1]!));
      if (payloads.length === 0) continue;
      m.render(<Card card={shopViewOf(a)} forceFull />);
      const greens = [...m.container.querySelectorAll('.desc .descup')].map((el) => normWs(el.textContent ?? ''));
      for (const p of payloads) {
        if (!greens.some((g) => g.includes(p))) failures.push(`${a.id}: live payload "${p}" not rendered green (descup spans: ${JSON.stringify(greens)})`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('golden variants render EXACTLY the golden helper string (the {{…}} doubling stays folded, not re-doubled)', () => {
    const mismatches: string[] = [];
    for (const a of ARMED) {
      const liveG = liveCardText(a.id, { ...a.bag, golden: true });
      // Only reconcile when the golden live text resolved: liveCardText then feeds it as goldenText, and the
      // Card must render it verbatim (its generic doubleNums pass is only the fallback for unarmed cards).
      if (liveG.goldenText === undefined) continue;
      m.render(<Card card={shopViewOf(a, true)} forceFull />);
      const rendered = descTextOf(m.container);
      const expected = plainOf(liveG.goldenText);
      if (rendered !== expected) mismatches.push(`${a.id} (golden):\n    helper  "${expected}"\n    rendered "${rendered}"`);
    }
    expect(mismatches, `Golden DOM does not show the golden helper string:\n  ${mismatches.join('\n  ')}`).toEqual([]);
  });
});

/* ───────────────────────── combat chain + cross-chain drift (Unit vs liveBoardView) ─────────────────────── */

/** Exemplars whose scaler state lives where BOTH chains read it (per-instance accrual or run scaler), so the
 *  shop chain (`liveBoardView`) and the combat chain (`Unit`) must print the SAME string for the same state. */
interface CrossExemplar { id: string; run?: Partial<RunState>; inst?: Partial<BoardCard> & Partial<UnitFrame> }
const CROSS: CrossExemplar[] = [
  { id: 'guel', inst: { spellProgress: 9 } }, //         per-instance spell tally
  // Crypt Drake: the accrued grant only — `attackSeen` is deliberately NOT set, because its "N to go"
  // countdown is a combat-only clause by design (cryptDrakeText: "shop view after combats: live magnitude,
  // no countdown"; instView carries no attackSeen). Setting it here would flag an INTENTIONAL difference.
  { id: 'cryptdrake', inst: { summonBonus: 2 } },
  { id: 'sergeant', inst: { hpGrantBonus: 3 } }, //      per-instance Deathrattle accrual
  { id: 'ritualist', inst: { eotBonus: 3 } }, //         per-instance End-of-Turn accrual
  { id: 'b2_groveweaver', inst: { summonBonus: 4 } }, // per-instance summon-buff accrual
  { id: 'd2_herzog', run: { spellsCast: 8 } }, //        run-scoped spell umbrella
  { id: 'chefraag', run: { impBuff: { attack: 2, health: 3 } } }, // run-scoped Imp Aura
  { id: 'n2_wanderer', run: { goldSpent: 13 } }, //      run-lifetime Gold meter
];

const runFor = (x: CrossExemplar): RunState => ({ ...createRun(7), ...x.run }) as RunState;
const boardCardFor = (x: CrossExemplar): BoardCard => {
  const def = CARD_INDEX[x.id]!;
  return {
    uid: `m-${x.id}`, cardId: x.id, tribe: def.tribe, attack: def.attack, health: def.health,
    keywords: [...def.keywords] as Keyword[], golden: false, ...x.inst,
  } as BoardCard;
};
const frameFor = (x: CrossExemplar): UnitFrame => {
  const def = CARD_INDEX[x.id]!;
  return {
    uid: `u-${x.id}`, cardId: x.id, name: def.name, tribe: def.tribe,
    attack: def.attack, health: def.health, keywords: [...def.keywords] as Keyword[],
    divineShield: false, alive: true, golden: false, summonBonus: 0,
    baseAttack: def.attack, baseHealth: def.health, ...x.inst,
  };
};

/** Mount a player-side Unit against a store run and return its rendered rules text. The store update is
 *  wrapped in act(): mounted Units subscribe to `useGame`, so setState IS a React state update. */
const renderUnit = (u: UnitFrame, run: RunState): string => {
  act(() => { useGame.setState({ run, compactCards: false }); });
  m.render(<Unit u={u} side="you" />);
  return descTextOf(m.container);
};

describe('rendered-text reconciliation — combat chain + cross-chain drift', () => {
  it('each exemplar actually arms on the shop chain (sanity: the comparison below is not vacuous)', () => {
    for (const x of CROSS) {
      const shopText = liveBoardView(boardCardFor(x), runFor(x)).text;
      expect(shopText, `${x.id}: the exemplar state did not move the shop text off the printed base`).not.toBe(CARD_INDEX[x.id]!.text);
    }
  });

  it('the combat-rendered text equals the shop chain for the same state (where the two chains drift)', () => {
    const drifts: string[] = [];
    for (const x of CROSS) {
      const run = runFor(x);
      const shopText = plainOf(liveBoardView(boardCardFor(x), run).text);
      const combatText = renderUnit(frameFor(x), run);
      if (combatText !== shopText) drifts.push(`${x.id} (${CARD_INDEX[x.id]!.name}):\n    shop   "${shopText}"\n    combat "${combatText}"`);
    }
    expect(drifts, `CROSS-CHAIN DRIFT — the combat card and the shop card print different strings for the same state:\n  ${drifts.join('\n  ')}`).toEqual([]);
  });
});

/* ──────────────────────────────────────── badge / stat displays ─────────────────────────────────────────── */

describe('rendered-text reconciliation — stat badges', () => {
  it('shop: rendered attack/health digits equal the view state; buffed stats read green (.up)', () => {
    const def = CARD_INDEX['sergeant']!;
    const view: CardView = {
      name: def.name, cardId: 'sergeant', tribe: def.tribe, attack: 9, health: 11,
      keywords: def.keywords as Keyword[], golden: false, text: def.text, tier: def.tier,
      baseAttack: def.attack, baseHealth: def.health, // buffed exemplar: 9/11 over a 6/6 base
    };
    m.render(<Card card={view} forceFull />);
    expect(badgeValuesOf(m.container)).toEqual({ attack: '9', health: '11' });
    expect(m.container.querySelector('.badge.atk')!.className).toContain('up');
    expect(m.container.querySelector('.badge.hp')!.className).toContain('up');
  });

  it('combat: rendered digits equal the UnitFrame stats; a stat below its combat floor reads red (.down)', () => {
    const x = CROSS[0]!;
    const run = runFor(x);
    const u: UnitFrame = { ...frameFor(x), attack: 10, health: 3, baseAttack: 6, baseHealth: 7 };
    renderUnit(u, run);
    expect(badgeValuesOf(m.container)).toEqual({ attack: '10', health: '3' });
    expect(m.container.querySelector('.badge.hp')!.className).toContain('down'); // 3 below the floor of 7
  });
});

/* ─────────────────────────────────────────── sabotage proof ─────────────────────────────────────────────── */

describe('rendered-text reconciliation — sabotage proof', () => {
  it('a deliberately stale string trips the reconciler (the harness can actually fail)', () => {
    const a = ARMED.find((x) => x.id === 'guel') ?? ARMED[0]!;
    const def = CARD_INDEX[a.id]!;
    // Feed the Card the PRINTED base text while the state says the helper output differs — the exact bug
    // shape this harness exists for. The reconciliation comparison must report a mismatch.
    m.render(<Card card={{ ...shopViewOf(a), text: def.text }} forceFull />);
    const rendered = descTextOf(m.container);
    expect(a.text).not.toBe(def.text); // the state IS armed…
    expect(rendered).not.toBe(plainOf(a.text)); // …and the stale DOM fails reconciliation, as it must
    expect(rendered).toBe(plainOf(def.text)); // (and for the right reason: it shows the stale base)
  });
});
