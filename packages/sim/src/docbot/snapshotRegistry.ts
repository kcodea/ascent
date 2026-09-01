/**
 * DOC BOT — the snapshot-fidelity contract.
 *
 * A per-instance field lives on `BoardCard` (packages/sim/src/state.ts) or `BoardMinion`
 * (packages/core/src/types.ts) and must cross three fidelity boundaries to keep meaning what it says:
 *
 *   'save'    — serialize/deserialize (save-and-continue, `state.ts`): the whole run through JSON.
 *   'capture' — `snapshotBoard`'s `cleanBoard` (packages/sim/src/snapshot.ts): the board captured for
 *               `servedBoards` / the opponent pipeline / the leaderboard. A field this boundary drops is
 *               simply GONE from every board served to another player.
 *   'combat'  — `instantiate` + the `snapshot()` that builds `CombatResult.initial`
 *               (packages/core/src/combat/{minion,simulate}.ts): what the combat replay/UI can see.
 *
 * Each boundary copies fields BY NAME, one at a time — so a newly added field is dropped SILENTLY unless its
 * author remembered every copy site. That is exactly how PR #453's four bugs shipped (copiedEcho /
 * bloodbinderMode / bloodlustRally / allTribes all silently dropped at 'capture'): the served board fought
 * differently than the board it was captured from, and nothing failed.
 *
 * `snapshotFidelity.test.ts` turns the audit into data. It re-derives the authoritative field lists by
 * parsing the two interface declarations from source (TS types are erased at runtime; the source is the
 * truth), pushes a fully-populated exemplar through each real boundary — the actual `serialize`/`deserialize`,
 * the actual `snapshotBoard`, the actual `simulate` — and demands that every field either SURVIVES or has an
 * entry here saying why not. Adding a field therefore forces a decision AT AUTHORING TIME: carry it across
 * the boundary, or write down the reason it stays behind.
 *
 * ── How to update ─────────────────────────────────────────────────────────────────────────────────────────
 * New field           → set it on the exemplar in snapshotFidelity.test.ts (the `Required<...>` type will
 *                       already be failing typecheck), then either thread it through the boundaries that
 *                       drop it or add a SNAPSHOT_EXCUSED entry with a real reason.
 * Field renamed       → if a boundary carries it under another name (chefGranted → chefGrantedLast), record
 *   across a boundary   the mapping in SURVIVES_AS so the diff follows it instead of crying wolf.
 * 'needs-triage'      → an inherited unknown. The test tolerates it but pins the COUNT: resolving one must
 *                       shrink the registry, and a new drop can never hide as triage (it needs a new entry,
 *                       which shows up in review).
 */

/** The three fidelity boundaries the test can drive headlessly. */
export type SnapshotBoundary = 'save' | 'capture' | 'combat';

/** A registered reason a field does NOT survive one boundary. */
export interface SnapshotExcuse {
  /** The boundary that drops the field. */
  boundary: SnapshotBoundary;
  /**
   * Why the drop is correct — or 'needs-triage' when nobody has ruled yet:
   *  'identity'      — a run-instance ref that must NOT travel (uid): carrying it would be the bug.
   *  'recomputed'    — the reader derives it again from surviving data (tribe from CARD_INDEX[cardId]).
   *  'folded'        — the VALUE crosses inside another surviving field (cite it): nothing is lost.
   *  'turn-scoped'   — a per-turn/per-pass counter, reset at rollover or already consumed when the
   *                    boundary runs; the far side correctly starts it fresh.
   *  'shop-only'     — read exclusively by recruit-phase code; the far side of this boundary never
   *                    runs a shop for this board (a served board only fights).
   *  'consumed-live' — combat only: the live `Minion` carries and ACTS on it during the fight; the
   *                    `initial` snapshot is a pre-combat display capture with no reader for it.
   *  'display-only'  — presentation text/labels with a fallback; behaviour never reads it here.
   *  'needs-triage'  — Doc Bot found the drop; no ruling exists. Tolerated, counted, must not grow.
   */
  kind: 'identity' | 'recomputed' | 'folded' | 'turn-scoped' | 'shop-only' | 'consumed-live' | 'display-only' | 'needs-triage';
  /** One line a future reader can VERIFY — cite the reset site, the surviving field, or the live reader. */
  why: string;
}

/** Fields a boundary carries under a DIFFERENT name, per boundary: source field → name on the far side.
 *  The diff follows these before calling a field dropped. */
export const SURVIVES_AS: Readonly<Record<SnapshotBoundary, Readonly<Record<string, string>>>> = {
  save: {},
  capture: {
    chefGranted: 'chefGrantedLast', // Rune of the Chef: a served Chef pays its OWNER's shop tally (cleanBoard)
    allTribes: 'universalTribe', // Anomaly Reactor "All" → the combat-side universal-tribe flag (cleanBoard)
  },
  combat: {},
};

/**
 * The excuse table, keyed `${boundary}:${field}`. Seeded 2026-08-26 from a full walk of every BoardCard /
 * BoardMinion field through the three real boundaries. Every 'needs-triage' below is a drop with NO current
 * ruling — several are exactly the PR #453 shape (a combat-relevant mark carried for some spells but not
 * others). Triage = follow the cited reader and either thread the field through or upgrade the excuse.
 */
export const SNAPSHOT_EXCUSED: Readonly<Record<string, SnapshotExcuse>> = {
  // ── 'capture' (BoardCard → snapshotBoard's cleanBoard): identity / recomputed / folded ──
  'capture:uid': { boundary: 'capture', kind: 'identity', why: 'run-instance ref, deliberately stripped ("drops run-specific instance refs", cleanBoard docblock; lobby/seats.ts strips the same way) — a served board must not alias its source run' },
  'capture:tribe': { boundary: 'capture', kind: 'recomputed', why: 'readers resolve tribe via CARD_INDEX[cardId] (see snapshot.ts topTribe); BoardMinion.tribe is a late display bake for SERVER rows only (types.ts, added 2026-08-20), not part of this capture' },
  'capture:chooseBothLeft': { boundary: 'capture', kind: 'shop-only', why: "Dealer's per-instance 'first Choose One this turn' latch. Choose One is resolved when a HAND card is played in the SHOP, and a CAPTURED board is only ever fought against — it never plays a card, so the latch has nothing to spend. The same reason the run-level charge is excused in the carry-over scan" },
  'capture:tempShield': { boundary: 'capture', kind: 'folded', why: 'Maw of the Pit: the granted DS keyword is already in `keywords` (survives); the flag only tells resolveCombat to strip it after the fight, and a served copy has no settle' },
  'capture:tempReborn': { boundary: 'capture', kind: 'folded', why: 'Lord of the Risen: same contract as tempShield for the R keyword (state.ts docblock)' },
  'capture:tempGrants': { boundary: 'capture', kind: 'folded', why: 'display preview only — faceOmen stamps the REAL grants from pendingCombatKeywords into `keywords` (which survive) and clears these before snapshotBoard runs (state.ts docblock)' },
  'capture:copiedEchoName': { boundary: 'capture', kind: 'display-only', why: 'Gravetwin: the source name for the shop inspect label; the copied effects themselves survive via copiedEcho' },

  // ── 'capture': per-turn / per-pass counters the far side correctly starts fresh ──
  'capture:attackSeen': { boundary: 'capture', kind: 'turn-scoped', why: 'per-EoT-pass witness counter; fireRallies clears it around each shop pass, and combat runs its own per-FIGHT counter from 0 by design (state.ts docblock)' },
  'capture:bredCount': { boundary: 'capture', kind: 'turn-scoped', why: 'Evolving Abomination per-pass doubling counter — same contract as attackSeen (same state.ts docblock)' },
  'capture:spellsOnThisTurn': { boundary: 'capture', kind: 'turn-scoped', why: 'Mirrorwing/Runefire per-turn window, "reset each turn with the other per-turn counters" (state.ts)' },
  'capture:rubiesOnThisTurn': { boundary: 'capture', kind: 'turn-scoped', why: 'per-turn Ruby tally, reset each turn (state.ts docblock beside spellsOnThisTurn)' },
  'capture:rubyRecvTick': { boundary: 'capture', kind: 'turn-scoped', why: 'Ruby Broker per-turn Gold cap, "reset each wave" (state.ts)' },
  'capture:boardSpellCount': { boundary: 'capture', kind: 'turn-scoped', why: 'Spellkeeper Drake per-turn count, reset each turn (recruit.ts "reset each turn ... placement is the natural floor")' },
  'capture:boardFirstSpellId': { boundary: 'capture', kind: 'turn-scoped', why: 'Spellkeeper Drake: the first spell of the CURRENT turn — meaningless on a board served on a later wave' },
  'capture:soldSeen': { boundary: 'capture', kind: 'turn-scoped', why: 'Voicekeeper per-turn sales witness, "reset each faceOmen" (state.ts)' },
  'capture:teachTick': { boundary: 'capture', kind: 'turn-scoped', why: 'Moonhowl Mentor once-per-turn counter, "reset each faceOmen" (state.ts)' },

  // ── 'capture': recruit-economy fields a served board (which only fights) never reads ──
  'capture:sellOverride': { boundary: 'capture', kind: 'shop-only', why: 'Rune of the Bargain Bin sell price, read only by sellValueOf — a served board never sells' },
  'capture:grantedTier': { boundary: 'capture', kind: 'shop-only', why: 'frozen Discover tier read by the discoverOnPlay resolution — a hand/Discover contract, nothing for a served board' },
  'capture:manaBonus': { boundary: 'capture', kind: 'shop-only', why: 'absorbed Money-Bot Gold-per-turn, read by the shop economy only' },
  'capture:attachments': { boundary: 'capture', kind: 'shop-only', why: 'weld count driving Blueprint Cache’s End-of-Turn SHOP pass' },
  'capture:spellAuraBonus': { boundary: 'capture', kind: 'shop-only', why: 'welded spell-power aura read by spellStatBonus at recruit; the run-level spell power a fight needs is captured separately (snapshot.spellPower)' },
  'capture:fodderAuraBonus': { boundary: 'capture', kind: 'shop-only', why: 'Heckbinder weld enriches NEW Fodder at recruit time; stats it already granted are baked into the minions it buffed' },
  'capture:lockedUntilTier': { boundary: 'capture', kind: 'shop-only', why: 'Disco Dan hand-card play gate — a card on the BOARD already cleared it (it gates the `play` action)' },
  'capture:lockedUntilGoldSpent': { boundary: 'capture', kind: 'shop-only', why: 'Brackus hand-card play gate, same contract as lockedUntilTier' },
  'capture:lockedUntilWave': { boundary: 'capture', kind: 'shop-only', why: 'Hourglass Reserve hand-card play gate, same contract as lockedUntilTier' },
  'capture:borrowed': { boundary: 'capture', kind: 'shop-only', why: 'Funeral on Loan hand-card contract (play → Echo → destroyed); never reaches a fighting board' },
  'capture:boughtWave': { boundary: 'capture', kind: 'shop-only', why: 'Hoarder sell-value input (currentWave - boughtWave), read only by sellValueOf' },
  'capture:soldProgress': { boundary: 'capture', kind: 'shop-only', why: 'Runic Archivist sold-minions meter, advanced and paid out by recruit dispatch only' },
  'capture:goldTick': { boundary: 'capture', kind: 'shop-only', why: 'gold-spend meter (Acid/Banksly) for recruit `goldSpent` effects — a served board spends no Gold' },
  'capture:buyTick': { boundary: 'capture', kind: 'shop-only', why: 'cards-bought meter (Korok/Banksly), the buy-count sibling of goldTick' },
  'capture:playTick': { boundary: 'capture', kind: 'shop-only', why: 'cards-played meter (Mountainbond), the played sibling of buyTick' },
  'capture:rubyCastTick': { boundary: 'capture', kind: 'shop-only', why: 'Gemgorge Fiend cast meter — spell/Ruby casts are recruit events a served board never makes (a scouted Fiend shows its printed base text)' },
  'capture:shoutTick': { boundary: 'capture', kind: 'shop-only', why: 'Scalechanter Shout cadence; Shouts fire at recruit (a scouted Scalechanter shows its printed base text)' },
  'capture:orbitTick': { boundary: 'capture', kind: 'shop-only', why: 'Orbit cadence counter; Orbit is a shop mechanic (phaseRegistry: TRIGGER_PHASES.orbit = recruit)' },

  // ── 'capture': NO ruling remains for rallySpreadAtk only. The 2026-08-27 snapshot-carries PR resolved the
  // rest of this block per owner rulings (q-snap-impbank / q-snap-one-combat-marks / q-snap-granted-effects /
  // q-snap-echostripped): resummon, partingCry, closedCasket, grantedEffects, impBank and echoStripped now
  // SURVIVE capture (cleanBoard carries them like bloodlust; opponentBoard + instantiate honor them).
  'capture:rallySpreadAtk': { boundary: 'capture', kind: 'needs-triage', why: 'Sunmane’s run-long shop accrual; NEITHER cleanBoard NOR the reducer’s own player mapping seeds combat with it (combat re-accrues per fight via arena.rallySpreadAtk) — whether the shop value should seed the fight is unruled' },
  // OWNER-RULINGS PR (2026-08-27): classified the day it was born.
  'capture:bredThisTurn': { boundary: 'capture', kind: 'turn-scoped', why: 'Brood Matron per-turn breed cap; the reducer zeroes it at every turn rollover, and a served board starts a fresh turn — dropping it is correct' },

  // ── 'combat' (BoardMinion → CombatResult.initial): the live Minion acts on these; the snapshot is display ──
  'combat:align': { boundary: 'combat', kind: 'consumed-live', why: 'instantiate carries it onto Minion.align for alignment-gated combat effects; the initial snapshot has no alignment reader' },
  'combat:critChance': { boundary: 'combat', kind: 'consumed-live', why: 'Minion.critChance drives per-swing crits (crit events narrate them); no snapshot reader' },
  'combat:rallyMechAtk': { boundary: 'combat', kind: 'consumed-live', why: 'Minion.rallyMechAtk drives the Rally-Mech buff on attack (buff events narrate it); no snapshot reader' },
  'combat:rallySpellWeld': { boundary: 'combat', kind: 'consumed-live', why: 'Minion.rallySpellWeld grants spells on attack; no snapshot reader' },
  'combat:universalTribe': { boundary: 'combat', kind: 'consumed-live', why: 'Minion.universalTribe is ORed into every combat tribe check; no snapshot reader' },
  'combat:bloodbinderMode': { boundary: 'combat', kind: 'consumed-live', why: 'read by the Bloodbinder Rally during the fight; no snapshot reader' },
  'combat:bloodlust': { boundary: 'combat', kind: 'consumed-live', why: 'consumed at Start of Combat as an immune out-of-turn attack (the attack events narrate it)' },
  'combat:bloodlustRally': { boundary: 'combat', kind: 'consumed-live', why: 'the welded Rally fires on the minion’s own attacks (buff events narrate it)' },
  'combat:sourceUid': { boundary: 'combat', kind: 'consumed-live', why: 'the carry-back channel: the live Minion.sourceUid routes per-instance results back to the BoardCard; the snapshot mints its own combat uid' },
  'combat:resummon': { boundary: 'combat', kind: 'consumed-live', why: 'executed at Start of Combat (destroy + resummon events narrate it)' },
  'combat:partingCry': { boundary: 'combat', kind: 'consumed-live', why: 'fires the Shout on death mid-fight; the events narrate it' },
  'combat:closedCasket': { boundary: 'combat', kind: 'consumed-live', why: 'detonates at Start of Combat as a real death; the events narrate it' },
  'combat:copiedEcho': { boundary: 'combat', kind: 'folded', why: 'appended into Minion.effects at instantiate (minion.ts), so it fires as a real Deathrattle — the value crosses, just not under this name' },
  // Snapshot-carries PR (2026-08-27): the three BoardMinion fields that PR added — classified the day they were born.
  'combat:grantedEffects': { boundary: 'combat', kind: 'folded', why: 'appended into Minion.effects at instantiate alongside copiedEcho (minion.ts), so a grafted Deathrattle fires as a real one — the value crosses, not under this name' },
  'combat:echoStripped': { boundary: 'combat', kind: 'folded', why: 'consumed at instantiate: the onDeath effects are filtered OUT of Minion.effects (the same rule combat’s stripEchoes applies), so the mark’s meaning crosses as the absence of the Echo' },
  'combat:impBank': { boundary: 'combat', kind: 'consumed-live', why: 'instantiate clones it onto Minion.impBank, which impInheritOnSummon spends during the fight (buff events narrate the payout); the initial snapshot has no bank reader' },
  'combat:text': { boundary: 'combat', kind: 'display-only', why: 'server-row display bake for STORED final boards (types.ts docblock: "Absent on pool/combat snapshots"); combat recomputes live text from state' },
  'combat:goldenText': { boundary: 'combat', kind: 'display-only', why: 'the golden variant of `text`, same contract' },
  'combat:addedTribes': { boundary: 'combat', kind: 'needs-triage', why: 'folded into the live Minion.tribe2 at instantiate (behaviour holds) but the snapshot carries neither addedTribes nor tribe2, so a spell-added tribe cannot be derived from initial for the combat display' },
  'combat:chefGrantedLast': { boundary: 'combat', kind: 'needs-triage', why: 'MinionSnapshot DECLARES the field (types.ts) but simulate’s snapshot() never populates it — declared-but-dead at this boundary; the live Minion still spends it via Rune of the Chef' },
};

/** The pinned needs-triage backlog (two-sided ratchet — see snapshotFidelity.test.ts).
 *  2026-08-27: 9 → 3 — the snapshot-carries PR resolved capture:{resummon, partingCry, closedCasket,
 *  grantedEffects, impBank, echoStripped} per the q-snap-* owner rulings. */
export const SNAPSHOT_TRIAGE_COUNT = 3;

/**
 * The boundary diff: which of `sourceFields` are MISSING from `output`, following per-boundary renames.
 * A field "survives" when the output object carries it (or its renamed form) as an own property — the
 * boundaries emit surviving truthy fields as present keys, so presence IS the contract being checked.
 */
export function droppedFields(
  sourceFields: readonly string[],
  output: object,
  boundary: SnapshotBoundary,
): string[] {
  const renames = SURVIVES_AS[boundary];
  return sourceFields.filter((f) => {
    const name = renames[f] ?? f;
    return !Object.prototype.hasOwnProperty.call(output, name);
  });
}
