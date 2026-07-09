import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import type { CombatEvent, CombatResult, Keyword, MinionBuff, MinionSnapshot, Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { pixiFx } from './pixiFx';
import { sfx } from './sfx';
import { getChoreoConfig } from './choreo/choreoConfig';
import { attackerOfImpact } from './combatBeats';
import { holdMs } from './choreo/clock';
import { compileMoments } from './choreo/compile';
import { runMomentCues } from './choreo/score';
import { runAttackExchangeCues, runRiseReturn } from './choreo/engine';
import { burstDeathAuras, breakShieldAura, reformReborn } from './choreo/channels/aura';
import { type Float, type DeathFloat, KW_FLOAT } from './choreo/channels/float';
import { combatBuffDelta, type CombatBuffDelta } from './runBuffs';

/** Card display name from its id (for combat-log lines about generated cards). */
const cardName = (id: string): string => CARD_INDEX[id]?.name ?? id;

/** A live combat unit, folded from the initial snapshot + the event log up to a beat. */
export interface UnitFrame {
  uid: string;
  cardId: string;
  name: string;
  tribe: Tribe;
  attack: number;
  health: number;
  keywords: Keyword[];
  divineShield: boolean;
  alive: boolean;
  golden: boolean;
  /** Live summon-buff bonus (Kennelmaster) — climbs via `improve` events mid-fight. */
  summonBonus: number;
  /** Flowing Monk's flat grant bonus (triple combine) — static; feeds the live card text. */
  overflowBonus?: number;
  /** Crypt Drake: ally attacks seen this combat — drives the live "current buff / N to go" text. */
  attackSeen?: number;
  /** Tara: how many stat-grants have accumulated toward ascension this combat. */
  ascendProgress?: number;
  /** Guel: spells cast while on the run board (seeded from the snapshot) — for the live combat text. */
  spellProgress?: number;
  /** Sergeant: accumulated HP bonus on the Deathrattle (grows each time Sergeant gains Attack). */
  hpGrantBonus?: number;
  /** Thundering Abomination (Engraved): permanent stat gains accrued mid-combat. */
  permaGain?: { attack: number; health: number };
  /** Per-source buff breakdown for the right-click inspect panel: the recruit-phase buffs this minion
   *  entered the fight with (carried in the snapshot), plus the combat `buff` events it gains as the log
   *  folds — merged by source name. Mirrors the shop inspect's breakdown. */
  buffs?: MinionBuff[];
  /** Combat-start stats — the values this unit *entered the fight* with (for tokens, its summon stats).
   *  This is the in-combat baseline for the green/red stat colouring: health below it reads red
   *  (damaged), attack below it reads red (debuffed), above reads green (buffed). It is NOT the printed
   *  card base used in the shop — a buffed 5/5 that drops to 5/3 in combat shows red, not green.
   *  Reset on Reborn (a returned minion is "fresh" at its new stats). */
  baseAttack: number;
  baseHealth: number;
}

/** Shared empty array for float-less units, so their `floats` prop keeps a stable reference across
 *  beats and the memoized Unit can skip re-rendering them (a fresh `[]` each render would defeat it). */
const EMPTY_FLOATS: Float[] = [];

const fromSnap = (s: MinionSnapshot): UnitFrame => ({
  uid: s.uid, cardId: s.cardId, name: s.name, tribe: s.tribe, attack: s.attack, health: s.health,
  keywords: [...s.keywords], divineShield: s.keywords.includes('DS'), alive: true,
  golden: s.golden ?? false, summonBonus: s.summonBonus ?? 0, overflowBonus: s.overflowBonus,
  hpGrantBonus: s.hpGrantBonus, // Sergeant: seed the live combat text from the run-board accrual (frame 1)
  ascendProgress: s.ascendProgress, // Tara: seed the ascend tracker from the run-board total, then count up
  spellProgress: s.spellProgress, // Guel: seed his on-board spell tally for the live combat text
  baseAttack: s.attack, baseHealth: s.health, // the stats it entered the fight (or was summoned) with
  // Clone the recruit-buff breakdown so the per-beat fold can merge in combat buffs without mutating the snapshot.
  buffs: s.buffs ? s.buffs.map((b) => ({ ...b })) : undefined,
});

/** Merge one buff into a per-source breakdown (find-and-sum by source, else push) — the combat counterpart
 *  of sim's recruit `bumpBuff`, used to fold `buff` events into a unit's inspect breakdown. */
function recordBuff(buffs: MinionBuff[], source: string, attack: number, health: number): void {
  const e = buffs.find((b) => b.source === source);
  if (e) { e.attack += attack; e.health += health; e.count += 1; }
  else buffs.push({ source, attack, health, count: 1 });
}

/**
 * Fold the event log up to `upto` into the live board state. Deaths from *before*
 * the current beat (index < `beatStart`) are removed outright; a minion dying in
 * the current beat is kept one beat (rendered with its death pop, no grey) so the
 * killing blow reads, then it's gone next beat.
 */
function computeFrame(
  initial: { player: MinionSnapshot[]; enemy: MinionSnapshot[] },
  events: CombatEvent[],
  upto: number,
  beatStart: number,
  names: Map<string, string>,
): { player: UnitFrame[]; enemy: UnitFrame[] } {
  const player = initial.player.map(fromSnap);
  const enemy = initial.enemy.map(fromSnap);
  const find = (uid: string) => player.find((u) => u.uid === uid) ?? enemy.find((u) => u.uid === uid);
  const gone = new Set<string>();
  for (let i = 0; i < Math.min(upto, events.length); i++) {
    const e = events[i];
    if (e.type === 'dmg') {
      const u = find(e.target);
      if (u) u.health = e.remainingHp;
    } else if (e.type === 'shield') {
      const u = find(e.target);
      if (u) { u.divineShield = false; u.keywords = u.keywords.filter((k) => k !== 'DS'); }
    } else if (e.type === 'shieldUp') {
      const u = find(e.target);
      if (u) { u.divineShield = true; if (!u.keywords.includes('DS')) u.keywords.push('DS'); }
    } else if (e.type === 'poison') {
      const u = find(e.target);
      if (u) u.health = 0;
    } else if (e.type === 'reborn') {
      // Returns at base stats: overwrite attack/health/keywords/shield (not a delta) so the buffed
      // body sheds its combat buffs + granted keywords and the blue Reborn aura drops (no more 'R').
      const u = find(e.target);
      if (u) {
        u.health = e.hp;
        u.attack = e.attack;
        u.keywords = [...e.keywords];
        u.divineShield = e.keywords.includes('DS');
        u.baseAttack = e.attack; // a returned minion is "fresh" — its stats become the new baseline
        u.baseHealth = e.hp;
        u.buffs = undefined; // back at base stats — the old buff breakdown no longer applies
        u.alive = true; // a Rise dies FIRST (a `rise` death precedes this) → bring the body back to life…
        gone.delete(e.target); // …and un-remove it if that death landed in an earlier beat
        // Re-slot to the RIGHT of `after` — the token its Deathrattle summoned into its old slot — so the
        // risen body returns to that token's right (mirrors the sim's board move). No `after` → it stays put.
        if (e.after) {
          const arr = player.includes(u) ? player : enemy;
          const from = arr.indexOf(u);
          if (from >= 0) {
            arr.splice(from, 1);
            const anchor = arr.findIndex((x) => x.uid === e.after);
            arr.splice(anchor >= 0 ? anchor + 1 : arr.length, 0, u);
          }
        }
      }
    } else if (e.type === 'reveal') {
      const u = find(e.target);
      if (u) u.keywords = u.keywords.filter((k) => k !== 'ST'); // Stealth lost on attack
    } else if (e.type === 'keyword') {
      // A combat effect granted a keyword (Mumi → Rise, a Ryme-replayed keyword battlecry) — the
      // pill appears on the card from this beat on. DS also raises the shield flag (bubble).
      const u = find(e.target);
      if (u && !u.keywords.includes(e.keyword)) {
        u.keywords = [...u.keywords, e.keyword];
        if (e.keyword === 'DS') u.divineShield = true;
      }
    } else if (e.type === 'venomLost') {
      const u = find(e.target);
      if (u) u.keywords = u.keywords.filter((k) => k !== 'V'); // Venomous spent on its first proc
    } else if (e.type === 'death') {
      const u = find(e.target);
      if (u) { u.alive = false; u.health = 0; }
      if (i < beatStart) gone.add(e.target);
    } else if (e.type === 'buff') {
      const u = find(e.target);
      if (u) {
        u.attack += e.attack;
        u.health += e.health;
        // Itemize the buff under its source for the inspect panel (combat buffs merge alongside recruit ones).
        if (e.attack !== 0 || e.health !== 0) {
          u.buffs ??= [];
          recordBuff(u.buffs, names.get(e.source) ?? 'Combat', e.attack, e.health);
        }
        // Tara: tally stat-grants on minions with ascendAt toward their ascend threshold.
        if ((e.attack !== 0 || e.health !== 0) && CARD_INDEX[u.cardId]?.ascendAt) {
          u.ascendProgress = (u.ascendProgress ?? 0) + 1;
        }
        // Thundering Abomination (EG): accumulate permanent stat gains for live card text.
        if (u.keywords.includes('EG') && (e.attack !== 0 || e.health !== 0)) {
          u.permaGain = {
            attack: (u.permaGain?.attack ?? 0) + e.attack,
            health: (u.permaGain?.health ?? 0) + e.health,
          };
        }
      }
      // Crypt Drake: detect its self-buff (source === target, attack > 0) to count ally-attack triggers.
      // Its onAllyAttackBuffAll buffs all friends including itself — this event is uniquely self-sourced.
      if (e.source === e.target && e.attack > 0) {
        const src = find(e.source);
        if (src?.cardId === 'cryptdrake') src.attackSeen = (src.attackSeen ?? 0) + 1;
      }
    } else if (e.type === 'hpGrant') {
      const u = find(e.target);
      if (u) u.hpGrantBonus = e.amount; // Sergeant: absolute cumulative HP-grant bonus → live card text
    } else if (e.type === 'improve') {
      const u = find(e.target);
      if (u) u.summonBonus += e.amount; // Kennelmaster's aura climbs mid-fight → live card text
    } else if (e.type === 'summon') {
      const arr = e.side === 'player' ? player : enemy;
      arr.splice(Math.min(e.index, arr.length), 0, fromSnap(e.minion));
    }
  }
  return { player: player.filter((u) => !gone.has(u.uid)), enemy: enemy.filter((u) => !gone.has(u.uid)) };
}

// Per-beat lengths (ms) + the global tempo baseline + float/hold lifetimes all live in `choreo/choreoConfig.ts`,
// live-tunable via the DEV Pacing tuner. The beat clock's hold formula lives in the pure `holdMs`
// (`choreo/clock.ts`) — it reads choreoConfig by primary event type each beat, so retuning applies to the
// next beat, and welds the `attack` (wind-up) beat to the lunge connection time (from lungeConfig.ts) so the
// damage float always lands ON contact, independent of pacing.

/** The transient animation class for the unit the active event acts on. */
function animFor(e: CombatEvent | undefined): Record<string, string> {
  if (!e) return {};
  switch (e.type) {
    case 'attack': return { [e.attacker]: 'attacking', [e.defender]: 'aimed' };
    case 'dmg': return { [e.target]: 'struck' };
    case 'shield': return { [e.target]: 'shatter' };
    case 'shieldUp': return { [e.target]: 'shieldgain' };
    case 'poison': return { [e.target]: 'poisoned' };
    case 'venomLost': return { [e.target]: 'venomspent' };
    case 'reborn': return { [e.target]: 'reborn' };
    case 'buff': return { [e.target]: 'buffed' };
    case 'improve': return { [e.target]: 'buffed' };
    case 'keyword': return { [e.target]: 'buffed' }; // a granted keyword pulses like a buff landing
    case 'maxGold': return { [e.target]: 'goldproc' };
    case 'sc': return e.cast ? { [e.source]: 'sccast' } : {}; // only a genuine SoC cast flashes; narration (spell power, etc.) is silent
    case 'death': return { [e.target]: 'dying' };
    case 'summon': return { [e.minion.uid]: 'summoned' };
    case 'rally': return { [e.source]: 'sccast', [e.target]: 'flare' }; // Deathsayer pulses; the Deathrattle minion flares
    default: return {};
  }
}

/** Verbose narration for the Combat Log — every event spelled out, with damage and the
 *  defender's remaining Health, tagged by kind so the overlay can colour each line. */
function narrateLog(e: CombatEvent, names: Map<string, string>): { text: string; kind: string } | null {
  const n = (uid: string): string => names.get(uid) ?? 'a minion';
  switch (e.type) {
    case 'sc': return { text: e.text, kind: 'sc' };
    case 'attack': return { text: `${n(e.attacker)} strikes ${n(e.defender)} for ${e.swing}.`, kind: 'attack' };
    case 'dmg': return { text: `${n(e.target)} takes ${e.amount} damage (${Math.max(0, e.remainingHp)} HP left).`, kind: 'dmg' };
    case 'shield': return { text: `${n(e.target)}'s Ward absorbs the hit.`, kind: 'shield' };
    case 'shieldUp': return { text: `${n(e.target)} gains a Ward.`, kind: 'shield' };
    case 'poison': return { text: `Toxin destroys ${n(e.target)}.`, kind: 'poison' };
    case 'venomLost': return { text: `${n(e.target)}'s Toxin is spent.`, kind: 'poison' };
    case 'reborn': return { text: `${n(e.target)} rises at ${e.hp} HP.`, kind: 'reborn' };
    case 'reveal': return { text: `${n(e.target)} breaks Stealth.`, kind: 'reveal' };
    case 'death': return { text: `${n(e.target)} is destroyed.`, kind: 'death' };
    case 'summon': return { text: `${e.minion.name} (${e.minion.attack}/${e.minion.health}) is summoned.`, kind: 'summon' };
    case 'buff': return { text: `${n(e.target)} grows +${e.attack}/+${e.health}.`, kind: 'buff' };
    case 'improve': return { text: `${n(e.target)}'s summon aura strengthens by +${e.amount}/+${e.amount}.`, kind: 'buff' };
    case 'keyword': return { text: `${n(e.target)} gains ${KW_FLOAT[e.keyword] ?? e.keyword}${e.source ? ` from ${n(e.source)}` : ''}.`, kind: 'buff' };
    case 'maxGold': return { text: `${n(e.target)}'s Avenge raises your max Gold by ${e.amount}.`, kind: 'buff' };
    case 'rally': return { text: `${n(e.source)}'s Rally triggers ${n(e.target)}'s Echo.`, kind: 'sc' };
    case 'toHand': return { text: `${cardName(e.cardId)} is added to your hand.`, kind: 'summon' };
    default: return null;
  }
}

function narrate(e: CombatEvent, names: Map<string, string>): string | null {
  const n = (uid: string) => names.get(uid) ?? 'a minion';
  switch (e.type) {
    case 'sc': return e.text;
    case 'attack': return `${n(e.attacker)} strikes ${n(e.defender)}.`;
    case 'shield': return 'A Ward absorbs the blow!';
    case 'shieldUp': return `${n(e.target)} gains a Ward.`;
    case 'poison': return `Toxin! ${n(e.target)} is destroyed.`;
    case 'reborn': return `${n(e.target)} rises at 1 Health.`;
    case 'death': return `${n(e.target)} falls.`;
    case 'summon': return `${e.minion.name} joins the fray.`;
    case 'buff': return `${n(e.target)} grows +${e.attack}/+${e.health}.`;
    case 'improve': return `${n(e.target)}'s aura strengthens (+${e.amount}/+${e.amount}).`;
    case 'keyword': return `${n(e.target)} gains ${KW_FLOAT[e.keyword] ?? e.keyword}!`;
    case 'maxGold': return `${n(e.target)} raises your max Gold by ${e.amount}!`;
    case 'rally': return `${n(e.source)}'s Rally fires ${n(e.target)}'s Echo!`;
    case 'toHand': return `${cardName(e.cardId)} is added to your hand.`;
    default: return null;
  }
}

/** A per-source proc report for the "Procs" tab — who triggered what, and how many times. Reads
 *  attribution off the events: `rally` (source → the Deathrattle it fired), `toHand`/`summon`/`buff`
 *  carry their producing minion's uid. So you get lines like "Deathsayer → Arcane Weaver's Deathrattle
 *  — 1×" and "Arcane Weaver → Spirit Fire — 2×". Headers are tagged kind `head`. */
function procReport(events: CombatEvent[], names: Map<string, string>): { text: string; kind: string }[] {
  const n = (uid: string): string => names.get(uid) ?? uid;
  const inc = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1);
  let attacks = 0, dmg = 0, deaths = 0, reborn = 0, poison = 0, shieldUp = 0, shieldBreak = 0;
  const rally = new Map<string, number>();
  const generated = new Map<string, number>();
  const summoned = new Map<string, number>();
  const startCombat = new Map<string, number>(); // Start-of-Combat effects that fired (by source)
  const buffs = new Map<string, { n: number; atk: number; hp: number }>();
  const maxGold = new Map<string, { n: number; total: number }>(); // Soulsman's Avenge → max Gold raised
  for (const e of events) {
    if (e.type === 'attack') attacks++;
    else if (e.type === 'dmg') dmg += e.amount;
    else if (e.type === 'death' && !e.rise) deaths++; // a Rise's death isn't a kill — the body returns
    else if (e.type === 'reborn') reborn++;
    else if (e.type === 'poison') poison++;
    else if (e.type === 'shieldUp') shieldUp++;
    else if (e.type === 'shield') shieldBreak++;
    else if (e.type === 'rally') inc(rally, `${n(e.source)} → ${n(e.target)}'s Echo`);
    else if (e.type === 'sc') inc(startCombat, n(e.source));
    else if (e.type === 'toHand') inc(generated, e.source ? `${n(e.source)} → ${cardName(e.cardId)}` : cardName(e.cardId));
    else if (e.type === 'summon') {
      inc(summoned, e.source ? `${n(e.source)} → ${e.minion.name}` : e.minion.name);
    }
    else if (e.type === 'buff') {
      const k = n(e.source);
      const t = buffs.get(k) ?? { n: 0, atk: 0, hp: 0 };
      t.n++; t.atk += e.attack; t.hp += e.health;
      buffs.set(k, t);
    }
    else if (e.type === 'maxGold') {
      const k = n(e.target);
      const t = maxGold.get(k) ?? { n: 0, total: 0 };
      t.n++; t.total += e.amount;
      maxGold.set(k, t);
    }
  }
  const out: { text: string; kind: string }[] = [];
  out.push({ text: `${attacks} attacks · ${dmg} damage dealt · ${deaths} deaths`, kind: 'total' });
  const kw: string[] = [];
  if (shieldUp) kw.push(`${shieldUp} Wards gained`);
  if (shieldBreak) kw.push(`${shieldBreak} Wards broken`);
  if (poison) kw.push(`${poison} Toxin kills`);
  if (reborn) kw.push(`${reborn} rises`);
  if (kw.length) out.push({ text: kw.join(' · '), kind: 'total' });
  if (startCombat.size) { out.push({ text: 'Start of Combat', kind: 'head' }); for (const [k, c] of startCombat) out.push({ text: c > 1 ? `${k} — ${c}×` : k, kind: 'sc' }); }
  if (rally.size) { out.push({ text: 'Rally', kind: 'head' }); for (const [k, c] of rally) out.push({ text: `${k} — ${c}×`, kind: 'rally' }); }
  if (generated.size) { out.push({ text: 'Cards generated', kind: 'head' }); for (const [k, c] of generated) out.push({ text: `${k} — ${c}×`, kind: 'summon' }); }
  if (summoned.size) { out.push({ text: 'Summoned', kind: 'head' }); for (const [k, c] of summoned) out.push({ text: `${k} — ${c}×`, kind: 'summon' }); }
  if (buffs.size) { out.push({ text: 'Buffs', kind: 'head' }); for (const [k, t] of buffs) out.push({ text: `${k} — ${t.n}× (+${t.atk}/+${t.hp})`, kind: 'buff' }); }
  if (maxGold.size) { out.push({ text: 'Max Gold', kind: 'head' }); for (const [k, t] of maxGold) out.push({ text: `${k} — +${t.total} (${t.n}×)`, kind: 'buff' }); }
  return out;
}

export interface CombatReplay {
  frame: { player: UnitFrame[]; enemy: UnitFrame[] };
  anims: Record<string, string>;
  lungeUid: string | null;
  projectiles: { id: number; x: number; y: number; dx: number; dy: number; kind?: string }[];
  floatsFor: (uid: string) => Float[];
  /** Damage floats for units that died this beat — rendered in a board-level overlay (their unit collapses
   *  + is removed), positioned at the captured screen coords so the killing-blow number reads + lingers. */
  deathFloats: DeathFloat[];
  log: string;
  /** The whole fight narrated in detail (every attack, hit, shield, death…) for the
   *  post-combat Combat Log — each line tagged with its kind for styling. */
  fullLog: { text: string; kind: string }[];
  /** Per-source proc report for the "Procs" tab (who triggered what, how many times). */
  procs: { text: string; kind: string }[];
  /** A card a combat effect just granted to the hand, shown flying to the hand (null when none). */
  handGrant: { cardId: string; key: number } | null;
  /** Card ids granted to the hand so far in the replay — appended to the combat hand so it grows live. */
  handGrantsShown: string[];
  /** uids whose effect fired in the current window — their trigger medallion pulses. */
  triggerUids: Set<string>;
  done: boolean;
  result: CombatResult['result'] | null;
  shaking: boolean;
  beatCount: number;
  /** Enemy minions killed so far in the replay (up to the current beat) — drives Cassen's live counter. */
  enemyDeaths: number;
  /** Run-buff gains telegraphed so far this fight (spell power, max Gold) — drives the live Buffs window. */
  combatBuffs: CombatBuffDelta;
  skip: () => void;
}

/**
 * The combat-replay engine, decoupled from layout. Folds `combat`'s event log into a
 * beat-by-beat animation: `active` gates whether the clock is ticking (so the caller
 * can hold on a "shop closing / enemies arriving" intro before the fight starts), and
 * `findEl` resolves a unit's live DOM node for measuring lunges + projectile bolts
 * (so the same engine works in any layout). The UI only *replays* — it never computes
 * the outcome (that's `simulate()`).
 */
export function useCombatReplay(
  combat: CombatResult | null | undefined,
  opts: { active: boolean; findEl: (uid: string) => Element | null; combatSpeed?: number },
): CombatReplay {
  const { active, findEl } = opts;
  // User-controlled replay speed (in-combat slider). 1 = the tuned default; >1 faster, <1 slower. Every
  // beat delay / float lifetime / final hold is divided by it, and each lunge is timeScaled to match.
  const combatSpeed = opts.combatSpeed && opts.combatSpeed > 0 ? opts.combatSpeed : 1;
  const events = useMemo(() => combat?.events ?? [], [combat]);
  // Moments are Beat-shaped (choreographer phase 1): identical grouping to the old buildBeats (equivalence-
  // tested), now carrying stepGroups for later phases. buildBeats itself remains only as the test oracle.
  const beats = useMemo(() => compileMoments(events), [events]);
  const [beatIdx, setBeatIdx] = useState(0);
  const [floats, setFloats] = useState<Float[]>([]);
  const [deathFloats, setDeathFloats] = useState<DeathFloat[]>([]); // damage on dying units (board overlay)
  const [triggers, setTriggers] = useState<Set<string>>(new Set()); // uids whose effect just fired → medallion pulse
  const [shake, setShake] = useState(0);
  const [shaking, setShaking] = useState(false);
  // Which minion is mid-attack — drives the `attacking` glow class. The lunge MOTION is run
  // imperatively by GSAP (see the layout effect below); React never sets a transform on a unit.
  const [attackUid, setAttackUid] = useState<string | null>(null);
  // True only when the choreo engine's GSAP timeline is driving THIS beat's advance (an attack whose elements
  // resolved). The scheduler consults it so it skips the attack transition ONLY when the engine actually took
  // over — if the lunge couldn't run (elements unresolved), the scheduler still advances, so the replay never
  // stalls (restoring the pre-engine unconditional-advance robustness).
  const engineAdvancingRef = useRef(false);
  // Latest combat speed, read by the cue effect's float-expiry timers WITHOUT being a dep (so a mid-beat speed
  // toggle doesn't re-run the effect and re-fire that beat's sfx/shake — sfx is only per-call deduped).
  const combatSpeedRef = useRef(combatSpeed);
  combatSpeedRef.current = combatSpeed;
  const [projectiles, setProjectiles] = useState<{ id: number; x: number; y: number; dx: number; dy: number; kind?: string }[]>([]);
  // A card a combat effect just granted to the hand (Arcane Weaver → Spirit Fire) — shown flying to the
  // hand for the duration of its beat, so the player sees it happen instead of it just appearing later.
  const [handGrant, setHandGrant] = useState<{ cardId: string; key: number } | null>(null);
  // `finished` lags `replayComplete` by a short hold (see below) so the FINAL beat's death animation +
  // damage float fully play before the replay reports `done` (which cleans up the dead + triggers the
  // round-end UI). Without it, the last kill was cut off mid-pop with no number.
  const [finished, setFinished] = useState(false);
  // Tab visibility — pause the beat clock while backgrounded so beats/lunges don't pile up and then fire
  // all at once (a loud burst of sounds) when you tab back in.
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const replayComplete = beatIdx >= beats.length;
  const done = finished;

  // A fresh combat resets the replay to the top (the hook persists across fights).
  useEffect(() => {
    setBeatIdx(0);
    setFloats([]);
    setDeathFloats([]);
    setTriggers(new Set());
    setFinished(false);
    setAttackUid(null);
    gsap.killTweensOf('[data-zone] .unit'); // stop any lunge left mid-flight by the previous fight
    setProjectiles([]);
    setShake(0);
    setHandGrant(null);
  }, [combat]);

  // uid → cardId for the whole fight (initial boards + everything summoned) — used to spot which dying
  // unit has a Deathrattle (so its medallion pulses) and which is a Blaster (purple blast bolts).
  const cardIds = useMemo(() => {
    const m = new Map<string, string>();
    if (!combat) return m;
    for (const u of [...combat.initial.player, ...combat.initial.enemy]) m.set(u.uid, u.cardId);
    for (const e of combat.events) if (e.type === 'summon') m.set(e.minion.uid, e.minion.cardId);
    return m;
  }, [combat]);

  // Track tab visibility (drives the pause-while-hidden gate on the beat clock).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = (): void => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Show the flying "→ hand" card only while its `toHand` beat is current; clear on any other beat.
  useEffect(() => {
    const beat = active ? beats[beatIdx] : undefined;
    if (beat && beat.primary.type === 'toHand') setHandGrant({ cardId: beat.primary.cardId, key: beatIdx });
    else setHandGrant(null);
  }, [active, beatIdx, beats]);

  useEffect(() => {
    if (!shake) return;
    setShaking(true);
    const t = window.setTimeout(() => setShaking(false), 300);
    return () => window.clearTimeout(t);
  }, [shake]);

  // Advance one beat at a time (a beat = an action + all its result events) — only once `active` (the intro
  // animation has finished and the fight is on), and NOT while the tab is hidden (so beats + GSAP lunges
  // don't pile up in the background and fire as one loud burst on tab-in; the clock resumes on return).
  useEffect(() => {
    if (!active || hidden || beatIdx >= beats.length) return;
    // The moment on screen is beats[beatIdx-1]; the clock decides how long it stays before beats[beatIdx].
    // EXCEPT the attack-wind-up → its impact transition: the choreo engine's GSAP timeline (see the layout
    // effect below, `runAttackExchangeCues`) advances that one itself, anchored at the lunge's real
    // `contact` position — the former clock.ts smack-lead weld is retired, not duplicated here.
    const shown = beatIdx > 0 ? beats[beatIdx - 1] : undefined;
    if (shown?.kind === 'attackExchange' && engineAdvancingRef.current) return;
    const d = holdMs(beats[beatIdx]!, shown, combatSpeed);
    const id = window.setTimeout(() => setBeatIdx((k) => k + 1), d);
    return () => window.clearTimeout(id);
  }, [active, hidden, beatIdx, beats, combatSpeed]);

  // Hold on the final beat: once the clock reaches the end, wait FINAL_HOLD_MS before reporting `done` — so
  // the last kill's death collapse + damage float fully play before cleanup + the round-end UI take over.
  useEffect(() => {
    if (!active || !replayComplete) return;
    const t = window.setTimeout(() => setFinished(true), getChoreoConfig().finalHold / combatSpeed);
    return () => window.clearTimeout(t);
  }, [active, replayComplete, combatSpeed]);

  // Trigger-medallion pulse — when a unit's EFFECT fires this beat (Start-of-Combat, Deathrattle/summon,
  // buff/aura, Rally, Avenge, Sergeant's HP-grant, Reborn), its trigger icon releases a ring of energy.
  // We tag the acting unit's uid, then clear it after the pulse animation so it always completes (and a
  // re-trigger restarts it). Held a fixed ~1.15s (glow flash + delayed ring) regardless of combat speed.
  useEffect(() => {
    if (!active || beatIdx === 0) return;
    const beat = beats[beatIdx - 1];
    if (!beat) return;
    const trig = new Set<string>();
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (!e) continue;
      if ((e.type === 'sc' || e.type === 'buff' || e.type === 'rally') && e.source) trig.add(e.source);
      else if ((e.type === 'summon' || e.type === 'toHand') && e.source) trig.add(e.source);
      else if (e.type === 'improve' || e.type === 'maxGold' || e.type === 'hpGrant' || e.type === 'reborn') trig.add(e.target);
      // A death whose unit has a Deathrattle/Avenge effect: its trigger just fired (the cleanest signal —
      // the resulting summon/buff events don't reliably carry the dying unit as their source).
      else if (e.type === 'death') {
        const effs = CARD_INDEX[cardIds.get(e.target) ?? '']?.effects;
        if (effs?.some((f) => f.on === 'onDeath' || f.on === 'avenge')) trig.add(e.target);
      }
    }
    if (trig.size === 0) return;
    sfx.triggerPulse(); // once per beat regardless of how many units pulse (the dedupe is built in too)
    setTriggers((prev) => new Set([...prev, ...trig]));
    const t = window.setTimeout(() => setTriggers((prev) => {
      const next = new Set(prev);
      for (const uid of trig) next.delete(uid);
      return next;
    }), 1150);
    return () => window.clearTimeout(t);
  }, [active, beatIdx, beats, events, cardIds]);

  // Combat cues — sfx (choreo/channels/sfx.ts) + floats (choreo/channels/float.ts) for the moment just
  // resolved, dispatched via the Score's channel registry (choreo/score.ts). The melee smack/impact-FX/
  // recoil for an attack's OWN contact fire separately, from the lunge's GSAP timeline (see the layout
  // effect below) — anchored at the real `contact` position instead of this beat-boundary effect.
  useEffect(() => {
    if (!active || beatIdx === 0) return; // only during the live replay (avoids a phantom cue at shop swap-in)
    const beat = beats[beatIdx - 1];
    if (!beat) return;
    const timers: number[] = [];
    // A unit's live VIEWPORT center+footprint (for the taunt death-burst + the reborn re-form glow, both of
    // which draw on the viewport-fixed FX layer). null when the unit isn't currently measurable.
    const rectOf = (uid: string): { cx: number; cy: number; w: number; h: number } | null => {
      const r = findEl(uid)?.getBoundingClientRect();
      return r ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height } : null;
    };
    // The reborn re-form glow is scheduled +460ms (the auraReform cue offset), but its FOOTPRINT must be the
    // unit's rect at BEAT-START — not at fire time, when the `risepop` CSS has scaled the card up to full size
    // (that would size the glow larger than pre-choreographer-panel behavior). Pre-measure here so the glow's
    // size stays byte-identical while its timing rides the cue offset.
    const rebornRects = new Map<string, { cx: number; cy: number; w: number; h: number } | null>();
    for (let i = beat.start; i < beat.end; i++) { const e = events[i]; if (e?.type === 'reborn') rebornRects.set(e.target, rectOf(e.target)); }
    const stop = runMomentCues(beat, {
      events,
      combatSpeed: combatSpeedRef.current,
      onShake: () => setShake((n) => n + 1),
      findEl,
      attackerUid: attackerOfImpact(beats, beatIdx - 1),
      onFloats: (spawned) => {
        setFloats((arr) => [...arr, ...spawned.filter((s) => !arr.some((x) => x.id === s.id))]);
        const ids = new Set(spawned.map((s) => s.id));
        timers.push(window.setTimeout(() => setFloats((arr) => arr.filter((x) => !ids.has(x.id))), getChoreoConfig().floatMs / combatSpeedRef.current));
      },
      onDeathFloats: (deaths) => {
        setDeathFloats((arr) => [...arr, ...deaths.filter((s) => !arr.some((x) => x.id === s.id))]);
        const ids = new Set(deaths.map((s) => s.id));
        timers.push(window.setTimeout(() => setDeathFloats((arr) => arr.filter((x) => !ids.has(x.id))), getChoreoConfig().deathFloatMs / combatSpeedRef.current));
      },
      onAuraBurst: (uid) => burstDeathAuras(uid, rectOf(uid)),
      onShieldBreak: (uid) => breakShieldAura(uid),
      onReborn: (uid) => reformReborn(rebornRects.get(uid) ?? rectOf(uid)),
    });

    // A Rise DEFENDER (dying but NOT the impact attacker being pulled home) explodes in place immediately —
    // the runner skips rise deaths, and the engine's runRiseReturn only handles the pulled-home ATTACKER.
    const impactAtk = attackerOfImpact(beats, beatIdx - 1);
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (e?.type === 'death' && e.rise && e.target !== impactAtk) burstDeathAuras(e.target, rectOf(e.target));
    }
    // Deathrattle skull-shatter: any dying unit whose card has an onDeath effect (a Deathrattle) — REAL deaths
    // only (a Rise body returns, so no shatter). Fires the painted bone skull that pops + explodes over it.
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (e?.type !== 'death' || e.rise) continue;
      if (!CARD_INDEX[cardIds.get(e.target) ?? '']?.effects?.some((f) => f.on === 'onDeath')) continue;
      const r = rectOf(e.target);
      if (r) pixiFx.deathrattle(r.cx, r.cy, r.w);
    }
    return () => { timers.forEach((id) => window.clearTimeout(id)); stop(); };
  }, [active, beatIdx, beats, events, findEl, cardIds]);

  // Verdict sting when the replay finishes.
  useEffect(() => {
    if (!active || !done || !combat) return;
    if (combat.result === 'win') sfx.win();
    else if (combat.result === 'lose') sfx.lose();
  }, [active, done, combat]);

  // Measure lunge + SC projectiles AFTER the beat commits, so positions reflect the
  // frame on screen (not the previous one). Runs synchronously before paint.
  useLayoutEffect(() => {
    const cur = beatIdx > 0 ? beats[beatIdx - 1] : undefined;
    const center = (uid: string): { x: number; y: number } | null => {
      const el = findEl(uid);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };

    // A RISE ATTACKER dying to retaliation returns HOME first: the engine's `runRiseReturn` kills the slow
    // elastic settle and pulls the unit straight back to its slot (a short hold so the contact reads, then a
    // quick pull), then fires the spirit burst the moment the body lands — so burst + fade + re-form all land
    // in its own slot. A Rise DEFENDER never gets pulled → the cue effect bursts it in place immediately.
    if (cur) {
      const impactAtk = attackerOfImpact(beats, beatIdx - 1);
      if (impactAtk) {
        for (let i = cur.start; i < cur.end; i++) {
          const e = events[i];
          if (e?.type !== 'death' || e.target !== impactAtk || !e.rise) continue;
          const el = findEl(impactAtk) as HTMLElement | null;
          if (el && el.querySelector('.reborncard')) {
            // pull home → burst the spirit in its slot; measure at LANDING (the taunt-burst rect needs the
            // unit's viewport spot after the pull-back, not before).
            runRiseReturn(el, combatSpeed, () => {
              const r = findEl(impactAtk)?.getBoundingClientRect();
              const rect = r ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height } : null;
              burstDeathAuras(impactAtk, rect);
            });
          }
        }
      }
    }

    // On the attack beat the attacker is marked (the glow) and the choreo engine runs the whole cue
    // timeline — wind up, strike toward the defender, the contact-anchored impact FX/sfx/recoil, the
    // beat-clock ADVANCE itself (fired from the SAME GSAP position — see choreo/engine.ts), then an
    // elastic settle.
    if (cur?.primary.type === 'attack') {
      const atkEl = findEl(cur.primary.attacker);
      const a = center(cur.primary.attacker);
      const d = center(cur.primary.defender);
      if (atkEl && a && d) {
        setAttackUid(cur.primary.attacker);
        const tl = runAttackExchangeCues(cur, atkEl, findEl(cur.primary.defender), d.x - a.x, d.y - a.y, {
          combatSpeed, advance: () => setBeatIdx((k) => k + 1),
        });
        engineAdvancingRef.current = tl !== null; // engine owns the advance; if it couldn't build, the scheduler falls back
      } else {
        setAttackUid(null);
        engineAdvancingRef.current = false; // elements unresolved — let the scheduler advance so the replay never stalls
      }
    } else {
      setAttackUid(null);
      engineAdvancingRef.current = false;
    }

    // Projectiles: Start-of-Combat bolts (caster → its next-beat dmg targets), plus Blaster's Deathrattle
    // — purple bolts from the dying Blaster to every minion its AOE hit (the dmg events in the same beat).
    const ps: { id: number; x: number; y: number; dx: number; dy: number; kind?: string }[] = [];
    if (cur?.primary.type === 'sc' && cur.primary.cast) {
      // Only a genuine Start-of-Combat damage cast fires the projectile bolt. A mid-combat narration `sc`
      // (a spell-power gain from Cinderwing-via-Ryme, Gnasher, Bladesmith…) has no `cast` flag, so it no
      // longer flings a phantom "Ember Whelp" bolt at whatever the next beat's damage happens to be.
      const src = center(cur.primary.source);
      const next = beats[beatIdx];
      if (src && next) {
        for (let i = next.start; i < next.end; i++) {
          const ev = events[i];
          if (ev?.type === 'dmg') {
            const t = center(ev.target);
            if (t) ps.push({ id: i, x: src.x, y: src.y, dx: t.x - src.x, dy: t.y - src.y });
          }
        }
      }
    }
    if (cur) {
      for (let i = cur.start; i < cur.end; i++) {
        const ev = events[i];
        if (ev?.type !== 'death' || cardIds.get(ev.target) !== 'blaster') continue;
        const src = center(ev.target); // the dying Blaster is kept this beat, so it's still measurable
        if (!src) continue;
        for (let j = i + 1; j < cur.end; j++) {
          const d = events[j];
          if (d?.type === 'dmg') {
            const t = center(d.target);
            if (t) ps.push({ id: 100000 + j, x: src.x, y: src.y, dx: t.x - src.x, dy: t.y - src.y, kind: 'blast' });
          }
        }
      }
    }
    setProjectiles(ps);
  }, [beatIdx, beats, events, findEl, cardIds]);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    if (!combat) return m;
    for (const u of [...combat.initial.player, ...combat.initial.enemy]) m.set(u.uid, u.name);
    for (const e of combat.events) if (e.type === 'summon') m.set(e.minion.uid, e.minion.name);
    return m;
  }, [combat]);

  // `beatIdx` can briefly outlive its beats: when a new (often shorter) combat's event log replaces the
  // previous one, this render runs with the OLD, larger beatIdx for one render *before* the reset effect
  // (`setBeatIdx(0)` on `[combat]`) fires. Guard the lookup so that stale render shows the final frame
  // instead of reading `.end`/`.start` off an out-of-range (undefined) beat — which threw, and with no
  // error boundary crash-looped the whole app into a hard lock (a long fight followed by a shorter one).
  const processedEnd = beatIdx === 0 ? 0 : (beats[beatIdx - 1]?.end ?? events.length);
  // Mid-replay, keep the current beat's dying minions one beat; once done, drop
  // every dead minion so the result shows only survivors.
  const beatStart = done ? processedEnd : beatIdx === 0 ? 0 : (beats[beatIdx - 1]?.start ?? 0);
  const frame = useMemo(
    () => (combat ? computeFrame(combat.initial, events, processedEnd, beatStart, names) : { player: [], enemy: [] }),
    [combat, events, processedEnd, beatStart, names],
  );

  // Enemy minions killed so far (deaths landed up to the current beat) — Cassen's Collision counter ticks
  // up live in combat off this; settleCombat banks the same total at the end.
  const enemyDeaths = useMemo(() => {
    // Count enemy-side deaths landed up to the current beat — matches simulate's `minion.side === 'enemy'`
    // tally exactly (the death event now carries `side`), so the live count agrees with the settled total.
    let n = 0;
    for (let i = 0; i < processedEnd; i++) {
      const e = events[i];
      if (e?.type === 'death' && e.side === 'enemy' && !e.rise) n++; // a Rise's death isn't a kill (it returns) — matches sim's enemyDeaths
    }
    return n;
  }, [events, processedEnd]);

  // Run-buff gains telegraphed so far this fight (spell power, max Gold) — folded into the live Buffs window so
  // it ticks up in sync with the replay, then settles into the run state at combat end. Same up-to-the-beat
  // accumulation as `enemyDeaths`.
  const combatBuffs = useMemo(() => combatBuffDelta(events, processedEnd), [events, processedEnd]);

  // Combat quest progress landed so far this fight — for the quest panel to LIVE-TICK. Counts the engine's
  // step-tagged `playerQuestEvents` up to the current step (= the last processed event's step), so it agrees
  // exactly with the settled tally. Same shape as `playerQuestTally` (total + by-tribe per kind).
  const questDelta = useMemo(() => {
    const d = {
      attack: 0, summonCombat: 0, slaughter: 0, deathrattle: 0, friendlyDeath: 0, rally: 0, summonImp: 0,
      attackByTribe: {} as Partial<Record<Tribe, number>>,
      summonCombatByTribe: {} as Partial<Record<Tribe, number>>,
      slaughterByTribe: {} as Partial<Record<Tribe, number>>,
    };
    const qe = combat?.playerQuestEvents;
    if (!qe || processedEnd <= 0) return d;
    const curStep = events[processedEnd - 1]?.step ?? Infinity;
    for (const e of qe) {
      if (e.step > curStep) continue; // not replayed yet
      d[e.kind] += 1;
      if (e.kind !== 'deathrattle' && e.kind !== 'friendlyDeath' && e.kind !== 'rally' && e.kind !== 'summonImp') { // these carry no tribe breakdown
        const by = e.kind === 'attack' ? d.attackByTribe : e.kind === 'summonCombat' ? d.summonCombatByTribe : d.slaughterByTribe;
        for (const t of e.tribes) by[t] = (by[t] ?? 0) + 1;
      }
    }
    return d;
  }, [combat, events, processedEnd]);

  // Death reflow is CSS-driven (see `.unit.dying` / `.unit.summoned` in styles.css): the dying unit
  // collapses its own flex slot AS it plays its death pop, so the survivors glide in simultaneously
  // (one smooth phase) instead of waiting a beat and then sliding. CSS flex animates the neighbours for
  // free, and — unlike a JS FLIP — it composes cleanly with the GSAP lunge (layout vs transform).

  const currentBeat = beatIdx > 0 ? beats[beatIdx - 1] : undefined;
  const anims: Record<string, string> = {};
  if (currentBeat) {
    // A Rise ATTACKER dying to retaliation gets `returning` too: the fade DELAYS while GSAP pulls the unit
    // back to its slot (see the pull-back in the layout effect), so it dies in place, not mid-lunge.
    const impactAtk = attackerOfImpact(beats, beatIdx - 1);
    for (let i = currentBeat.start; i < currentBeat.end; i++) {
      for (const [uid, cls] of Object.entries(animFor(events[i]))) {
        // The venom-spent flourish lands first in its beat; don't let the poisoner's same-beat
        // retaliation `struck` clobber it. A death still wins (the demise reads over the flourish).
        if (anims[uid] === 'venomspent' && cls === 'struck') continue;
        // A Rise body dies SOFT — `dying rising` fades it in place (no bounce/spin/slot collapse; see
        // styles.css) since its spirit bursts over it and the body re-forms in that same slot next beat.
        if (cls === 'dying') {
          const u = frame.player.find((x) => x.uid === uid) ?? frame.enemy.find((x) => x.uid === uid);
          if (u?.keywords.includes('R')) {
            anims[uid] = uid === impactAtk ? 'dying rising returning' : 'dying rising';
          } else if (CARD_INDEX[cardIds.get(uid) ?? '']?.effects?.some((f) => f.on === 'onDeath')) {
            anims[uid] = 'dying dr'; // Deathrattle: fade the card IN PLACE (no bounce) under the skull burst
          } else {
            anims[uid] = cls;
          }
          continue;
        }
        anims[uid] = cls;
      }
    }
  }

  // The attacker's motion is run by GSAP in the layout effect above; here we just apply its glow class.
  const lungeUid = attackUid;
  if (lungeUid) {
    const atk = frame.player.find((u) => u.uid === lungeUid) ?? frame.enemy.find((u) => u.uid === lungeUid);
    anims[lungeUid] = atk?.keywords.includes('C') ? 'attacking cleaving' : 'attacking';
  }

  let log = 'The boards take their positions…';
  for (let i = processedEnd - 1; i >= 0; i--) {
    const line = narrate(events[i]!, names);
    if (line) { log = line; break; }
  }
  // Bucket the current floats by uid ONCE (memoized on `floats`), handing each unit a stable array
  // reference — float-less units share EMPTY_FLOATS — so the memoized Unit only re-renders the units
  // whose floats actually changed this beat, instead of all ~14 on every render.
  const floatsByUid = useMemo(() => {
    const m = new Map<string, Float[]>();
    for (const f of floats) {
      const arr = m.get(f.uid);
      if (arr) arr.push(f);
      else m.set(f.uid, [f]);
    }
    return m;
  }, [floats]);
  const floatsFor = (uid: string): Float[] => floatsByUid.get(uid) ?? EMPTY_FLOATS;
  const fullLog = useMemo(
    () => events.map((e) => narrateLog(e, names)).filter((l): l is { text: string; kind: string } => l !== null),
    [events, names],
  );
  const procs = useMemo(() => procReport(events, names), [events, names]);
  // Cards granted to the hand by combat effects (Arcane Weaver → Spirit Fire) that have already
  // "landed" — every `toHand` before the current beat. The recruit hand stays the pre-combat hand until
  // `resolveCombat`, so the combat view appends these so the hand visibly grows as cards arrive.
  const handGrantsShown = useMemo(() => {
    const before = beats[beatIdx]?.start ?? events.length;
    return events.slice(0, before).flatMap((e) => (e.type === 'toHand' ? [e.cardId] : []));
  }, [beatIdx, beats, events]);

  return {
    frame, anims, lungeUid, projectiles, floatsFor, deathFloats, log, fullLog, procs, handGrant, handGrantsShown,
    triggerUids: triggers,
    done, result: combat ? combat.result : null, shaking,
    beatCount: beats.length, enemyDeaths, combatBuffs, questDelta, skip: () => setBeatIdx(beats.length),
  };
}
