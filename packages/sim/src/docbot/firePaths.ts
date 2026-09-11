/**
 * DOC BOT — fire-path derivation (the `firePaths` lane), shared by `firePaths.test.ts` (gates) and the
 * `npm run docbot` CLI (prints the classification).
 *
 * THE MISS THIS ENCODES (Bug Board 7e04222d, fixed in PR #1374): the Rune of Rallying's free Start-of-Combat
 * Rally (`fireFreeRally` in packages/core/src/combat/simulate.ts) ran only the rallier's OWN `onAttack`
 * effects. A NATURAL Rally — an RL body swinging — goes out on the `onAttack` bus and reaches every watcher
 * on the board, so Hawkus ("whenever you trigger a Rally, trigger your left-most Echo"), Paragon and Mineral
 * Master lit on every real swing and stayed dark on the rune's Rally. A SYNTHETIC fire path had quietly
 * diverged from the natural one, and no lane compared the two: the phase registry proves a factory exists,
 * the combat differential proves it acts SOMEWHERE, and neither asks whether every path that claims to be
 * "a Rally" reaches the same set of listeners.
 *
 * Two halves, both derived from source and content — nothing here is a hand-kept list that can rot:
 *
 *   1. SYNTHETIC FIRE SITES. In combat the natural emitter is the `CombatBus`: `registerEffect` subscribes
 *      every effect to its trigger, and a `bus.emit('<trigger>')` reaches every subscriber. Anything else that
 *      invokes `FACTORIES[…]` directly — a free Rally, a multiplier re-fire loop, an Echo proc, a replayed
 *      Shout, a Start-of-Combat dispatch — is a SYNTHETIC path: it hand-picks who hears the trigger. The
 *      scan below finds every such call in core and demands a classification in `SYNTHETIC_FIRE_SITES`
 *      (keyed by file + enclosing scope + trigger). An unclassified site fails ("classify me"); a registry
 *      entry no site matches any more fails too (the list cannot rot into scenery).
 *
 *   2. THE RALLY DERIVATION PAIR. For every `onAttack` factory in content, the lane stages its card as a
 *      WATCHER (0 Attack, so it never swings itself) and as a RALLIER, and asks who reacts under
 *        · a NATURAL Rally      — an RL ally attacks (the bus path),
 *        · a NATURAL plain swing — the same ally without RL (what separates a Rally watcher from an
 *                                  ally-attack watcher such as Crypt Drake),
 *        · a FREE Rally         — Rune of Rallying's Start-of-Combat fire, read in the window BEFORE the
 *                                  first attack event so the synthetic fire is the only Rally in it,
 *        · a MULTIPLIED Rally   — one natural swing with Uron on the board (`extraTriggerFires('rally')`),
 *                                  whose extra fire is the other synthetic site of the family; measured by a
 *                                  factory spy (invocation count), so it cannot be fooled by how many events
 *                                  a second fire happens to emit.
 *      "Reacted" is read off the event log: every event a factory emits is stamped `key: factory:<do>:<on>`
 *      + `srcCard` by `withEffect`, on BOTH paths, so the detector cannot favour one side. The derivation:
 *      the free-Rally watcher set must EQUAL the natural-Rally watcher set minus the ally-ATTACK watchers
 *      (a free Rally is not an attack — the documented excuse, verified per factory by the plain-swing
 *      staging rather than taken on trust), and the multiplied Rally must invoke each of them twice.
 *      A factory that reacts on NO path is not silently fine: it must carry a `FIRE_UNOBSERVED` reason.
 *
 * Deliberately NOT here: recruit-phase dispatch (`RECRUIT_FACTORIES`) has no bus at all, so every shop
 * dispatch is direct and "natural vs synthetic" is not a distinction the shop makes.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVED_CARDS, CARD_INDEX } from '@game/content';
import { FACTORIES, combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent } from '@game/core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

// ── source scopes (shared with entryPaths.ts) ─────────────────────────────────────────────────────────────

const SCOPE_PATTERNS: RegExp[] = [
  /^(\s*)(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[<(]/,
  /^(\s*)(?:export\s+)?(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:<[^>]*>)?\([^)]*\)\s*(?::[^=]+)?=>/,
  /^(\s*)(\w+):\s*(?:async\s*)?(?:<[^>]*>)?\([^)]*\)\s*(?::[^=]+)?=>/, // a table entry (`rallyBuff: (ctx, self) =>`)
  /^(\s*)case\s+'(\w+)':/, // a reducer action
];

/** The innermost named scope enclosing line `at`: the nearest preceding function / arrow / table entry /
 *  `case` label that sits at a SMALLER indentation than the site (a sibling one-liner at the same depth is
 *  not an enclosure). Returns `?` at top level. */
export function enclosingScope(lines: readonly string[], at: number): string {
  const indentOf = (s: string): number => /^(\s*)/.exec(s)![1]!.length;
  let depth = indentOf(lines[at]!);
  for (let i = at - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.trim() || /^\s*(\/\/|\*|\/\*)/.test(line)) continue; // blank + comment lines carry no scope
    const ind = indentOf(line);
    if (ind >= depth) continue;
    const named = (l: string): string | undefined => { for (const re of SCOPE_PATTERNS) { const m = re.exec(l); if (m) return m[2]!; } return undefined; };
    const here = named(line);
    if (here) return here;
    // A multi-line signature's tail (`): CombatResult {`) sits at the declaration's own indentation: the name
    // is on the first line of that signature, above, at the same depth.
    if (/^\s*\)/.test(line)) {
      for (let j = i - 1; j >= 0; j--) {
        const up = lines[j]!;
        if (!up.trim() || /^\s*(\/\/|\*|\/\*)/.test(up)) continue;
        const upInd = indentOf(up);
        if (upInd < ind) break;
        if (upInd === ind) { const n = named(up); if (n) return n; }
      }
    }
    depth = ind; // a shallower non-declaration line (a brace, an `if`) narrows the search upward
  }
  return '?';
}

// ── 1. synthetic fire sites ────────────────────────────────────────────────────────────────────────────────

/** The core files that can dispatch a combat factory. `registerEffect` (the bus subscription) lives in the first. */
export const FIRE_SITE_FILES = [
  'packages/core/src/combat/simulate.ts',
  'packages/core/src/effects/factories.ts',
  'packages/core/src/effects/arena.ts',
] as const;

export interface FireSite {
  /** `<basename>#<enclosing scope>#<trigger>` — the registry key. */
  key: string;
  file: string;
  line: number;
  enclosing: string;
  /** The trigger literal the site gates on (`effect.on === 'onAttack'`), the trigger implied by a literal
   *  factory id, or `?` when the site dispatches whatever effect it was handed. */
  trigger: string;
  text: string;
}

export type FireSiteKind =
  | 'natural' // the bus subscription itself — the path every other site is measured against
  | 'natural-dispatch' // a trigger with NO bus: the primary dispatcher IS the natural path (Start of Combat, ordered onSummon)
  | 'free-rally' // a Rally fired without an attack (Rune of Rallying, Backbeat, Hunting Bell, `triggerRally`)
  | 'rally-multiplier' // the extra fires a Rally multiplier adds (Uron, the additive doublers)
  | 'echo-proc' // an Echo fired without a death (Echohorn, Hawkus, Spots, Bone Throne)
  | 'battlecry-replay' // a Shout re-fired in combat (Ryme, Sovereign, Dawnclaw, Conductor)
  | 'kill-replay' // an on-kill effect re-fired by a multiplier
  | 'ruby-replay' // an on-Ruby-played effect fired by a combat Ruby
  | 'copied-effect'; // an effect run on behalf of a body that copied it

export interface FireSiteEntry {
  kind: FireSiteKind;
  /** Which behavioural derivation pair covers the site, or `none` with the natural counterpart named in `why`. */
  pair: 'rally' | 'none';
  why: string;
}

/**
 * Every direct `FACTORIES[…]` dispatch in core, classified. Keys are `<file>#<enclosing>#<trigger>` exactly as
 * `scanFireSites()` derives them; the lane fails on an unclassified site AND on an entry with no site.
 *
 * `pair: 'rally'` sites are held to the behavioural derivation in `rallyDerivation()`. `pair: 'none'` sites
 * are classified (so a NEW site is at least named and read) but not yet paired — each `why` names the
 * natural counterpart, which is the spec for the next pair.
 */
export const SYNTHETIC_FIRE_SITES: Readonly<Record<string, FireSiteEntry>> = {
  // ── the natural path ──
  'simulate.ts#registerEffect#?': { kind: 'natural', pair: 'none', why: 'the CombatBus subscription — every bus.emit reaches every registered effect (alignment-gated halves excluded at registration); this is the reference path' },
  'simulate.ts#emitOnSummonOrdered#onSummon': { kind: 'natural-dispatch', pair: 'none', why: 'onSummon never travels the bus: this ordered dispatch (auras first, then watchers left→right, owner ruling 2026-08-12) IS the natural path' },
  'simulate.ts#simulate#startOfCombat': { kind: 'natural-dispatch', pair: 'none', why: 'Start of Combat has no bus event: the inline loop in simulate() IS the natural dispatch (scEngraveAll first, then board order, then the Uron/Chronos extras; alignment-gated at each site)' },
  // ── Rally ──
  'simulate.ts#fireFreeRally#onAttack': { kind: 'free-rally', pair: 'rally', why: "Rune of Rallying / Backbeat / Hunting Bell / ctx.triggerRally: the rallier's own onAttack effects, then the RL-gated watchers on the rest of the side (the 7e04222d fix); ally-ATTACK watchers stay quiet because no attack happened" },
  'simulate.ts#refireRallyWatchers#onAttack': { kind: 'rally-multiplier', pair: 'rally', why: 'the Rally WATCHERS re-fired once per multiplier extra (owner report 2026-08-14: Paragon was stuck at ×1)' },
  'simulate.ts#performAttack#onAttack': { kind: 'rally-multiplier', pair: 'rally', why: "the attacker's own onAttack effects re-run per Uron/Drakko extra and per additive doubler (Law of Teeth, Rallying Offensive, …) — direct calls so broadcast watchers do not double" },
  // ── Echo ──
  'simulate.ts#fireOnce#onDeath': { kind: 'natural-dispatch', pair: 'none', why: "fireOwnDeathrattles' inner fire: a body's OWN Echo on its own death runs here (with the killer), then `onDeath` goes out on the bus with ownAlreadyFired for the watchers — the natural death path" },
  'simulate.ts#killOrReborn#onDeath': { kind: 'echo-proc', pair: 'none', why: 'the Rise branch: a body that comes back fires its Echo here before the ownAlreadyFired broadcast. Natural counterpart: fireOwnDeathrattles' },
  'simulate.ts#killOrReborn#onPlay': { kind: 'battlecry-replay', pair: 'none', why: 'Rune of the Warpath / Sovereign-style "when X dies, the left-most Shout fires" replays. Natural counterpart: the shop play (recruit-owned; cross-phase equivalence is the factoryPhase lane)' },
  'simulate.ts#performAttack#onDeath': { kind: 'echo-proc', pair: 'none', why: "Echohorn Stag / Hawkus-style \"trigger your left-most Echo\" on attack: fires the echoer's onDeath effects without killing it. Natural counterpart: the death path; pair wanted (which onDeath WATCHERS hear a proc'd Echo?)" },
  'simulate.ts#simulate#onDeath': { kind: 'echo-proc', pair: 'none', why: 'the inline rune block in simulate(): Bone Throne-style Start-of-Combat Echo procs on living bodies, plus the Adjacent-Battlecry replay literal. Natural counterpart: the death path' },
  // ── Shouts in combat ──
  'simulate.ts#onCombatSpellCast#onPlay': { kind: 'battlecry-replay', pair: 'none', why: "Rune of Shared Scripture's forced left-most Shout on the first combat spell cast (folds Drakko, then fireFreeRally for the Rally half). Combat has no natural Shout — the shop play is the natural path" },
  'simulate.ts#performAttack#onPlay': { kind: 'battlecry-replay', pair: 'none', why: 'the Burning-Legion / left-most-Shout-on-attack combat replays' },
  // ── on-kill ──
  'simulate.ts#performAttack#onKill': { kind: 'kill-replay', pair: 'none', why: 'Slaughter re-fires per multiplier extra after the natural `onKill` bus emit' },
  // ── factories.ts helpers ──
  'factories.ts#playRubyOn#onRubyPlayed': { kind: 'ruby-replay', pair: 'none', why: "a Ruby played in combat fires the target's onRubyPlayed effects directly (no bus event for Rubies in combat)" },
  'factories.ts#triggerEchoOn#onDeath': { kind: 'echo-proc', pair: 'none', why: "the combat arena's triggerEchoOn: runs a living body's onDeath effects under asEcho (Echohorn, Spots, Hawkus)" },
  'factories.ts#fire#onDeath': { kind: 'echo-proc', pair: 'none', why: 'the golden/multiplied inner fire of the arena Echo proc' },
  'factories.ts#replayCombatBattlecry#onPlay': { kind: 'battlecry-replay', pair: 'none', why: 'the shared combat Shout replay — War Drum / Encore extras consumed here; see the phaseRegistry docblock history' },
  'factories.ts#battlecryTriggeredOwnDeathrattle#onDeath': { kind: 'echo-proc', pair: 'none', why: "a Shout that fires the body's OWN Echo without dying" },
};

const TRIGGER_GATE = /\.on\s*(?:===|!==)\s*'(\w+)'/;

/** Scan core for every direct `FACTORIES[…]` dispatch — the synthetic-path candidates plus the bus handler. */
export function scanFireSites(): FireSite[] {
  const out: FireSite[] = [];
  for (const rel of FIRE_SITE_FILES) {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
    const base = rel.split('/').pop()!;
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i]!;
      if (/^\s*(\/\/|\*)/.test(text)) continue; // comments
      if (!/\bFACTORIES\[/.test(text)) continue;
      let trigger = '?';
      const literal = /FACTORIES\['(\w+)'\]/.exec(text);
      if (literal) {
        const eff = Object.values(CARD_INDEX).flatMap((c) => c?.effects ?? []).find((e) => e.do === literal[1]);
        trigger = eff?.on ?? '?';
      } else {
        for (let j = i; j >= Math.max(0, i - 8); j--) {
          const g = TRIGGER_GATE.exec(lines[j]!);
          if (g) { trigger = g[1]!; break; }
        }
      }
      const enclosing = enclosingScope(lines, i);
      out.push({ key: `${base}#${enclosing}#${trigger}`, file: rel, line: i + 1, enclosing, trigger, text: text.trim() });
    }
  }
  return out;
}

export interface FireSiteAudit {
  sites: FireSite[];
  /** Scanned sites with no registry entry — "classify me". */
  unclassified: FireSite[];
  /** Registry keys no scanned site matches — rot. */
  stale: string[];
}

export function auditFireSites(): FireSiteAudit {
  const sites = scanFireSites();
  const keys = new Set(sites.map((s) => s.key));
  return {
    sites,
    unclassified: sites.filter((s) => !SYNTHETIC_FIRE_SITES[s.key]),
    stale: Object.keys(SYNTHETIC_FIRE_SITES).filter((k) => !keys.has(k)),
  };
}

// ── 2. the Rally derivation pair ──────────────────────────────────────────────────────────────────────────

/** `onAttack` factories that emit nothing on ANY staged path. Each needs a reason a reader can check against
 *  the staging (`fight()` below); a factory that starts emitting makes its entry stale and fails the lane. */
export const FIRE_UNOBSERVED: Readonly<Record<string, string>> = {
  onAttackStripKeywords: 'Tauntbreaker strips keywords from the body it HITS; the staged dummy carries none',
  onFriendlyAttackBuffTribe: 'Raptor reacts to a friendly BEAST attacking; the reference rallier is a Dragon and the Beast filler never swings',
  onAllyAttackCastGrowth: 'Fatecarver casts Growth when an ally attacks; Growth is not combat-castable under the staged side, so the cast fizzles (the Beefy class — see COMBAT_CASTING_FACTORIES)',
  rallySummonRandomTribeFromHand: 'Seedling summons from HAND; combat sides carry no hand',
  rallyGiveTribeAttackOfHighestAttackHand: 'Flamebanner reads the highest-Attack card in HAND; combat sides carry no hand',
  rallyGainAttackPerSpiritsPlayed: 'Kindled scales with spiritsPlayed, which the staged side leaves at 0',
  rallyGrantFirstSpellCopy: 'Conductor copies the first spell cast this turn; the staged side names none',
};

export type RallyClass =
  | 'self-rally' // reacts to its OWN swing only (the ordinary Rally effect)
  | 'rally-watcher' // reacts to ANOTHER RL ally's swing and NOT to a plain swing (Hawkus, Paragon, Mineral Master)
  | 'attack-watcher' // reacts to another ally's swing whether or not it was a Rally (Crypt Drake): excused from free Rallies
  | 'unobserved'; // emitted nothing on any staged path

export interface RallyObservation {
  factory: string;
  card: string;
  cls: RallyClass;
  /** Emitted on: natural own swing / natural other RL swing / natural other plain swing / free Rally as the
   *  rallier / free Rally on another rallier (the last two read in the pre-attack window). */
  natSelf: boolean;
  natOther: boolean;
  natPlain: boolean;
  freeSelf: boolean;
  freeOther: boolean;
  /** Factory INVOCATIONS over one natural Rally, ×1 and with Uron on the board (spy-counted). */
  fires: number;
  firesMultiplied: number;
}

export interface RallyDivergence { factory: string; card: string; problem: string }

const bm = (cardId: string, uid: string, attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords } as unknown as BoardMinion);

/** The reference rallier: a content card whose Rally grants itself spell power — a reaction that changes no
 *  stat on any body, so it never confounds the subject's, and never gives the rallier the Attack to keep
 *  swinging after a free Rally. Falls back to any self-only Rally. */
function referenceRallier(exclude: string): CardDef {
  const all = Object.values(CARD_INDEX).filter((c): c is CardDef => !!c && !c.spell && !c.token && !c.ruby && c.id !== exclude);
  return all.find((c) => c.effects.some((e) => e.on === 'onAttack' && e.do === 'rallyGrantSpellPower'))
    ?? all.find((c) => c.effects.some((e) => e.on === 'onAttack' && e.do === 'rallyBuffSelf'))!;
}

/** A 0-Attack, effect-free enemy body: it can never swing, so the only attacks in a fight are the ones the
 *  staging arranges. `omen` is the declared clean control token (see playScan.ts). */
const DUMMY_ENEMY = 'omen';

interface Staging { player: BoardMinion[]; rune?: boolean; multiplier?: boolean; enemyHealth?: number }

/** 0-Attack FILLERS seated to the RIGHT of the subject so tribe-/Echo-scoped Rallies have subjects: an Echo
 *  body (Mama Pup: Beast + deathrattleSummon) and a Dragon. They never swing; their own effects emit under
 *  their own `srcCard`, so they cannot be mistaken for the subject's. A filler that IS the subject's card is
 *  dropped (same-id stamps would confound). */
function fillers(subject: string): BoardMinion[] {
  const dragon = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && c.tribe === 'dragon' && c.id !== subject)!;
  return [bm('pack', 'f0', 0, 40), bm(dragon.id, 'f1', 0, 40)].filter((m) => m.cardId !== subject);
}

function fight(st: Staging): CombatEvent[] {
  const subject = st.player.find((m) => m.sourceUid === 'w')!.cardId;
  const player = [...st.player, ...fillers(subject), ...(st.multiplier ? [bm('uron', 'mult', 0, 40)] : [])];
  const r = simulate(player, [bm(DUMMY_ENEMY, 'e0', 0, st.enemyHealth ?? 400)], makeRng(0x5a11), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['beast', 'demon', 'dragon', 'dwarf', 'kobold', 'undead', 'mech', 'celestial', 'spirit'] as never,
      lastSpellCastId: 'growth', questMods: st.rune ? { runeRallying: true } : {} } as never),
    combatSide({ tier: 1 }));
  return r.events;
}

const stampOf = (e: CombatEvent): { key?: string; srcCard?: string } => e as unknown as { key?: string; srcCard?: string };
const isMine = (e: CombatEvent, factory: string, card: string): boolean =>
  stampOf(e).key === `factory:${factory}:onAttack` && stampOf(e).srcCard === card;

/** Did the factory emit in the pre-attack window (Start of Combat — where a free Rally lives) / after the
 *  first attack (the natural path)? */
function reactedBeforeAttacks(events: readonly CombatEvent[], factory: string, card: string): boolean {
  const first = events.findIndex((e) => e.type === 'attack');
  return events.slice(0, first < 0 ? events.length : first).some((e) => isMine(e, factory, card));
}
function reactedAfterAttacks(events: readonly CombatEvent[], factory: string, card: string): boolean {
  const first = events.findIndex((e) => e.type === 'attack');
  return first >= 0 && events.slice(first).some((e) => isMine(e, factory, card));
}

/** Count the factory's INVOCATIONS for `card` across one fight — a spy on the registry, restored after. */
function countFires(factory: string, card: string, st: Staging): number {
  const table = FACTORIES as Record<string, ((...a: unknown[]) => unknown) | undefined>;
  const real = table[factory];
  if (!real) return 0;
  let n = 0;
  table[factory] = (...args: unknown[]): unknown => {
    if ((args[1] as { cardId?: string } | undefined)?.cardId === card) n++;
    return real(...args);
  };
  try { fight(st); } finally { table[factory] = real; }
  return n;
}

/** Every `onAttack` factory in ACTIVE content (archived cards resolve by id but are not reachable), with the
 *  first card that carries it. */
export function rallyWorklist(): { factory: string; card: CardDef }[] {
  const archived = new Set(ARCHIVED_CARDS.map((c) => c.id));
  const seen = new Map<string, CardDef>();
  for (const c of Object.values(CARD_INDEX)) {
    if (!c || c.spell || c.ruby || archived.has(c.id)) continue;
    for (const e of c.effects) if (e.on === 'onAttack' && !seen.has(e.do)) seen.set(e.do, c);
  }
  return [...seen.entries()].map(([factory, card]) => ({ factory, card }));
}

export function observeRally(factory: string, card: CardDef): RallyObservation {
  const ref = referenceRallier(card.id);
  const noRL = card.keywords.filter((k) => k !== 'RL');
  const watcher = (): BoardMinion => bm(card.id, 'w', 0, 40, noRL);
  const rallier = (): BoardMinion => bm(card.id, 'w', 3, 40, [...noRL, 'RL']);
  const other = (rl: boolean): BoardMinion => bm(ref.id, 'r', 3, 40, rl ? ['RL'] : []);
  // The rallier goes LEFT-MOST so Rune of Rallying's "left-most Rally" is the one under study.
  const natSelfEv = fight({ player: [rallier()] });
  const natOtherEv = fight({ player: [other(true), watcher()] });
  const natPlainEv = fight({ player: [other(false), watcher()] });
  const freeSelfEv = fight({ player: [rallier()], rune: true });
  const freeOtherEv = fight({ player: [other(true), watcher()], rune: true });
  const natSelf = reactedAfterAttacks(natSelfEv, factory, card.id);
  const natOther = reactedAfterAttacks(natOtherEv, factory, card.id);
  const natPlain = reactedAfterAttacks(natPlainEv, factory, card.id);
  const freeSelf = reactedBeforeAttacks(freeSelfEv, factory, card.id);
  const freeOther = reactedBeforeAttacks(freeOtherEv, factory, card.id);
  const cls: RallyClass = natOther ? (natPlain ? 'attack-watcher' : 'rally-watcher') : natSelf ? 'self-rally' : freeSelf || freeOther ? 'rally-watcher' : 'unobserved';
  // The multiplier pair: ONE natural Rally (the dummy dies to the first swing), with and without Uron.
  const one: Staging = cls === 'self-rally' ? { player: [rallier()], enemyHealth: 1 } : { player: [other(true), watcher()], enemyHealth: 1 };
  const fires = countFires(factory, card.id, one);
  const firesMultiplied = countFires(factory, card.id, { ...one, multiplier: true });
  return { factory, card: card.id, cls, natSelf, natOther, natPlain, freeSelf, freeOther, fires, firesMultiplied };
}

/** The derivation itself, as a pure function of the observations — so a doctored observation can prove the
 *  alarm works (the in-file sabotage check in firePaths.test.ts). */
export function deriveRallyDivergences(observations: readonly RallyObservation[]): RallyDivergence[] {
  const out: RallyDivergence[] = [];
  for (const o of observations) {
    const d = (problem: string): void => { out.push({ factory: o.factory, card: o.card, problem }); };
    if (o.cls === 'unobserved') continue;
    if (o.natSelf && !o.freeSelf && o.cls !== 'attack-watcher') d('reacts to its OWN natural Rally but not to a free Rally on itself — fireFreeRally skips its own effects');
    if (!o.natSelf && o.freeSelf) d("a free Rally on itself fires an effect its own natural swing does not — the synthetic path skips a gate the bus subscription applies (registerEffect's alignment gate, for one)");
    if (o.cls === 'rally-watcher' && !o.freeOther) d("a Rally WATCHER (reacts to another RL ally's swing, silent on a plain swing) is not reached by a free Rally — the Hawkus class (7e04222d)");
    if (o.cls === 'attack-watcher' && o.freeOther) d('an ally-ATTACK watcher (reacts to a plain swing too) is reached by a free Rally, which is not an attack');
    if (o.cls === 'self-rally' && o.freeOther) d("a self-only Rally effect fired for ANOTHER body's free Rally");
    if ((o.cls === 'rally-watcher' || o.cls === 'self-rally') && o.fires > 0 && o.firesMultiplied !== 2 * o.fires) {
      d(`a Rally multiplier (Uron, +1 extra) invoked it ${o.firesMultiplied}× for one Rally vs ${o.fires}× unmultiplied — expected exactly 2×: the multiplier re-fire loop does not reach it (the Paragon class, owner report 2026-08-14)`);
    }
    if (o.cls === 'attack-watcher' && o.fires > 0 && o.firesMultiplied !== o.fires) {
      d(`an ally-ATTACK watcher counts swings, not Rallies, yet a Rally multiplier changed its invocations for one swing (${o.fires} → ${o.firesMultiplied})`);
    }
  }
  return out;
}

export interface RallyDerivation {
  observations: RallyObservation[];
  /** Synthetic ≠ natural — the Hawkus class. */
  divergences: RallyDivergence[];
  /** Reacted nowhere and not excused in FIRE_UNOBSERVED. */
  unexplained: string[];
  /** FIRE_UNOBSERVED entries whose factory now reacts somewhere. */
  staleExcuses: string[];
}

export function rallyDerivation(): RallyDerivation {
  const observations = rallyWorklist().map(({ factory, card }) => observeRally(factory, card));
  const divergences = deriveRallyDivergences(observations);
  const unexplained = observations.filter((o) => o.cls === 'unobserved' && !FIRE_UNOBSERVED[o.factory]).map((o) => o.factory);
  const observedSet = new Set(observations.filter((o) => o.cls !== 'unobserved').map((o) => o.factory));
  const staleExcuses = Object.keys(FIRE_UNOBSERVED).filter((f) => observedSet.has(f));
  return { observations, divergences, unexplained, staleExcuses };
}
