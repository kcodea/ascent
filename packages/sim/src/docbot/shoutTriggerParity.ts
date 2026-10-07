/**
 * DOC BOT — the SHOUT-TRIGGER PARITY lane (R-SHOUT-TRIGGER-01), shared by `shoutTriggerParity.test.ts` and the
 * `npm run docbot` CLI.
 *
 * THE MISS THIS ENCODES (owner reports 2026-10-03: "auctioneer w/ rune of the choir does not work and it should";
 * "pulse or other triggering options should absolutely trigger the extra shouts in this case. make sure all of
 * this logic works across the board"). Every Shout fire site used to count for itself:
 *   · Shop: the Choir-family extras and the one-per-turn charges (Warm Embers, War Drum) lived only in the
 *     PLAYED-Shout counter; `replayBattlecry` (the Auctioneer's Pulse and every other re-trigger) read Drakko only.
 *   · Combat: `questCombatMods` carried no Choir, no Warm Embers freebie and no Twin Sun / Drake Skull edge buff;
 *     a carried extra fire emitted no `battlecryTriggered`, so the tally and every Shout watcher missed it; and
 *     three forced Shouts (Shared Scripture, Ancestral Roar, War Chorus) looped the onPlay factories by hand,
 *     reading no Shout extras and emitting no `battlecryTriggered` at all.
 * The interaction matrix even PINNED the Shop gap as deliberate (its P2), on the strength of a code comment.
 *
 * Two halves:
 *   1. SOURCE. Every Shop scope that dispatches an `onPlay` recruit factory must read THE one Shop fold,
 *      `shoutFireCount` (or be the settle replay, which says why). Every combat `onPlay` FACTORIES dispatch must
 *      read `shoutCarryExtras` AND emit `battlecryTriggered` in its scope, and NO other core site may emit
 *      `battlecryTriggered` — so a new hand-rolled Shout loop fails the day it lands.
 *   2. BEHAVIOUR. `shoutModifierMatrix()` drives every Shout MODIFIER through every ENTRY PATH and reports a
 *      pass/fail cell: the fire count, the Shout tally, a watcher, an edge buff and the charge latches.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatResult, type QuestCombatMods } from '@game/core';
import { createRun } from '../state';
import type { BoardCard, RunState } from '../state';
import { reduce } from '../reducer';
import { replayBattlecry } from '../recruit';
import { enclosingScope, scanFireSites } from './firePaths';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

// ── 1. source ─────────────────────────────────────────────────────────────────────────────────────────────────

export const SHOP_SHOUT_FILES = [
  'packages/sim/src/recruit.ts',
  'packages/sim/src/reducer.ts',
  'packages/sim/src/ancients.ts',
] as const;

export type ShoutCounter = 'fold' | 'settle';

/** Every shop scope that dispatches a Shout's `onPlay` recruit factory, and how its fire count is decided. */
export const SHOP_SHOUT_FIRE_SCOPES: Readonly<Record<string, { counter: ShoutCounter; why: string }>> = {
  playCard: { counter: 'fold', why: 'a Shout played from hand' },
  applyBattlecryTarget: { counter: 'fold', why: 'an aimed Shout resolving after its target pick' },
  triggerBorrowedEcho: { counter: 'fold', why: 'Funeral on Loan PLAYS the borrowed card (owner 2026-07-24)' },
  replayBattlecry: { counter: 'fold', why: 'THE shared Shop re-trigger: the Auctioneer Pulse, Echoing Roar, Resonance, Ryme in the Shop, Rune of the Last Word, Crucible Choir, Moira, the arena replayShout' },
  replayEconomyBattlecry: { counter: 'settle', why: "the settle half of a COMBAT Shout fire: called once per fire the combat loop already counted (every extra, charge and notify happened in combat), so folding here would pay them twice" },
};

const SHOP_FOLD = /\bshoutFireCount\(/;
const COMBAT_FOLD = /\bshoutCarryExtras\b/;
const COMBAT_NOTIFY = /emit\(\s*'battlecryTriggered'/;
/** The ONE combat scope allowed to emit `battlecryTriggered`. */
export const COMBAT_SHOUT_CHOKEPOINT = 'replayCombatBattlecry';

export interface ShoutFireSite { key: string; scope: string; file: string; line: number; reads: boolean }

/** The text of the enclosing scope from its declaration line down to `to` (default: the site). */
function scopeBody(lines: readonly string[], at: number, scope: string, to = at): string {
  if (!/^\w+$/.test(scope)) return lines.slice(Math.max(0, at - 40), to + 1).join('\n'); // top level / unnamed
  const siteIndent = /^(\s*)/.exec(lines[at]!)![1]!.length;
  const decl = new RegExp(`\\b${scope}\\b\\s*[:=(<]|function\\s+${scope}\\b`);
  for (let j = at; j >= 0; j--) {
    const l = lines[j]!;
    if (/^\s*(\/\/|\*)/.test(l)) continue;
    if (/^(\s*)/.exec(l)![1]!.length < siteIndent && decl.test(l)) return lines.slice(j, to + 1).join('\n');
  }
  return lines.slice(Math.max(0, at - 40), to + 1).join('\n');
}

/** Shop: every RECRUIT_FACTORIES dispatch inside a scope that gates on 'onPlay'. */
export function scanShopShoutSites(): ShoutFireSite[] {
  const out: ShoutFireSite[] = [];
  for (const rel of SHOP_SHOUT_FILES) {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]!;
      if (/^\s*(\/\/|\*)/.test(t) || !/\bRECRUIT_FACTORIES\[/.test(t)) continue;
      const scope = enclosingScope(lines, i);
      const body = scopeBody(lines, i, scope);
      if (!/'onPlay'/.test(body)) continue;
      const counter = SHOP_SHOUT_FIRE_SCOPES[scope]?.counter;
      out.push({ key: scope, scope, file: rel, line: i + 1, reads: counter === 'settle' ? true : SHOP_FOLD.test(body) });
    }
  }
  return out;
}

/** Combat: every FACTORIES dispatch gated on onPlay; it must read the fold AND notify per fire (scope, +12 lines). */
export function scanCombatShoutSites(): ShoutFireSite[] {
  const cache = new Map<string, string[]>();
  return scanFireSites().filter((s) => s.trigger === 'onPlay').map((s) => {
    const lines = cache.get(s.file) ?? readFileSync(join(ROOT, s.file), 'utf8').split('\n');
    cache.set(s.file, lines);
    const body = scopeBody(lines, s.line - 1, s.enclosing, s.line + 12);
    return { key: s.key, scope: s.enclosing, file: s.file, line: s.line, reads: COMBAT_FOLD.test(body) && COMBAT_NOTIFY.test(body) };
  });
}

/** Every core site that emits `battlecryTriggered`: only the chokepoint may (one notify per fire, never twice). */
export function scanCombatShoutNotifies(): { file: string; line: number; scope: string }[] {
  const out: { file: string; line: number; scope: string }[] = [];
  for (const rel of ['packages/core/src/combat/simulate.ts', 'packages/core/src/effects/factories.ts', 'packages/core/src/effects/arena.ts']) {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(\/\/|\*)/.test(lines[i]!) || !COMBAT_NOTIFY.test(lines[i]!)) continue;
      out.push({ file: rel, line: i + 1, scope: enclosingScope(lines, i) });
    }
  }
  return out;
}

export interface ShoutParityAudit {
  shop: ShoutFireSite[];
  combat: ShoutFireSite[];
  /** Shop Shout scopes with no SHOP_SHOUT_FIRE_SCOPES entry — "classify me". */
  unclassified: ShoutFireSite[];
  /** Registry entries no scanned scope matches — rot. */
  stale: string[];
  /** Sites that fire a Shout without reading their phase's fold (or, in combat, without notifying) — the Choir class. */
  deaf: ShoutFireSite[];
  /** `battlecryTriggered` emitted outside the chokepoint — a hand-rolled notify that would double or skip. */
  strayNotifies: { file: string; line: number; scope: string }[];
}

export function auditShoutParity(): ShoutParityAudit {
  const shop = scanShopShoutSites();
  const combat = scanCombatShoutSites();
  const seen = new Set(shop.map((s) => s.scope));
  return {
    shop,
    combat,
    unclassified: shop.filter((s) => !SHOP_SHOUT_FIRE_SCOPES[s.scope]),
    stale: Object.keys(SHOP_SHOUT_FIRE_SCOPES).filter((k) => !seen.has(k)),
    deaf: [...shop.filter((s) => SHOP_SHOUT_FIRE_SCOPES[s.scope] && !s.reads), ...combat.filter((s) => !s.reads)],
    strayNotifies: scanCombatShoutNotifies().filter((n) => n.scope !== COMBAT_SHOUT_CHOKEPOINT),
  };
}

// ── 2. behaviour: every Shout modifier × every entry path ─────────────────────────────────────────────────────

/** A Shout MODIFIER: how it is armed in the Shop (RunState) and in combat (QuestCombatMods), and how many fires
 *  ONE Shout trigger should make under it. `latch` names the per-turn charge a Shop trigger must spend. */
export interface ShoutModifier {
  id: string;
  label: string;
  shop: Partial<RunState>;
  combat: QuestCombatMods;
  fires: number;
  latch?: 'shoutFirstUsedThisTurn' | 'runeWarDrumUsedThisTurn';
}

export const SHOUT_MODIFIERS: readonly ShoutModifier[] = [
  { id: 'none', label: 'no modifier (control)', shop: {}, combat: {}, fires: 1 },
  { id: 'choir', label: 'Rune of the Choir / Hoardwake / Resonant Path / legacy Orivax Chorus mode (+1 each)', shop: { shoutExtraAlways: 1 }, combat: { shoutExtraAlways: 1 }, fires: 2 },
  { id: 'blasting', label: 'Rune of Blasting Voices (+2)', shop: { shoutExtraAlways: 2 }, combat: { shoutExtraAlways: 2 }, fires: 3 },
  { id: 'encore', label: 'Demand an Encore (this turn)', shop: { shoutExtraTurn: 1 }, combat: { encoreExtra: 1 }, fires: 2 },
  { id: 'warmEmbers', label: 'Warm Embers / Opening Act (first Shout each turn / phase)', shop: { shoutFirstDoubleEachRound: true, shoutFirstUsedThisTurn: false }, combat: { warmEmbersFirst: 1 }, fires: 2, latch: 'shoutFirstUsedThisTurn' },
  { id: 'warDrum', label: 'Rune of the War Drum (first Shout each turn, +2)', shop: { runeWarDrum: 2, runeWarDrumUsedThisTurn: false }, combat: { warDrumExtra: 2 }, fires: 3, latch: 'runeWarDrumUsedThisTurn' },
];

/** What one entry path measured under one modifier. Every count is per ONE Shout trigger. */
export interface ShoutCell {
  path: string;
  modifier: string;
  expected: number;
  /** The Shout's effect fires. */
  fires: number;
  /** The Shout tally (quests / Bane's Presence / rune meters): Shop `shoutFiresThisTurn`, combat `playerShoutFires`. */
  tally: number;
  /** A "whenever you trigger a Shout" watcher: Shop = Embermouth Whelp; combat = Twin Sun Oath's trigger. */
  watcher: number;
  /** Rune of the Drake Skull's edge buff (Shop; combat reads the Twin Sun trigger above). */
  edge: number;
  /** The per-turn charge was spent (only for latch modifiers). */
  latchSpent: boolean | null;
  pass: boolean;
}

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};

type ShopFire = (s: RunState) => RunState;
/** The Shop entry paths. Each fires Hoard Cleric ('c': "give your other Dragons +3/+3") exactly once. */
const SHOP_PATHS: Record<string, { cleric: 'board' | 'hand'; fire: ShopFire }> = {
  'played from hand': { cleric: 'hand', fire: (s) => reduce(s, { type: 'play', uid: 'c' }) },
  "Auctioneer's Pulse": { cleric: 'board', fire: (s) => reduce(s, { type: 'heroPower', uid: 'c' }) },
  'replayBattlecry (Echoing Roar / Resonance / Ryme / Last Word / Crucible Choir / Moira)': {
    cleric: 'board',
    fire: (s) => {
      const n = structuredClone(s);
      n.lastShoutFires = 0;
      replayBattlecry(n, n.board.find((c) => c.uid === 'c')!);
      n.shoutFiresThisTurn = (n.shoutFiresThisTurn ?? 0) + (n.lastShoutFires ?? 0); // what the reducer folds per action
      return n;
    },
  },
};

function shopCell(path: string, mod: ShoutModifier): ShoutCell {
  const p = SHOP_PATHS[path]!;
  const cleric = card('c', 'cleric', { attack: 1, health: 50 });
  // w: a plain Dragon (fires = its Attack gain / 3). e: Embermouth Whelp (+3 from the Cleric, +1 as the watcher).
  const others = [card('w', 'whelpling', { attack: 1, health: 50 }), card('e', 'd2_embermouth', { attack: 1, health: 50 })];
  const base = {
    ...createRun(5, 'myra'), wave: 6, phase: 'recruit', embers: 60, shoutFiresThisTurn: 0,
    board: p.cleric === 'board' ? [...others, cleric] : others, hand: p.cleric === 'hand' ? [cleric] : [],
    shoutEdgeTribeBuff: { tribe: 'dragon', attack: 6, health: 6 },
    ...mod.shop,
  } as RunState;
  const after = p.fire(base);
  const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
  // Drake Skull hits the left- and right-most Dragon: `w` (left) every fire, the Cleric (right) every fire.
  const skull = (s: RunState): number => (at(s, 'w').buffs ?? []).filter((b) => b.source === 'Rune of the Drake Skull').reduce((a, b) => a + b.attack, 0);
  const edge = skull(after) / 6;
  const fires = (at(after, 'w').attack - at(base, 'w').attack - skull(after)) / 3;
  const watcher = (at(after, 'e').attack - at(base, 'e').attack) - 3 * fires;
  const tally = (after.shoutFiresThisTurn ?? 0) - (base.shoutFiresThisTurn ?? 0);
  const latchSpent = mod.latch ? !!after[mod.latch] : null;
  const pass = fires === mod.fires && tally === mod.fires && watcher === mod.fires && edge === mod.fires && latchSpent !== false;
  return { path, modifier: mod.id, expected: mod.fires, fires, tally, watcher, edge, latchSpent, pass };
}

const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...extra } as unknown as BoardMinion);
const fight = (player: BoardMinion[], enemy: BoardMinion[], mods: QuestCombatMods, extra: object = {}, seed = 0xd0c5): CombatResult =>
  simulate(player, enemy, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, questMods: mods, ...extra } as never), combatSide({ tier: 3 }));

const rallyCard = (): string => Object.values(CARD_INDEX).find((c) => c?.keywords.includes('RL') && c.effects.some((e) => e.on === 'onAttack'))!.id;
const shoutCard = (): string => Object.values(CARD_INDEX).find((c) => c?.effects.some((e) => e.on === 'onPlay') && !c.spell && !c.token)!.id;

/** The combat entry paths. Each stages exactly ONE Shout trigger on the player side. */
const COMBAT_PATHS: Record<string, (mods: QuestCombatMods) => CombatResult> = {
  'combat: Ryme Echo (fireShout)': (m) => fight([bm('alley', 'p0', 1, 30), bm('ryme', 'p1', 1, 1)], [bm('cryptwolf', 'e0', 5, 60)], m),
  'combat: Parting Cry': (m) => fight([bm('alley', 'p0', 1, 1, { partingCry: true }), bm('whelpling', 'p1', 0, 400)], [bm('cryptwolf', 'e0', 5, 60)], m),
  'combat: Rune of Shared Scripture': (m) => fight(
    [bm('emissary', 'p0', 1, 60), bm('badgington', 'p1', 1, 60), bm('sporebat', 'p2', 1, 1)], [bm('sandbag', 'e0', 9, 400)],
    { ...m, runeSharedScripture: true }, { lastSpellCastId: 'growth' }, 5),
  'combat: Rune of Ancestral Roar': (m) => fight([bm('emissary', 'p0', 2, 1), bm('whelpling', 'p1', 0, 400)], [bm('sandbag', 'e0', 9, 400)], { ...m, runeAncestralRoar: true }, {}, 7),
  'combat: Rune of the War Chorus': (m) => fight([bm(shoutCard(), 'p0', 1, 300), bm(rallyCard(), 'p1', 2, 300)], [bm('sandbag', 'e0', 9, 400)], { ...m, runeWarChorus: true }, {}, 5),
};

function combatCell(path: string, mod: ShoutModifier): ShoutCell {
  const r = COMBAT_PATHS[path]!({ ...mod.combat, shoutEdgeBuff: { attack: 1, health: 1 } });
  const tally = r.playerShoutFires ?? 0;
  const watcher = r.events.filter((e) => e.type === 'questTrigger' && (e as { flag: string; side: string }).flag === 'twinSunOath' && (e as { side: string }).side === 'player').length;
  // Fires: the base fire logs its own line (a `shout`, or Parting Cry's cast `sc`); every extra fire logs a `shout`.
  const fires = tally; // the chokepoint notifies once per effect fire, so the tally IS the fire count
  const pass = tally === mod.fires && watcher === mod.fires;
  return { path, modifier: mod.id, expected: mod.fires, fires, tally, watcher, edge: watcher, latchSpent: null, pass };
}

export const SHOUT_ENTRY_PATHS: readonly string[] = [...Object.keys(SHOP_PATHS), ...Object.keys(COMBAT_PATHS)];

/** The full modifier × entry-path matrix. Every cell must pass. */
export function shoutModifierMatrix(): ShoutCell[] {
  const cells: ShoutCell[] = [];
  for (const mod of SHOUT_MODIFIERS) {
    for (const path of Object.keys(SHOP_PATHS)) cells.push(shopCell(path, mod));
    for (const path of Object.keys(COMBAT_PATHS)) cells.push(combatCell(path, mod));
  }
  return cells;
}
