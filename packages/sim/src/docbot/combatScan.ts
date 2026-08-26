/**
 * DOC BOT — the combat presence differential (tripwire 10), shared by `combatDifferential.test.ts` and the
 * `npm run docbot` CLI.
 *
 * The question, per combat-effect card: DOES ITS EFFECT CHANGE A FIGHT? `simulate()` runs the same battle
 * with the card and with a STAT-CLONE control (identical uid, stats and keywords, but the effect-free control
 * def) — same seed — and diffs the FULL result with both identities masked. Indistinguishable fights across
 * every staged variant ⇒ the card's combat effect never acted.
 *
 * This is the GENERIC form of the phase tripwire: Conductor-in-combat is caught here with zero registry
 * entries, because a re-fired Shout that does nothing leaves the fights identical.
 *
 * TWO INSTRUMENT LESSONS built into the current shape (both found by interrogating the first cut's 54-card
 * inert queue, roadmap L1/L3):
 *
 *   · SERIALIZE THE WHOLE RESULT. The first cut compared only {events, outcome, playerDamage} — which made
 *     every ECONOMY carry-back invisible (onKill Gold, buy-bonus grants, aura carry-backs ride other
 *     CombatResult fields), so Moe read as inert while working perfectly. The diff now covers the entire
 *     `simulate()` return value.
 *   · ONE SCENARIO IS A POINT, NOT A SPACE. The generic fight cannot stage tribe-scoped watchers, Echo/Shout
 *     neighbours, deep Avenge thresholds, survivable damage, overflow, or Celestial pairs. The scan now runs
 *     a VARIANT MATRIX and a card is inert only if it acted in NONE of them — each variant exists to drain a
 *     named cluster of the original queue.
 */
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef } from '@game/core';
import { VANILLA_CONTROL_ID } from './playScan';
import { PHASE_EXCUSED } from './phaseRegistry';

/** Triggers whose home (or second home) is combat — the worklist filter. */
const COMBAT_TRIGGERS = new Set([
  'onDeath', 'onAttack', 'startOfCombat', 'avenge', 'onKill', 'onDamaged', 'onSummon',
  'summonOverflow', 'friendlyDemonDealtDamage', 'spellCastOnThis', 'passive', 'onGainAttack',
]);

const bm = (cardId: string, uid: string, attack: number, health: number, keywords: string[] = [], golden = false, extra: Record<string, unknown> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords, golden, ...extra } as unknown as BoardMinion);

/** Pick a real minion id of a tribe (same id used in subject and control runs, so its own effects cancel). */
const tribeId = (tribe: string): string =>
  Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && (c.tribe === tribe || c.tribe2 === tribe))!.id;

interface Variant { name: string; allies: (s: BoardMinion) => BoardMinion[]; enemies: () => BoardMinion[] }

/** The staged variants. Each names the inert-queue cluster it exists to drain. */
export const VARIANTS: Variant[] = [
  {
    // the original generic fight: attacks, a kill, deaths on both sides, SoC
    name: 'generic',
    allies: (s) => [bm('pup', 'p0', 2, 2), s, bm('cryptwolf', 'p2', 3, 3), bm('nanobot', 'p3', 2, 4), bm('n2_trooper', 'p4', 3, 2), bm('b2_trexbaby', 'p5', 2, 2)],
    enemies: () => [bm('pup', 'e0', 1, 1), bm('nanobot', 'e1', 4, 5), bm('cryptwolf', 'e2', 5, 6), bm('n2_trooper', 'e3', 6, 7)],
  },
  {
    // tribe-scoped watchers (Skald: Dragon attacks; Mineralmaster: Kobolds; Chancellor: Imps; …)
    name: 'tribal',
    allies: (s) => [bm(tribeId('dragon'), 'p0', 3, 4), s, bm(tribeId('dwarf'), 'p2', 3, 4), bm(tribeId('kobold'), 'p3', 3, 4), bm(tribeId('demon'), 'p4', 3, 4), bm(tribeId('beast'), 'p5', 3, 4)],
    enemies: () => [bm(tribeId('undead'), 'e0', 2, 3), bm(tribeId('mech'), 'e1', 4, 6), bm(tribeId('demon'), 'e2', 5, 7)],
  },
  {
    // Echo + Shout neighbours (Ryme, Dawnclaw, Echohorn, Hawkus, Echomimic — re-fire adjacents)
    name: 'neighbours',
    allies: (s) => {
      const echoer = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.effects.some((e) => e.on === 'onDeath'))!;
      const shouter = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.effects.some((e) => e.on === 'onPlay'))!;
      return [bm(echoer.id, 'p0', 2, 2, [...echoer.keywords]), s, bm(shouter.id, 'p2', 2, 3, [...shouter.keywords]), bm('pup', 'p3', 2, 2)];
    },
    enemies: () => [bm('nanobot', 'e0', 5, 6), bm('cryptwolf', 'e1', 5, 7), bm('n2_trooper', 'e2', 6, 8)],
  },
  {
    // deep Avenge thresholds + friendly-death watchers: many cheap allies die
    name: 'massDeaths',
    allies: (s) => [bm('pup', 'p0', 1, 1), bm('pup', 'p1', 1, 1), s, bm('pup', 'p3', 1, 1), bm('pup', 'p4', 1, 1), bm('pup', 'p5', 1, 1), bm('pup', 'p6', 1, 1)],
    enemies: () => [bm('cryptwolf', 'e0', 4, 20), bm('nanobot', 'e1', 5, 22)],
  },
  {
    // guaranteed OWN kills + survivable damage (onKill, onDamaged): weak enemies that poke
    name: 'killsAndPokes',
    allies: (s) => [s, bm('cryptwolf', 'p1', 2, 8)],
    enemies: () => [bm('pup', 'e0', 1, 1), bm('pup', 'e1', 1, 1), bm('pup', 'e2', 1, 1), bm('pup', 'e3', 1, 2), bm('pup', 'e4', 1, 2)],
  },
  {
    // summon overflow: a near-full board + echo summoners (Monk, Thundering Abomination)
    name: 'overflow',
    allies: (s) => {
      const summoner = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.effects.some((e) => e.on === 'onDeath' && e.do === 'deathrattleSummon'))!;
      return [bm(summoner.id, 'p0', 1, 1), bm(summoner.id, 'p1', 1, 1), s, bm('pup', 'p3', 2, 2), bm('pup', 'p4', 2, 2), bm('pup', 'p5', 2, 2), bm('pup', 'p6', 2, 2)];
    },
    enemies: () => [bm('cryptwolf', 'e0', 6, 18), bm('nanobot', 'e1', 6, 18)],
  },
  {
    // Celestial pairs — WITH ALIGNMENT STAMPED. `align` is a reducer-set BoardMinion field (locked at combat
    // setup); the first cut never set it, so every alignment-gated Start of Combat read as inert and three
    // working Celestials were mis-queued (owner audit 2026-08-26). The subject is stamped 'eclipse' (counts
    // as both Dawn and Dusk, per approved rule R-CEL-01) so either half of a split effect can fire.
    name: 'celestial',
    allies: (s) => [bm(tribeId('celestial'), 'p0', 3, 4, [], false, { align: 'dawn' }), { ...s, align: 'eclipse' } as BoardMinion, bm(tribeId('celestial'), 'p2', 3, 4, [], false, { align: 'dusk' }), bm('pup', 'p3', 2, 2)],
    enemies: () => [bm('nanobot', 'e0', 4, 6), bm('cryptwolf', 'e1', 5, 8)],
  },
  {
    // A LIVING left-most Echo + a stored side spell: Echohorn's Rally procs the LEFT-MOST Echo, so the echoer
    // must be alive at slot 0 when the subject attacks (the first cut's echoer was 2/2 and long dead — a
    // working Echohorn was mis-queued); Sporebat-family Echoes cast the side's stored spell, so one is armed.
    name: 'livingEcho',
    allies: (s) => {
      const echoer = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token
        && c.effects.some((e) => e.on === 'onDeath' && e.do === 'deathrattleSummon' && !(e.params as { fixed?: boolean }).fixed))!;
      return [bm(echoer.id, 'p0', 1, 30), s, bm('pup', 'p2', 1, 1)];
    },
    enemies: () => [bm('cryptwolf', 'e0', 4, 14)],
  },
  {
    // combat spell casts (spellCastOnThis / spell watchers): an ally that casts a named spell mid-fight
    name: 'spellcaster',
    allies: (s) => {
      const caster = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.effects.some((e) => /Cast/.test(e.do) && (e.on === 'onAttack' || e.on === 'onDeath')))!;
      return [bm(caster.id, 'p0', 3, 5, [...caster.keywords]), s, bm('pup', 'p2', 2, 2)];
    },
    enemies: () => [bm('nanobot', 'e0', 4, 8), bm('cryptwolf', 'e1', 5, 9)],
  },
];

/** One fight under a variant; the FULL simulate() return value, serialized with the subject's identity
 *  masked STRUCTURALLY. String-masking cardId+name was not enough — `initial` and event payloads carry the
 *  subject's TRIBE, which a neutral control can never match, so every card trivially "differed" and the
 *  re-sabotage check exposed the scan as vacuous (the second time a Doc Bot instrument was caught by its own
 *  sabotage discipline; see also playScan's control saga). The fix is two-sided:
 *   · the CONTROL BODY wears the subject's tribes BEHAVIOURALLY (`addedTribes` folds into combat `tribe2`;
 *    `universalTribe` is honoured from the board flag) so tribal auras hit both bodies alike, and
 *   · `maskDeep` strips identity fields (cardId, name, tribe, tribe2, universalTribe) from any object owned
 *     by the subject uid, plus display `text` strings, so only CONSEQUENCES remain.
 *  Residual, documented: a DUAL-tribe subject's second tribe cannot be cloned onto the control (one
 *  addedTribes slot), so a tribe2-keyed aura can mark such a card active without its effect acting — an
 *  undercount of the inert queue, never an overcount. */
function fight(subject: BoardMinion, variant: Variant, maskIds: ReadonlySet<string>): string {
  const result = simulate(variant.allies(subject), variant.enemies(), makeRng(0xf17e), CARD_INDEX,
    // `lastSpellCastId` armed: stored-spell Echoes (Sporebat family) read it from the side; leaving it empty
    // made a working card read inert (owner audit 2026-08-26).
    combatSide({ tier: 5, tribes: ['beast', 'demon', 'dragon', 'dwarf', 'kobold'] as never, lastSpellCastId: 'growth' } as never),
    combatSide({ tier: 5 }));
  const r = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
  // TRIGGER TELEMETRY, not effect consequence — these tick when a trigger FIRES regardless of what its
  // factory did, so they mask a dead factory exactly like `shoutsThisTurn` did in the play lane (the third
  // instrument catch of the sabotage discipline): the run-wide deathrattle tallies, and the quest-event
  // stream (which also embeds the subject's def-tribes per attack/death, an identity leak with no uid to
  // mask by).
  delete r.playerDeathrattles; delete r.enemyDeathrattles;
  delete r.playerQuestEvents; delete r.enemyQuestEvents;
  return JSON.stringify(maskDeep(r, maskIds));
}

/** Identity-mask keyed on CARD ID VALUE, not uid — `initial` and event entries carry REMAPPED uids (m0, m1…)
 *  with no sourceUid, so a uid-keyed mask silently never fired there (the sabotage discipline's second catch
 *  in this file). Any object whose cardId is the subject's or the control's loses its identity fields. */
function maskDeep(v: unknown, ids: ReadonlySet<string>): unknown {
  if (Array.isArray(v)) return v.map((x) => maskDeep(x, ids));
  if (v && typeof v === 'object') {
    const o = { ...(v as Record<string, unknown>) };
    delete o.text; // display strings carry names
    if (typeof o.cardId === 'string' && ids.has(o.cardId)) {
      delete o.cardId; delete o.name; delete o.tribe; delete o.tribe2; delete o.universalTribe;
      delete o.golden; // the golden lane compares golden-vs-plain SUBJECTS: the flag itself must not be the diff
    }
    for (const k of Object.keys(o)) o[k] = maskDeep(o[k], ids);
    return o;
  }
  return v;
}

export interface CombatScanResult {
  /** Cards whose presence changed NO variant of the staged fights, vs a stat-clone control. */
  inert: string[];
  /** Cards covered and confirmed active, with the variant that proved them. */
  activeCount: number;
  provedBy: Record<string, string>;
}

// NOTE (owner audit 2026-08-26): the former GOLDEN-FLAT lane was removed as an instrument artifact — it
// compared golden-vs-plain in the variant that PROVED a card active, but the proving difference often came
// from a non-scaling aspect (a Ward, a body) while the effect never fired there, so working cards
// (Beardsley, Imp King verified doubling +3→+6) were mis-queued. Golden semantics are checked where they are
// checkable: per-family magnitude contracts (tripwire 13) that assert exact ×2 when the effect FIRES.

export function combatScan(): CombatScanResult {
  const inert: string[] = [];
  const provedBy: Record<string, string> = {};
  let activeCount = 0;
  const control = CARD_INDEX[VANILLA_CONTROL_ID]!;

  for (const def of Object.values(CARD_INDEX)) {
    if (!def || def.spell || def.ruby) continue;
    const combatEffects = def.effects.filter((e) => COMBAT_TRIGGERS.has(e.on));
    if (combatEffects.length === 0) continue;
    // Already answered elsewhere: if EVERY combat-relevant effect carries a combat-side excuse in the phase
    // registry (other-channel, state-missing, …), this lane has nothing to add — re-questioning it here
    // double-counts (Ancient Wanderer's shop passive was mis-queued this way; owner audit 2026-08-26).
    if (combatEffects.every((e) => PHASE_EXCUSED[e.do]?.phase === 'combat')) continue;
    const a = Math.max(1, def.attack);
    const h = Math.max(1, def.health);
    // The control wears the subject's tribes behaviourally (see fight()'s doc).
    const controlBody = (): BoardMinion => ({
      ...bm(control.id, 'pS', a, h, [...def.keywords]),
      ...(def.tribe !== 'neutral' || def.tribe2 ? { addedTribes: [def.tribe, ...(def.tribe2 ? [def.tribe2] : [])] } : {}),
      ...(def.universalTribe ? { universalTribe: true } : {}),
    } as BoardMinion);
    const maskIds = new Set([def.id, control.id]);
    let activeVariant: Variant | undefined;
    for (const variant of VARIANTS) {
      if (fight(bm(def.id, 'pS', a, h, [...def.keywords]), variant, maskIds) !== fight(controlBody(), variant, maskIds)) { activeVariant = variant; break; }
    }
    if (!activeVariant) { inert.push(def.id); continue; }
    activeCount++;
    provedBy[def.id] = activeVariant.name;
  }
  return { inert, activeCount, provedBy };
}

/** The defs the scan worklist covers — exported so the test can pin the surface size. */
export function combatWorklist(): CardDef[] {
  return Object.values(CARD_INDEX).filter((c): c is CardDef =>
    !!c && !c.spell && !c.ruby && c.effects.some((e) => COMBAT_TRIGGERS.has(e.on)));
}
