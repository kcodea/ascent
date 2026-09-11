/**
 * DOC BOT 2.0 WP D — FAMILY DRIVERS, the shared staging + observation kit (2026-09-11).
 *
 * The contract oracle's first five drivers were written PER OBJECT SHAPE (a death summon, an avenge
 * threshold, a battlecry summon, a copy policy, a gilded token). That left 471 applicable cases skipped
 * `no-driver-for-shape` — Doc Bot's single largest verification hole. The drivers in this directory are
 * written PER CLAIM FAMILY instead: a contract that states "+A/+H" is driven the same way whether the grant
 * rides a Shout, a Rally, an Echo or a spell cast — what differs is only HOW the trigger is made to fire,
 * and that is this module's job.
 *
 * Two halves, both through the REAL engine (§4.1 — nothing here re-implements card behaviour):
 *
 *  · STAGING — `stageShop` fires a shop-phase trigger through the real reducer (`reduce`, `applyEndOfTurn`,
 *    `applyStartOfTurn`) under the playDifferential fixture (`playFixture`, reused, not re-invented);
 *    `stageCombat` fires a combat-phase trigger through the real `simulate()` with the contract oracle's
 *    sandbag fixtures. Every stager returns EVERY variant it could build (a watcher is fed a subject of each
 *    tribe, a Start-of-Combat gets a lone body and a tribe-rich board) so a driver can try each until the
 *    effect is observed — and an un-stageable trigger returns nothing, which the planner already typed as a
 *    skip (never a silent pass, §4.3).
 *
 *  · OBSERVATION — per-uid stat deltas across board/hand/shop plus the run-wide {attack, health} fields,
 *    cards gained, numeric run-field deltas (the economy), keywords gained; in combat the authoritative event
 *    log (buff / handBuff / summon / toHand / keyword / sc events). Drivers compare these to the CONTRACT's
 *    declared params — never to "something changed".
 */
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef } from '@game/core';
import type { ContentContract, ContractObservation } from '@game/rules/contracts/schema';
import { reduce } from '../../reducer';
import { applyEndOfTurn, applyStartOfTurn } from '../../recruit';
import type { BoardCard, RunState } from '../../state';
import { playFixture, VANILLA_CONTROL_ID } from '../playScan';
import type { ExecutedCase } from '../contractOracle';
import type { MetamorphicCheck } from '../variantDiff';
import { ALL_TRIBES } from './families';

export { ALL_TRIBES, COMBAT_STAGEABLE, SHOP_STAGEABLE, constAmount, gildFactor, keysWithin, stageableTrigger } from './families';

// ── the driver context (moved here from contractOracle.ts so drivers never import the oracle) ────────────

export interface DriverCtx {
  obs: (contractId: string, path: string, observed: ContractObservation['observed'], evidence: string) => void;
  executed: ExecutedCase[];
  metamorphic: MetamorphicCheck[];
  limitChecks: Array<{ contractId: string; limit: string; ok: boolean; detail: string }>;
}

// ── combat fixture helpers (the slice's harness pattern, shared with the original drivers) ───────────────

export const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [], ...extra });

export type Sim = ReturnType<typeof simulate>;

/** The side context the original drivers were measured under (the slice's seven tribes) — kept verbatim so
 *  their fixtures stay byte-identical; `lastSpellCastId` is armed for the stored-spell Echo family. */
const FIGHT_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];

export function fight(player: BoardMinion[], enemy: BoardMinion[], mods: Record<string, unknown> = {}, seed = 1): Sim {
  return simulate(player, enemy, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: FIGHT_TRIBES, questMods: mods, lastSpellCastId: 'growth' } as never),
    combatSide({ tier: 1 }));
}

export const FILLER = (): BoardMinion => bm('sandbag', 0, 50);

// ── shop staging ─────────────────────────────────────────────────────────────────────────────────────────

export interface ShopStage {
  /** Which variant this is (a tribe-fed watcher, a lone body …) — printed in evidence. */
  variant: string;
  before: RunState;
  after: RunState;
  /** The uid the contract's body wears in this stage. */
  sourceUid: string;
  /** The subject card played past a watcher (its own consequences are NOT the source's). */
  subjectUid?: string;
  /** Gold the staging itself spent (a spell's real cost in this run) — added back to economy deltas. */
  costPaid: number;
  /** The SAME staging with the vanilla control body in the source's place: everything the fixture does on
   *  its own (a subject spell's own buff, an offer's price, a sale's base value, a Discover the subject
   *  raised) is measured here and SUBTRACTED, so only the source's consequences remain. Absent for a cast
   *  (a spell has no body to swap for the control). */
  baseline?: RunState;
  /** The play was refused (the card is still in hand) — recorded, never a silent pass. */
  refused?: boolean;
}

let BASE: RunState | null = null;
/** The playDifferential fixture, built once (the reducer never mutates its input). */
export function shopBase(): RunState {
  if (!BASE) BASE = playFixture().state;
  return BASE;
}

let TRIBE_RICH: RunState | null = null;
/** The same fixture with a TRIBE-RICH board — one effect-free body of each tribe the base board lacks — so
 *  a tribe-scoped grant ("give your Dragons …", "a friendly Dwarf") finds a subject. Second variant, tried
 *  when the base fixture shows nothing. */
export function shopBaseTribeRich(): RunState {
  if (!TRIBE_RICH) {
    const base = shopBase();
    const bodies = ['dragon', 'dwarf', 'kobold', 'demon', 'spirit', 'celestial'].map((t, i) => instOf(`rich${i}`, tribeSubject(t), false));
    TRIBE_RICH = { ...base, board: bodies };
  }
  return TRIBE_RICH;
}

export const instOf = (uid: string, def: CardDef, golden: boolean): BoardCard => ({
  uid, cardId: def.id, tribe: def.tribe,
  attack: (golden ? 2 : 1) * def.attack, health: (golden ? 2 : 1) * def.health,
  keywords: [...def.keywords], golden,
} as BoardCard);

const isClean = (d: CardDef | undefined): d is CardDef =>
  !!d && !d.spell && !d.token && !(d as { ruby?: boolean }).ruby && !d.henchman && d.effects.length === 0
  && !d.triggerMultiplier && !d.chooseOne && !d.noTriple;

/** A subject of one tribe to play past a watcher — an effect-free body when the pool has one, so its own
 *  play adds no consequences of its own; otherwise the first minion of that tribe (playScan's pick). */
export function tribeSubject(tribe: string): CardDef {
  const all = Object.values(CARD_INDEX).filter((c): c is CardDef => !!c && !c.spell && !c.token && !(c as { ruby?: boolean }).ruby);
  return all.find((c) => isClean(c) && (c.tribe === tribe || c.tribe2 === tribe))
    ?? all.find((c) => c.tribe === tribe || c.tribe2 === tribe)
    ?? CARD_INDEX[VANILLA_CONTROL_ID]!;
}

/** A Shout body to play past a `battlecryTriggered` watcher: any onPlay minion whose Shout is a plain
 *  self-contained stat effect (no target prompt), so the watcher — not the subject — is what we read. */
function shoutSubject(): CardDef {
  return Object.values(CARD_INDEX).find((c): c is CardDef => !!c && !c.spell && !c.token
    && c.effects.some((e) => e.on === 'onPlay' && /BuffSelf|GainKeyword|GrantSpellPowerRun|GetRubies/.test(e.do))
    && !c.chooseOne)
    ?? Object.values(CARD_INDEX).find((c): c is CardDef => !!c && !c.spell && !c.token && c.effects.some((e) => e.on === 'onPlay'))!;
}

const vanillaSpellId = (): string => Object.values(CARD_INDEX).find((c) => c?.spell && !c.token && (c.effects?.length ?? 0) > 0)!.id;

/** Auto-resolve the modal a play may have raised (a Discover pick, a Choose One, a deferred target), so the
 *  staged effect completes without an interactive window — the first option every time (deterministic). */
function settleModals(s: RunState, sourceUid: string, chooseIndex = 0): RunState {
  let cur = s;
  for (let i = 0; i < 4; i++) {
    if (cur.chooseOne) cur = reduce(cur, { type: 'chooseOne', index: chooseIndex });
    else if (cur.pendingTarget) {
      // A tribe-restricted aim refuses an ineligible target and keeps the prompt up — try every other body.
      const pending = cur;
      for (const t of pending.board.filter((c) => c.uid !== sourceUid)) {
        cur = reduce(pending, { type: 'battlecryTarget', targetUid: t.uid });
        if (!cur.pendingTarget) break;
      }
      if (cur.pendingTarget) break;
    } else if (cur.discover?.length) cur = reduce(cur, { type: 'discover', index: 0 });
    else break;
  }
  return cur;
}

const withBoard = (base: RunState, extra: BoardCard[]): RunState =>
  ({ ...base, board: [...base.board.slice(0, Math.max(0, 7 - extra.length - 1)), ...extra] });

/**
 * Fire one shop trigger for the contract's body through the real reducer. Returns every variant built (the
 * driver tries each until observed) — empty when the trigger is not stageable here.
 */
export interface StageOptions {
  /** The Choose One branch to pick (0-based) when the play raises the prompt. */
  chooseIndex?: number;
}

export function stageShop(c: ContentContract, event: string, golden: boolean, opts: StageOptions = {}): ShopStage[] {
  // Two fixtures per staging: the playDifferential base, then the tribe-rich board (drivers try each in
  // order and read the first that shows anything).
  return [
    ...stageShopOn(shopBase(), '', c, event, golden, opts),
    ...stageShopOn(shopBaseTribeRich(), ' [tribe-rich board]', c, event, golden, opts),
  ];
}

function stageShopOn(base: RunState, suffix: string, c: ContentContract, event: string, golden: boolean, opts: StageOptions): ShopStage[] {
  const def = CARD_INDEX[c.contentId];
  const control = CARD_INDEX[VANILLA_CONTROL_ID];
  if (!def || !control) return [];
  const chooseIndex = opts.chooseIndex ?? 0;
  const SRC = 'docbotSrc';
  const src = instOf(SRC, def, golden);
  // The control wears the source's stats + keywords (a stat-clone, like combatScan's) — only the identity differs.
  const ctrl: BoardCard = { ...src, cardId: control.id, tribe: control.tribe };
  const stages: ShopStage[] = [];
  const push = (variant: string, before: RunState, after: RunState, extra: Partial<ShopStage> = {}): void => {
    stages.push({ variant: variant + suffix, before, after, sourceUid: SRC, costPaid: 0, ...extra });
  };
  /** Build a stage from a `before` that contains the source, plus the same `act` on the control-body twin. */
  const staged = (variant: string, before: RunState, act: (s: RunState) => RunState, extra: Partial<ShopStage> = {}): void => {
    const swap = (s: RunState): RunState => ({
      ...s,
      board: s.board.map((x) => (x.uid === SRC ? ctrl : x)),
      hand: s.hand.map((x) => (x.uid === SRC ? ctrl : x)),
      shop: s.shop.map((o) => (o.uid === 'docbotOff' ? { ...o, cardId: control.id } : o)),
    });
    push(variant, before, act(before), { baseline: act(swap(before)), ...extra });
  };

  switch (event) {
    case 'onPlay':
    case 'cast':
    case 'equip': {
      const before = { ...base, hand: [...base.hand, src] };
      const act = (s: RunState): RunState => settleModals(reduce(s, { type: 'play', uid: SRC, targetUid: 'fix0' }), SRC, chooseIndex);
      const played = act(before);
      const refused = played.hand.some((h) => h.uid === SRC);
      const variant = `played from hand (target fix0${def.chooseOne ? `, Choose One branch ${chooseIndex + 1}` : ''})`;
      if (def.spell) {
        // No body to swap for the control — the Gold the cast ACTUALLY charged (the reducer's own spend
        // ledger, `goldSpentThisTurn`) is added back instead; a printed cost is not what this run paid.
        const costPaid = (played.goldSpentThisTurn ?? 0) - (before.goldSpentThisTurn ?? 0);
        push(variant, before, played, { costPaid, ...(refused ? { refused: true } : {}) });
      } else {
        push(variant, before, played, { baseline: act({ ...base, hand: [...base.hand, ctrl] }), ...(refused ? { refused: true } : {}) });
      }
      return stages;
    }
    case 'onSell': {
      staged('sold from the board', withBoard(base, [src]), (s) => reduce(s, { type: 'sell', uid: SRC }));
      return stages;
    }
    case 'endOfTurn': {
      staged('End of Turn (applyEndOfTurn)', withBoard(base, [src]), (s) => { const a = structuredClone(s); applyEndOfTurn(a); return a; });
      return stages;
    }
    case 'startOfTurn': {
      staged('Start of Turn (applyStartOfTurn)', withBoard(base, [src]), (s) => { const a = structuredClone(s); applyStartOfTurn(a); return a; });
      return stages;
    }
    case 'minionSold': {
      staged("another minion ('fix0') sold", withBoard(base, [src]), (s) => reduce(s, { type: 'sell', uid: 'fix0' }), { subjectUid: 'fix0' });
      return stages;
    }
    case 'spellCast': {
      const spell = CARD_INDEX[vanillaSpellId()]!;
      staged(`a ${spell.name} cast from hand`, withBoard(base, [src]),
        (s) => settleModals(reduce(s, { type: 'play', uid: 'spareSpell', targetUid: 'fix0' }), SRC), { subjectUid: 'spareSpell' });
      return stages;
    }
    case 'spellCastOnThis': {
      const spell = CARD_INDEX[vanillaSpellId()]!;
      staged(`a ${spell.name} cast ON it`, withBoard(base, [src]),
        (s) => settleModals(reduce(s, { type: 'play', uid: 'spareSpell', targetUid: SRC }), SRC), { subjectUid: 'spareSpell' });
      return stages;
    }
    case 'spellBought': {
      staged('a spell offer bought', { ...withBoard(base, [src]), shop: [...base.shop, { uid: 'docbotSpellOff', cardId: vanillaSpellId() }] },
        (s) => reduce(s, { type: 'buy', uid: 'docbotSpellOff' }), { subjectUid: 'docbotSpellOff' });
      return stages;
    }
    case 'onSummon':
    case 'onTribePlayed': {
      for (const tribe of ALL_TRIBES) {
        const subject = tribeSubject(tribe);
        staged(`a ${tribe} (${subject.name}) played past it`, { ...withBoard(base, [src]), hand: [...base.hand, instOf('docbotSubj', subject, false)] },
          (s) => settleModals(reduce(s, { type: 'play', uid: 'docbotSubj', targetUid: 'fix0' }), 'docbotSubj'), { subjectUid: 'docbotSubj' });
      }
      return stages;
    }
    case 'battlecryTriggered': {
      const subject = shoutSubject();
      staged(`a Shout (${subject.name}) played past it`, { ...withBoard(base, [src]), hand: [...base.hand, instOf('docbotSubj', subject, false)] },
        (s) => settleModals(reduce(s, { type: 'play', uid: 'docbotSubj', targetUid: 'fix0' }), 'docbotSubj'), { subjectUid: 'docbotSubj' });
      return stages;
    }
    case 'onBuy': {
      staged('bought from the tavern', { ...base, shop: [...base.shop, { uid: 'docbotOff', cardId: def.id, ...(golden ? { golden: true } : {}) }] },
        (s) => reduce(s, { type: 'buy', uid: 'docbotOff' }), { sourceUid: 'docbotOff' });
      return stages;
    }
    case 'goldSpent':
    case 'cardsBought':
    case 'onGainCard': {
      staged("an offer ('off0') bought", withBoard(base, [src]), (s) => reduce(s, { type: 'buy', uid: 'off0' }), { subjectUid: 'off0' });
      return stages;
    }
    case 'shopRefreshed': {
      staged('the tavern refreshed', withBoard(base, [src]), (s) => reduce(s, { type: 'roll' }));
      return stages;
    }
    default:
      return [];
  }
}

// ── combat staging ───────────────────────────────────────────────────────────────────────────────────────

export interface CombatStage {
  variant: string;
  sim: Sim;
  /** The contract body's uid in `sim.initial` (remapped by simulate; resolved by cardId). */
  sourceCardId: string;
  /** The same fight with a stat-clone CONTROL body in the source's place (combatScan's differential) — the
   *  activation family diffs the two with identities masked. */
  control?: Sim;
}

export interface CombatStageOptions {
  /** Also run the control-body twin of every fight. */
  control?: boolean;
}

/** The first effect-free body of one tribe, for tribe-rich boards (never the contract's own card). */
function tribeBody(tribe: string, exclude: string, attack = 1, health = 30): BoardMinion {
  const def = tribeSubject(tribe);
  return bm(def.id === exclude ? VANILLA_CONTROL_ID : def.id, attack, health);
}

/**
 * Fire one combat trigger for the contract's body through the real `simulate()`. Each trigger gets the
 * smallest fixture that provably fires it: a Taunt body that dies, a lone attacker vs a 0-attack sandbag, a
 * killer vs 1/1s, a pokeable wall, a watcher beside a known Echo summoner. Returns every variant.
 */
export function stageCombat(c: ContentContract, event: string, golden: boolean, opts: CombatStageOptions = {}): CombatStage[] {
  const def = CARD_INDEX[c.contentId];
  if (!def || def.spell) return [];
  const m = golden ? 2 : 1;
  const g: Partial<BoardMinion> = golden ? { golden: true } : {};
  const kw = [...def.keywords];
  const id = c.contentId;
  const stages: CombatStage[] = [];
  // The control wears the subject's tribes behaviourally (combatScan's rule), so tribal auras hit both alike.
  const controlOf = (b: BoardMinion): BoardMinion => ({
    ...b, cardId: VANILLA_CONTROL_ID,
    ...(def.tribe !== 'neutral' || def.tribe2 ? { addedTribes: [def.tribe, ...(def.tribe2 ? [def.tribe2] : [])] as never } : {}),
    ...(def.universalTribe ? { universalTribe: true } : {}),
  });
  const push = (variant: string, player: BoardMinion[], enemy: BoardMinion[]): void => {
    stages.push({
      variant, sim: fight(player, enemy), sourceCardId: id,
      ...(opts.control ? { control: fight(player.map((b) => (b.cardId === id ? controlOf(b) : b)), enemy) } : {}),
    });
  };
  const allies = ALL_TRIBES.slice(0, 6).map((t) => tribeBody(t, id));

  switch (event) {
    case 'onDeath':
      push('the Taunt body died to a 5-attack enemy', [bm(id, m, m, { keywords: ['T'], ...g })], [bm('sandbag', 5, 4000)]);
      push('the Taunt body died beside a tribe-rich board', [bm(id, m, m, { keywords: ['T'], ...g }), ...allies], [bm('sandbag', 5, 4000)]);
      return stages;
    case 'onAttack':
      // A 0/1 sandbag dies to the FIRST swing, so exactly ONE Rally fires — the per-activation count a
      // contract states (three swings read "get 3 Rubies" as 9).
      push('the lone body attacked a 0/1 sandbag (one Rally)', [bm(id, m, 400, { keywords: kw, ...g })], [bm('sandbag', 0, 1)]);
      push('the body attacked a 0/1 sandbag beside a tribe-rich board (one Rally)', [bm(id, m, 400, { keywords: kw, ...g }), ...allies], [bm('sandbag', 0, 1)]);
      return stages;
    case 'startOfCombat':
      push('a lone body at Start of Combat', [bm(id, m, 10 * m, { keywords: kw, ...g })], [bm('sandbag', 1, 10)]);
      push('a tribe-rich board at Start of Combat', [bm(id, m, 10 * m, { keywords: kw, ...g }), ...allies], [bm('sandbag', 1, 10)]);
      return stages;
    case 'onKill':
      push('the body killed three 1/1s', [bm(id, 5 * m, 400, { keywords: kw, ...g })], [bm('pup', 1, 1), bm('pup', 1, 1), bm('pup', 1, 1)]);
      return stages;
    case 'onDamaged':
      push('a 1-attack enemy poked the body', [bm(id, m, 400, { keywords: kw, ...g })], [bm('sandbag', 1, 30)]);
      return stages;
    case 'onSummon':
      push('a Wolves\' Den Echo summoned three Crypt Wolves beside it', [bm('wolvesden', 1, 1, { keywords: ['T'] }), bm(id, m, 400, { keywords: kw, ...g })], [bm('sandbag', 5, 4000)]);
      return stages;
    case 'onRise':
      // A Rise (Reborn) Taunt body dies and returns — the `onRise` watchers fire on the return.
      push('the Rise Taunt body died and rose', [bm(id, m, m, { keywords: [...new Set([...kw, 'T', 'R'])] as never, ...g })], [bm('sandbag', 5, 4000)]);
      push('a Rise Taunt ally died and rose beside it', [bm('cryptwolf', 1, 1, { keywords: ['T', 'R'] }), bm(id, m, 400, { keywords: kw, ...g })], [bm('sandbag', 5, 4000)]);
      return stages;
    case 'summonOverflow':
      // A full board: Wolves' Den's three wolves have one slot — the other two overflow.
      push('a Wolves\' Den Echo overflowed a full board beside it',
        [bm('wolvesden', 1, 1, { keywords: ['T'] }), bm(id, m, 400, { keywords: kw, ...g }), FILLER(), FILLER(), FILLER(), FILLER(), FILLER()], [bm('sandbag', 5, 4000)]);
      return stages;
    case 'friendlyDemonDealtDamage':
      push('a friendly Demon landed a hit beside it', [bm(id, m, 400, { keywords: kw, ...g }), tribeBody('demon', id, 3, 400)], [bm('sandbag', 1, 30)]);
      return stages;
    default:
      return [];
  }
}

// ── shop observation ─────────────────────────────────────────────────────────────────────────────────────

export interface UnitDelta {
  key: string;
  zone: 'board' | 'hand' | 'shop' | 'run';
  cardId?: string;
  dA: number;
  dH: number;
}

interface StatSnapshot { key: string; zone: UnitDelta['zone']; cardId?: string; attack: number; health: number }

/** Every {attack, health}-bearing thing in a run state, keyed so before/after line up: board + hand cards by
 *  uid, shop offers by uid (their `atk`/`hp` riders), and run-wide aura objects / `*Atk`+`*Hp` field pairs. */
function statSnapshot(s: RunState): StatSnapshot[] {
  const out: StatSnapshot[] = [];
  for (const c of s.board) out.push({ key: c.uid, zone: 'board', cardId: c.cardId, attack: c.attack, health: c.health });
  for (const c of s.hand) out.push({ key: c.uid, zone: 'hand', cardId: c.cardId, attack: c.attack, health: c.health });
  for (const o of s.shop) out.push({ key: o.uid, zone: 'shop', cardId: o.cardId, attack: o.atk ?? 0, health: o.hp ?? 0 });
  const rec = s as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(rec)) {
    if (/Fx/.test(k)) continue; // presentation stamps carry amounts too — never a consequence
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      const atk = typeof o.attack === 'number' ? o.attack : typeof o.atk === 'number' ? o.atk : undefined;
      const hp = typeof o.health === 'number' ? o.health : typeof o.hp === 'number' ? o.hp : undefined;
      if (atk !== undefined && hp !== undefined) out.push({ key: `run:${k}`, zone: 'run', attack: atk, health: hp });
    } else if (typeof v === 'number' && /(Atk|Attack)$/.test(k)) {
      const hk = k.replace(/Atk$/, 'Hp').replace(/Attack$/, 'Health');
      const h = rec[hk];
      out.push({ key: `run:${k.replace(/(Atk|Attack)$/, '')}`, zone: 'run', attack: v, health: typeof h === 'number' ? h : 0 });
    }
  }
  return out;
}

function rawUnitDeltas(before: RunState, after: RunState): UnitDelta[] {
  const b = new Map(statSnapshot(before).map((x) => [x.key, x]));
  const out: UnitDelta[] = [];
  for (const a of statSnapshot(after)) {
    // A run-wide aura object that did not exist before (`rubyBonus` minted by the first Ruby Power) is a
    // delta from zero; a board/hand/shop card that did not exist before is an ARRIVAL, not a delta.
    const prev = b.get(a.key) ?? (a.zone === 'run' ? { ...a, attack: 0, health: 0 } : undefined);
    if (!prev) continue;
    const dA = a.attack - prev.attack;
    const dH = a.health - prev.health;
    if (dA !== 0 || dH !== 0) out.push({ key: a.key, zone: a.zone, ...(a.cardId ? { cardId: a.cardId } : {}), dA, dH });
  }
  return out;
}

/** Per-key stat deltas of a stage, with the control-body baseline's deltas SUBTRACTED per key (so a subject
 *  spell's own buff, or a Rally the fixture would fire anyway, never reads as the source's grant). The source
 *  body itself is compared def-relative through its uid, so a golden body's base ×2 is not a delta. */
export function unitDeltas(st: ShopStage): UnitDelta[] {
  const raw = rawUnitDeltas(st.before, st.after);
  if (!st.baseline) return raw;
  const base = new Map(rawUnitDeltas(st.before, st.baseline).map((d) => [d.key, d]));
  const out: UnitDelta[] = [];
  const seen = new Set<string>();
  for (const d of raw) {
    seen.add(d.key);
    const b = base.get(d.key);
    const dA = d.dA - (b?.dA ?? 0);
    const dH = d.dH - (b?.dH ?? 0);
    if (dA !== 0 || dH !== 0) out.push({ ...d, dA, dH });
  }
  // A unit the baseline moved but the source run did not is a NEGATIVE consequence (the source suppressed it).
  for (const [key, b] of base) if (!seen.has(key)) out.push({ ...b, dA: -b.dA, dH: -b.dH });
  return out;
}

function rawGained(before: RunState, after: RunState): Array<{ uid: string; cardId: string; zone: 'board' | 'hand' | 'shop' }> {
  const seen = new Set([...before.board, ...before.hand, ...before.shop].map((c) => c.uid));
  const out: Array<{ uid: string; cardId: string; zone: 'board' | 'hand' | 'shop' }> = [];
  for (const c of after.board) if (!seen.has(c.uid)) out.push({ uid: c.uid, cardId: c.cardId, zone: 'board' });
  for (const c of after.hand) if (!seen.has(c.uid)) out.push({ uid: c.uid, cardId: c.cardId, zone: 'hand' });
  for (const c of after.shop) if (!seen.has(c.uid)) out.push({ uid: c.uid, cardId: c.cardId, zone: 'shop' });
  return out;
}

/** Cards present after but not before (hand + board + shop), minus what the control-body baseline gained
 *  (a bought offer, a Discover the subject raised, the fixture's own refresh) — matched as a multiset by id. */
export function gainedCards(st: ShopStage): Array<{ uid: string; cardId: string; zone: 'board' | 'hand' | 'shop' }> {
  const raw = rawGained(st.before, st.after);
  if (!st.baseline) return raw;
  const budget = new Map<string, number>();
  for (const g of rawGained(st.before, st.baseline)) budget.set(g.cardId, (budget.get(g.cardId) ?? 0) + 1);
  return raw.filter((g) => {
    const n = budget.get(g.cardId) ?? 0;
    if (n > 0) { budget.set(g.cardId, n - 1); return false; }
    return true;
  });
}

function rawFieldDeltas(before: RunState, after: RunState): Record<string, number> {
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    const x = b[k]; const y = a[k];
    if (typeof y === 'number' && (typeof x === 'number' || x === undefined) && y !== (x ?? 0)) out[k] = y - ((x as number | undefined) ?? 0);
  }
  return out;
}

/** Top-level numeric run-field deltas (the economy's surface: embers, bonusEmbersNextTurn, maxEmbers, …),
 *  minus the control-body baseline's (an offer's price, a sale's base value). */
export function numericFieldDeltas(st: ShopStage): Record<string, number> {
  const raw = rawFieldDeltas(st.before, st.after);
  if (!st.baseline) return raw;
  const base = rawFieldDeltas(st.before, st.baseline);
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(raw), ...Object.keys(base)])) {
    const v = (raw[k] ?? 0) - (base[k] ?? 0);
    if (v !== 0) out[k] = v;
  }
  return out;
}

/** Keywords a unit carries after that it did not before (board + hand + shop), plus pending combat grants,
 *  minus the control-body baseline's. */
export function gainedKeywords(st: ShopStage): Array<{ key: string; keyword: string }> {
  const raw = rawGainedKeywords(st.before, st.after);
  if (!st.baseline) return raw;
  const base = new Set(rawGainedKeywords(st.before, st.baseline).map((k) => `${k.key}|${k.keyword}`));
  return raw.filter((k) => !base.has(`${k.key}|${k.keyword}`));
}

function rawGainedKeywords(before: RunState, after: RunState): Array<{ key: string; keyword: string }> {
  const kwOf = (s: RunState): Map<string, Set<string>> => {
    const m = new Map<string, Set<string>>();
    for (const c of [...s.board, ...s.hand]) m.set(c.uid, new Set([...c.keywords, ...(c.golden ? ['golden'] : [])]));
    for (const o of s.shop) m.set(o.uid, new Set([...(o.keywords ?? []), ...(o.golden ? ['golden'] : [])]));
    return m;
  };
  const b = kwOf(before);
  const out: Array<{ key: string; keyword: string }> = [];
  for (const [uid, kws] of kwOf(after)) {
    const prev = b.get(uid);
    if (!prev) continue;
    for (const k of kws) if (!prev.has(k)) out.push({ key: uid, keyword: k });
  }
  const pb = (before.pendingCombatKeywords ?? []).length;
  for (const p of (after.pendingCombatKeywords ?? []).slice(pb)) out.push({ key: `pending:${p.uid}`, keyword: p.keyword });
  return out;
}

// ── combat observation (the authoritative event log) ─────────────────────────────────────────────────────

type Ev = Record<string, unknown> & { type: string };
const evs = (sim: Sim): Ev[] => sim.events as unknown as Ev[];

/** Player-side buff events (board `buff` + hand `handBuff`), as (attack, health, target). */
export function combatBuffs(sim: Sim): Array<{ target: string; attack: number; health: number; source?: string }> {
  const enemyUids = new Set(sim.initial.enemy.map((x) => x.uid));
  const out: Array<{ target: string; attack: number; health: number; source?: string }> = [];
  for (const e of evs(sim)) {
    if (e.type === 'buff' && !enemyUids.has(e.target as string)) {
      out.push({ target: e.target as string, attack: e.attack as number, health: e.health as number, ...(e.source ? { source: e.source as string } : {}) });
    }
    if (e.type === 'handBuff' && e.side !== 'enemy') out.push({ target: `hand:${e.uid as string}`, attack: e.attack as number, health: e.health as number });
  }
  return out;
}

/** The uid the contract's body wears inside `simulate()` (uids are remapped; resolved by card id). */
export const combatSourceUid = (sim: Sim, cardId: string): string | undefined =>
  sim.initial.player.find((m) => m.cardId === cardId)?.uid;

/** Attributed to the source: an event stamped with the source's uid, or one carrying no source at all (an
 *  ally's own effect stamps the ally, and is excluded — Mammoth's random Beasts each summoning their own
 *  tokens read as 4, not 3, before this). */
const bySource = (e: Ev, srcUid: string | undefined): boolean =>
  e.source === undefined || srcUid === undefined || e.source === srcUid;

/** Player-side summon events attributed to the source body, by card id. */
export function combatSummons(sim: Sim, sourceCardId?: string): string[] {
  const src = sourceCardId ? combatSourceUid(sim, sourceCardId) : undefined;
  return evs(sim).filter((e) => e.type === 'summon' && e.side !== 'enemy' && bySource(e, src)).map((e) => (e.minion as { cardId: string }).cardId);
}

/** Cards a combat effect handed the player's hand, by card id (attributed to the source where stamped). */
export function combatToHand(sim: Sim, sourceCardId?: string): string[] {
  const src = sourceCardId ? combatSourceUid(sim, sourceCardId) : undefined;
  return evs(sim).filter((e) => e.type === 'toHand' && e.side !== 'enemy' && bySource(e, src)).map((e) => e.cardId as string);
}

/** Keywords a combat effect granted to a player minion — `keyword` events plus `shieldUp` (a Ward grant is
 *  emitted as the shield rising, not as a keyword event). */
export function combatKeywords(sim: Sim): Array<{ target: string; keyword: string }> {
  const enemyUids = new Set(sim.initial.enemy.map((x) => x.uid));
  const out: Array<{ target: string; keyword: string }> = [];
  for (const e of evs(sim)) {
    if (e.type === 'keyword' && !enemyUids.has(e.target as string)) out.push({ target: e.target as string, keyword: e.keyword as string });
    if (e.type === 'shieldUp' && !enemyUids.has(e.target as string)) out.push({ target: e.target as string, keyword: 'DS' });
  }
  return out;
}

/** Named spells a combat effect cast (`sc` events with a spellId), by spell id. */
export function combatCasts(sim: Sim): string[] {
  return evs(sim).filter((e) => e.type === 'sc' && typeof e.spellId === 'string').map((e) => e.spellId as string);
}

/** The whole `simulate()` result with the source's / control's identity masked (combatScan's rule: any
 *  object whose cardId is one of `ids` loses cardId / name / tribe / tribe2 / universalTribe / golden; display
 *  `text` strings go too), and the trigger TELEMETRY that ticks regardless of what a factory did stripped
 *  (deathrattle tallies, quest event streams). Two fights that serialize equal had the same consequences. */
export function combatMasked(sim: Sim, ids: ReadonlySet<string>): string {
  const r = JSON.parse(JSON.stringify(sim)) as Record<string, unknown>;
  delete r.playerDeathrattles; delete r.enemyDeathrattles; delete r.playerQuestEvents; delete r.enemyQuestEvents;
  const mask = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(mask);
    if (v && typeof v === 'object') {
      const o = { ...(v as Record<string, unknown>) };
      delete o.text;
      if (typeof o.cardId === 'string' && ids.has(o.cardId)) { delete o.cardId; delete o.name; delete o.tribe; delete o.tribe2; delete o.universalTribe; delete o.golden; }
      for (const k of Object.keys(o)) o[k] = mask(o[k]);
      return o;
    }
    return v;
  };
  return JSON.stringify(mask(r));
}

/** Player-side `maxGold` events (a combat effect raising max Gold), summed. */
export function combatMaxGold(sim: Sim): number {
  return evs(sim).filter((e) => e.type === 'maxGold' && e.side !== 'enemy').reduce((n, e) => n + (e.amount as number), 0);
}
