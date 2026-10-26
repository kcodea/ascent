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
    currentBehaviour: 'Conforms — shipped in #1262 (2026-08-27, the THIS TURN rule): each phase carries its own first-Shout charge; pinned by the carryOver lane. 2026-10-03 (R-SHOUT-TRIGGER-01): the combat half is now real for the Warm Embers / Opening Act freebie too (questCombatMods.warmEmbersFirst, spent by the first Shout triggered in each fight), and in the Shop a TRIGGERED Shout spends the charge as well as a played one.',
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
      'A Rally fired without a swing (Rallying at Start of Combat, Backbeat, Hunting Bell) is a Rally '
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
      'A Ruby that a minion bounces onward (Resonance Idol, a Candle Conduit or Conduit extra hop, '
      + 'the Redirection second landing) resolves on its destination exactly as if it had been cast there: '
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
      + 'a Resonance Idol hop, a Candle Conduit hop and the Redirection\'s right-most landing all carried '
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
      + 'drawer, not on the card. Since the owner balance of 2026-10-10 Impossible Todd prints only the Imp grant (+2/+1, '
      + 'no self-gain; R-PUMMEL-SUMMON-01); the self-gain half is Leech\'s and Axeman\'s.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Balance batch 9/23 (owner sheet, 2026-09-23) — Impossible Todd', quote: 'Impossible Todd: "When a friendly Demon deals damage, gain +1/+2 permanently and give your Imps +2/+1 this game."' },
      { kind: 'code', ref: 'packages/core/src/effects/factories.ts onFriendlyDemonDamageBuffSelf (permaGain carry-back + grantImpBuff); packages/content/src/cards/set2/demons.ts dm_todd' },
    ],
    contentIds: ['dm_todd', 'dm_leech', 'dm_chosenfiend'],
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
    id: 'R-REPEAT-04',
    title: 'A repeating End-of-Turn effect ACCELERATES: every repeat keeps its own tick, the whole chain is capped',
    statement:
      'An End-of-Turn effect that repeats (a "Repeat for every ..." tick of Kringle, Striker, Mother Moss, Rope Wrangler '
      + 'or Action, and any Chronos or rune repeat of an End-of-Turn trigger) still plays every repeat as its own '
      + 'tick and beat (R-REPEAT-01), but the chain speeds up: the first three ticks play near-normal (100%, 70% and 45% '
      + 'of the beat), the next shrink quickly to a short floor (40 ms since R-REPEAT-05), and once the count outruns the cap several '
      + 'ticks share one visual slot. The whole chain for one source never takes longer than 2.5 seconds, whatever the '
      + 'count, and the last tick holds briefly so the final number reads. The stats update as each tick (or slot) lands '
      + 'and finish on the exact committed values. Only accent ticks (the lead-in, the final tick, and slot starts at least '
      + '130 ms apart) play the trigger sound, the source cue and the buff ribbons, so a long chain never becomes a wall of '
      + 'noise. A plain effect and a Chronos double keep their full pace. Presentation only: no outcome changes.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Claude Code session, 2026-09-27 (Kringle x106 End of Turn)',
        quote: 'kringle and other end of turn effects that REPEAT, need to go extremely fast, this is going to take me minutes to finish.',
      },
      { kind: 'code', ref: 'packages/ui/src/choreographer/repeatPacing.ts repeatChainSchedule; packages/ui/src/choreographer/compileTimeline.ts repeatPaceOf; packages/ui/src/Recruit.tsx QUIET_TICK_SKIPS' },
    ],
    contentIds: ['dw_foreman', 'dw3_striker', 'sp3_nurturer'],
    currentBehaviour:
      'Conforms as of 2026-09-27. Before the fix every tick played a full own beat (120 / 540 / 170 ms), so Kringle at '
      + 'x106 (107 ticks) took about 76 seconds of End of Turn. The paced chain takes about 2.5 seconds (27 visual '
      + 'slots, 9 accents) and still delivers all 107 ticks.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/choreographer/fastRepeatPacing.test.ts', 'packages/ui/src/choreographer/repeatPerTickBeats.test.ts'],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-REPEAT-05',
    title: 'Several repeating End-of-Turn chains share one short budget, and a long chain stays smooth',
    statement:
      'When more than one LONG repeat chain (5 or more ticks: several Kringles, Mother Moss, Striker, Rope Wrangler, a '
      + 'rune repeat) plays in the same End of Turn, the chains split a 4 second budget between them, each between 1 and '
      + '2.5 seconds, so four Kringles finish in about 4 seconds instead of 10. A lone chain keeps the R-REPEAT-04 pace, '
      + 'and a Chronos double keeps its full pace. A shortened chain still opens with its lead-in and rolls its tail over '
      + 'several updates (never one jump to the end). Every tick still lands as its own beat and the numbers finish on the '
      + 'exact committed values. Batched ticks update the numbers at most every 40 ms, sped-up accent ticks draw their '
      + 'ribbons at 40% of the authored particles (the first tick plays as authored), and the live player folds all of '
      + 'one frame\'s deliveries at once, so a long chain costs about the same per frame as a short one. Presentation only: '
      + 'no outcome changes.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Claude Code session, 2026-10-26 (several golden Kringles, Ale-heavy turn)',
        quote: 'kringle was triggering super slowly and causing freezes/massive slow downs',
      },
      { kind: 'owner-chat', ref: 'Kevin, FPS bar 2026-10-09', quote: '>160 fps at all times' },
      { kind: 'code', ref: 'packages/ui/src/choreographer/repeatPacing.ts repeatChainCapMs / repeatTickFxIntensity; compileTimeline.ts longChains; projection.ts applyConsequencesToProjection; livePlayer.ts crossForward' },
    ],
    contentIds: ['dw_foreman', 'dw3_striker', 'sp3_nurturer'],
    currentBehaviour:
      'Conforms as of 2026-10-26. Before, each chain took up to 2.5 s on its own (four golden Kringles after 60 cards: '
      + '10.7 s of End of Turn on the prod bench), and the player copied the delivered-id set once per delivery, so one '
      + 'frame of a 480-card chain spent 74 ms folding. Now 4.7 s, and that frame is under 2 ms.',
    example: 'Four golden Kringles after a 60-card turn: each rolls its Dwarves for about a second, all four done in about 4 seconds.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/choreographer/repeatPhaseBudget.test.ts', 'packages/ui/src/choreographer/fastRepeatPacing.test.ts'],
      lastVerifiedAt: '2026-10-26',
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
      + 'counts for every Ruby and spell tally but never ripples a third time. A cast multiplier ('
      + 'Resonance, Prismcaster, Yazzus, a Comet charge) repeats the whole cast, rider included: under Resonance a '
      + 'Ripple lands four times, a Golden pays 4 Gold, a Splintered bounces twice, a Dark eats twice. A HOP (a '
      + 'Splintered bounce, a Resonance Idol or Candle Conduit hop, Redirection / Distillation) carries '
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
    id: 'R-MINIONCAST-01',
    title: 'A spell a minion casts in the Shop or at End of Turn is a full cast: every rune, watcher and tally hears it',
    statement:
      'When a minion casts a spell outside combat (Rope Wrangler\x27s Lasso, Soul Defiler\x27s Staff of Guel, Arnold\x27s '
      + 'Beefy, any End-of-Turn or Shop caster), the cast behaves exactly like the same spell cast from hand, once per '
      + 'repetition: it counts for every spell tally and quest, updates the first/last-spell memory the copy effects read, '
      + 'wakes every "when you cast a spell" card and rune (board and hand watchers alike), pays the per-cast spell runes '
      + '(Kindling, Scales, Flagship, Summoning, Might) and the cast-specific runes (Lassoing\x27s +2/+2 on a Lasso, '
      + 'Spellweaving, and for a spell cast ON a minion Lorekeeping and Spellhide). Each cast is counted exactly '
      + 'once. A targeted spell lands on the caster\x27s chosen friend (Arnold: itself; the others: the highest-Attack other '
      + 'friend); an untargeted spell (Lasso, Staff of Guel) is cast on nobody. Cast multipliers never multiply a '
      + 'minion\x27s cast and a minion\x27s cast never spends one (R-MULT-06: they apply only to spells cast from hand). '
      + 'Because it IS a spell cast, an End-of-Turn Lasso or Staff of Guel can be the turn\x27s first or last spell, so '
      + 'Recurrence, Mushy, Steward of Spells and Runesnout Archivist can remember one.',
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
      + '`applyCastEffects` and bumped `spellsCast` / `spellsThisTurn` by hand, so Lassoing never paid for a '
      + 'Rope Wrangler Lasso and no `spellCast` watcher or per-cast rune heard these casts (only Goldilox, via a narrow '
      + 'hook). The shop `castRepeat` path already counted through `noteSpellCast` but skipped Spellweaving. Combat '
      + 'minion casts were audited and already funnel through `castInCombat` (ctx.castSpell + spellResolved). '
      + 'Might\x27s own Might of Aeon cast deliberately stays a bare `applyCastEffects` behind its recursion guard.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/minionCastsFullPath.test.ts', 'packages/sim/src/spellFxEverySource.test.ts', 'packages/sim/src/goldilox.test.ts', 'packages/sim/src/castMultipliersFromHand.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  {
    id: 'R-REALTIME-01',
    title: 'Real-time by default: every trigger, grant and printed number resolves and updates the moment it happens',
    statement:
      'Unless a card, rune, hero power, quest or Ancient EXPLICITLY says otherwise (for example "next turn", "at End of '
      + 'Turn", "at Start of Combat", "after combat"), its trigger fires, its grant lands and its printed text updates AT '
      + 'THE MOMENT the condition is met, in whatever phase that is. A payout that a fight earns (a card to hand, a stat '
      + 'gain, a tally step) is granted DURING the fight at the event that earned it (a live toHand / buff the replay '
      + 'shows), never deferred to combat resolution or the next shop. Counters and countdowns tick live. A deferred '
      + 'timing is only correct when the text says so or an owner ruling records it. This complements cross-phase by '
      + 'default (every effect works in the shop, at End of Turn and in combat) and live card text (CLAUDE.md).',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Warden Genesis timing)', quote: 'please bake this rule into the oracle - our triggers, text, etc should all default to real-time updates and grants unless otherwise stated' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Warden Genesis timing)', quote: "warden's genesis grant should be in real-time not at combat resolution." },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts ctx.grantToHand (the one mid-fight hand chokepoint: live toHand + the hand reactors) and the Genesis ancientWardCopy window at the Ward-break site' },
    ],
    currentBehaviour:
      'Conforms for the cases pinned below. FIXED 2026-09-26: Warden x Ancient of Genesis paid its copy at settle; it now '
      + 'pays mid-fight the moment the 3rd Ward breaks. Known deliberate deferrals: Warden x Ancient of Fortune ("gain 2 '
      + 'Gold next turn", said in its text).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/ancientsWarden.test.ts', 'packages/sim/src/handGainInCombat.test.ts'],
      lastVerifiedAt: '2026-09-26',
    },
  },
  {
    id: 'R-REALTIME-02',
    title: 'A Shout fired in combat that touches your hand pays the hand DURING the fight (Tidebud)',
    statement:
      'When a Shout is triggered in combat (a Start-of-Combat Ancient of Time trigger, a Rally re-fire, a Ryme-style '
      + 'replay), any part of it that buffs a card IN HAND resolves at that moment through the combat hand-buff channel: '
      + 'the hand card grows in the replay on that beat (a live handBuff event) and is carried back once. It is never '
      + 'deferred and replayed in the Shop at settle. Tidebud: a random OTHER friendly Spirit on the board gains the stats '
      + 'as a normal combat gain, and a random Spirit in hand gains them permanently (R-HAND-02). The general rule for '
      + 'EVERY combat Shout is R-REALTIME-03.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Auctioneer x Time, Tidebud)', quote: 'ancient of time + auctioneer trigger happened at resolution instead of in real time. please fix this' },
      { kind: 'code', ref: 'packages/core/src/effects/factories.ts FACTORIES.battlecryBuffRandomTribeBoardAndHand (the combat half; replayCombatBattlecry runs it live instead of deferring)' },
    ],
    contentIds: ['sp3_tidebud'],
    currentBehaviour: 'Conforms, FIXED 2026-09-26: Tidebud had no combat half, so a combat Shout deferred to settle and grew the hand card only after the fight.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsAuctioneer.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-REALTIME-03',
    title: 'Every Shout triggered in combat resolves in real time, whatever it does',
    statement:
      'A Shout triggered during combat (Dawnclaw / Ryme, a Rally re-fire, Parting Cry, an Ancient of Time, Shared '
      + 'Scripture, the War Chorus, Ancestral Roar) resolves AT THE MOMENT it fires, whatever it does. Cards it gives reach '
      + 'your hand in the fight (a live toHand) and wake the hand-grant watchers then (Gangplank, Kegheart); a Discover '
      + 'resolves as a random pick of its offer, to hand, live (the combat Discover rule, owner 2026-08-08); hand buffs, '
      + 'stats, Gold, next-turn Gold, free rolls, next-spell charges, the Grimoire charge, Squirl Scout’s snowball and '
      + 'permanent Shop buffs are granted and logged on that beat and carried back to the run ONCE; "this shop" buffs '
      + 'bank on the next Shop (the combat shop-buff spell rule). Nothing is replayed as a Shout at settle. The only '
      + 'exceptions are Shouts whose TARGET only exists in the Shop (SHOP_ONLY_SHOUTS: the Starform, a Shop meal, a Shop '
      + 'slot, Orbit, a Consume, the Choose One latch): they still fire live (their line, every Shout counter and watcher) '
      + 'and only their Shop part is applied when the Shop exists again, exactly once, acting as the Shout’s own run card. '
      + 'A targeted Shout re-fired without an aim (Gravetwin, Auric Runemaster, Graverobber) picks a random legal target, '
      + 'in combat exactly as in the Shop (R-TARGET-06).',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (combat Shouts in real time)', quote: "all shouts should be real time in combat, regardless of what they do/are. theres no point in delaying any of them and they may be important to trigger other combat effects like gangplank's to hand watcher." },
      { kind: 'code', ref: 'packages/core/src/effects/factories.ts replayCombatBattlecry + SHOP_ONLY_SHOUTS + deferShopOnlyShout (the combat halves under "SHOUTS IN REAL TIME")' },
      { kind: 'code', ref: 'packages/sim/src/reducer.ts settleCombat: playerShoutCarry folded in once; playerDeferredBattlecries holds only SHOP_ONLY_SHOUTS' },
    ],
    contentIds: ['n3_defender', 'sp3_revelator', 'sp3_luminary', 'dw_dorrin', 'sp3_gatheringguide', 'nimbus', 'ce3_vendor', 'd2_grimoire', 'squirlscout', 'd2_recaller', 'cryptbroker', 'dm_butcher', 'dm_malphas', 'ce3_accretionwarden', 'ce3_shootingstar', 'gravetwin', 'dw_runemaster', 'graverobber'],
    currentBehaviour: 'Conforms, FIXED 2026-09-26: 17 Shout ids had no combat half and were deferred to settle and replayed in the Shop after the fight (cards to hand arrived only after the fight and never woke Gangplank).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/combatShoutsRealtime.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-RISE-SHOP-01',
    title: 'A Rise in the Shop fires every "when a minion Rises" watcher, once, the moment the body returns',
    statement:
      'When a friendly minion with Rise is destroyed in the Shop by ANY path (an immediate destroy such as Warden x '
      + 'Ancient of Death (Aegis) or Auctioneer x Ancient of Death, or the two-step death of Cage Breaker / a '
      + 'Deathfibrillator / a loan), its Rise return fires the Shop onRise dispatch exactly once, at that moment, '
      + 'with the risen body as the payload (the same payload as the combat `onRise`). Every Rise watcher hears it: Revenant, Rising '
      + 'Tide (board and hand), Endless March, and Lord of the Risen x Ancient of Bonds. A later settle never '
      + 'fires it again. A Rebirth return is not a Rise and stays silent.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (shop Rise watchers gap, found building the Risen Ancients)', quote: 'yes fix this' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts riseReturn (the one shop Rise return) -> fireOnRise (ancientOnShopRise + the board onRise watchers)' },
    ],
    contentIds: ['u3_revenant', 'u3_risingtide'],
    currentBehaviour:
      'Conforms, FIXED 2026-09-26: only the deferred settle (`settlePendingDeath`) called `fireOnRise`, so a minion '
      + 'destroyed by the immediate path (`destroyMinionInShop`) Rose without its watchers hearing it. Bonds had its own '
      + 'hook inside `riseReturn` as a workaround; it now rides `fireOnRise` like every other watcher.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/shopRiseWatchers.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-REALTIME-04',
    title: 'A Shout re-fired in combat gives combat-only board stats, like every other combat buff',
    statement:
      'When a Shout fires during combat (Dawnclaw / Ryme, a Rally re-fire, an Ancient of Time, Parting Cry, Shared '
      + 'Scripture), the stats it gives to minions on the board are COMBAT gains: they last for that fight and are gone '
      + 'when the Shop opens, exactly like every other combat buff. They are never turned into a permanent Shop buff '
      + 'after the fight. This holds for Squirl Scout, Limelight and Baby Gastrid, and for an Auric Runemaster Gild '
      + 'made in combat. Only a card whose text says the gain is permanent keeps it (a hand buff, R-HAND-02; a '
      + '"permanently" text). Run-wide values the Shout improves (Squirl Scout\u2019s snowball) still carry back once '
      + '(R-REALTIME-03).',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (#1755 question 1: "when Squirl Scout, Limelight or Baby Gastrid fire in combat, their board buff now lasts for that fight only")', quote: 'this is correct now, good catch' },
      { kind: 'code', ref: 'packages/core/src/effects/factories.ts battlecryScoutSpread / battlecryBuffRandomTribePlusReveler / battlecryBuffTargetPerGoldSpent / battlecryGildTarget (ctx.buff on the combat body; nothing carried to the run card)' },
    ],
    contentIds: ['squirlscout', 'sp3_luminary', 'dw_dorrin', 'dw_runemaster'],
    currentBehaviour:
      'Conforms since #1755 (2026-09-26). Before it, these three Shouts were deferred to settle and replayed in the '
      + 'Shop, which quietly made their combat buff permanent. The owner confirmed the combat-only reading.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/combatShoutsRealtime.test.ts', 'packages/sim/src/shoutRefireTargets.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-REALTIME-05',
    title: 'Consume is a Shop action: a Consume Shout fired in combat feeds when the Shop opens',
    statement:
      'Consume happens only in the Shop. A Shout whose effect is a Consume (Herald of the Apocalypse: "all of your '
      + 'Demons Consume a Fodder"; Appetite Agent; Cinder Clerk; The Great Attractor) that fires during combat still '
      + 'fires live (its line, every Shout counter and watcher) but consumes nothing mid-fight: its Consume is applied '
      + 'once when the Shop opens, acting as the Shout\u2019s own run card, where the Consume watchers hear it '
      + '(SHOP_ONLY_SHOUTS, R-REALTIME-03). There is no combat Consume and no temporary combat version of the gain.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (#1755 question 3: "Herald of the Apocalypse stays Shop-only")', quote: 'yes, consume does nothing in combat' },
      { kind: 'code', ref: 'packages/core/src/effects/factories.ts SHOP_ONLY_SHOUTS (battlecryAllDemonsConsume, battlecryTargetConsumesShop, battlecryConsumeShopRandom, battlecryStarformConsumeShop)' },
    ],
    contentIds: ['heraldapoc', 'dm_agent'],
    currentBehaviour: 'Conforms (the #1755 SHOP_ONLY_SHOUTS list). No behaviour change: the owner confirmed it.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/combatShoutsRealtime.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-SOT-BEAT-01',
    title: 'Every Start of Turn effect gets its OWN beat in the Shop, played after the return-to-shop wipe has finished',
    statement:
      'ALL Start of Turn effects (hero powers, Ancients, runes, quests, minions, Equipment) get their own presentation '
      + 'beat in the Shop: the source announces itself (a hero source pulses the hero-power button, a rune its node, a '
      + 'minion its body), then each consequence lands on its recipient with its FX, and the shown numbers rise on that '
      + 'beat. The beat plays only once the return-to-shop wipe has fully finished (the curtain at rest on the revealed '
      + 'Shop) plus a short pad, never under the curtain, and a Start of Turn effect never resolves silently. Gameplay '
      + 'is unchanged: the state resolves with the turn setup and the beat is presentation. The Runeforge entrance '
      + 'follows the same wait (R-RUNE-18).',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Lord of the Risen x Ancient of Time report)', quote: 'this also does not have a start of turn beat, please wire one in and make sure we bake time for the screen wipe transition. make a note in the oracle that ALL start of turns get their own beat as well. i believe this is already in there.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-27 (every Start of Turn source)', quote: 'yes they all need their own beat, and the timer/turn shouldnt start until after they complete. also, they need to wait until the transition back from combat finishes.' },
      { kind: 'code', ref: 'packages/sim/src/sotBeat.ts recordSotBeat / pushSotBeat (the read-only per-source diff recorder); packages/sim/src/reducer.ts advanceCombat (every Start of Turn source wrapped, in sim order); packages/sim/src/state.ts SotBeatFx / SotBeatSource / sotBeatFx / sotBeatFxSeq / sotRuneProcs; packages/ui/src/sotBeats.ts (sotBeatsMayPlay, planSotBeats, holdSotBeats, releaseSotCue); packages/ui/src/sotRuneHold.ts (the rune badge hold); packages/ui/src/Recruit.tsx (the holds derived during render, the beat player, the buff wave + equip cues leaving a beat\'s records to it)' },
    ],
    currentBehaviour:
      'Conforms (2026-09-27). Every Start of Turn source runs through the beat recorder in advanceCombat and gets ONE beat, '
      + 'in the order the sim applied them: hero powers (Cassen\'s Commission, Chaos, Gildmaster, Great Presence, Lord of '
      + 'the Risen x Ancient of Time), runes (Treasure Map, Long Shift, Resonance, Astral Draft, Traveling Festival, Merry '
      + 'Christmas, Happy Birthday, the recurring and cadenced grants, the Deep, the tribe drips, Pendant, Grand Workshop, '
      + 'Copies, Summit, First Light, Strange Caravan, Fresh Pages), quests (banked repeats, recurring grants), the Royal '
      + 'Allowance Gift, each surviving Gravetwin, each Equipment source body (the re-equip) and each board minion with a '
      + 'Start of Turn effect. After the wipe rests (+300 ms) each beat pulses its source, then lands its gains one by one, '
      + 'then its new cards (hand, board, shop), with the stats and cards held back until their cue. Modals the turn '
      + 'opens (quest offer, Runeforge, power pick, a Discover a rune raised) open after the last beat.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/sotBeatsAll.test.ts', 'packages/ui/src/sotBeats.test.ts', 'packages/sim/src/risenTimeRealtime.test.ts'],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SOT-TIMER-01',
    title: 'The turn timer starts when the return-from-combat transition finishes; it does not wait for Start of Turn beats',
    statement:
      'The Shop turn timer starts the moment the return-from-combat transition comes to rest (nothing is playable under '
      + 'the curtain). It does NOT wait for the Start of Turn beats: the Shop is playable while they play, so the clock '
      + 'runs as normal. On a Gold Fuse turn (every lobby and Practice, R-TIMER-FUSE-01; the Gauntlet, R-GAUNTLET-04) the '
      + 'countdown starts only once the fuse\'s Gold is spent, and never before the transition comes to rest. Offers raised at Start of Turn (a Discover, a quest offer, the Runeforge) still open after the '
      + 'beats. The timer is the local player presentation clock: the engine is untimed, so the recorded run, replays '
      + 'and the other seats are unchanged.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-27 (PR #1765 review)', quote: 'start of turn stuff looks fine for now - maybe just start the clock as normal though since you can play right away' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-27 (every Start of Turn source)', quote: 'yes they all need their own beat, and the timer/turn shouldnt start until after they complete. also, they need to wait until the transition back from combat finishes.' },
      { kind: 'code', ref: 'packages/ui/src/turnClock.ts turnClockMayTick (transitionPlaying); packages/ui/src/Recruit.tsx (the countdown passes the wipe only; overlaysHeld waits for sotPlaying)' },
    ],
    currentBehaviour: 'Conforms (2026-09-27). Before this the clock started as the combat resolved, under the return curtain.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/sotBeats.test.ts'], lastVerifiedAt: '2026-09-27' },
  },
  {
    id: 'R-TIMER-ESC-01',
    title: 'The Esc / Settings menu pauses the Shop turn timer',
    statement:
      'While the Esc / Settings menu is open during a Shop turn, the turn timer is held: it does not count down, and '
      + 'closing the menu resumes it from the second it showed (the turn is never reset or shortened). This matches '
      + 'the Compendium, Career and bug reporter. The ruling covers only the Shop clock: opening the menu does not '
      + 'pause a combat replay. The timer is the local player presentation clock: the engine is untimed, so the '
      + 'recorded run, replays and the other seats are unchanged.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (Esc menu and the shop timer)', quote: 'yes, lets have it pause the shop timer for now' },
      { kind: 'code', ref: 'packages/ui/src/turnClock.ts turnClockMayTick (settingsOpen); packages/ui/src/Recruit.tsx (the countdown gate reads the store settingsOpen, kept out of overlayOpen; the charge glyph follows the clock, R-TIMER-SYNC-01)' },
    ],
    currentBehaviour: 'Conforms (2026-09-29). Before this the Shop clock kept running behind the Esc menu.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/escMenuPausesTimer.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-SHOUT-TRIGGER-01',
    title: 'A triggered Shout is a Shout: every Shout modifier, charge, tally and watcher applies to it, in the Shop and in combat',
    statement:
      'GENERAL FORM: an ability fired through something other than its native trigger (a hero power, a rune, a spell, '
      + 'an Echo, a Rally) still IS that ability, for every listener: every multiplier, charge, tally, watcher and rune '
      + 'that reads the trigger reads it, in every phase. FOR SHOUTS, every Shout trigger counts the same, however it '
      + 'was fired: a Shout played from hand; the Auctioneer\'s Pulse; every other Shop re-trigger (Echoing Roar, '
      + 'Resonance, Ryme, Last Word, Crucible Choir, Moira); and every Shout triggered in combat (Ryme / '
      + 'Dawnclaw, Thunderous Sovereign, Chorus Drake, Parting Cry, Shared Scripture, Ancestral Roar, '
      + 'War Chorus, Ancient of Time). On each such trigger: '
      + '(1) the STANDING extras add fires: Choir, Hoardwake Ritual, Resonant Path, the legacy Orivax '
      + 'Chorus run mode (+1 each), Blasting Voices (+2), Demand an Encore (+1 this turn), and Orivax on the board '
      + '(+2 each copy, +4 golden; a board aura since 2026-10-07, R-AURA-ONBOARD-02); '
      + '(2) the ONE-PER-TURN CHARGES are spent by the first Shout TRIGGERED, not only the first played: Warm Embers / '
      + 'Opening Act (+1; per phase, so each fight has its own, R-SHOUT-01) and War Drum (+2; an unspent '
      + 'Shop charge carries to the first combat Shout, owner 2026-08-26); '
      + '(3) Drakko\'s repeats apply, and all extras ADD (one fold, never multiplied); '
      + '(4) EVERY fire, extras included, is a Shout for every listener: the Shout objectives and tallies (quests, Bane\'s '
      + 'Presence, Ancestral Roar\'s count, Merchant\'s Chorus, Hoardcalling), the "whenever you trigger a Shout" '
      + 'watchers (Karwind, Bane, Embermouth Whelp, Reconfigured Combinator, the Celestial and Spirit Shout runes, '
      + 'the Ancients), and Twin Sun Oath / Drake Skull, which now hear combat Shouts too (a combat buff '
      + 'for that fight). Each fire is its own counted beat. '
      + 'SPECIFIC CASE: the Auctioneer with Choir. Pulse on a minion fires its Shout twice (three times with '
      + 'Drakko; five with an unspent Warm Embers and War Drum, which the Pulse then spends), and the Choir\'s badge '
      + 'pulses. REASONING: the runes say "your Shouts" and "the first Shout you trigger", and the Pulse says "trigger a '
      + 'Shout"; Drakko already followed the trigger into every re-fire, so everything else skipping them was an '
      + 'inconsistency, not a design. ROOT CAUSE (the class Doc Bot must keep catching): there was no single fold for '
      + '"how many times does this Shout fire, and who hears each fire". Each site counted for itself. Shop: the extras '
      + 'and charges lived only in the played counter, and `replayBattlecry` read only Drakko. Combat: `questCombatMods` '
      + 'carried no Choir, no Warm Embers and no edge buffs; a carried extra fire emitted no `battlecryTriggered`; and '
      + 'three forced Shouts looped the onPlay factories by hand, with no extras, no notify and no counted beat. A code '
      + 'comment ("Applies ONLY to real plays") was then pinned as if it were a ruling (interactionFamilyMatrix P2). '
      + 'FIX: ONE Shop fold, `shoutFireCount`, for every played and triggered Shout; ONE combat chokepoint, '
      + '`replayCombatBattlecry` (reached through `fireShout`), which folds `ctx.shoutCarryExtras` and emits '
      + '`battlecryTriggered` once per fire. Doc Bot lane `shoutTriggerParity` fails any Shop or combat Shout site '
      + 'outside its fold and any stray notify, and drives every modifier through every entry path (48 cells; 40 '
      + 'failed before the fix).',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner report 2026-10-03 (Claude Code session)', quote: 'auctioneer w/ rune of the choir does not work and it should. why doesn\'t it work? please fix it and wire the logical fix and reasoning into the oracle for docbot' },
      { kind: 'owner-chat', ref: 'Owner ruling 2026-10-03 on PR #1933 (the one-per-turn charges)', quote: 'yes pulse or other triggering options should absolutely trigger the extra shouts in this case. make sure all of this logic works across the board. are the other runes fixed now too?' },
      { kind: 'card-text', ref: 'packages/content/src/runes.ts rune_choir, rune_war_drum', quote: 'Your **Shouts** trigger an **additional time**. / The first **Shout** you trigger each turn triggers **2** more times.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts shoutFireCount (playCard, applyBattlecryTarget, triggerBorrowedEcho, replayBattlecry); packages/sim/src/reducer.ts questCombatMods (shoutExtraAlways, warmEmbersFirst, shoutEdgeBuff, shoutEdgeTribeBuff); packages/core/src/effects/factories.ts replayCombatBattlecry + fireShout; packages/core/src/combat/simulate.ts shoutCarryExtras, the Twin Sun / Drake Skull handler, Shared Scripture / Ancestral Roar / War Chorus via fireShout; packages/content/src/questFlags.ts' },
      { kind: 'docbot-scan', ref: 'packages/sim/src/docbot/shoutTriggerParity.ts', quote: 'pre-fix source: 4 deaf Shout sites, battlecryTriggered emitted outside the chokepoint, 40 of 48 modifier x entry-path cells failing' },
    ],
    currentBehaviour:
      'Conforms (fix/auctioneer-rune-choir, 2026-10-03). Before: Pulse with the Choir fired the Shout once; no Shop '
      + 're-trigger heard the Choir, Encore, Warm Embers or the War Drum; no combat Shout heard the Choir, Warm Embers, '
      + 'Twin Sun Oath or the Drake Skull; carried extra fires were invisible to the tally and watchers; and the three '
      + 'rune-fired combat Shouts heard nothing and drew only a narration line. Behaviour change to note: a triggered '
      + 'Shout now SPENDS the Warm Embers / War Drum charge, so a Pulse or an End-of-Turn re-trigger can use it before a '
      + 'Shout played later that turn.',
    cardText: 'Choir: "Your **Shouts** trigger an **additional time**. Get a **Shout** minion." Auctioneer, Pulse: "Trigger a friendly minion\'s **Shout**."',
    example:
      'Auctioneer owns Choir and War Drum. Board: a Whelpling and a Hoard Cleric ("Shout: give your '
      + 'other Dragons +3/+3"). The first Pulse of the turn gives the Whelpling +12/+12 (four fires: 1 + Choir + War Drum 2); '
      + 'a Cleric played afterwards fires twice. In combat, Ryme dying beside a Pennycat with the Choir summons two Strays, '
      + 'and both fires count toward Bane\'s Presence and pulse the Choir\'s badge.',
    contentIds: ['rune_choir', 'rune_blasting_voices', 'q_hoardwake_ritual', 'hq_resonant_path_shout', 'd2_orivax', 'gift_encore', 'q_warm_embers', 'hq_opening_act_shout', 'rune_war_drum', 'q_twin_sun_oath', 'rune_drake_skull', 'rune_shared_scripture', 'rune_ancestral_roar', 'rune_war_chorus', 'sp_partingcry'],
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/auctioneerChoir.test.ts', 'packages/sim/src/docbot/shoutTriggerParity.test.ts', 'packages/sim/src/docbot/interactionFamilyMatrix.test.ts', 'packages/sim/src/runeBatch4T4.test.ts', 'packages/sim/src/runeBatch10.test.ts'],
      lastVerifiedAt: '2026-10-03',
    },
  },
  {
    id: 'R-DEATH-RETURN-01',
    title: 'A death that leads to a Rise or Rebirth is a real death for every death listener',
    statement:
      'When a minion dies and then returns by Rise or Rebirth, that death is a REAL death for every effect that listens '
      + 'for a friendly death, in combat and in the Shop. It is ONE death: each listener hears it once, and the dying '
      + 'body\'s own Echo fires once as before. That covers Beastial Swarm (the payout and its Avenge (2) '
      + 'improvement) and every other death listener: Avenge counts, The Bone Throne, Assembly Line, Blood and '
      + 'Coin, Backbeat, Moonhowl, Ancestral Roar, Ruby Shrapnel, Emberline, '
      + 'Candlelight Toll, Gem Golem and Parting Cry. A returning Beast is also one of the "summoned Beasts" '
      + 'Beastial Swarm buffs: a Rise return takes the swarm through the Beast pool every summon inherits, and a Rebirth '
      + 'return (which kept its body) takes the payouts that landed while it was dead, its own death\'s included. '
      + 'Excluded by their own scope: graveyards (Mossmemory Colossus, Final Gate) record only bodies that '
      + 'stay dead, and the "your last minion died" checks (Pit Without End, Finality, Crucible) '
      + 'do not fire for a body that is about to return. The summon side of the same rule is R-SUMMON-RETURN-01.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ruling 2026-10-06 (Claude Code session, after #1967 found Beastial Swarm deaf to a Rise death)', quote: 'yeah a minion that rises/rebirths should get benefits from beastial swarm' },
      { kind: 'owner-chat', ref: 'Owner ruling 2026-07-27 (Rise death is a real death; reversing 2026-07-02/07-06)', quote: 'minions that die and then rise should still count as a death' },
      { kind: 'card-text', ref: 'packages/content/src/runes.ts rune_beastial_swarm', quote: 'When a friendly **Beast** dies, give all Friendly and summoned Beasts **+2/+2**. **Avenge (2):** Improve this.' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts killOrReborn: deathWatchers / firePartingCry / beastialSwarmImprove / avengePacedDeathWatchers, called from the true, Rise and Rebirth death branches; beastialGiven (the Rebirth return\'s owed swarm); packages/sim/src/recruit.ts fireOnFriendDeath(returnsWhole) from destroyMinionInShop and settlePendingDeath' },
      { kind: 'docbot-scan', ref: 'packages/sim/src/docbot/combatModScan.ts deathReturnRider', quote: 'pre-fix engine: runeBeastialSwarm, runeGemGolem and assemblyLineStep deaf to Rise + Rebirth' },
    ],
    currentBehaviour:
      'Conforms as of 2026-10-06. Before: the combat death listeners that live inline in `killOrReborn` sat on its '
      + 'TRUE-death branch only, so a Rise or Rebirth death reached the bus `onDeath` broadcast, the tallies and Avenge '
      + 'but skipped Beastial Swarm (payout and improvement), the Avenge-paced side watchers (a Rise death that landed '
      + 'on the Nth death paid nothing), and the rune-granted Echoes. The Shop half already heard a returning death; '
      + 'only its Rebirth return missed its own death\'s Beastial Swarm buff.',
    example:
      'You own Beastial Swarm. A 1-Health Pennycat with Rise dies in combat beside another Pennycat: the other '
      + 'gains +2/+2 at once, and the Pennycat returns as its printed body plus +2/+2. With Rebirth it returns with its '
      + 'whole body and then gains +2/+2. Two Rise deaths in one fight improve the rune to +4/+4.',
    contentIds: ['rune_beastial_swarm', 'q_the_bone_throne', 'q_assembly_line', 'rune_blood_and_coin', 'rune_backbeat', 'rune_moonhowl', 'rune_ancestral_roar', 'rune_ruby_shrapnel', 'rune_emberline', 'q_candlelight_toll', 'rune_gem_golem', 'sp_partingcry'],
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/riseDeathWatchers1006.test.ts', 'packages/sim/src/docbot/combatModLane.test.ts'],
      lastVerifiedAt: '2026-10-06',
    },
  },
  {
    id: 'R-RALLY-FORCED-01',
    title: 'A Rally fired without an attack is boosted by every Rally doubler, in the Shop and in combat',
    statement:
      'A forced Rally, fired by something other than the rallier\'s own attack (Rallying, Backbeat, the Hunting '
      + 'Bell, a "trigger a Rally" effect in combat; Lasting Cadence and every other Shop Rally), is boosted by '
      + 'the Rally doublers exactly as a swing\'s Rally is. In combat: the card multipliers on the side\'s board (Uron, '
      + 'Elderhorn for a Beast) and the additive doublers (Law of Teeth, War Council, Rallying Offensive, '
      + 'Adventuring, Spark Permit\'s first Rally of the fight). In the Shop: Uron, Elderhorn for a Beast, Law of Teeth, '
      + 'War Council and Adventuring; Rallying Offensive ("next combat") and Spark Permit ("each combat") stay '
      + 'in combat, as their own text says. Each extra fire re-runs the rallier\'s own Rally effects and the '
      + '"whenever you trigger a Rally" watchers, is its own Rally line, and counts as a Rally for every tally. A welded '
      + 'Rally (Better Bot, Perfect Core) pays once, as it does on a swing.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ruling 2026-10-07 on PR #1970, asked "Should Elderhorn boost Rallies that fire without an attack? Saying yes would change Uron too"', quote: 'yes' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts fireFreeRally (rallyCardExtras + playerRallyExtras); packages/sim/src/recruit.ts fireShopRally + shopRallyExtras' },
    ],
    contentIds: ['b2_elderhorn', 'uron', 'rune_rallying', 'rune_lasting_cadence', 'rune_adventuring', 'rune_backbeat', 'rune_hunting_bell'],
    currentBehaviour:
      'Conforms as of 2026-10-07. Before, no Rally multiplier applied to a forced Rally in either phase: Uron, Law of Teeth, '
      + 'Adventuring and the Elderhorn modes boosted only a Rally fired by an attack.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/elderhornOrivaxAuras.test.ts'], lastVerifiedAt: '2026-10-07' },
  },
  {
    id: 'R-TIMER-SYNC-01',
    title: 'The end-of-turn charge (glyph, motes, pulse and its build sound) stops whenever the Shop clock stops',
    statement:
      'The end-of-turn charge effect is a readout of the Shop turn timer and never runs on a clock of its own. Whenever '
      + 'the timer is held mid-turn, for ANY reason (a Discover or other decision, an offer, an aim, the Esc menu, an '
      + 'overlay, the Good Luck intro, the combat wipe, a Gold Fuse turn before its Gold is spent, or any hold added '
      + 'later), the glyph fill, its pulse, its motes and the charge-build sound all stop with it, and on resume they '
      + 'continue from exactly where the timer is. A hold keeps the part of the second already elapsed, so pausing '
      + 'neither costs nor refunds time. The build sound always plays from the point that matches the timer (also when '
      + 'the effect lights mid-window, such as after Save & Continue), so its peak and the explosion land on 0:00. At '
      + '0:00 the timer is finished, not held: the completion flash and the tail of the sound play out.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-07 (charge glyph out of sync after a pause)', quote: 'we just need to make sure it stops when the game is stopped in any way' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-07 (charge glyph out of sync after a pause)', quote: 'i want the audio to stay the same and synced to the same timing at the end of each round' },
      { kind: 'code', ref: 'packages/ui/src/turnClock.ts (running / hold / startSecond / secondProgress / chargeElapsed); packages/ui/src/Recruit.tsx (countdown holds on teardown; ChargeGlyph reads useTurnClockRunning); packages/ui/src/sfx.ts (turnCharge offset)' },
    ],
    currentBehaviour: 'Conforms (2026-10-07). Before, the 21 s build clip fired once on light and played through every pause, '
      + 'the glyph paused off a private copy of the gate that missed several holds, the motes never paused, and each pause '
      + 'restarted the current second of the clock.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/chargeGlyphHold.test.ts'], lastVerifiedAt: '2026-10-07' },
  },
  {
    id: 'R-VERSUS-TIMER-FX-01',
    title: 'A Versus clock plays the lobby clock\'s sounds and the 20 s charge glyph, off the server deadline, frozen by a pause',
    statement:
      'The Versus Shop clock behaves exactly like a lobby Shop clock, driven by the match\'s server deadline on the synced '
      + 'clock: the warm-up on 10 to 6, the FIVE to ONE ticks, the explosion at 0:00 and the announcer\'s clock reading fire '
      + 'at the same seconds, and the 20 s charge glyph lights, fills and plays its build sound as the deadline runs down. '
      + 'Hero Select\'s Versus clock plays the same ticks (no explosion: there is no Shop to lock; no glyph: the board is '
      + 'covered). Each cue fires once per second it marks: a first sight of a running clock (a mount, a reconnect, a '
      + 'spectator switching seats) plays nothing for the second it lands on, and a long jump or a clock pushed back up '
      + 'plays nothing. During the 30 s disconnect pause and the returning player\'s 3-2-1 (paused_at is set through both) '
      + 'the clock, the cues, the glyph and its build sound are frozen; the resume continues from the frozen second without '
      + 'replaying it. A spectator mirrors the watched player\'s clock through the same path, so it hears and sees the same. '
      + 'QUIET AFTER END TURN (owner 2026-10-16): once the player on screen has ended the turn early and waits, the clock '
      + 'face keeps counting but its sounds stop and the glyph fades, as after a lobby End Turn; the other player, still '
      + 'shopping, hears it as normal, and a spectator follows the seat it watches. A lock AT 0:00 is not early: the 0:00 '
      + 'cues and the glyph completion play out.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-16 (Versus timer silent)', quote: 'the versus timer does not play sound effects at all and the glyph animation doesnt play either, the 20s glyph' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-16 (follow-up ruling, relayed by the coordinator)', quote: 'Clock goes quiet after End Turn: yes.' },
      { kind: 'code', ref: 'packages/ui/src/versus/versusClockFx.ts (versusClockCues / driveVersusClock); packages/ui/src/turnClock.ts (follow); packages/ui/src/versus/VersusHud.tsx useVersusRecruit; packages/ui/src/versus/VersusHeroTimer.tsx' },
    ],
    currentBehaviour: 'Conforms (2026-10-16). Before, Versus skipped the local countdown loop that plays the cues and only wrote '
      + 'the displayed seconds, so every clock sound was silent and the clock read as held, freezing the charge glyph.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/versus/versusClockFx.test.ts', 'packages/ui/src/versus/versusClockLock.test.ts'], lastVerifiedAt: '2026-10-16' },
  },
  {
    id: 'R-CONSUME-ALL-01',
    title: 'Hydraskus: EVERY friendly Demon consumes a Shop minion at End of Turn, left to right, one beat per bite',
    statement:
      'Hydraskus reads "End of Turn: Your Demons consume a minion in the Shop." Every friendly Demon on the board eats '
      + 'one Shop minion (owner), Hydraskus included, in board order LEFT TO RIGHT. Each meal is a random edible Shop '
      + 'minion (the house default for "a minion in the Shop"; spells and Rubies are never eaten). Each bite is its own '
      + 'End-of-Turn tick (`eotTickCount` counts the Demons), so its own root trigger and its own beat (R-REPEAT-01). '
      + 'When the Shop runs out of minions the feast ends and later Demons eat nothing. Gilded: every eater gains '
      + 'DOUBLE the meal\'s stats (the tribe\'s "and gain double its stats" rider). Every consume fires the usual consume '
      + 'payoffs (Enigma, Open Market, Bottomless Banquet) once per bite.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner balance batch 2026-10-10 (Hydraskus, new Set 2 Tier 6 Demon)', quote: 'EVERY friendly Demon eats one Shop minion.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts endOfTurnDemonsConsumeShop + eotTickCount; packages/content/src/cards/set2/demons.ts dm_hydraskus' },
    ],
    contentIds: ['dm_hydraskus'],
    cardText: '**End of Turn:** your **Demons** consume a minion in the Shop.',
    currentBehaviour: 'Conforms (2026-10-10), new card.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/balanceBatch1010.test.ts'], lastVerifiedAt: '2026-10-10' },
  },
  {
    id: 'R-VAULT-01',
    title: 'The Attack-gain pulse (the 2026-10-10 Vaultkeeper): once per Attack gain, every gain counts, no reaction inside a pulse',
    statement:
      'Vaultkeeper: "When this gains Attack, give adjacent Dragons +3/+4." Every separate Attack buff on a Vaultkeeper on '
      + 'your board is one gain and fires one pulse, in the Shop and in combat alike: a gilded Karwind\x27s "+4/+4 twice" '
      + 'is two gains and two pulses in both phases (the Shop no longer folds an action\x27s gains into one). A pulse buffs '
      + 'the adjacent Dragons, never the Vaultkeeper itself; with Vaultkeeper it buffs every other friendly '
      + 'Dragon instead. LOOP GUARD: while any Vaultkeeper pulse is resolving, no Vaultkeeper reacts to a gain, so two '
      + 'adjacent Vaultkeepers each pay the other once per outside gain and then stop. A Vaultkeeper in hand never pulses.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner balance batch 2026-10-10 (Vaultkeeper rework)', quote: 'When this gains Attack, give adjacent Dragons +3/+4.' },
      { kind: 'owner-chat', ref: 'Owner balance batch 2026-10-10 (Vaultkeeper notes)', quote: 'one pulse per gain event, with no re-entrant cascades' },
      { kind: 'owner-chat', ref: 'Owner balance batch 2026-10-10 (Vaultkeeper notes)', quote: 'every separate Attack buff must count as gaining Attack' },
      { kind: 'code', ref: 'packages/core/src/effects/arena.ts runVaultPulse + onGainAttackBuffAdjacentTribe; packages/core/src/effects/factories.ts onGainAttackBuffAdjacentTribe; packages/sim/src/recruit.ts addBuff -> vaultkeeperShopPulse' },
    ],
    contentIds: ['karwind'],
    currentBehaviour: 'DORMANT since 2026-10-13: the owner reworked Vaultkeeper again (R-VAULT-02), so no card in the pool carries this effect and Vaultkeeper no longer widens it. The factory (onGainAttackBuffAdjacentTribe), its per-gain-instance Shop dispatch through the addBuff chokepoint and its loop guard are unchanged engine code and conform; they are pinned through a probe def that is the 2026-10-10 card. The combat-side rune wiring (QuestCombatMods.runeVaultkeeper -> all) is still connected to the dormant factory and is a cleanup candidate.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/dragonBatch1010.test.ts'], lastVerifiedAt: '2026-10-13' },
  },
  {
    id: 'R-HUMPHRY-01',
    title: 'Humphry gives a +2/+2 baseline plus +2/+2 per other Dragon played this turn, as one lump buff, never +0/+0',
    statement:
      'Humphry: "Shout: Give a friendly Dragon +2/+2, plus +2/+2 for every other Dragon played this turn." ONE buff (the '
      + 'lump pattern of R-REPEAT-01): the +2/+2 baseline plus +2/+2 for every OTHER Dragon played from hand this turn, so '
      + 'it is never +0/+0. Played as the first Dragon of the turn it gives +2/+2; after one other Dragon, +4/+4. A real '
      + 'play does not count itself; a re-fire (Shrieker, a Shout repeater, any combat fire) is not a play, so every '
      + 'Dragon played this turn counts. Gilded: +4/+4 baseline plus +4/+4 per other Dragon. Its live text (+X/+Y) prints '
      + 'that same total on every surface (Shop, hand, Discover, board, combat).',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner balance batch 2026-10-10 (Humphry)', quote: 'if it\x27s the first Dragon played this turn the buff is +2/+2, if it\x27s the second it\x27s +4/+4' },
      { kind: 'owner-chat', ref: 'Owner fix 2026-10-10 (Humphry baseline)', quote: 'humphry should buff +2/+2 baseline, not 0/0 baseline.' },
      { kind: 'code', ref: 'packages/core/src/effects/arena.ts battlecryBuffTarget (perPlayedTribe); packages/ui/src/cardText.ts perPlayedTargetText' },
    ],
    contentIds: ['d2_humphry'],
    currentBehaviour: 'Conforms as of 2026-10-10 (fix/humphry-baseline). Before, a re-fire with no Dragons played this turn gave +0/+0, and a board or combat copy printed (+0/+0).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/dragonBatch1010.test.ts'], lastVerifiedAt: '2026-10-10' },
  },
  {
    id: 'R-ROOMWORKS-01',
    title: 'Roomworks and Shrieker cannot loop: no nested Roomworks Shout, no nested "trigger your Shouts" End of Turn',
    statement:
      'Roomworks: "Shout: Trigger a friendly minion\x27s End of Turn effect" (you pick; only a minion with an End of Turn '
      + 'effect is a legal target). Shrieker: "End of Turn: Trigger your minions\x27 Shouts. (Except Roomworks)". Gilded '
      + 'fires each twice. LOOP GUARD: no Roomworks Shout fires while a Roomworks Shout or a "trigger your Shouts" End of '
      + 'Turn (Shrieker, Moira) is resolving, and no "trigger your Shouts" End of Turn starts while another is resolving. '
      + 'That cuts every chain that turns one into the other, including Storm Chaser, Veinstorm, High King Mykel, '
      + 'Roomworks, Shrieker and back. Sequential fires (a gilded second fire, two Roomworks played in a row) are untouched.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner balance batch 2026-10-10 (new Set 2 Dragons)', quote: 'Add a re-entrancy guard so Roomworks/Shrieker chains can\x27t loop.' },
      { kind: 'owner-chat', ref: 'Owner balance batch 2026-10-10 (Roomworks)', quote: 'you PICK the target. It\x27s a targeted Shout; only minions with an End of Turn effect are valid.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts SHOUT_EOT_CHAIN, battlecryReplayTargetEndOfTurn, endOfTurnTriggerShouts (exclude), battlecryTargetAllowed; packages/sim/src/reducer.ts battlecryTarget guard' },
    ],
    contentIds: ['d2_roomworks', 'd2_shrieker', 'b2_moira'],
    currentBehaviour: 'Conforms as of 2026-10-10 (new cards).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/dragonBatch1010.test.ts'], lastVerifiedAt: '2026-10-10' },
  },
  {
    id: 'R-STORMCHASER-01',
    title: 'A "Cast Veinstorm" Shout in combat casts in real time: any minion half lands now, the Shop half at settle',
    statement:
      'When a Shout that says "Cast Veinstorm" (the Shardluck branch; Storm Chaser from 2026-10-10 to 2026-10-13) is '
      + 'triggered during combat, the cast is a real combat cast on its own beat, SPLIT by what the spell does. Whatever '
      + 'the spell casts on friendly minions resolves instantly: a Ruby on every living friendly minion in the fight, worth '
      + '1 + your Ruby strength + spell power, temporary like every combat Ruby. Its Shop half (Shop minions get Ruby stats, '
      + 'banked for future Shops) is applied once per cast when the fight settles, through the Shop spell body, folding '
      + 'spell power the same way. Gilded doubles the casts. It is not a Shop-only Shout (R-REALTIME-03). Since 2026-10-13 '
      + 'Veinstorm casts on the Shop ONLY, so today the combat cast announces itself and banks its Shop half, and no Ruby '
      + 'lands on the fighting minions. Storm Chaser is no longer covered by this rule: its Shout GETS a Veinstorm (to hand) '
      + 'and casts nothing, in the Shop and in combat alike.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ruling 2026-10-10 (Storm Chaser in combat, follow-up to #2016)', quote: 'Split (real time)' },
      { kind: 'owner-chat', ref: 'Owner balance 2026-10-13 (second Kobold nerf batch)', quote: 'the veinstorm effect should only cast on shop, not friendly minions' },
      { kind: 'owner-chat', ref: 'Owner balance 2026-10-13 (Storm Chaser)', quote: 'storm chaser needs to change from: Cast a Veinstorm to Get a Veinstorm. So it should add a veinstorm to hand instead of casting it directly' },
      { kind: 'code', ref: 'packages/core/src/effects/factories.ts FACTORIES.battlecryCastNamedSpell + playRubyOn (extra); packages/core/src/combat/simulate.ts deferShopSpellHalf; packages/sim/src/recruit.ts applyShopSpellHalf; packages/sim/src/reducer.ts settle (shopSpellHalves)' },
    ],
    contentIds: ['k3_facetbound', 'veinstorm'],
    currentBehaviour: 'Conforms. 2026-10-10: the cast-Veinstorm Shout stopped being a SHOP_ONLY_SHOUTS entry and its minion half landed live. 2026-10-13: Veinstorm dropped its `minions` param, so the live half is dormant (the factory and the combat split still honour the param; a probe spell pins that). Later on 2026-10-13 Storm Chaser went back to Get a Veinstorm (battlecryGrantSpell, pinned in stormChaser1013.test.ts), leaving the Shardluck branch as the only card on battlecryCastNamedSpell; the split is pinned through a probe def that is the 10-10 Storm Chaser.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/koboldBalance1013.test.ts', 'packages/sim/src/koboldBalance1010.test.ts', 'packages/sim/src/stormChaser1013.test.ts'], lastVerifiedAt: '2026-10-13' },
  },
  {
    id: 'R-GASKET-RALLY-01',
    title: 'Gasket: a Rally that sprays 2 damage over every minion except friendly Demons, one pass per repeat',
    statement:
      'Each time Gasket Rallies (its own attack, or a forced Rally: R-RALLY-FORCED-01), it deals 2 damage to EVERY minion '
      + 'on both sides except its friendly Demons: every enemy (enemy Demons included) and every friendly non-Demon. '
      + 'Gasket is a Demon, so it spares itself. The pass hits every victim at once; a body at 0 stops taking hits and every '
      + 'death resolves once, after the final pass. Gilded deals 2 damage TWICE: two separate passes, each its own tick '
      + '(the repeat rule), never one 4-damage hit. A Ward absorbs the first pass and pops. Gasket is the damage source, so '
      + 'each landed hit counts toward its Pummel and fires the "when a friendly Demon deals damage" reactors, per hit. '
      + 'A target the pass kills is not then swung at (no clash). It is the SAME spray body as Fel Spikes\x27 Echo '
      + '(`sprayDamageExceptFriendlyTribe`), fired from the Rally trigger (`rallyDamageAllExceptTribe`). In the SHOP (a forced '
      + 'Rally there) there is no enemy, so only your non-Demons take it, the Fel Spikes / Blaster shop ruling.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner add 2026-10-10 (Gasket)', quote: 'Rally: Deal 2 damage to all minions except friendly Demons.' },
      { kind: 'owner-chat', ref: 'Owner add 2026-10-10 (Gasket, Gilded)', quote: 'deals 2 damage twice' },
      { kind: 'code', ref: 'packages/core/src/effects/factories.ts sprayDamageExceptFriendlyTribe + FACTORIES.rallyDamageAllExceptTribe; packages/sim/src/recruit.ts shopSprayExceptTribe + RECRUIT_FACTORIES.rallyDamageAllExceptTribe' },
    ],
    contentIds: ['dm_gasket', 'dm_felspikes'],
    currentBehaviour: 'Conforms as of 2026-10-10 (new card; Fel Spikes\x27 body extracted unchanged).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/gasket.test.ts'], lastVerifiedAt: '2026-10-11' },
  },
  {
    id: 'R-DEMON-DAMAGE-SHOP-01',
    title: 'A friendly Demon dealing damage in the Shop fires the Shop half of "when a Demon deals damage"',
    statement:
      'When a friendly Demon deals damage in the Shop (a Shop-fired Gasket Rally or Fel Spikes Echo), each landed hit '
      + 'fires the board\x27s "when a Demon deals damage" effects that have a Shop body, exactly as one landed combat hit '
      + 'does. Today that is `onFriendlyDemonDamageBuffTribe` (Rad Rachel, Ruinous Lord), whose Shop buff is permanent '
      + '(R-BUFF-PHASE-01). Leech, Axeman and Impossible Todd have no Shop body yet, so they stay combat-only.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ruling 2026-10-11 (Rad Rachel permanence)', quote: 'if the effect is triggered in recruit phase, it would be permanent.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts fireShopDemonDealtDamage (called per landed hit from shopSprayExceptTribe)' },
    ],
    contentIds: ['dm_radrachel', 'dm_gasket'],
    currentBehaviour: 'Conforms as of 2026-10-11. Before, `friendlyDemonDealtDamage` had no Shop path at all.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/radRachel.test.ts'], lastVerifiedAt: '2026-10-11' },
  },
  {
    id: 'R-RUINOUS-01',
    title: 'Ruinous Lord: every landed friendly-Demon hit gives your living Demons +1/+1 for this combat only',
    statement:
      'Ruinous Lord (granted only by Ruinous) watches the same trigger as Impossible Todd (R-DEALT-01): it '
      + 'fires once for every instance of damage a FRIENDLY Demon lands in combat, its own swings included; a Ward-absorbed '
      + 'hit dealt nothing and does not count, and an enemy Demon never fires it. Each fire gives every living friendly '
      + 'Demon (the Lord itself included) +1/+1, gilded +2/+2. Fired in combat the gain lasts THIS COMBAT ONLY, except on '
      + 'an Engraved body, which carries it back; a friendly Demon dealing damage in the Shop (a Shop-fired Fel Spikes Echo, '
      + 'one fire per landed hit) pays your board Demons PERMANENTLY (R-BUFF-PHASE-01). Each combat fire is its own '
      + 'beat: one buff wave, all the Demon gains landing together.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner add 2026-10-10 (Rune of the Ruinous)', quote: 'When a Demon deals damage, give your Demons +1/+1. The buff lasts for this combat only.' },
      { kind: 'code', ref: 'packages/core/src/effects/factories.ts onFriendlyDemonDamageBuffTribe; packages/content/src/cards/set2/demons.ts dm_ruinouslord; packages/content/src/runes.ts rune_ruinous' },
    ],
    contentIds: ['dm_ruinouslord', 'rune_ruinous'],
    currentBehaviour: 'Conforms as of 2026-10-11 (new card + new primitive; the Shop half added with the owner phase ruling).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ruinousRune1010.test.ts'], lastVerifiedAt: '2026-10-10' },
  },
  {
    id: 'R-VAULT-02',
    title: 'Vaultkeeper gains when you play a Dragon, and improves every 4 Dragons or Dwarves played this game',
    statement:
      'Vaultkeeper is a Dwarf/Dragon: "When you play a Dragon, gain +3/+3. Improves every 4 Dragons or Dwarves played '
      + 'this game." Each Dragon played from hand while a Vaultkeeper is on your board gives that Vaultkeeper its '
      + 'current gain; a Dwarf pays nothing. The improve is a RUN-WIDE tally, not a per-copy one: every Dragon OR Dwarf '
      + 'played from hand since the start of the game counts, whether or not a Vaultkeeper is on the board, in hand or '
      + 'in the Shop, and each 4 counted raise the gain of EVERY Vaultkeeper by +3/+3 (+3/+3, then +6/+6, then +9/+9), so '
      + "a copy bought late arrives already improved. A body that is both types is one play, and a Vaultkeeper's own "
      + 'play counts (it never pays itself for its own arrival). A summoned token is not a play, and a Vaultkeeper in '
      + 'hand never gains. Gilded doubles the gain. With Vaultkeeper, each gain is also given to an adjacent '
      + 'Dragon. Every surface (Shop, Discover, hand, board, combat, a served opponent) prints the current gain and the '
      + 'N/4 counter from the run-wide count.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner rework 2026-10-13 (Vaultkeeper)', quote: 'When you play a dragon, gain 3/3. Play 3 Dragons or Dwarves to improve this.' },
      { kind: 'owner-chat', ref: 'Owner answer 2026-10-13 (how much the gain grows per 3 played)', quote: '+3/+3 per step' },
      { kind: 'owner-chat', ref: 'Owner answer 2026-10-13 (what Rune of the Vaultkeeper does now)', quote: 'Old rune effect' },
      { kind: 'owner-chat', ref: 'Owner change 2026-10-20 (Vaultkeeper retype + run-wide improve)', quote: "lets change vaultkeeper to a Dwarf / Dragon tribe type, and let's change its mechanic to 4 dragons or dwarves played improves it. i want this mechanic to be active even when the card is not on board or in hand or in shop." },
      { kind: 'owner-chat', ref: 'Owner answers 2026-10-20 (relayed): wording, payout, start, self count', quote: 'reuse the existing tail ... the +3/+3 still pays on Dragons ONLY ... counts from the START OF THE GAME ... playing a Vaultkeeper adds 1 to the tally' },
      { kind: 'code', ref: 'packages/sim/src/runTally.ts + recruit.ts countTribeUnionPlay / tribePlayedGainSelfImproving; packages/sim/src/snapshot.ts cleanBoard (served tally); packages/content/src/cards/set2/dragons.ts d2_herzog; packages/ui/src/instView.ts + Recruit.tsx + Unit.tsx (runTallyFor)' },
    ],
    contentIds: ['d2_herzog', 'rune_herzog'],
    currentBehaviour: 'Conforms as of 2026-10-20 (the run-wide tally `RunState.tribeUnionPlays`, keyed `dragon+dwarf`, bumped in `playCard` after the play watchers fire). Was per copy and every 3 from 2026-10-13. ORDER is a lead assumption, not an owner ruling: the gain is paid first and the play counted second, so the play that completes a set of 4 still pays the old value. A run saved before 2026-10-20 starts its count at 0 from then. The rune picks one adjacent Dragon, seeded when both neighbours are Dragons. Mastery does not speed the count. Shop only: nothing is played from hand in combat.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/vaultkeeperRunTally1020.test.ts', 'packages/sim/src/vaultBrisbane1013.test.ts', 'packages/ui/src/vaultBrisbaneText.test.ts'], lastVerifiedAt: '2026-10-20' },
  },
  {
    id: 'R-BRISBANE-01',
    title: 'Alchemist Brisbane: Shout and Rally pay one improving Ruby grant, improved by Gold spent',
    statement:
      'Alchemist Brisbane: "Shout and Rally: Your Rubies gain +1/+1. Spend 40 Gold to improve this." Both triggers pay '
      + 'the SAME grant, in the Shop and in combat. Every 40 Gold spent while Brisbane is on your board improves that '
      + 'copy by +1/+1 (+1/+1, then +2/+2, then +3/+3), permanently; the Gold meter carries across turns. Gilded doubles '
      + 'the grant. Brisbane has no Echo and no End of Turn effect.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner rework 2026-10-13 (Alchemist Brisbane)', quote: 'Shout, Echo, and Rally: Your Rubies gain +2/+2. Spend 30 Gold to improve this.' },
      { kind: 'owner-chat', ref: 'Owner answer 2026-10-13 (how much the grant grows per 30 Gold)', quote: '+2/+2 per step' },
      { kind: 'owner-chat', ref: 'Owner answer 2026-10-13 (the End of Turn Ruby cast)', quote: 'Remove it' },
      { kind: 'owner-chat', ref: 'Owner balance 2026-10-20 (Alchemist Brisbane)', quote: 'change brisbane to just shout and rally, change spend to 40.' },
      { kind: 'owner-chat', ref: 'Owner balance 2026-10-20 (Brisbane grant size)', quote: 'change brisbane to 1/1 gem buffs, and improving it means improve by 1/1' },
      { kind: 'code', ref: 'packages/core/src/effects/arena.ts improvingGrant + rallyRubyStatGain; packages/core/src/effects/factories.ts rubyStatGain; packages/sim/src/recruit.ts rubyStatGain + goldSpentImproveSelf; packages/content/src/cards/set2/kobolds.ts k_alchemist; packages/ui/src/cardText.ts improvingRubyGrantText' },
    ],
    contentIds: ['k_alchemist'],
    currentBehaviour: 'Conforms as of 2026-10-20 (Echo leg removed, 30 -> 40 Gold, +2/+2 -> +1/+1 base and step; Shout, Echo and Rally at +2/+2 per 30 from 2026-10-13). The improvements ride the copy (summonBonus), so they go into combat with it and a re-fired Shout and every Rally read them. Mastery doubles each improvement earned, like every other improve. A Brisbane in hand earns nothing: the Gold meter runs on board bodies only.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/vaultBrisbane1013.test.ts'], lastVerifiedAt: '2026-10-20' },
  },
  {
    id: 'R-INDY-01',
    title: 'Indy adds a Golden Monkey to the Shop every 5 rolls; the Golden Monkey sells into a Discover from the Tier above',
    statement:
      'Indy: "When you roll 5 times, add a Golden Monkey to the Shop." Indy counts ONLY the player pressing Refresh while '
      + 'it is on your board (a free reroll banked by a card or rune still counts: it is still the button). The fresh Shop '
      + 'at the start of a turn and refreshes made by runes, spells or hero powers do not count. The tally runs from when '
      + 'that copy arrived and pays on every 5th roll: 5, 10, 15. Gilded adds 2. The Shop never grows: a short row takes the Monkey in a '
      + 'free slot, a full row swaps out its right-most minion (never the Starform, a spell or another Golden Monkey). '
      + 'The Golden Monkey is a 6/6 Taunt token: "Sell: Discover a minion from the Tier above yours (up to Tier 7)." The '
      + 'offer is exactly your Shop tier + 1, capped at 7; gilded offers gilded minions.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner Set 3 batch 2026-10-13 (Indy)', quote: 'When you roll 5 times, add a Golden Monkey to the Shop.' },
      { kind: 'owner-chat', ref: 'Owner answer 2026-10-13 (what Indy counts)', quote: 'this should only count hitting the refresh button' },
      { kind: 'owner-chat', ref: 'Owner Set 3 batch 2026-10-13 (Golden Monkey)', quote: 'one above your current Shop tier, capped at 7' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts onShopRefreshAddToShop + addCardToShop + onSellDiscover (tierOffset); packages/content/src/cards/set3/neutral.ts n3_indy + n3_goldenmonkey; packages/ui/src/cardText.ts sellDiscoverTierText' },
    ],
    contentIds: ['n3_indy', 'n3_goldenmonkey'],
    currentBehaviour: 'Conforms as of 2026-10-13. Only the reducer roll action carries playerRoll on the shopRefreshed dispatch. Lead call, not an owner ruling: free rerolls count (they are the player pressing Refresh). The tally is cumulative per copy, not per turn. The countdown rides the board badge (owner-approved), not the text. Golden Monkey offering Tier 7 at Shop tier 6 without Tier 7 access is approved for now.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Batch1013.test.ts'], lastVerifiedAt: '2026-10-13' },
  },
  {
    id: 'R-AGNUS-01',
    title: 'Amplification Agnus Amplifies every Equipment activation while it is on your board, spending nothing',
    statement:
      'Amplification Agnus: "All Equipment is Amplified." While Agnus is on your board, every Equipment you activate '
      + 'from the slot triggers twice. It spends nothing: an Amplified stack banked by Amplification or the Grand '
      + 'Workshop, and a pending Calibration Wrench charge, stay for a later activation. Amplified is twice at most, so '
      + 'two Agnus, a gilded Agnus, or Agnus plus a stack still trigger twice. Off the board (sold, or still in hand) it '
      + 'does nothing. Dismantling and Counterrotation re-fires are not activations and are not Amplified.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner Set 3 batch 2026-10-13 (Amplification Agnus)', quote: 'All Equipment is Amplified.' },
      { kind: 'owner-chat', ref: 'Owner answer 2026-10-13 (when it applies)', quote: 'Only while on your board' },
      { kind: 'code', ref: 'packages/sim/src/equipment.ts equipmentAmplifiedByAura + equipmentWillAmplify; packages/sim/src/reducer.ts activateEquipment; packages/content/src/cards/set3/neutral.ts n3_agnus' },
    ],
    contentIds: ['n3_agnus'],
    currentBehaviour: 'Conforms as of 2026-10-13. The slot paints the charge blue off equipmentWillAmplify, which reads Agnus too.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Batch1013.test.ts'], lastVerifiedAt: '2026-10-13' },
  },
  {
    id: 'R-SOLBURN-01',
    title: 'Solburn collapses your Starform when it is SOLD, and never receives a hit itself',
    statement:
      'Solburn: "Sell: Collapse your Starform." Selling Solburn collapses the Starform exactly as before (3 unique random '
      + 'friendly Celestials, plus Nova Herald extras, each gain half its stats; gilded gives the full stats). Solburn has '
      + 'already left the board when the sale fires, so it is never one of the hits. Playing Solburn does nothing.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner Set 3 batch 2026-10-13 (Solburn)', quote: 'Sell: Collapse your Starform.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts battlecryCollapseStarform (fired by fireOnSell); packages/content/src/cards/set3/celestials.ts ce3_coronadevotee' },
    ],
    contentIds: ['ce3_coronadevotee'],
    currentBehaviour: 'Conforms as of 2026-10-13. Stats kept at 4/5 (the owner gave none).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Batch1013.test.ts'], lastVerifiedAt: '2026-10-13' },
  },
  {
    id: 'R-REALTIME-STATS-01',
    title: 'Every stat change in combat shows on the minion on the beat it happens, at the exact engine number',
    statement:
      'During the combat replay, every Attack / Health change (a buff, a Ruby, an aura a body takes, a Rise, a summon) '
      + 'moves the badges of the affected minion on the beat its event plays, and after every resolution step the screen shows '
      + 'each living minion at exactly the Attack and Health the engine holds. Nothing waits for the next beat, the expiry '
      + 'of a hold or settle. Every number the replay withholds for an animation has a deliverer on its own beat: a tendril or '
      + 'pulse, the attack wind-up, or (for a Ruby, whose gem carries no number) a roll timed to the gem landing. A stat '
      + 'change the engine makes always rides an event the replay folds (R-REALTIME-01 is the trigger half of this rule).',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-14 (real-time combat buffs)', quote: 'can you make sure our buffs update in real time in combat? i believe ive seen some that dont, like veinstorm but im sure there are others.' },
      { kind: 'code', ref: 'packages/ui/src/useCombatReplay.ts computeFrame (reborn clears the overkill debt; prefolded buffs) + the per-beat undeliveredRollPlan roll; packages/ui/src/choreo/buffDelivery.ts; packages/ui/src/choreo/clashOrder.ts prefoldedShareOf; packages/ui/src/choreo/avengeOrder.ts; packages/core/src/combat/simulate.ts syncUnityCombat (buff events) + CombatConfig.probe' },
    ],
    currentBehaviour:
      'Conforms, FIXED 2026-10-14. The audit (simulate probe vs computeFrame over the replay order, every set, random '
      + 'boards, contexts and rune / quest / hero mods) found five defects: (1) a risen body kept the overkill debt of the '
      + 'blow that killed it, so its first Health buffs never showed (every Rise minion); (2) Unity gave the Undead '
      + 'Aura with no event; (3) the clash reorder slid a Health buff past a later hit on the same body, whose absolute '
      + 'remaining Health already held it, so the gain showed twice for the rest of the fight (Chosen Fiend, Ruinous Lord, '
      + 'Rad Rachel); (4) a grant on a body before it is placed (Solid Ground, an Avenge grant) was slid past its own '
      + 'summon and shown twice; (5) every Ruby outside an attack wind-up (Gemstorm, Blazer, Kobaby Boldies, a Shout '
      + 'casting Rubies) was withheld with no deliverer and snapped in on the next beat.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/realtimeStatsAudit.test.ts'], lastVerifiedAt: '2026-10-14' },
  },
  {
    id: 'R-DWARF-1021-01',
    title: 'Set 3 Dwarf batch 2026-10-21: "after you play a Dwarf" is a play, "a Dwarven Ale" is the Ale family, Foamguard re-wards once per combat',
    statement:
      'Coin Counter ("After you play a Dwarf, gain +1/+1") grows only on a real PLAY of a Dwarf from hand, never a token '
      + 'summon and never its own play; an All-types minion counts as a Dwarf; it listens on the board only; the gain is '
      + 'permanent. Keg Runner ("Sell: gain 2 additional Gold") pays its 2 Gold on top of the normal sell value. Champion '
      + 'Inu ("After you cast a Dwarven Ale, give your Dwarves +2/+2") fires on any cast of the Dwarven Ale family (the five '
      + 'Ales in ALE_IDS) by any caster, once per cast repetition, in the Shop and in combat, and never on any other spell; '
      + '"your Dwarves" includes itself and All-types minions. Foamguard ("Taunt. Ward. The first time this loses Ward each '
      + 'combat, gain +10/+10 and Ward") reacts to the real Ward break on its own body (not a Resilient Ward downgrade), '
      + 'once per body: it gains the stats as a combat buff, then regains Ward (a Rise / Rebirth return re-arms it, see '
      + 'R-DWARF-1021-02). Gilding doubles every number above and never the once-per-body count.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner content ask 2026-10-21 — Set 3 Dwarf batch', quote: 'create these set 3 dwarf minions and wire their art' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts tribePlayedBuffSelfInHand (board form) / fireOnTribePlayed / spellCastBuffAll (aleOnly) / onSellGainGold; packages/core/src/effects/factories.ts spellCastBuffAll (aleOnly) / onLoseWardOnceBuffSelfRegain; packages/core/src/combat/simulate.ts ctx.spellResolved (Ale watchers)' },
    ],
    cardText: 'After you cast a **Dwarven Ale**, give your **Dwarves +2/+2**.',
    contentIds: ['dw3_coincounter', 'dw3_kegrunner', 'dw3_championinu', 'dw3_foamguard'],
    currentBehaviour: 'Conforms (built with the cards, 2026-10-21).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3DwarvesBatch1021.test.ts'], lastVerifiedAt: '2026-10-21' },
  },
  {
    id: 'R-DWARF-1021-02',
    title: 'Foamguard re-arms on every return: a Risen or Reborn Foamguard can lose Ward and regain it once more',
    statement:
      "Foamguard's \"the first time this loses Ward each combat, gain +10/+10 and Ward\" is spent per BODY, not per fight. "
      + 'When it dies and comes back through Rise or Rebirth, the returned body has Ward (Rise keeps printed keywords; '
      + 'Rebirth restores a Ward it carried) and its trigger is available again, so the next real Ward break on that '
      + 'body gives +10/+10 and Ward once more. After that it is spent until the next removal and return. Each '
      + 'removal and return resets it. The stats stay a combat-only gain (R-BUFF-PERM). Bounded: a reset needs a spent '
      + 'Rise / Rebirth (or a budgeted Deathtouched Apple re-arm), so no loop is possible. This reverses the '
      + "R-DWARF-1021-01 build, which copied Yeti's \"a returned body stays spent\" rule. Since 2026-10-21 the same reset "
      + 'covers every per-body per-combat limit, Yeti included (R-RETURN-RESET-01).',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ruling 2026-10-21 on Foamguard after #2194', quote: "no it should rise and gain ward, then reset when it's removed again" },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts killOrReborn (Rebirth and Rise branches clear wardRegainFired); packages/core/src/effects/factories.ts onLoseWardOnceBuffSelfRegain' },
    ],
    cardText: '**Taunt.** **Ward.** The first time this loses **Ward** each combat, gain **+10/+10** and **Ward**.',
    contentIds: ['dw3_foamguard'],
    currentBehaviour: 'Conforms (fixed 2026-10-21).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3DwarvesBatch1021.test.ts'], lastVerifiedAt: '2026-10-21' },
  },
  {
    id: 'R-DWARF-1021-03',
    title: 'Foamguard presentation: the Ward break plays, then the +10/+10, then the Ward visibly re-forms',
    statement:
      'When Foamguard loses Ward and its trigger fires, the replay shows three beats in order: the normal Ward break on '
      + 'the hit, then the +10/+10 buff beat, then the Ward re-forming on its own Ward-gain moment (the existing '
      + 'ward-gain-blast FX and Ward-gain sound), about 250 to 400 ms after the break at 1x speed. The break moment never '
      + 'carries the Ward coming back. Same on both sides, in replays and spectating (one replay path), and on a risen '
      + 'or reborn body. Presentation only: a triggered Ward gain is moved to the end of the slice that broke that Ward, '
      + 'unless something later in that slice touches the same body, so the folded end state is unchanged.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ask 2026-10-21 on the Foamguard PR', quote: "can you show the ward break and then get re-applied? i think it'd be more satisfying" },
      { kind: 'code', ref: 'packages/ui/src/choreo/clashOrder.ts isWardReform / isWardReformEvent; packages/ui/src/choreo/clock.ts WARD_REFORM_AFTER_BUFF_MS' },
    ],
    cardText: '**Taunt.** **Ward.** The first time this loses **Ward** each combat, gain **+10/+10** and **Ward**.',
    contentIds: ['dw3_foamguard'],
    currentBehaviour: 'Conforms (built 2026-10-21).',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/choreo/wardReform.test.ts'], lastVerifiedAt: '2026-10-21' },
  },
  {
    id: 'R-DWARF-1021-04',
    title: 'Set 3 Dwarf rework 2026-10-21: Hank Pepe and Shift Broker fire on any Sell; four Dwarves leave Set 3; Brill is buyable there',
    statement:
      'Hank Pepe ("When you Sell a minion, give 3 other Dwarves +1/+1") fires on the sale of ANY minion, any tribe, and no '
      + 'longer on a Dwarf play. It buffs up to 3 RANDOM other Dwarves on the board (seeded; never itself, never the sold '
      + 'minion; an All-types minion counts as a Dwarf; fewer than 3 buffs them all). Gilded doubles the stat (+2/+2), '
      + 'never the count. Shift Broker gains +2 Attack per sale (Gilded +4). Both are Shop buffs and permanent '
      + '(R-BUFF-PHASE-01); a sale only happens in the Shop. Coinfire, Striker, Billings and Lieutenant Thane are out of the '
      + 'Set 3 pool (still Set 2 cards; old Set 3 saves, snapshots and replays resolve them by id). Dwarf King, Brill is a '
      + 'buyable Set 3 Tier 6 (no longer a token; Set 2 keeps it forge-only by leaving it out of its manifest), and Rune '
      + 'of the High King is a Set 2 rune only.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner content changes for Set 3, 2026-10-21', quote: 'Hank Pepe becomes: "When you Sell a minion, give 3 other Dwarves +1/+1."' },
      { kind: 'owner-chat', ref: 'Owner ask 2026-10-21 (same PR)', quote: "add dwarf king brill to set 3's dwarf pool, archive the rune from set 3" },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts minionSoldBuffRandomTribeOthers / minionSoldBuffSelf; packages/content/src/sets.ts SET3_DWARVES_IN_SET3 / SET2_DWARVES_IN_SET3 / SET2_BRILL_IN_SET3' },
    ],
    cardText: 'When you **Sell** a minion, give **3 other Dwarves +1/+1**.',
    contentIds: ['dw3_hankpepe', 'dw3_shiftbroker', 'dw_coinfire', 'dw3_striker', 'dw_billings', 'dw_thane', 'dw_brill'],
    currentBehaviour: 'Conforms (built 2026-10-21).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3DwarfRework1021.test.ts'], lastVerifiedAt: '2026-10-21' },
  },
  {
    id: 'R-DWARF-1021-05',
    title: 'Set 3 Sell Dwarves 2026-10-21: Sailsey, Mariet, Valyou, Leeds',
    statement:
      'Sailsey (T2 3/1) "Sell: Give your Dwarves +2/+3": its OWN sale buffs every Dwarf left on the board (All-types '
      + 'count; never itself, it has left). Mariet (T3 2/6) "When you Sell 4 minions, get a Dwarven Ale" (a random Shop '
      + 'Spell until the owner\'s 2026-10-23 change): a per-instance meter of the minions you Sell while it is on the board, '
      + 'carried round to round; every 4 pays one random Dwarven Ale from the run\'s Ale pool (a set without Ales grants '
      + 'nothing); Gilded pays TWO Ales per payout (the Runic Archivist convention), not a halved counter. Valyou (T5 6/9) "When you '
      + 'Sell a minion, gain +3/+3. Every 4 triggers also grants 2 Gold": +3/+3 per sale, permanent, and every 4th trigger '
      + 'also pays 2 Gold now; Gilded doubles both (+6/+6, 4 Gold). Leeds (T6 6/8) "When you play a Dwarf, give your '
      + 'Dwarves +2/+2. Improves when you Sell 4 minions": on a real Dwarf play (All-types count; not its own arrival) every '
      + 'Dwarf on the board, Leeds and the played one included, gains base x (1 + floor(sales / 4)), the sales being those '
      + 'made while this Leeds was on the board, carried round to round. Each improve adds the base grant again (+2/+2, '
      + '+4/+4, +6/+6), the game\'s "Improves" convention (Aspect, Flowing Monk, Archmagus Guel). Gilded doubles the base and '
      + 'every step. All four are Shop buffs and permanent (R-BUFF-PHASE-01). Every sold meter (Mariet, Valyou, Leeds) '
      + 'shows its countdown as the game\'s standard integer counter under the card (N/4, like Avenge and every every-N card), '
      + 'never as prose in the text (owner 2026-10-21): the printed sentence stays authored, and Leeds prints its CURRENT '
      + 'grant in place of +2/+2 once it has improved.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner content ask 2026-10-21 (four new Set 3 Dwarves)', quote: 'Leeds: When you play a Dwarf, give your Dwarves +2/+2. Improves when you Sell 4 minions.' },
      { kind: 'owner-chat', ref: 'Owner 2026-10-21 (countdown prose on Mariet / Valyou / Leeds)', quote: 'i dont think we use text for this, just integers' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts minionSoldBuffSelf (count/gold) / minionSoldTally / tribePlayedBuffTribeSellImproving / minionSoldGrantSpell; battlecryBuffTribe on onSell; packages/ui/src/cardText.ts sellImproveText (Leeds grant) + stepProgress minions-SOLD counter' },
    ],
    cardText: 'When you play a **Dwarf**, give your **Dwarves +2/+2**. Improves when you **Sell** **4 minions**.',
    contentIds: ['dw3_salezarsails', 'dw3_marketing', 'dw3_valyou', 'dw3_leeds'],
    currentBehaviour: 'Conforms (built 2026-10-21; the countdown prose of the first cut replaced by the integer counter the same day).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3SellDwarves1021.test.ts', 'packages/ui/src/sellDwarvesText.test.ts'], lastVerifiedAt: '2026-10-21' },
  },
  {
    id: 'R-KOBOLD-1022-01',
    title: 'Set 3 Kobold pool 2026-10-22: Kobe and Blazer out; Shardluck, Delver, Cavern Fiend back; Dealski gets a random Ruby; Prismatic Pick Discovers 2 Rubies',
    statement:
      'Kobe and Blazer are out of the Set 3 pool (still Set 2 cards; old Set 3 saves, snapshots and replays resolve them '
      + 'by id). Shardluck and Delver (archived 2026-10-13) and Cavern Fiend (the old Gemgorge Fiend, archived from every '
      + 'set 2026-10-10) are buyable Set 3 Kobolds again at their existing tier, stats and text; Set 2 does not regain '
      + 'Cavern Fiend. Delver and Shardluck still name Veinstorm, which is granted or cast by id even though Set 3 does '
      + 'not sell it. Dealski: "When you play a Choose One card, get a random Ruby" (one of all six types, R-RAND-02; '
      + 'Gilded 2), on the shared chooseOnePlayed trigger. Prismatic Pick: "Choose One: Discover 2 Rubies or your next '
      + 'Choose One card gains both effects": the Ruby branch is TWO Ruby Discovers (Gilded four, special types only, '
      + 'R-RAND-RUBY-DISCOVER-01); the Both branch arms one shared Choose-Both charge (Gilded two), spent by the next '
      + 'Choose One played and cleared at the turn boundary, and the Equipment slot prints how many charges are armed.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner content changes for Set 3 Kobolds, 2026-10-22', quote: 'Dealski becomes: "When you play a Choose One card, get a random Ruby."' },
      { kind: 'owner-handoff', ref: 'Owner content changes for Set 3 Kobolds, 2026-10-22', quote: 'Choose One: Discover 2 Rubies or your next Choose One card gains both effects.' },
      { kind: 'code', ref: 'packages/content/src/sets.ts SET2_KOBOLDS_IN_SET3; packages/content/src/cards/set3/kobolds.ts; packages/content/src/equipment.ts PRISMATIC_PICK; packages/sim/src/equipment.ts equipmentText' },
    ],
    cardText: 'When you play a **Choose One** card, get a random **Ruby**.',
    contentIds: ['k_kobe', 'k_blazer', 'k3_veinchant', 'k3_facetbound', 'k_gemgorge', 'k3_dealski', 'k3_prismpick'],
    currentBehaviour: 'Conforms (built 2026-10-22).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3KoboldPool1022.test.ts'], lastVerifiedAt: '2026-10-22' },
  },
  {
    id: 'R-KOBOLD-1022-02',
    title: 'Set 3 Kobolds 2026-10-22: Boy Scout, Gramps, Zapdash, Frack Attack, Rosey',
    statement:
      'Boy Scout (T2 3/3) "Shout: Gain 2 free Refreshes": banks 2 free Refreshes in the run\'s free-refresh bank (spent '
      + 'before Gold on a roll); Gilded 4; a combat Shout replay banks through the Gryphon carry-back. Gramps (T3 4/2) '
      + '"Sell: Cast a Ruby on all of your minions" (the sheet\'s "Play" printed as "Cast", the 2026-08-30 one-verb ruling): '
      + 'its own sale casts one Ruby on every minion left on the board, any tribe, never itself (it has left); Gilded casts 2 '
      + 'on each, each its own landing. Zapdash (T3 4/4) "Pummel (10): Cast a Ruby on your Kobolds. (Twice per combat)": a '
      + 'Pummel marker on the shared lifetime damage meter; each payout casts a Ruby on every living friendly Kobold, itself, '
      + 'dual tribes and All-types included; at most 2 payouts per combat, re-armed by a Rise / Rebirth return '
      + '(R-RETURN-RESET-01); Gilded casts 2 Rubies per Kobold per payout (owner). Frack Attack (T4 6/5) "Start of Combat: '
      + 'Cast 3 Rubies on this. Repeat after 3 friendly attacks": 3 Rubies on itself at Start of Combat, then 3 more on every '
      + '3rd friendly attack this combat (repeating); the meter is per combat, counts only while Frack lives, and starts over on a '
      + 'Rise / Rebirth return (resetPerCombatLimits); Gilded 6. Combat Rubies from Zapdash and Frack Attack are combat-only '
      + '(R-BUFF-PHASE-01). Rosey (T6 2/2) "When you cast a Ruby, this gains +2/+1 permanently. Improves every 3 Refreshes": '
      + 'per Ruby cast by you, from any source, on any minion (Rosey and a Shop minion included), in the Shop and in combat; a '
      + 'bounce hop is not a cast and pays nothing; each step adds the base again (+2/+1, +4/+2, ...) every 3 Refreshes the '
      + 'player presses while it is on the board (Indy\'s meter); Gilded doubles base and steps. Live text: Rosey prints its '
      + 'current grant in place; every countdown is the integer counter under the card (Rosey N/3, Zapdash the Pummel '
      + 'badge, Frack Attack N/3), never prose.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner content ask 2026-10-22 (five new Set 3 Kobolds)', quote: 'Frack Attack: Start of Combat: Cast 3 Rubies on this. Repeat after 3 friendly attacks.' },
      { kind: 'code', ref: 'packages/content/src/cards/set3/kobolds.ts; packages/core/src/combat/simulate.ts noteDamageDealt (dealtDamageCastRubiesTribe); packages/core/src/effects/factories.ts friendlyAttacksPlayRubiesSelf / battlecryGrantFreeRolls / playRubyOn (Rosey); packages/core/src/combat/minion.ts resetPerCombatLimits; packages/sim/src/recruit.ts roseyHearsRubies / shopRefreshTallySelf; packages/core/src/effects/arena.ts rubyCastGainOf' },
    ],
    cardText: '**Pummel (10):** Cast a **Ruby** on your **Kobolds**. (Twice per combat)',
    contentIds: ['k3_boyscout', 'k3_gramps', 'k3_zapdash', 'k3_frackattack', 'k3_rosey'],
    currentBehaviour: 'Conforms (built 2026-10-22).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Kobolds1022.test.ts', 'packages/ui/src/set3Kobolds1022Text.test.ts'], lastVerifiedAt: '2026-10-22' },
  },
  {
    id: 'R-KOBOLD-1022-03',
    title: '"A Ruby" without "random" is the plain Ruby (Gramps, Zapdash, Frack Attack)',
    statement:
      'A card that casts "a Ruby" / "N Rubies" without the word "random" casts the PLAIN Ruby (+1/+1 plus the run\'s Ruby '
      + 'improvements, no Kobold rider), never a random special type. Gramps, Zapdash and Frack Attack all cast plain Rubies. '
      + 'A Ruby DISCOVER is the different case: it offers special types only, never the plain one.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner confirmed 2026-10-22 (via the coordinator)', quote: '"A Ruby" without "random" means the plain Ruby (Gramps, Zapdash, Frack Attack).' },
      { kind: 'code', ref: 'packages/core/src/effects/factories.ts playRubyOn (plain Ruby); packages/core/src/effects/arena.ts battlecryPlayRubiesAll / scPlayRubiesSelfAndAdjacentTribe' },
    ],
    contentIds: ['k3_gramps', 'k3_zapdash', 'k3_frackattack'],
    currentBehaviour: 'Conforms (owner confirmed 2026-10-22).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Kobolds1022.test.ts'], lastVerifiedAt: '2026-10-22' },
  },
  {
    id: 'R-KOBOLD-1022-04',
    title: 'Rosey\'s "permanently" carries combat gains back to the Shop',
    statement:
      'Rosey\'s per-Ruby gain is PERMANENT in every phase: a gain earned in combat carries back to the Shop board at settle, '
      + 'the way an Engraved minion keeps its combat gains (the printed "permanently" overrides the combat-only default of '
      + 'R-BUFF-PHASE-01).',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner confirmed 2026-10-22 (via the coordinator)', quote: 'Rosey\'s "permanently" carries combat gains back to the Shop, like Engraved.' },
      { kind: 'code', ref: 'packages/core/src/effects/factories.ts playRubyOn (Rosey: combatArena.buffPermanent, permaGain)' },
    ],
    contentIds: ['k3_rosey'],
    currentBehaviour: 'Conforms (owner confirmed 2026-10-22).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Kobolds1022.test.ts'], lastVerifiedAt: '2026-10-22' },
  },
  {
    id: 'R-KOBOLD-1022-05',
    title: 'Frack Attack counts every friendly attack, each Flurry swing included',
    statement:
      'Frack Attack\'s "Repeat after 3 friendly attacks" meter counts EVERY attack a friendly minion makes, Frack itself '
      + 'included, and a Flurry minion\'s swings count one by one.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner confirmed 2026-10-22 (via the coordinator)', quote: 'Frack Attack\'s 3-attack counter counts every friendly attack, including each Flurry swing.' },
      { kind: 'code', ref: 'packages/core/src/effects/factories.ts friendlyAttacksPlayRubiesSelf (the onAttack bus fires per swing)' },
    ],
    contentIds: ['k3_frackattack'],
    currentBehaviour: 'Conforms (owner confirmed 2026-10-22).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Kobolds1022.test.ts'], lastVerifiedAt: '2026-10-22' },
  },
  {
    id: 'R-KOBOLD-1022-06',
    title: 'Counters under a card are plain integers N/M, never words (Rosey\'s Refresh meter first)',
    statement:
      'Every step counter under a card reads as the plain integer N/M and counts UP (1/3, 2/3, 3/3 when it pays, then 1/3), '
      + 'like Avenge. No counter prints a word. Rosey\'s "Improves every 3 Refreshes" meter (shared with Hellrider and Indy) '
      + 'read "1 Refresh" and now reads N/3; the End-of-Turn "every N turns" cadences read "2 Turns" and now read N/M. The '
      + 'rune meters dropped theirs too: Rune of Unity "3/5 types" is 3/5, and the turn cadences (Rune of the Deep, Happy '
      + 'Birthday, Merry Christmas, the cadenced grants) "1/2 turns" are 1/2. Value readouts that are not a progress meter '
      + '(a rune\'s "+3 Health", "N left", a hero power\'s "2t") are out of scope.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner bug report 2026-10-22 (Rosey screenshot, "1 Refresh")', quote: 'change rosey to our typical x/3 setup. we dont want to show \'refreshes\' etc in our counter text' },
      { kind: 'code', ref: 'packages/ui/src/cardText.ts stepProgress (the refresh + cadence branches); packages/ui/src/runeTally.ts' },
    ],
    contentIds: ['k3_rosey', 'n3_indy'],
    currentBehaviour: 'Conforms (fixed 2026-10-22). Rosey, Hellrider and Indy printed "N Refreshes" and the turn cadences "N Turns".',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/stepProgress.test.ts', 'packages/ui/src/set3Kobolds1022Text.test.ts'], lastVerifiedAt: '2026-10-22' },
  },
  {
    id: 'R-KOBOLD-1022-07',
    title: 'Frack Attack\'s N/3 counter ticks live in combat on every friendly swing',
    statement:
      'In combat, Frack Attack\'s counter under the card follows the sim\'s attackSeen meter: it climbs one per friendly '
      + 'attack (each Flurry swing included, never an enemy swing) while Frack lives, lands on 3/3 on the swing whose Ruby '
      + 'repeat follows (that repeat plays on its own beat, the ownBeat policy), and starts over at 0/3 on a Rise / Rebirth '
      + 'return. The combat replay mirrors the rule from the attack events, so the card never sits on a stale 0/3.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner bug report 2026-10-22', quote: 'frack attack\'s counter isnt working in combat, please fix that' },
      { kind: 'code', ref: 'packages/ui/src/useCombatReplay.ts computeFrame (the attack branch + countsFriendlyAttacks; reset in the reborn branch); packages/core/src/effects/factories.ts friendlyAttacksPlayRubiesSelf' },
    ],
    contentIds: ['k3_frackattack'],
    currentBehaviour: 'Conforms (fixed 2026-10-22). The replay only re-derived Crypt Drake\'s attackSeen, so Frack\'s combat counter never moved; the repeats themselves fired correctly.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/frackCombatCounter.test.ts', 'packages/sim/src/set3Kobolds1022.test.ts'], lastVerifiedAt: '2026-10-22' },
  },
  {
    id: 'R-DRAGON-NITROGEN-01',
    title: 'Nitrogen casts Growth whenever a friendly Dragon attacks (gilded: twice)',
    statement:
      'Nitrogen (Set 3, T5 6/6 Dragon): every swing by a friendly Dragon, its own included (dual-tribe and '
      + 'All-types bodies count), casts the real Shop spell Growth through the combat named-spell path. It is a genuine '
      + 'spell cast announced from Nitrogen (counts toward spell tallies and wakes spell watchers), not a cast from hand. '
      + 'The Growth buff in combat lands on every friendly minion and is combat-only. A non-Dragon swing casts nothing. '
      + 'Gilded casts Growth twice per Dragon swing. An enemy Nitrogen behaves identically.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ask 2026-10-23', quote: 'add dragon to set 3 and wire art: * Nitrogen T5 6/6 When a Dragon attacks, Cast Growth. * gilded casts twice.' },
      { kind: 'code', ref: 'packages/content/src/cards/set3/dragons.ts d3_nitrogen; packages/core/src/effects/arena.ts onTribeAttackCastNamedSpell' },
    ],
    contentIds: ['d3_nitrogen'],
    currentBehaviour: 'Conforms (built 2026-10-23).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Nitrogen1023.test.ts'], lastVerifiedAt: '2026-10-23' },
  },
  {
    id: 'R-SPELLONTHIS-SHOP-01',
    title: 'A Shop spell cast on a minion in the Shop fires its "cast on this" reactions, once per instance per turn',
    statement:
      'Mirrorwing ("The first Shop spell you cast on this each turn casts again") works wherever the minion is: a '
      + 'targeted Shop spell cast on a Mirrorwing OFFER in the Shop casts again on that offer, exactly as on the board '
      + '(a full re-cast, scaled by the cast multiplier; Gilded casts 2 additional times; the Inspect ledger shows both '
      + 'casts). The "first Shop spell each turn" count is per instance: the offer keeps its own count, the count rides '
      + 'onto the body when it is bought (so a Mirrorwing that already re-cast in the Shop this turn does not re-cast '
      + 'again on the board that turn), and it re-arms at Start of Turn (a frozen or held offer too). The same path '
      + 'serves every `spellCastOnThis` reaction (Crash Course, Reflector); Tamby stays board-only by its own guard, '
      + 'and Rune of Shared Reflection spreads only from a BOARD Mirrorwing (an offer has no adjacent Dragons).',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Player report relayed by the owner 2026-10-23 (Lemon, Discord)', quote: 'when in shop mirrorwing doesnt procc' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts castSpellOnOffer (fires fireOnSpellCastOnThis on the offer stand-in) / recastOn / foldOfferCast; packages/sim/src/reducer.ts the buy carry + Start of Turn reset; packages/sim/src/state.ts ShopCard.spellsOnThisTurn' },
    ],
    contentIds: ['d2_mirrorwing', 'ce3_adept', 'n2_reflector', 'rune_shared_reflection'],
    currentBehaviour: 'Conforms (fix/mirrorwing-shop-offer, 2026-10-23). Before, `castSpell` only told a BOARD target a spell landed on it, so a Spirit Fire on a Mirrorwing offer resolved once.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/mirrorwingShopOffer.test.ts'], lastVerifiedAt: '2026-10-23' },
  },
  {
    id: 'R-CONDUCTOR-RUNWIDE-01',
    title: 'Every trigger of a Conductor Shout improves EVERY Conductor by +3/+3 for the rest of the game',
    statement:
      'Conductor\'s Shout gives its adjacent minions +(3 + N)/+(3 + N) (Gilded doubles that grant) and THEN raises N, '
      + 'the run-wide Conductor improvement, by +3 (x Rune of Mastery; Gilded does not double the step). N is shared by '
      + 'every Conductor wherever it is (Shop, Discover, hand, board, one found later), so the first trigger of the game '
      + 'gives +3/+3, the next +6/+6, then +9/+9. EVERY trigger steps it: the play and any re-trigger of the Shout (Moira, '
      + 'Ryme, Dawnclaw, a hero power, an extra Shout trigger, a combat re-fire). In combat the adjacent grant is '
      + 'combat-only but the step is PERMANENT: it carries back at settle, so the next Shop shows the improved value. Each '
      + 'combat side uses its own run\'s N (a recorded board serves the value it had) and an enemy\'s growth never reaches '
      + 'the player. Every surface prints the live grant. A legacy per-copy accrual from the 2026-09-23 design still pays on top.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ask 2026-10-24 (Conductor)', quote: 'every played conductor should buff every other conductor\'s buff. so if one conductor is played, the next conductor found gets the increases buff from it' },
      { kind: 'owner-chat', ref: 'Owner correction 2026-10-24 (Conductor step)', quote: 'no, it improves by +3/+3 each trigger of the shout.' },
      { kind: 'owner-chat', ref: 'Owner ruling 2026-10-24 (Conductor in combat)', quote: 'so if it gets triggered in combat, those stats won\'t be permanently granted, but the improvement would be.' },
      { kind: 'code', ref: 'packages/core/src/effects/arena.ts battlecryConductorAdjacent (conductorTally / growConductor); packages/core/src/combat/simulate.ts conductorLive + ShoutCarry.conductorBuff; packages/sim/src/reducer.ts settle fold; packages/ui/src/cardText.ts conductorText' },
    ],
    contentIds: ['n2_conductor'],
    currentBehaviour: 'Conforms from 2026-10-24. Before it each copy improved only itself by +1/+1 per fire (2026-09-23 design).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/conductorCombat.test.ts', 'packages/sim/src/run.test.ts'], lastVerifiedAt: '2026-10-24' },
  },
  {
    id: 'R-SET2-BAL-1024-01',
    title: 'Set 2 balance 2026-10-24: Tunneller Rik, Cave Cutter, Scrapper, Gem Carver, Beev, Big Huggies, Big Brain Billy',
    statement:
      'Tunneller Rik (T3 3/4 Rally): Rally gets ONE random Ruby (any of the six types, R-RAND-02), Gilded 2; in combat it is '
      + 'carried back to hand by type. Cave Cutter (T4 5/3): Choose One, give your Rubies +1/+1 (run-wide Ruby strength; Gilded '
      + '+2/+2) or get 4 plain Rubies (Gilded 8). Scrapper: T2 3/1 Kobold, Echo: your Rubies gain +1 Attack (Gilded +2), no '
      + 'Health, in the Shop and carried back from combat. Gem Carver: Tier 4, nothing else changes. Beev (T3 4/4): when a '
      + 'friendly Beast attacks (Beev included), give it and Beev +2/+1 (Gilded +4/+2), combat-only in combat (R-BUFF-PHASE-01), '
      + 'permanent on a Shop Rally replay. Big Huggies (T4 5/2 Taunt): Echo gets 2 Staves of Guel (Gilded 4), in the Shop and '
      + 'from combat. Big Brain Billy (T2 2/2): +2/+2 per Shop spell cast (Gilded +4/+4).',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner balance 2026-10-24 (Set 2)', quote: 'set 2 balance adjustment: * tunneller rik -> rally: get a random ruby * cave cutter -> choose one: give your rubies +1/+1 or get 4 rubies * Scrapper -> T2, stats to 3/1 echo: your rubies gain +1 attack * gem carver -> T4 * beev -> when a beast attacks give it and this +2/+1 * big huggies -> taunt. echo: get 2 staff of guels * big brain billy -> buff to +2/+2' },
      { kind: 'code', ref: 'packages/content/src/cards/set2/kobolds.ts k_tunnelcharger / k_veinbreaker / k_faultline / k_gemheart; packages/content/src/cards/set2/beasts.ts b2_beev; packages/content/src/cards/set2/demons.ts dm_velvet; packages/content/src/cards/set2/dwarves.ts dw_bigbrainbilly' },
    ],
    contentIds: ['k_tunnelcharger', 'k_veinbreaker', 'k_faultline', 'k_gemheart', 'b2_beev', 'dm_velvet', 'dw_bigbrainbilly'],
    currentBehaviour: 'Conforms from 2026-10-24. Before: Rik 2 random Rubies; Cave Cutter +2/+1; Scrapper T3 5/1 +1/+1; Gem Carver T3; Beev +2/+2; Big Huggies 2 Picnics; Billy +1/+1.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set2Balance1024.test.ts'], lastVerifiedAt: '2026-10-24' },
  },
];
