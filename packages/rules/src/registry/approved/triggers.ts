/**
 * APPROVED RULES — domain `triggers`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';
import { AVWIN_HANDOFF } from './shared';

export const TRIGGERS_RULES: GameRule[] = [

  // ── Per-instance temporal windows (Docbot handoff §5.0, owner rulings 2026-08-26) ──────────────────────
  {
    id: 'R-AVWIN-01',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'Late entry starts at zero',
    statement:
      'An Avenge source summoned after earlier friendly deaths does not count those earlier deaths. Its '
      + 'observation window opens when the instance enters play; nothing before that is its progress.',
    domain: 'triggers',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'Late entry starts at zero.' }],
    currentBehaviour:
      'Conforms: `placeSummon` stamps `avengeBaseline = deaths[side]` on every mid-combat summon '
      + '(the #1176 fix, owner report 2026-08-24); start-of-fight bodies keep baseline 0.',
  },
  {
    id: 'R-AVWIN-02',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'The summoning death does not count',
    statement:
      'If a friendly death summons an Avenge source, that same death is outside the new source\'s '
      + 'observation window — the source must not count the death that created it.',
    domain: 'triggers',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'The summoning death does not count.' }],
    currentBehaviour:
      'Conforms — 2026-09-10: both combat death paths count `deaths[side]` BEFORE the Echo fires, so a source the '
      + 'Echo summons stamps a baseline that already includes the death that created it. Was VIOLATED (pinned in '
      + 'temporalWindow KNOWN_VIOLATIONS 2026-08-27 → 2026-09-10): the Deathrattle fired before the increment.',
  },
  {
    id: 'R-AVWIN-06',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'Deaths count individually',
    statement:
      'Avenge evaluates each friendly death separately. A source with Avenge (3) observing six eligible '
      + 'deaths reaches its threshold twice.',
    domain: 'triggers',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'Deaths count individually.' }],
    currentBehaviour: 'Conforms: every factory thresholds `seen % count === 0` per death.',
  },
  {
    id: 'R-AVWIN-09',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'Rise creates a fresh observation window',
    statement:
      'When an Avenge source dies and Rises, the returned instance restarts with zero accrued Avenge '
      + 'progress.',
    domain: 'triggers',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'Rise creates a fresh observation window.' }],
    currentBehaviour:
      'Conforms: the Rise return re-stamps `avengeBaseline = deaths[side]` AFTER its own rise-death was '
      + 'tallied, so neither prior progress nor the rise-death itself counts (owner ruling 2026-08-08).',
  },
  {
    id: 'R-AVWIN-10',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'A source dying in a simultaneous batch observes none of that batch',
    statement:
      'If an Avenge source dies in the same death instance/batch as other friendly minions, it counts '
      + 'none of those simultaneous deaths. Resolution order within the batch must not leak partial '
      + 'progress to the dying source.',
    domain: 'triggers',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'A source dying in a simultaneous batch observes none of that batch.' }],
    currentBehaviour:
      'Conforms — 2026-09-10: the avenge broadcast skips a source at ≤0 Health, so the sequential clash resolution '
      + '(cleave victims → target → attacker) leaks no batch-mate to a mortally wounded source. Was VIOLATED (pinned '
      + 'in temporalWindow KNOWN_VIOLATIONS 2026-08-27 → 2026-09-10): the guard checked only the `dead` flag.',
  },
  {
    id: 'R-SHOUT-01',
    title: '"First Shout each turn" charges are per-phase: shop and combat each carry their own',
    statement:
      'A "first Shout each turn/round triggers twice" charge (Warm Embers family) means the first Shout '
      + 'triggered in EACH shop or combat phase: a Shout doubled via Parting Cry in turn 7\'s combat spends '
      + 'that combat\'s charge, and the first Shout in turn 8\'s shop is a separate charge — both work. '
      + 'Combat use is not a double-dip of one charge; the phases account separately.',
    domain: 'triggers',
    status: 'approved',
    evidence: [{
      kind: 'owner-chat', ref: 'decisions.json q-carry-warm-embers-double-dip (triage round 2, 2026-08-27)',
      quote: 'first shout each turn = the first shout triggered EACH shop or combat phase. so if a shout gets triggered through parting cry in combat on turn 7, then the first shout in turn 8 is a separate charge, so both should work.',
    }],
    currentBehaviour: 'Conforms — shipped in #1262 (2026-08-27, the THIS TURN rule): each phase carries its own first-Shout charge; pinned by the carryOver lane.',
    enforcement: { kind: 'oracle', refs: ['carryOver'], lastVerifiedAt: '2026-08-27' },
  },
  // ── Late-2026-08 / early-2026-09 fixes and rulings (owner reports + Bug Board rounds 1–2), entered 2026-09-09 ──
  {
    id: 'R-TIER-01',
    title: 'Skybound Ascendant reaches Tier 7 on every run — an authored Tier-7 source is not bound by the Tier-7 access gate',
    statement:
      'A card that prints "up to Tier 7" transforms up to Tier 7 on EVERY run. The Shop\'s Tier-7 access gate '
      + '(Summit runs, quest grants) governs what the Shop can OFFER, not what an authored effect can produce: '
      + 'Skybound Ascendant steps its left neighbour up to seven on a plain run, and a neighbour already at '
      + 'seven re-rolls at seven. The printed 7 is always true, so the live text never rewrites it to 6.',
    domain: 'triggers',
    status: 'approved',
    evidence: [{
      kind: 'owner-chat', ref: 'Bug Board cb45dc41 (round 2, 2026-09-09) — overruling the first by-design close',
      quote: 'it should work up to tier 7 always. it is not bound by t6 rules.',
    }],
    cardText: '**End of Turn:** transform the minion to the **left** into a random minion **one Tier higher** (up to **Tier 7**).',
    contentIds: ['d2_ascendant'],
    currentBehaviour:
      'Conforms — #1374: `endOfTurnTransformLeftTierUp` clamps to a constant 7 (was `hasTier7Access ? 7 : 6`), '
      + 'and the `ascendantTierText` live-text rewrite is deleted. Clockwork Assistant\'s Discover still reads the '
      + 'run ceiling — it is a Shop offer, which is exactly what the gate governs.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/runeMinionsAug20.test.ts', 'packages/ui/src/instView.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-RALLY-01',
    title: 'A free Rally is a triggered Rally — the "when a Rally is triggered" watchers fire on it',
    statement:
      'A Rally fired without a swing (Rune of Rallying at Start of Combat, Backbeat, Hunting Bell) is a Rally '
      + 'TRIGGERED, so every watcher whose text says "when a Rally is triggered" / "whenever you trigger a Rally" '
      + '(Hawkus → your left-most Echo, Paragon, Rubies-on-Rally) fires on it exactly as on a swing\'s Rally. No '
      + 'attack happens and no on-attack bus event is emitted — the watchers are reached directly.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'fix-pr', ref: '#1374 (Bug Board 7e04222d, priority 8)', quote: 'hawkus doesnt seem to be triggering dawnclaw after a rally unit triggers its rally effect' },
      { kind: 'card-text', ref: 'b2_hawkus', quote: 'When a **Rally** is triggered, trigger your **left-most Echo**.' },
    ],
    contentIds: ['b2_hawkus', 'rune_rallying'],
    currentBehaviour:
      'Conforms — #1374: `fireFreeRally` in simulate.ts runs `FREE_RALLY_WATCHER_EFFECTS` (onRallyBuffOnePerTribe, '
      + 'onRallyProcLeftmostEcho, onRallyPlayRubiesTribe) over the rallier\'s board after its own on-attack effects.',
    enforcement: { kind: 'scenario', refs: ['packages/core/src/combat/freeRallyWatchers.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-RALLY-02',
    title: '"Rally:" is the card\'s own swing; "whenever you trigger a Rally" is a watcher — sharing a factory does not share the trigger',
    statement:
      'A card that prints "**Rally:**" fires on ITS OWN swing only (Standard Bearer). A card that prints '
      + '"whenever you trigger a Rally" / "when a Rally is triggered" is a WATCHER and fires on every friendly '
      + 'Rally (Paragon). Two cards sharing one effect factory must still honour their own printed wording — '
      + 'the wiring carries a `selfOnly` gate, not a second factory.',
    domain: 'triggers',
    status: 'approved',
    evidence: [{
      kind: 'fix-pr', ref: '#1361 (owner report 2026-09-03)',
      quote: 'standard bearer is acting as a watcher … whenever ANY rally minion attacks, it is buffing other units.',
    }],
    cardText: '**Rally:** give a minion of **each type** **+3/+3**.',
    contentIds: ['n2_standardbearer'],
    currentBehaviour:
      'Conforms — #1361: `onRallyBuffOnePerTribe` takes `selfOnly`, gating `attacker.uid !== arena.self.uid` in both '
      + 'dispatch paths (combat\'s refireRallyWatchers, the shop\'s fireShopRally); Standard Bearer sets it, Paragon does not. '
      + 'The rallyGuard lane classifies every Rally wording against its dispatch.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/docbot/rallyGuard.test.ts', 'packages/sim/src/rallyDispatch.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-REFLECT-01',
    title: 'Reflector: Spells and Rubies share ONE once-per-turn re-cast',
    statement:
      'Reflector\'s "(Once per turn)" is a single allowance shared by both things it reacts to: the first Spell '
      + 'OR Ruby cast on it each turn is re-cast on a random friendly minion, and nothing else cast on it that '
      + 'turn reflects. Two Rubies then a Crest of the Climb reflects only the first Ruby; Crest first on a fresh '
      + 'Reflector reflects the Crest.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'fix-pr', ref: '#1326 (Bug Board 224af0ee, priority 2) — the text was the defect, the engine was right', quote: 'Spells and **Rubies** cast on this also cast on a random friendly minion. (Once per turn)' },
      { kind: 'test', ref: 'packages/sim/src/reflectorSharedAllowance.test.ts (#1374 — the behaviour lane the text PR shipped without)' },
    ],
    cardText: 'Spells and **Rubies** cast on this **also cast** on a random friendly minion. **(Once per turn)**',
    contentIds: ['n2_reflector'],
    currentBehaviour:
      'Conforms: both factories (`spellCastOnThis`, `onRubyPlayed`) guard on `spellsOnThisTurn + rubiesOnThisTurn === 1`, '
      + 'so the allowance is one per turn across both kinds. Pinned in both orders through the real reducer.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/reflectorSharedAllowance.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-HAND-01',
    title: 'Hand-gain watchers fire in combat, when the card arrives — not at carry-back',
    statement:
      '"When a card is added to your hand" (Gangplank) fires the moment a card reaches the hand, in EITHER phase: '
      + 'a card granted mid-combat (`grantToHand`, `grantRubies`) triggers the watcher during that fight, so the '
      + 'payout can affect the fight that earned it. A payout that lands on the shop board after the fight is late, '
      + 'and late is a defect.',
    domain: 'triggers',
    status: 'approved',
    evidence: [{ kind: 'fix-pr', ref: '#1297 (owner report 2026-08-29)', quote: 'GANGPLANK DOESN\'T TRIGGER WHEN CARDS ARE ADDED TO HAND IN COMBAT' }],
    cardText: 'When a card is added to your hand, give a **random** friendly **Dwarf +1/+2**.',
    contentIds: ['dw_gangplank'],
    currentBehaviour:
      'Conforms — #1297: `onGainCard` bodies moved to ARENA_EFFECTS so both phases run one implementation; combat emits '
      + 'from `ctx.grantToHand` / `ctx.grantRubies`, the only two ways a card reaches a hand mid-fight.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/handGainInCombat.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-RISE-03',
    title: 'Rise watchers fire in both phases — a shop Rise pays out, permanently',
    statement:
      '"When a friendly minion Rises" is an event of its own, and it fires wherever the Rise happens: in combat '
      + 'when a body returns, and in the shop when a destroyed body returns (R-RISE-02). The payout of a watcher in '
      + 'the shop is permanent — the stats AND any keyword it grants (the Ward of Revenant) — exactly as any recruit-phase '
      + 'gain is; in combat the board half is a normal combat gain and a hand half is permanent (R-HAND-02). Only a '
      + 'FRIENDLY Rise counts: an enemy body returning wakes nothing on your side.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-09 (set-3 Undead roster review, answers 3–5)', quote: 'friendly only … if minions rise in shop, that would trigger rising tide and that buff would be permanent since it\'s in recruit. this will be a common trigger/effect in set 3 so make sure that logic is wired correctly for minions rising in recruit.' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts (the onRise bus emit after the reborn return); packages/sim/src/recruit.ts fireOnRise (off riseReturn in settlePendingDeath)' },
    ],
    contentIds: ['u3_revenant', 'u3_risingtide'],
    currentBehaviour:
      'Conforms (built with the ruling, 2026-09-09). One trigger, `onRise`, dispatched from the single Rise site of each '
      + 'phase with the risen body in the payload; the watchers are side-guarded in combat and land shop grants through '
      + '`addBuff` / the keyword list. Pinned for Revenant and Rising Tide in both phases, including an enemy Rise doing nothing.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Undead.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-AVWIN-12',
    title: 'Late entry starts at zero on EVERY placement path, and the printed counter shows that same window',
    statement:
      'R-AVWIN-01 binds every way a body reaches the board mid-combat, the Reclaim / resummon insert included, not '
      + 'just the ordinary summon. A fresh body observes only what happens after it arrives. The PRINTED counter '
      + 'must read the same window the simulator uses: a body summoned onto a board that has already lost minions '
      + 'shows 0 of N, never the side\'s running death tally.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Bug Board 8e0b4757 (owner report, 2026-09-22)', quote: 'the bull beast card summoned dunkey which summoned with 2/4 avenge stacks when it should be 0 since it is a fresh body on board' },
      { kind: 'fix-pr', ref: 'PR #1176 (placeSummon stamps avengeBaseline) and PR #1618 (the Reclaim insert + the combat readout) — packages/core/src/combat/simulate.ts, packages/ui/src/useCombatReplay.ts' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-22 (PR #1618 merged). Both halves this rule adds are pinned: the sim side, where the '
      + 'Reclaim (Soren) insert kept the side tally until `flushResummons` stamped the baseline, and the combat '
      + 'readout, which re-derived the counter from the whole fight so a freshly summoned Avenge body printed 2 of '
      + '4. The ordinary summon path stays pinned by the #1176 baseline stamp (R-AVWIN-01 ground).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/core/src/combat/avengeSummonBaseline.test.ts', 'packages/ui/src/avengeSummonReadout.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-REPEAT-01',
    title: 'LUMP versus REPEAT: "for every C" is one instance; "Repeat for every C" is the base plus one tick per C',
    statement:
      'Two wordings, two resolutions. LUMP: "give a minion +x/+y, +a/+b for every C you played" (and "+x/+y for '
      + 'each C") is ONE buff instance whose magnitude is computed from the count: one tick, one beat, one buff '
      + 'signal per target. REPEAT: "give a minion +x/+y. Repeat for every C played this turn" is the BASE buff '
      + 'applied once and then repeated once per C, 1 + count ticks in all, and EVERY tick is its own instance: '
      + 'its own state delta, its own buff-FX event, its own root trigger and beat, so the presentation lands the '
      + 'buffs one after another and the sequence is naturally longer. A random target is re-rolled per tick, '
      + 'deterministically off the run cursor; a fixed target is hit every tick. Watchers that react to a gain '
      + '(when a Dwarf gains Attack) react once per tick. A turn with zero C still pays the base once. Gilding '
      + 'doubles the per-tick grant, never the tick count; an End-of-Turn multiplier (Chronos) repeats the whole '
      + 'tick sequence and counts as one trigger per repeat, never one per tick. The live text of a REPEAT card '
      + 'prints the per-tick grant as written and the number of times it will land right now.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (Mother Moss + Kringle repeat per tick)', quote: 'mother moss and kringle give the individual stat buff and repeat it x times. there are different ways of building these buffs. for example, a lot of our stuff is... give a minion +x/+y, +a/+b for every c you played. that should give a lump sum amount in one instance. however, if something says \'give a minion +x/+y. repeat for ever c played this turn.\' that should give the base buff and repeat it z times for every c played that turn. both kringle and mother moss should function with the repeat logic. their animation beats will also naturally be longer since they\'ll spew out all of the different buffs repeated times instead of 1 per target.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts eotTickCount / endOfTurnTicksOf / forEachTick / eotRepeatTick (the shared tick count, the per-tick End-of-Turn root triggers in applyEndOfTurn, the per-tick projection beats in projectEndOfTurnSteps); packages/ui/src/Recruit.tsx (the legacy beat list per tick, the per-action tagged-wave pacing); packages/ui/src/cardText.ts perCardPlayedText' },
    ],
    contentIds: ['sp3_nurturer', 'dw_foreman', 'squirlscout', 'sp_dragonflame', 'dw3_striker', 'dw_dorrin', 'ce3_shootingstar'],
    currentBehaviour:
      'Conforms for the End-of-Turn pair as of 2026-09-22. Mother Moss already computed 1 + Spirits played picks '
      + 'but both End-of-Turn channels summed them into one beat per target; Kringle was the LUMP form (n x +1/+2 '
      + 'in one lump, itemized only on the legacy FX channel). Both now resolve one tick per root trigger: base + '
      + 'one per count, each its own beat on the Choreographer path and its own projected step on the legacy path, '
      + 'with a fresh pick per Moss tick. Kringle\'s text moved to the repeat form and its magnitude from n to n + 1 '
      + 'ticks (a balance change, stated in the patch note). Squirl Scout and Dragonflame (shop cast) were already '
      + 'per-repeat in the sim and now emit one tagged buff-FX event per repeat, paced apart on the play path. '
      + 'Striker kept its LUMP text until 2026-09-24, when the owner moved it to the REPEAT form too (R-REPEAT-03); Baby Gastrid is one instance. Rocket '
      + 'Power ("give this shop +3/+3. Repeat for every Shop spell you cast this turn") resolves as 1 + spells ticks '
      + 'in the sim (review fix 2026-09-22): one buffThisShopOffers call per tick at the per-tick rate, so the offer '
      + 'ledger counts the ticks (Inspect prints "Rocket Power x3") and the bought body inherits that count; the '
      + 'row total is unchanged and Twinning still hears ONE starformGained for the whole sequence, because the '
      + 'token\'s growth is a per-action boundary diff, not a per-call watcher. Its live text moved to the house '
      + 'style: the per-tick rate as printed plus "(xN)" on the Repeat sentence, in place of the summed total it '
      + 'used to green. OPEN (owner forks, not changed): the shop ROW has no per-offer buff-FX channel '
      + '(captureBuffFx diffs the board), so Rocket Power\'s ticks re-render the row once with the summed stats; a '
      + 'per-offer, per-tick cue on the play path is the remaining presentation half. Mother Moss keeps itself in '
      + 'its random pool. Squirl Scout ("Repeat for every Beast you own") fires once per Beast owned with the Scout '
      + 'itself as one of those Beasts, so the Scout IS the base tick: the "1 + count" arithmetic of this rule is '
      + 'stated for "played this turn" counts, and an "own" count that already includes the source is not one tick '
      + 'short (flip the loop to 1 + Beasts only on an owner ruling). Combat-phase repeats (an archived Oaf, a '
      + 'combat-cast Dragonflame) still collapse into one buffWave moment: separating them needs a per-fire wave tag '
      + 'on the combat buff event (a shared-types boundary), tracked on the roadmap.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/repeatPerTick.test.ts', 'packages/ui/src/choreographer/repeatPerTickBeats.test.ts', 'packages/ui/src/choreo/socEotTendrils.test.ts', 'packages/sim/src/balanceBatch0804.test.ts', 'packages/sim/src/promisedNumbers.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-RUBY-01',
    title: 'A bounced Ruby is the whole Ruby: its keyword rider lands on the hop destination',
    statement:
      'A Ruby that a minion bounces onward (Resonance Idol, a Candle Conduit or Rune of the Conduit extra hop, '
      + 'the Rune of Redirection second landing) resolves on its destination exactly as if it had been cast there: '
      + 'the Ruby\'s current stats (base plus every Ruby improvement in force) AND its keyword rider (a Warding '
      + 'Ruby\'s Ward). The rider keeps its own landing gate on every hop: Ward is granted only to a Kobold, and '
      + 'never twice. A Gilded Idol\'s repeated hop stacks the stats and lands the keyword once. The hop is still '
      + 'stats-and-rider only, never a fresh "Ruby played on" notification: a bounce never re-bounces, so two Idols '
      + 'cannot ping a Ruby between them, and the destination\'s own Ruby watchers do not fire off a hop.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: '9/23 balance list, Bugs (2026-09-23)', quote: 'warding ruby cast on a resonance idol that then hits a kobold should grant it ward.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts fireOnRubyPlayed / grantRubyKeyword (the one landing primitive: the rider rides the onRubyPlayed payload as rubyKeyword); packages/core/src/effects/arena.ts rubyPlayedBounce + EffectArena.gainRubyStats(t, a, h, grantKeyword?) (the bounce body, both phases); packages/core/src/effects/factories.ts combatArena.gainRubyStats (the combat adapter honours the rider through grantShield / the keyword log); packages/sim/src/reducer.ts play-Ruby branch (the direct landing and the Redirection tail both pass def.rubyGrantKeyword)' },
    ],
    contentIds: ['k_resonance', 'warding-ruby', 'k_candleconduit'],
    currentBehaviour:
      'Conforms as of 2026-09-23. Before the fix the Warding Ruby\'s Ward was a trailing grant in the reducer\'s '
      + 'hand-play branch, applied to the direct target only AFTER fireOnRubyPlayed had already bounced the stats on: '
      + 'a Resonance Idol hop, a Candle Conduit hop and the Rune of Redirection\'s right-most landing all carried '
      + '+1/+1 and no Ward. The keyword now rides the landing primitive as part of the Ruby\'s payload, so every '
      + 'hop resolves the whole Ruby. No combat Ruby source casts a keyworded Ruby today (playRubyOn plays the plain '
      + 'Ruby), so the combat adapter\'s rider path is wired for parity and reachable only through a payload that '
      + 'carries one.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/wardingRubyBounce.test.ts', 'packages/sim/src/rubies.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  // ── Balance 9/23, tranche 2 — the minion mechanic rewrites (owner sheet 2026-09-23) ──
  {
    id: 'R-SHOUT-02',
    title: '"Trigger your Shout minions" fires every friendly Shout minion on the board, each a real Shout trigger',
    statement:
      'A "trigger your Shout minions" effect (Moira, End of Turn) re-fires the Shout of EVERY friendly Shout minion '
      + 'on the board, left to right, wherever it stands — position and adjacency play no part. The roster is read '
      + 'before the first fire, so a Shout minion that arrives during the sequence does not fire until the next '
      + 'trigger, and a minion consumed or sold mid-sequence is skipped. Every re-fire goes through the shared Shout '
      + 're-trigger path: it counts as a Shout for quests, takes Spell Drummer\'s repeats, and notifies every '
      + '"after you trigger a Shout" watcher (Embermouth Whelp, Karwind) once per Shout fired. Gilding repeats the '
      + 'whole sequence (every Shout twice), never the size of any one Shout. A minion with no printed Shout is not a '
      + 'Shout minion, and the trigger never fires its own carrier.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Balance batch 9/23 (owner sheet, 2026-09-23) — Moira', quote: 'Moira: "End of Turn: trigger your Shout minions."' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts endOfTurnTriggerShouts (routes every Shout through replayBattlecry, which fires battlecryTriggered per Shout); packages/content/src/cards/set2/beasts.ts b2_moira' },
    ],
    contentIds: ['b2_moira', 'd2_embermouth', 'karwind'],
    currentBehaviour:
      'Conforms as of 2026-09-23. Moira fired the two board NEIGHBOURS only (endOfTurnTriggerAdjacentShouts, '
      + '2026-07-28) until the owner\'s 9/23 rework moved her to the whole board; the neighbour factory is retired. '
      + 'Each fire rides replayBattlecry, so the shout objective, Spell Drummer and the battlecryTriggered watchers '
      + 'see one trigger per Shout; gilded fires the loop twice.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/balance923MinionReworks.test.ts', 'packages/sim/src/finalTranche.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-REPEAT-02',
    title: '"Cast X. Repeat for every N Gold spent this turn" is base + one tick per N Gold, each tick its own End-of-Turn beat, uncapped',
    statement:
      'A minion whose End of Turn reads "cast X. Repeat for every N Gold spent this turn" (Rope Wrangler, Lasso, N = '
      + '10) is the REPEAT form of R-REPEAT-01 applied to a cast: the base cast lands once, then once more per full N '
      + 'Gold spent this turn — 1 + floor(Gold / N) ticks, no cap — and EVERY tick is its own End-of-Turn tick: its '
      + 'own root trigger, its own projected step and its own beat, so the shared tick count (eotTickCount), the '
      + 'projection and the legacy beat list all report the same number. Each tick is a real cast (spell-cast tallies '
      + 'and payoffs see every one, each Lasso steal is recorded on its own). Gilding doubles the per-tick cast '
      + '("cast X twice"), never the tick count; an End-of-Turn multiplier (Chronos) repeats the whole sequence. A '
      + 'single-shot replay (Dusk) with no tick runs every tick in one call. The live text keeps the per-tick cast as '
      + 'printed and folds the tick count into the Repeat sentence, (×N), only once a repeat is owed.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Balance batch 9/23 (owner sheet, 2026-09-23) — Rope Wrangler', quote: 'Rope Wrangler: "End of Turn: Cast Lasso. Repeat for every 10 gold spent this turn."' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (the lump-vs-repeat ruling, R-REPEAT-01)', quote: 'if something says \'give a minion +x/+y. repeat for ever c played this turn.\' that should give the base buff and repeat it z times for every c played that turn.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts castSpell (perGold → forEachTick) + eotTickCount (the castSpell case); packages/ui/src/cardText.ts castSpellPerGoldText; packages/content/src/cards/set1/neutral.ts ropewrangler' },
    ],
    contentIds: ['ropewrangler'],
    currentBehaviour:
      'Conforms as of 2026-09-23. Until then Rope Wrangler cast 1 + floor(Gold / 6) times, capped at 5, all inside '
      + 'ONE End-of-Turn tick (the lump shape); the 9/23 rework moved it to per-10-Gold ticks with no cap, and the '
      + 'maxCasts cap left the shared castSpell factory (no live card used it). Soul Defiler\'s flat "cast Staff of '
      + 'Guel" is the same factory without perGold: one tick.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/balance923MinionReworks.test.ts', 'packages/sim/src/ownerBatchAug18b.test.ts', 'packages/sim/src/balanceBatch0804.test.ts', 'packages/ui/src/balance923LiveText.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-DEALT-01',
    title: '"When a friendly Demon deals damage" fires once per landed damage instance, self included; the self-gain is permanent, the Imp gain is run-wide',
    statement:
      'A "when a friendly Demon deals damage" watcher (Impossible Todd) fires once for EVERY instance of damage a '
      + 'friendly Demon lands in combat — an attack, a counter-hit, its own swings included; a hit absorbed by a Ward '
      + 'dealt nothing and does not count. Each instance pays the printed self-gain to the watcher PERMANENTLY (it '
      + 'carries back to the run card like an Engraved gain) and the printed Imp grant into the run-wide Imp aura '
      + '("this game": every Imp you own now or later). Gilding doubles both grants per instance, never the count. '
      + 'The printed numbers are per instance; the aura\'s running total is a run-scoped tally shown in the Buffs '
      + 'drawer, not on the card.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Balance batch 9/23 (owner sheet, 2026-09-23) — Impossible Todd', quote: 'Impossible Todd: "When a friendly Demon deals damage, gain +1/+2 permanently and give your Imps +2/+1 this game."' },
      { kind: 'code', ref: 'packages/core/src/effects/factories.ts onFriendlyDemonDamageBuffSelf (permaGain carry-back + grantImpBuff); packages/content/src/cards/set2/demons.ts dm_todd' },
    ],
    contentIds: ['dm_todd'],
    currentBehaviour:
      'Conforms as of 2026-09-23 at the new numbers (+1/+2 self, +2/+1 Imps per instance; was +4/+4 and +2/+2 '
      + 'since the 2026-08-18 add). The mechanic is unchanged by the rework: the friendlyDemonDealtDamage trigger, '
      + 'the permaGain carry-back and the playerImpBuffGain channel are the 2026-08-18 wiring.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/balance923MinionReworks.test.ts', 'packages/sim/src/set2NewMinionsAug18.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-REPEAT-03',
    title: 'Striker is the REPEAT form: +1 Attack to its neighbours once, then once more per card played, each its own tick',
    statement:
      'Striker reads "End of Turn: give adjacent minions +1 Attack. Repeat for every card played this turn" and resolves '
      + 'by R-REPEAT-01: the base +1 Attack lands on both neighbours once, then once more for every card played this '
      + 'turn (minions and spells, Striker\'s own play included), 1 + count ticks, each its own state delta, buff-FX wave '
      + 'and beat. A turn with nothing played still pays the base once. The neighbours are read per tick. Gilding '
      + 'doubles the per-tick grant (+2 Attack), never the tick count. "When a Dwarf gains Attack" watchers react once '
      + 'per tick. The live text prints the per-tick grant as written and the number of ticks it will land right now.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner card batch 2026-09-24 (Kobold / Dwarf batch)', quote: 'Striker: "End of Turn: Give adjacent minions +1 attack. Repeat for every card played this turn."' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts endOfTurnBuffAdjacentPerCard (forEachTick + eotRepeatTick) and eotTickCount; packages/ui/src/cardText.ts perCardPlayedText' },
    ],
    cardText: '**End of Turn:** give adjacent minions **+1 Attack**. Repeat for every card played this turn.',
    contentIds: ['dw3_striker'],
    currentBehaviour:
      'Conforms (built with the change, 2026-09-24). Striker was the LUMP form (n waves of +1, no base tick, one beat); '
      + 'it now shares Kringle\'s per-tick path, so the commit, the projection and the beat list agree on 1 + cards '
      + 'played ticks through the one `eotTickCount`.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/repeatPerTick.test.ts', 'packages/sim/src/set3Dwarves.test.ts', 'packages/ui/src/cardText.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  {
    id: 'R-SHOPSPELL-01',
    title: '"When you cast a Shop spell" (Goldilox) hears a Shop-pool spell from any source, in any phase, on the board and in the hand',
    statement:
      'A Shop spell is a spell from the set\'s Shop-spell pool, Dwarven Ales included. A Ruby, a Clue or other Gift, and '
      + 'a reward or token spell are not Shop spells and never count. Goldilox ("When you cast a Shop Spell, gain +3/+2. '
      + 'Gains 2x while in hand.") grows on EVERY such cast, whoever casts it (the player from hand, a rune, an Equipment, '
      + 'a minion, an End-of-Turn cast, a repeat) and in every phase (Shop, End of Turn, combat). On the board it gains '
      + '+3/+2 per cast, in the hand +6/+4; gilding doubles both. Every gain is permanent: a combat gain on the board '
      + 'carries back to the run card, and a combat gain in the hand is a hand buff (R-HAND-02), shown live in the replay. '
      + 'Only the caster\'s own side counts. The live text in the hand prints the doubled gain.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner card batch 2026-09-24 (Kobold / Dwarf batch) — Goldilox', quote: 'shop spells cast from anywhere count, not rubies, clues or generic spells. just a heads up - ales ARE shop spells. they do count. also, this should work in combat, so if spells are cast in combat, goldilox gains stats and those stats are permanent per our rules for hand granted stats in combat.' },
      { kind: 'code', ref: 'packages/core/src/effects/factories.ts castInCombat (the per-repetition identity probe) / withCastingSpell / isShopPoolSpell / shopSpellGrowth / shopSpellCastGrowSelf; packages/core/src/combat/simulate.ts ctx.spellResolved; packages/sim/src/recruit.ts shopSpellCastGrowSelf, noteSpellCast (board + hand watchers; every minion cast reaches it through castSpell since R-MINIONCAST-01)' },
    ],
    cardText: 'When you cast a **Shop spell**, gain **+3/+2**. Gains **2x** while in hand.',
    contentIds: ['dw3_goldilox'],
    currentBehaviour:
      'Conforms (built with the card, 2026-09-24). The shop pays through `noteSpellCast` (board and `alsoInHand` hand '
      + 'watchers); combat pays after each cast repetition resolves, once its spell is known. The End-of-Turn minion '
      + 'casts (Soul Defiler, Rope Wrangler, Arnold) used to need a Goldilox-only hook; they are full `castSpell()` casts '
      + 'now (R-MINIONCAST-01), so the hook is gone and Goldilox hears them like any other cast.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/goldilox.test.ts', 'packages/ui/src/instView.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  {
    id: 'R-RUBY-02',
    title: 'A special Ruby\'s Kobold rider resolves once per cast on its target; hops carry only stats and Ward',
    statement:
      'Golden, Splintered, Ripple and Dark Rubies are ordinary Rubies (their grant is the printed base plus every '
      + 'Ruby improvement in force) with a rider that fires only when the Ruby\'s TARGET is a Kobold (a dual-tribe or '
      + 'All-types body counts). The rider resolves once per cast, after the stats land: Golden gains 2 Gold; '
      + 'Splintered bounces the Ruby once to a random other friendly minion (Resonance Idol\'s hop, never doubled '
      + 'by a Gilded target); Dark consumes the Shop minion with the highest Health (ties: the leftmost; the '
      + 'Starform counts, as it does for every Shop consume) and adds its stats to the target as Rubies, or does '
      + 'nothing more with no Shop minion; Ripple casts the Ruby again on the same target, a real second cast that '
      + 'counts for every Ruby and spell tally but never ripples a third time. A cast multiplier (Rune of '
      + 'Resonance, Prismcaster, Yazzus, a Comet charge) repeats the whole cast, rider included: under Resonance a '
      + 'Ripple lands four times, a Golden pays 4 Gold, a Splintered bounces twice, a Dark eats twice. A HOP (a '
      + 'Splintered bounce, a Resonance Idol or Candle Conduit hop, Rune of Redirection / Distillation) carries '
      + 'the stats and the Ward rider only, never the Gold, bounce, ripple or consume.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Ruby batch handoff, 2026-09-24', quote: 'Give a minion +1/+1. If it is a Kobold, it casts again.' },
      { kind: 'owner-chat', ref: 'Ruby batch handoff, 2026-09-24', quote: 'Give a minion +1/+1. If it is a Kobold, it consumes the highest health minion in the shop as Rubies.' },
      { kind: 'code', ref: 'packages/sim/src/reducer.ts play-Ruby branch (riderKobold / ripple landings); packages/sim/src/recruit.ts applyRubyRiderAction (gold / bounce / devour) + recordRubyRiderFx' },
    ],
    contentIds: ['golden-ruby', 'splintered-ruby', 'ripple-ruby', 'dark-ruby', 'rune_resonance'],
    currentBehaviour:
      'Conforms as of 2026-09-24 (new content). No combat source casts a special Ruby today: they only reach play '
      + 'from the hand in the Shop, so the riders live on the Shop cast path.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/rubyTypes.test.ts', 'packages/sim/src/wardingRubyBounce.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  {
    id: 'R-RUBY-03',
    title: 'Gem Sage pays a random Ruby for every Ruby you get, from any source, and never for its own',
    statement:
      'Whenever a Ruby reaches your hand (a Shop mint, a Discover pick, a Rune, a Ruby won in combat and minted at '
      + 'settle), each Gem Sage on your board gets you a random Ruby (two if Gilded). A Ruby granted by any Gem Sage '
      + 'never triggers a Gem Sage, so two Sages turn one Ruby into three, never a loop.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Ruby batch follow-up, 2026-09-24', quote: 'this grants a random ruby from the pool of 6 whenever a player gets a ruby added to hand. recruit, shop etc all count. doesn\'t trigger off itself or copies of itself.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts onGetRubyRandomRuby (the gemSageMinting latch) via fireOnRubyGained / mintRubies' },
    ],
    contentIds: ['k_gemsage'],
    currentBehaviour: 'Conforms as of 2026-09-24.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/rubyTypes.test.ts'], lastVerifiedAt: '2026-09-24' },
  },
  {
    id: 'R-ECHOTALLY-01',
    title: 'Grim counts every Echo triggered this GAME, its own included, in the Shop and in combat',
    statement:
      'Grim ("Echo: give your Beast Aura +3/+2 for every Echo triggered this game") pays N x (+3/+2), gilded N x (+6/+4), '
      + 'where N is the run-wide Echo tally: every Echo triggered this game, in the Shop, at End of Turn and in every '
      + 'combat so far (each extra trigger from Sylus, Zyff, Elderhorn and the like counts), PLUS this fight\'s Echoes '
      + 'so far. The tally is bumped before an Echo fires, so Grim\'s own Echo is in its N; an extra re-fire of the '
      + 'same death reads the tally at death. The printed text is STATIC by owner ruling (an exception to the live-value '
      + 'default): no live total and no count on any surface.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner Beast/Dragon batch 2026-09-24', quote: 'Grim: "Echo: Give your Beast aura +3/+2 for every Echo triggered this game." Grim\'s own Echo counts, so it gives N x (+3/+2), where N includes itself.' },
      { kind: 'owner-handoff', ref: 'Owner correction 2026-09-24 (Grim text)', quote: 'grim text doesnt need flavor. just Echo: Give your Beast Aura +3/+2 for every Echo triggered this game.' },
      { kind: 'code', ref: 'packages/core/src/effects/arena.ts deathrattleBuffTribeByTally; packages/core/src/combat/simulate.ts deathrattleTally + bumpDeathrattles; packages/sim/src/recruit.ts deathrattlesTriggered (bumped before the shop fire); packages/content/src/cards/set1/beasts.ts grim (static text, owner ruling)' },
    ],
    cardText: '**Echo:** Give your **Beast Aura** **+3/+2** for every **Echo** triggered this game.',
    contentIds: ['grim'],
    currentBehaviour:
      'Conforms (built with the rework, 2026-09-24). Reuses the existing run tally `deathrattlesTriggered` (carried back '
      + 'from combat as `playerDeathrattles`). Known asymmetry kept: an ENEMY Grim reads its snapshot\'s frozen tally.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/beastDragonBatch0924.test.ts', 'packages/core/src/combat/simulate.test.ts', 'packages/ui/src/cardText.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  {
    id: 'R-MINIONCAST-01',
    title: 'A spell a minion casts in the Shop or at End of Turn is a full cast: every rune, watcher and tally hears it',
    statement:
      'When a minion casts a spell outside combat (Rope Wrangler\x27s Lasso, Soul Defiler\x27s Staff of Guel, Arnold\x27s '
      + 'Beefy, any End-of-Turn or Shop caster), the cast behaves exactly like the same spell cast from hand, once per '
      + 'repetition: it counts for every spell tally and quest, updates the first/last-spell memory the copy effects read, '
      + 'wakes every "when you cast a spell" card and rune (board and hand watchers alike), pays the per-cast spell runes '
      + '(Kindling, Scales, Flagship, Summoning, Might) and the cast-specific runes (Rune of Lassoing\x27s +2/+2 on a Lasso, '
      + 'Rune of Spellweaving, and for a spell cast ON a minion Lorekeeping and Spellhide). Each cast is counted exactly '
      + 'once. A targeted spell lands on the caster\x27s chosen friend (Arnold: itself; the others: the highest-Attack other '
      + 'friend); an untargeted spell (Lasso, Staff of Guel) is cast on nobody. Cast multipliers never multiply a '
      + 'minion\x27s cast and a minion\x27s cast never spends one (R-MULT-06: they apply only to spells cast from hand). '
      + 'Because it IS a spell cast, an End-of-Turn Lasso or Staff of Guel can be the turn\x27s first or last spell, so '
      + 'Rune of Recurrence, Mushy, Steward of Spells and Runesnout Archivist can remember one.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ruling 2026-09-24 on the End-of-Turn minion-cast gap (Rune of Lassoing not paying for a Rope Wrangler Lasso)', quote: 'fix that for all' },
      { kind: 'owner-chat', ref: 'Owner confirmation 2026-09-24, with the from-hand multiplier ruling (R-MULT-06), of: An End-of-Turn Lasso or Staff of Guel can now count as the turn\x27s first or last spell. So Rune of Recurrence, Mushy, Steward of Spells and Runesnout Archivist can remember one.', quote: 'this is correct' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts RECRUIT_FACTORIES castSpell / endOfTurnCastSpellOnSelf / endOfTurnCastSpellEscalating (each repetition calls castSpell(); minionCastTarget picks the target), the shop arena castRepeat (spellweaveSnapshot / settleSpellweave around the inline body); fireShopSpellGrowers (the Goldilox-only hook from #1682) removed' },
    ],
    contentIds: ['ropewrangler', 'dm_curator', 'dw_arnold', 'rune_lassoing', 'rune_spellweaving', 'dw3_goldilox'],
    currentBehaviour:
      'Conforms — FIXED 2026-09-24 (fix/minion-casts-full-path). Before, the three End-of-Turn cast factories called '
      + '`applyCastEffects` and bumped `spellsCast` / `spellsThisTurn` by hand, so Rune of Lassoing never paid for a '
      + 'Rope Wrangler Lasso and no `spellCast` watcher or per-cast rune heard these casts (only Goldilox, via a narrow '
      + 'hook). The shop `castRepeat` path already counted through `noteSpellCast` but skipped Spellweaving. Combat '
      + 'minion casts were audited and already funnel through `castInCombat` (ctx.castSpell + spellResolved). Rune of '
      + 'Might\x27s own Might of Aeon cast deliberately stays a bare `applyCastEffects` behind its recursion guard.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/minionCastsFullPath.test.ts', 'packages/sim/src/spellFxEverySource.test.ts', 'packages/sim/src/goldilox.test.ts', 'packages/sim/src/castMultipliersFromHand.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
];
