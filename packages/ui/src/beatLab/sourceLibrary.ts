/**
 * BEAT SYSTEM PR 9 — the SOURCE-grouped beat library: organized around cards/runes/quests you recognize (by
 * NAME), each listing its trigger moments with a coverage badge, instead of a flat list of internal factory
 * ids. This is what makes the library findable ("Fleeting Vigor", not "spellPendingSCBuff") and surfaces the
 * EMPTY triggers — combat moments that currently have no beat at all — so they can be assigned one.
 *
 * Two trigger sources per card:
 *   1. Content EffectDefs — `(card, e.on, e.do)` → registry key `factory:<do>:<on>`. Combat triggers
 *      (onDeath / onAttack / startOfCombat / avenge / …) are already registered here; grouping surfaces them.
 *   2. DERIVED combat moments — effects whose downstream application in the SIMULATOR is a separate
 *      presentation point with no content EffectDef and no registry entry (the `spellPending*` pattern:
 *      Fleeting Vigor's Start-of-Combat +2/+1, pending SC Imps). These are the "empty" triggers.
 *
 * JUDGMENT CALL (owner-flagged): the derived surface is currently the two known `spellPending*` factories.
 * Other silent-application mechanics get added here as they're identified.
 */
import { ALL_CARDS, RUNES, EPIC_RUNES, QUEST_DEFS } from '@game/content';
import { heroSurface } from '@game/sim';
import { combatBeatsEnabled } from '../choreographer/combatHolds';
import { PRESENTATION_POLICIES, type PresentationBatch, type PresentationPolicy } from '@game/core';

export type TriggerCoverage = 'classified' | 'silent' | 'empty';
export type SourceKind = 'minion' | 'spell' | 'rune' | 'quest' | 'hero';

export interface TriggerRow {
  /** Stable id within its source (used for selection). */
  id: string;
  /** Human moment label ('Shout', 'Start of Combat', 'Echo', 'on cast', …). */
  moment: string;
  /** The gameplay trigger this maps to for timing resolution ('onPlay', 'startOfCombat', 'cast', …). */
  trigger: string;
  /** The content factory (content effects only; absent for derived moments). */
  factory?: string;
  policy?: PresentationPolicy;
  family?: string;
  coverage: TriggerCoverage;
  /** True for a simulator-derived moment with no content EffectDef / registry entry (an EMPTY trigger). */
  derived: boolean;
  /** Where a timing edit for this trigger writes — per-source, so tuning one card doesn't move every sibling. */
  editKey: string;
  /**
   * CHOREOGRAPHER — what editing THIS trigger reaches (owner reports 2026-08-13, twice: "nothing i do in the
   * lab seems to affect the timing in game", then "i still see a lot of previews in the library"):
   *   'live'    — paces the real game right now (End of Turn always; combat rows when the LIVE toggle is on,
   *               since PR 21/23 made both the quest/rune flags and the minion class consumable).
   *   'flag'    — WOULD be live, one click away: a combat-class row while the LIVE toggle is off.
   *               Without this state the whole combat surface read as unwired when it is actually gated.
   *   'immediate' — a SHOP action (Shout, cast, hero power). Deliberately NOT staged: shop actions fire
   *                 instantly, by design, because snappy fast-paced play is a north star (owner ruling
   *                 2026-08-14: "shop actions MUST remain immediate"). Its beat is still inspectable here,
   *                 and its consequence still emits for the record — the game just never holds the shop to
   *                 play it. This is a permanent design state, not a milestone.
   */
  live: 'live' | 'flag' | 'immediate';
}

export interface SourceEntry {
  kind: SourceKind;
  id: string;
  name: string;
  tier?: number | string;
  tribe?: string;
  triggers: TriggerRow[];
  /** Convenience for badges/sorting: does this source have any EMPTY trigger? */
  hasEmpty: boolean;
}

/** Human labels for the trigger vocabulary — so a row reads 'Shout', not 'onPlay'. */
export const MOMENT_LABEL: Record<string, string> = {
  onPlay: 'Shout (on play)', cast: 'on cast', spellCast: 'when a spell is cast',
  endOfTurn: 'End of Turn', startOfCombat: 'Start of Combat', onDeath: 'Echo (on death)',
  onAttack: 'on attack', onKill: 'on kill', onDamaged: 'on damaged', avenge: 'Avenge',
  onSummon: 'on summon', battlecryTriggered: 'when a Shout triggers', orbit: 'Orbit', orbitFired: 'when an Orbit fires',
  onGainAttack: 'on gain Attack', summonOverflow: 'on summon overflow', onConsume: 'on consume',
  goldSpent: 'on Gold spent', cardsBought: 'on cards bought', cardsPlayed: 'on cards played',
  onBuy: 'on buy', onSell: 'on sell', minionSold: 'on minion sold', spellBought: 'on spell bought',
  shopRefreshed: 'on shop refresh', rubyCast: 'on Ruby cast', onGetRuby: 'on get Ruby', onRubyPlayed: 'on Ruby played',
  spellCastOnThis: 'when a spell is cast on this', passive: 'passive', onComplete: 'on complete', recruit: 'in the shop', combat: 'in combat', onAcquire: 'on acquire',
};
const label = (trigger: string): string => MOMENT_LABEL[trigger] ?? trigger;

/** Factories whose CAST plants a buff/summon applied at Start of Combat — a distinct, currently-silent moment. */
const DERIVED_START_OF_COMBAT: Record<string, string> = {
  spellPendingSCBuff: 'Start of Combat (next-combat buff)',
  pendingSCImps: 'Start of Combat (summon Imps)',
};

const coverageOf = (key: string): { coverage: TriggerCoverage; policy?: PresentationPolicy; family?: string } => {
  const e = PRESENTATION_POLICIES[key];
  if (!e) return { coverage: 'empty' };
  return { coverage: e.policy === 'intentionallySilent' ? 'silent' : 'classified', policy: e.policy, family: e.family };
};

const runeKeyPrefixTrigger = (id: string): { key: string; trigger: string } | null => {
  // Runes/quests were registered under a phase segment (endOfTurn / combat / onAcquire / recruit / onComplete).
  // Find whichever registry key exists for this id.
  for (const [k] of Object.entries(PRESENTATION_POLICIES)) {
    const parts = k.split(':');
    if ((parts[0] === 'rune' || parts[0] === 'quest') && parts[1] === id) return { key: k, trigger: parts[2] ?? 'recruit' };
  }
  return null;
};


/** Minion effect triggers that fire IN COMBAT — the class PR 23 stamped, consumable behind the flag. */
const COMBAT_ONS = new Set([
  'onDeath', 'onAttack', 'onSummon', 'avenge', 'onKill', 'onDamaged', 'onGainAttack',
  'battlecryTriggered', 'summonOverflow', 'spellCast', 'startOfCombat', 'orbit', 'orbitFired',
]);

/** What editing a trigger reaches — see TriggerRow.live. Read at enumeration time; reopen after flag flips. */
function liveToday(kind: string, sourceId: string, trigger: string): 'live' | 'flag' | 'immediate' {
  if (trigger === 'endOfTurn' || (kind === 'hero' && sourceId === 'repete')) return 'live';
  const combatRow = ((kind === 'rune' || kind === 'quest') && trigger === 'combat')
    || (kind === 'minion' && COMBAT_ONS.has(trigger));
  if (combatRow) return combatBeatsEnabled() ? 'live' : 'flag';
  return 'immediate'; // a shop action — instant by design, never staged (see TriggerRow.live)
}

export function sourceEntries(): SourceEntry[] {
  const out: SourceEntry[] = [];

  for (const c of ALL_CARDS) {
    const kind: SourceKind = c.spell ? 'spell' : 'minion';
    const triggers: TriggerRow[] = [];
    const seen = new Set<string>();
    for (const e of [...c.effects, ...(c.chooseOne?.flatMap((o) => o.effects) ?? [])]) {
      const key = `factory:${e.do}:${e.on}`;
      const cov = coverageOf(key);
      const rowId = `${e.do}:${e.on}`;
      if (!seen.has(rowId)) {
        seen.add(rowId);
        triggers.push({
          id: rowId, moment: label(e.on), trigger: e.on, factory: e.do,
          policy: cov.policy, family: cov.family, coverage: cov.coverage, derived: false,
          editKey: `source:${kind}:${c.id}:${e.on}`,
          live: liveToday(kind, c.id, e.on),
        });
      }
      // A derived Start-of-Combat moment (Fleeting Vigor, pending SC Imps) — an EMPTY trigger.
      const dm = DERIVED_START_OF_COMBAT[e.do];
      if (dm && !seen.has(`derived:startOfCombat`)) {
        seen.add('derived:startOfCombat');
        triggers.push({
          id: 'derived:startOfCombat', moment: dm, trigger: 'startOfCombat', factory: e.do,
          coverage: 'empty', derived: true, editKey: `source:${kind}:${c.id}:startOfCombat`,
          live: 'immediate',
        });
      }
    }
    if (triggers.length) out.push({ kind, id: c.id, name: c.name, tier: c.tier, tribe: c.tribe, triggers, hasEmpty: triggers.some((t) => t.coverage === 'empty') });
  }

  for (const r of [...RUNES, ...EPIC_RUNES]) {
    const found = runeKeyPrefixTrigger(r.id);
    if (!found) continue;
    const cov = coverageOf(found.key);
    out.push({
      kind: 'rune', id: r.id, name: r.name, tier: r.epic ? 'epic' : 'basic',
      triggers: [{ id: found.trigger, moment: label(found.trigger), trigger: found.trigger, policy: cov.policy, family: cov.family, coverage: cov.coverage, derived: false, editKey: `source:rune:${r.id}:${found.trigger}`, live: liveToday('rune', r.id, found.trigger) }],
      hasEmpty: cov.coverage === 'empty',
    });
  }

  for (const q of QUEST_DEFS) {
    const found = runeKeyPrefixTrigger(q.id);
    if (!found) continue;
    const cov = coverageOf(found.key);
    out.push({
      kind: 'quest', id: q.id, name: q.name, tier: q.tier,
      triggers: [{ id: found.trigger, moment: label(found.trigger), trigger: found.trigger, policy: cov.policy, family: cov.family, coverage: cov.coverage, derived: false, editKey: `source:quest:${q.id}:${found.trigger}`, live: liveToday('quest', q.id, found.trigger) }],
      hasEmpty: cov.coverage === 'empty',
    });
  }

  // Heroes (DoD item 1b) — each hero's automatic power as one trigger moment, from the sim-side hero surface.
  for (const h of heroSurface()) {
    const cov = coverageOf(h.key);
    out.push({
      kind: 'hero', id: h.heroId, name: h.name,
      triggers: [{ id: h.powerKind, moment: `hero power · ${h.powerKind}`, trigger: h.powerKind, policy: cov.policy, family: cov.family, coverage: cov.coverage, derived: false, editKey: `source:hero:${h.heroId}:${h.powerKind}`, live: liveToday('hero', h.heroId, h.powerKind) }],
      hasEmpty: cov.coverage === 'empty',
    });
  }

  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function filterSources(entries: readonly SourceEntry[], query: string, opts?: { emptyOnly?: boolean; kind?: SourceKind | null }): SourceEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((s) => {
    if (opts?.kind && s.kind !== opts.kind) return false;
    if (opts?.emptyOnly && !s.hasEmpty) return false;
    if (!q) return true;
    return s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || s.triggers.some((t) => t.moment.toLowerCase().includes(q) || (t.factory ?? '').toLowerCase().includes(q));
  });
}

/** A synthetic preview batch for one source+trigger (fires twice with a stat consequence). */
export function fixtureBatchForTrigger(entry: SourceEntry, row: TriggerRow): PresentationBatch {
  const kind = entry.kind === 'spell' ? 'spell' : entry.kind;
  const phase = row.trigger === 'endOfTurn' ? 'endOfTurn' as const : row.trigger === 'startOfCombat' || /combat/i.test(row.trigger) ? 'startOfCombat' as const : 'recruit' as const;
  const policy = row.policy ?? 'ownBeat';
  const src = { kind: kind as never, id: entry.id, label: `${entry.name} (synthetic)` };
  return {
    id: `batch:fixture:${entry.id}:${row.id}`,
    actionId: `fixture:${entry.id}:${row.id}`,
    phase,
    events: [
      // `family` rides on the fixture (PR 18) so committed family templates pace the preview exactly as
      // they pace the live game — without it the preview silently fell through to policy defaults.
      { type: 'sourceTrigger', id: 'fx:t1', sequence: 0, step: 1, phase, source: src, trigger: row.trigger, policy, ...(row.family ? { family: row.family } : {}), repeatIndex: 0, repeatCount: 2 },
      { type: 'statsChanged', id: 'fx:c1', sequence: 1, step: 1, parentId: 'fx:t1', target: { zone: 'board', uid: 'fixture-a' }, attack: 2, health: 2, permanent: true },
      { type: 'sourceTrigger', id: 'fx:t2', sequence: 2, step: 2, phase, source: src, trigger: row.trigger, policy, ...(row.family ? { family: row.family } : {}), repeatIndex: 1, repeatCount: 2 },
      { type: 'statsChanged', id: 'fx:c2', sequence: 3, step: 2, parentId: 'fx:t2', target: { zone: 'board', uid: 'fixture-b' }, attack: 2, health: 2, permanent: true },
    ],
  };
}
