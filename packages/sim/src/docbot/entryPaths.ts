/**
 * DOC BOT — entry paths (the `entryPaths` lane), shared by `entryPaths.test.ts` (gates) and the
 * `npm run docbot` CLI (prints the queues).
 *
 * THE MISS THIS ENCODES (Bug Board 9852e16f, fixed in PR #1374): Kindness's four TARGETED Gifts — Unbridled
 * Might, Ironclad Favor, Champion's Regalia, Parting Gifts — consumed the card, counted the cast and changed
 * NOTHING for a month. `applyCastEffects` sent `{ minion }` while the four factories read `payload.target`.
 * A Gift never sits in a shop: it only ever ARRIVES IN HAND — from a rune (Happy Birthday, Merry Christmas),
 * a hero schedule (Kindness) or a Discover — and nothing staged that arrival, so nothing ever cast one under
 * a differential that could see the no-op.
 *
 * Two lessons, and this lane encodes both:
 *
 *   1. ENTRY SITES ARE DERIVED, NOT LISTED. Every place the run reducer or the recruit engine writes a card
 *      into `hand` or `board` is found by scanning the source (`scanEntrySites`) and must carry a
 *      classification in `ENTRY_SITES` (keyed by file + enclosing scope + zone). A site nobody classified
 *      fails ("classify me"); an entry no site matches any more fails too. So a NEW way for a card to enter
 *      play cannot appear without a reader naming it — and the worklist below can never be missing a path
 *      because someone forgot to write it down.
 *
 *   2. NON-SHOP CARDS ARE STAGED THROUGH THEIR REAL PATH. Every card that belongs to no set (Gifts, the
 *      card-minted hand spells, tokens, henchmen) is looked up backwards: which ACTIVE card names it in an
 *      effect param, which rune, which hero, which source function. Cards nobody names are ORPHANS (surfaced,
 *      never skipped). Each castable one is then driven into the hand THROUGH THE REAL `reduce` — the minting
 *      card is played, the rune is bought, the Discover is picked — and cast, and its cast must change
 *      something beyond hand-consumption, cast counters and cost. Refusals (the path could not be staged, or
 *      the cast was refused) are pinned queues: visible, ratcheted, never silently green.
 *
 * INSTRUMENT LESSON (found while building this, 2026-09-11 — see the PR): the play lane's spell sub-lane
 * diffs the post-cast state against the PRE-REDUCE fixture, and `reduce` lazily initialises a dozen fields
 * (`lastRallyFires`, `fodderEaten`, `cardsPlayedTotal`, …) on every action — so every cast looked effectful
 * and the "inert spell" gate was vacuously green, Gifts included. The differential here compares two states
 * that BOTH came out of `reduce` (post-arrival vs post-cast), which is the only baseline that cannot lie
 * that way.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVED_CARDS, CARD_INDEX, ENEMY, EPIC_RUNES, EQUIPMENT, GIFT_IDS, QUEST_DEFS, RUNES, SETS } from '@game/content';
import type { CardDef, RuneDef } from '@game/core';
import { HEROES } from '../heroes';
import { reduce } from '../reducer';
import type { BoardCard, RunState } from '../state';
import { enclosingScope } from './firePaths';
import { playFixture } from './playScan';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

// ── 1. entry sites ─────────────────────────────────────────────────────────────────────────────────────────

/** The two files that write cards into the run's hand/board. */
export const ENTRY_SITE_FILES = ['packages/sim/src/reducer.ts', 'packages/sim/src/recruit.ts'] as const;

export interface EntrySite {
  /** `<basename>#<enclosing scope>#<hand|board>` — the registry key. */
  key: string;
  file: string;
  line: number;
  enclosing: string;
  zone: 'hand' | 'board';
  text: string;
}

export type EntryKind =
  | 'shop-buy' // the shop's minion / spell slot → hand
  | 'play' // hand → board
  | 'reorder' // a move within the same zone (no card enters)
  | 'return-to-hand' // board → hand (a refused play, a return spell)
  | 'discover' // a Discover pick lands in hand
  | 'hero-grant' // a hero power / adopted power hands out a card
  | 'quest-grant' // a quest reward or buy-trigger copy
  | 'rune-grant' // a rune reward hands out a card
  | 'hand-mint' // an effect mints a card into hand (spells, Rubies, Ales, copies, steals)
  | 'triple' // three copies fold into a golden
  | 'token-summon' // an effect summons a body onto the board
  | 'combat-carry' // a combat-time grant delivered at settle
  | 'start-of-turn'; // a scheduled start-of-turn grant

export interface EntrySiteEntry { kind: EntryKind; why: string }

/**
 * Every hand/board entry site in the reducer + recruit engine, classified. Keys are exactly what
 * `scanEntrySites()` derives; the lane fails on an unclassified site AND on an entry with no site.
 */
export const ENTRY_SITES: Readonly<Record<string, EntrySiteEntry>> = {
  // ── reducer.ts ──
  'reducer.ts#conjurePlainCopy#hand': { kind: 'hero-grant', why: "Re-Pete / Gorr's plain copy of a held card (conjured, no pool take)" },
  'reducer.ts#drakkoQuestBuy#hand': { kind: 'quest-grant', why: 'the Drakko buy-trigger quest: a copy of the bought Shout minion' },
  'reducer.ts#chronosQuestBuy#hand': { kind: 'quest-grant', why: 'the Chronos buy-trigger quest: a copy of the bought End-of-Turn minion' },
  'reducer.ts#takeDiscoverPick#hand': { kind: 'discover', why: 'the Discover pick — every Discover (hero, rune, spell, Gift) lands through this one site' },
  'reducer.ts#buy#hand': { kind: 'shop-buy', why: 'the shop: the right-hand spell slot, a minion offer, a restored/borrowed body' },
  'reducer.ts#play#board': { kind: 'play', why: 'hand → board' },
  'reducer.ts#play#hand': { kind: 'return-to-hand', why: 'a play that bounces a board body back to hand (Bumper-style swaps)' },
  'reducer.ts#reposition#board': { kind: 'reorder', why: 'drag within the board' },
  'reducer.ts#reorderHand#hand': { kind: 'reorder', why: 'drag within the hand' },
  'reducer.ts#heroPower#board': { kind: 'hero-grant', why: 'a hero power that places a body beside its target (Gildmaster / copy powers)' },
  'reducer.ts#heroPower#hand': { kind: 'hero-grant', why: 'a hero power that hands out a card (Pocket Magic, Dynamite Dig picks, adopted-power seeds)' },
  'reducer.ts#grantGoldenDiscover#hand': { kind: 'discover', why: 'the golden Discover reward (a triple / Gildmaster) lands its pick in hand' },
  'reducer.ts#combineIntoGolden#hand': { kind: 'triple', why: 'three copies fold into the golden card (hand first, board when the hand is full)' },
  'reducer.ts#combineIntoGolden#board': { kind: 'triple', why: 'the golden card lands on the board when the hand is full' },
  'reducer.ts#settleCombat#hand': { kind: 'combat-carry', why: "combat's grantToHand carry-backs (Arcane Weaver copies, Rally spell grants) delivered at settle" },
  'reducer.ts#advanceCombat#hand': { kind: 'start-of-turn', why: 'scheduled start-of-turn grants (Royal Allowance, Chaos, pending quest rewards)' },
  'reducer.ts#seedAdoptedPower#hand': { kind: 'hero-grant', why: 'an adopted hero power seeding its starting cards (Symbiotic Attachment and kin)' },
  // ── recruit.ts ──
  'recruit.ts#pushTaughtPup#hand': { kind: 'hand-mint', why: 'Mage Pup: the taught spell copy' },
  'recruit.ts#gainGold#hand': { kind: 'rune-grant', why: 'Rune of the Golden Splinter, paid out inside the Gold-gain chokepoint: a golden tier-mate to hand' },
  'recruit.ts#grantMinionToHandOrBoard#hand': { kind: 'hand-mint', why: 'the shared minion grant (quest / rune / effect rewards): hand, then board, then overflow' },
  'recruit.ts#grantMinionToHandOrBoard#board': { kind: 'token-summon', why: 'the shared minion grant falling through to the board when the hand is full' },
  'recruit.ts#conjureToHand#hand': { kind: 'hand-mint', why: 'the shared conjure chokepoint — random-Gift grants, spell copies, rune grants' },
  'recruit.ts#mintRubies#hand': { kind: 'hand-mint', why: 'Rubies minted to hand (Kobolds, Gemcutting)' },
  'recruit.ts#mintHandSpells#hand': { kind: 'hand-mint', why: 'card-minted hand spells (Tower Shield, Clue)' },
  'recruit.ts#riseReturn#board': { kind: 'token-summon', why: 'a shop-phase Rise brings the body back to its slot' },
  'recruit.ts#giftGrandLarceny#hand': { kind: 'hand-mint', why: "the Grand Larceny Gift steals the shop's offers into hand" },
  'recruit.ts#rallySummonAndGetRally#board': { kind: 'token-summon', why: 'Recruiter: a shop Rally summons a body beside it' },
  'recruit.ts#startOfTurnGetSpellImproveRubies#hand': { kind: 'hand-mint', why: 'a start-of-turn spell grant' },
  'recruit.ts#battlecryGainRandomMinion#hand': { kind: 'hand-mint', why: 'a Shout that hands out a random minion' },
  'recruit.ts#endOfTurnGrantSpellChoice#hand': { kind: 'hand-mint', why: 'an End of Turn spell grant' },
  'recruit.ts#battlecryGrantSpell#hand': { kind: 'hand-mint', why: 'a Shout that hands out a named spell' },
  'recruit.ts#deathrattleSummonRandomHandMinion#board': { kind: 'token-summon', why: 'a shop Echo that plays a random minion from hand' },
  'recruit.ts#battlecryDestroyForSpell#hand': { kind: 'hand-mint', why: 'a Shout that destroys a body for a spell' },
  'recruit.ts#spellCopyTargetExact#hand': { kind: 'hand-mint', why: 'an exact copy of a board body to hand' },
  'recruit.ts#spellStealShop#hand': { kind: 'hand-mint', why: 'a spell that steals shop offers into hand' },
  'recruit.ts#spellReturnToHand#hand': { kind: 'return-to-hand', why: 'a spell that returns a board body to hand' },
  'recruit.ts#stealTavernMinion#hand': { kind: 'hand-mint', why: 'a shop offer stolen into hand' },
  'recruit.ts#spellCopyRecent#hand': { kind: 'hand-mint', why: 'a copy of the last spell cast' },
  'recruit.ts#endOfTurnGetRandomSpells#hand': { kind: 'hand-mint', why: 'an End of Turn random-spell grant' },
  'recruit.ts#summon#board': { kind: 'token-summon', why: 'the shared shop summon (tokens beside their summoner)' },
  'recruit.ts#landBorrowed#board': { kind: 'token-summon', why: 'a borrowed body landing on the board' },
  'recruit.ts#summonCopyFromHandShop#board': { kind: 'token-summon', why: 'a copy summoned from hand / shop' },
};

const ENTRY_WRITE = /\.(hand|board)\.(?:push|unshift)\(|\.(hand|board)\.splice\([^,;]+,\s*0\s*,/;

/** Scan the reducer + recruit engine for every write that puts a card INTO the hand or board (push/unshift,
 *  or a splice that inserts). Pure removals (`splice(i, 1)`) are not entries. */
export function scanEntrySites(): EntrySite[] {
  const out: EntrySite[] = [];
  for (const rel of ENTRY_SITE_FILES) {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
    const base = rel.split('/').pop()!;
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i]!;
      if (/^\s*(\/\/|\*|\/\*)/.test(text)) continue;
      const m = ENTRY_WRITE.exec(text);
      if (!m) continue;
      const zone = (m[1] ?? m[2]) as 'hand' | 'board';
      const enclosing = enclosingScope(lines, i);
      out.push({ key: `${base}#${enclosing}#${zone}`, file: rel, line: i + 1, enclosing, zone, text: text.trim() });
    }
  }
  return out;
}

export interface EntrySiteAudit {
  sites: EntrySite[];
  unclassified: EntrySite[];
  stale: string[];
}

export function auditEntrySites(): EntrySiteAudit {
  const sites = scanEntrySites();
  const keys = new Set(sites.map((s) => s.key));
  return {
    sites,
    unclassified: sites.filter((s) => !ENTRY_SITES[s.key]),
    stale: Object.keys(ENTRY_SITES).filter((k) => !keys.has(k)),
  };
}

// ── 2. the non-shop worklist: who names each card ─────────────────────────────────────────────────────────

export type EntryPathRef =
  | { via: 'card'; cardId: string; trigger: string; factory: string }
  | { via: 'rune'; runeId: string }
  | { via: 'hero'; heroId: string }
  | { via: 'quest'; questId: string }
  | { via: 'equipment'; equipmentId: string }
  | { via: 'source'; file: string; enclosing: string };

/** Non-shop cards nobody names in ACTIVE content, runes, heroes, quests, equipment or the run engine — with
 *  the reason each is legitimately unreachable. A card that gains a path makes its entry stale. */
export const ENTRY_ORPHAN_EXCUSED: Readonly<Record<string, string>> = {
  b2_ninjapal: "an authored token of the Learn Ascent tutorial's seats (packages/sim/src/tutorial/learnAscent.ts) — never minted, summoned or offered in a normal run",
};

export const pathLabel = (p: EntryPathRef): string =>
  p.via === 'card' ? `card:${p.cardId}/${p.factory}` : p.via === 'rune' ? `rune:${p.runeId}` : p.via === 'hero' ? `hero:${p.heroId}`
    : p.via === 'quest' ? `quest:${p.questId}` : p.via === 'equipment' ? `equipment:${p.equipmentId}` : `source:${p.enclosing}`;

export interface EntryWorkItem {
  id: string;
  /** `cast` — a spell / Ruby whose PLAY is its effect (the class the Gifts belong to); `body` — a minion,
   *  whose play the `playDifferential` lane already drives regardless of how it arrived. */
  shape: 'cast' | 'body';
  paths: EntryPathRef[];
}

function deepMentions(v: unknown, id: string): boolean {
  if (typeof v === 'string') return v === id;
  if (Array.isArray(v)) return v.some((x) => deepMentions(x, id));
  if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).some((x) => deepMentions(x, id));
  return false;
}

/** Every card that belongs to NO set — reachable only through some non-shop path — with every path that
 *  names it. Enemy filler and archived cards are excluded (never reachable in a run). */
export function entryWorklist(): EntryWorkItem[] {
  const inSet = new Set(Object.values(SETS).flatMap((s) => s.own.map((c) => c.id)));
  const excluded = new Set([...ENEMY.map((c) => c.id), ...ARCHIVED_CARDS.map((c) => c.id)]);
  const active = Object.values(CARD_INDEX).filter((c): c is CardDef => !!c && inSet.has(c.id));
  const sources = ENTRY_SITE_FILES.map((rel) => ({ rel, lines: readFileSync(join(ROOT, rel), 'utf8').split('\n') }));
  const out: EntryWorkItem[] = [];
  for (const def of Object.values(CARD_INDEX)) {
    if (!def || inSet.has(def.id) || excluded.has(def.id)) continue;
    const paths: EntryPathRef[] = [];
    for (const c of active) {
      let named = false;
      for (const e of c.effects) if (deepMentions(e.params, def.id)) { named = true; paths.push({ via: 'card', cardId: c.id, trigger: e.on, factory: e.do }); }
      // A def-level reference (`ascendInto`, a Choose One branch, a henchman) — anything but the printed text.
      const rest: Record<string, unknown> = { ...c };
      delete rest.text; delete rest.goldenText;
      if (!named && deepMentions(rest, def.id)) paths.push({ via: 'card', cardId: c.id, trigger: 'def', factory: 'def' });
    }
    for (const r of [...RUNES, ...EPIC_RUNES]) if (deepMentions(r, def.id)) paths.push({ via: 'rune', runeId: r.id });
    for (const h of HEROES) if (deepMentions(h, def.id)) paths.push({ via: 'hero', heroId: h.id });
    for (const q of QUEST_DEFS) if (deepMentions(q, def.id)) paths.push({ via: 'quest', questId: q.id });
    for (const eq of EQUIPMENT) if (deepMentions(eq, def.id)) paths.push({ via: 'equipment', equipmentId: eq.id });
    const isGift = GIFT_IDS.includes(def.id);
    for (const { rel, lines } of sources) {
      const seen = new Set<string>();
      const file = rel.split('/').pop()!;
      const add = (enclosing: string): void => { if (enclosing !== '?' && !seen.has(enclosing)) { seen.add(enclosing); paths.push({ via: 'source', file, enclosing }); } };
      const isCode = (t: string): boolean => !/^\s*(\/\/|\*|\/\*|import\b)/.test(t);
      lines.forEach((t, i) => {
        if (!isCode(t)) return;
        if (!t.includes(`'${def.id}'`) && !(isGift && /\bGIFT_IDS\b/.test(t))) return;
        add(enclosingScope(lines, i));
      });
      // ONE caller hop: a helper that mints the card (`grantRandomGift`) is reached from the rune / schedule
      // that calls it — the caller's scope is the path a stager can drive.
      for (const fn of [...seen]) {
        const call = new RegExp(`\\b${fn}\\(`);
        const decl = new RegExp(`function\\s+${fn}\\b`);
        lines.forEach((t, i) => { if (isCode(t) && call.test(t) && !decl.test(t)) add(enclosingScope(lines, i)); });
      }
    }
    out.push({ id: def.id, shape: def.spell || def.ruby ? 'cast' : 'body', paths });
  }
  return out;
}

// ── 3. staging the real path, then the cast differential ──────────────────────────────────────────────────

/** Order-insensitive stringify (the runeSwallowScan lesson). */
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'undefined';
};

/** Run noise + per-action scratch + CAST BOOKKEEPING: everything a cast changes by virtue of being a cast,
 *  whatever its effect did. The differential must see through all of it. */
const CAST_NOISE = new Set([
  'rngCursor', 'uidCounter', 'uidSeq', 'presentation', 'fx', 'beats', 'log',
  'shoutsThisTurn', 'firstShoutUid', 'auraFxSeq', 'auraFx', 'lastShoutFires', 'lastEchoFires', 'lastRallyFires', 'lastEotFires',
  'questTendrilFx', 'fodderEaten', 'shopEaten', 'gainCardFiredUids', 'gainAttackFiredUids', 'equipmentSpellCasts', 'recruitBuffFx',
  'aleGranted', 'veinstormStamped', 'weldFxBaseSeq', 'karwindFlash', 'shopDeathFx', 'equipFx',
  'spellsCast', 'spellsThisTurn', 'lastSpellCastId', 'firstSpellThisTurnId', 'lastSpellThisTurnId', 'spellsCastIds', 'alesCastThisTurn',
  'embers', 'goldSpent', 'goldSpentThisTurn', 'playedThisTurn', 'cardsPlayedTotal', 'hand', 'nextSpellBonus',
]);

/** The consequence-only projection of a run state. */
export function castProjection(s: RunState): string {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (!CAST_NOISE.has(k) && v !== undefined) o[k] = v;
  return stable(o);
}

export type StageOutcome =
  | { ok: true; via: string; state: RunState; uid: string }
  | { ok: false; reason: string };

const CAST_TARGET = 'fix0'; // the play fixture's left-most board body

function handHas(s: RunState, id: string): BoardCard | undefined { return s.hand.find((c) => c.cardId === id); }

/** Drive the card into the hand THROUGH THE REAL REDUCER along one of its derived paths. */
export function stageArrival(item: EntryWorkItem): StageOutcome {
  const { state: base } = playFixture();
  const rich: RunState = { ...base, embers: 60 } as RunState;
  const tried: string[] = [];
  /** Play a minter card from hand; a Choose One minter is tried on every branch. */
  const playMinter = (minter: CardDef): RunState | undefined => {
    const inHand: BoardCard = { uid: 'docbotMinter', cardId: minter.id, tribe: minter.tribe, attack: minter.attack, health: minter.health, keywords: [...minter.keywords], golden: false } as BoardCard;
    const s0 = reduce({ ...rich, hand: [...rich.hand, inHand] } as RunState, { type: 'play', uid: 'docbotMinter', targetUid: CAST_TARGET });
    if (!s0.chooseOne) return handHas(s0, item.id) ? s0 : undefined;
    for (let i = 0; i < (minter.chooseOne?.length ?? 1); i++) {
      let s = reduce(s0, { type: 'chooseOne', index: i });
      if (s.chooseOne) s = reduce(s, { type: 'chooseOne', index: 0 });
      if (handHas(s, item.id)) return s;
    }
    return undefined;
  };
  /** Buy a rune out of a staged forge; a random pick / Discover offer is retried across rng cursors. */
  const buyRune = (rune: RuneDef): { s: RunState; via: string } | undefined => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = reduce({ ...rich, rngCursor: seed, runeforgeOffer: [rune.id] } as RunState, { type: 'buyRune', index: 0 });
      if (handHas(s, item.id)) return { s, via: `rune:${rune.id}` };
      const at = ((s.discover ?? []) as string[]).indexOf(item.id);
      if (at >= 0) {
        s = reduce(s, { type: 'discover', index: at });
        if (handHas(s, item.id)) return { s, via: `rune:${rune.id}→discover` };
      }
    }
    return undefined;
  };
  const done = (s: RunState, via: string): StageOutcome => ({ ok: true, via, state: s, uid: handHas(s, item.id)!.uid });
  // (a) a card that names it: play the minter.
  for (const p of item.paths) {
    if (p.via !== 'card') continue;
    const s = playMinter(CARD_INDEX[p.cardId]!);
    if (s) return done(s, `card:${p.cardId}`);
    tried.push(`card:${p.cardId}`);
  }
  // (b) a rune that names it, or whose reward drives the source scope that mints it (`case 'runeHappyBirthday'`).
  const runes = [...RUNES, ...EPIC_RUNES];
  const runePaths = new Map<string, RuneDef>();
  for (const p of item.paths) {
    if (p.via === 'rune') runePaths.set(p.runeId, runes.find((r) => r.id === p.runeId)!);
    if (p.via === 'source') for (const r of runes) if (deepMentions(r.reward, p.enclosing)) runePaths.set(r.id, r);
  }
  for (const rune of runePaths.values()) {
    const hit = buyRune(rune);
    if (hit) return done(hit.s, hit.via);
    tried.push(`rune:${rune.id}`);
  }
  // (c) an Equipment that names it: wield it and activate it.
  for (const p of item.paths) {
    if (p.via !== 'equipment') continue;
    const equipment = { available: [{ equipmentId: p.equipmentId, version: 'plain', sourceUids: [CAST_TARGET], grantedTurn: rich.wave }], selectedEquipmentId: p.equipmentId, baseActivations: 1, bonusActivations: 0, activationsSpent: 0, temporaryCostReduction: 0 };
    let s = reduce({ ...rich, equipment } as unknown as RunState, { type: 'activateEquipment', targetUid: CAST_TARGET });
    if (s.chooseOne) s = reduce(s, { type: 'chooseOne', index: 0 });
    if (handHas(s, item.id)) return done(s, `equipment:${p.equipmentId}`);
    tried.push(`equipment:${p.equipmentId}`);
  }
  // (d) a source function that IS a content factory: play a card that carries that factory.
  for (const p of item.paths) {
    if (p.via !== 'source') continue;
    const carrier = Object.values(CARD_INDEX).find((c) => c && !c.token && !c.ruby && c.effects.some((e) => e.do === p.enclosing));
    if (!carrier) continue;
    const s = playMinter(carrier);
    if (s) return done(s, `factory:${p.enclosing} (${carrier.id})`);
    tried.push(`factory:${p.enclosing}`);
  }
  return { ok: false, reason: tried.length ? `no staged path delivered it (tried ${tried.join(', ')})` : `no stager for its paths (${item.paths.map(pathLabel).join(', ') || 'none'})` };
}

export type CastVerdict = 'effectful' | 'inert' | 'refused';

/** Cast the arrived card and compare against the post-arrival state — both out of `reduce`. */
export function castDifferential(arrived: RunState, uid: string): CastVerdict {
  let after = reduce(arrived, { type: 'play', uid, targetUid: CAST_TARGET });
  if (after.chooseOne) after = reduce(after, { type: 'chooseOne', index: 0 });
  if (after.hand.some((c) => c.uid === uid)) return 'refused';
  return castProjection(after) === castProjection(arrived) ? 'inert' : 'effectful';
}

export interface EntryScanResult {
  worklist: EntryWorkItem[];
  /** Non-shop cards nobody names — unreachable, or reached by a path the derivation cannot see. */
  orphans: string[];
  /** Cast-shaped cards staged through a real path and proven effectful, with the path. */
  verified: Record<string, string>;
  /** Cast-shaped cards that arrived and whose cast changed NOTHING beyond bookkeeping (the Gifts class). */
  inert: string[];
  /** Cast-shaped cards that arrived but whose cast was refused by the reducer. */
  refused: string[];
  /** Cast-shaped cards no stager could deliver into the hand. */
  unstaged: Record<string, string>;
}

export function entryScan(): EntryScanResult {
  const worklist = entryWorklist();
  const orphans = worklist.filter((w) => w.paths.length === 0).map((w) => w.id);
  const verified: Record<string, string> = {};
  const inert: string[] = [];
  const refused: string[] = [];
  const unstaged: Record<string, string> = {};
  for (const item of worklist) {
    if (item.shape !== 'cast' || item.paths.length === 0) continue;
    const staged = stageArrival(item);
    if (!staged.ok) { unstaged[item.id] = staged.reason; continue; }
    const verdict = castDifferential(staged.state, staged.uid);
    if (verdict === 'effectful') verified[item.id] = staged.via;
    else if (verdict === 'inert') inert.push(item.id);
    else refused.push(item.id);
  }
  return { worklist, orphans, verified, inert, refused, unstaged };
}
