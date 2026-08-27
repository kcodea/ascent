# Order ambiguities — proposed triage questions

Found while building the order goldens (`packages/sim/src/docbot/orderGoldens.test.ts`, 2026-08-26). Each
golden **pins the current behaviour** so a silent flip fails loudly; the entries below are the orderings that
seemed genuinely ambiguous or surprising while staging them — where the pinned behaviour might not be the
*ruled* behaviour. They are written in the owner board's card format (verbatim context, concrete example,
explicit click semantics) so they can be lifted onto the board as-is. **The rules seeder was deliberately not
touched** — these are proposals, not seeded questions.

---

## q-order-clash-echo-defender-first — mutual kill: the DEFENDER's Echo resolves first

- **Current behaviour:** When an attacker and its defender die in the same clash, the **defender's** death
  (and therefore its Echo) resolves before the attacker's — on both sides of the board (golden G3 proves it
  keys on the defender role, not on the player side).
- **Alternative reading:** Attacker-first — the acting minion's consequences resolve before the reaction's.
  This is the convention most players import from other autobattlers, so defender-first may read as a bug to
  anyone counting Echo order in a replay.
- **Why it matters (concrete example):** Player Mama Pup attacks enemy Mama Pup; both die. Today the
  **enemy's** Pups hit the board first, so they also take/receive the next trades first. If both sides race
  to fill the last board slots (Echo armies near the 7-cap), whoever's Echo fires first fills them.
- **Proposed question:** "A mutual-kill clash resolves the defender's Echo before the attacker's. Should it?
  — ✓ Approve = defender-first is the rule (document it in GAME-RULES). ✎ Revise = your ruling, in a
  sentence. ✕ Reject = attacker-first is intended — this is a bug (flipping it changes replays)."

## q-order-soc-player-side-first — Start of Combat: player side always resolves first

- **Current behaviour:** ALL of the player side's Start-of-Combat effects resolve before any of the enemy's,
  regardless of which side holds the first attack (golden G2: the enemy has initiative, the player's SoC
  still fires first).
- **Alternative reading:** Initiative-side-first — the side that attacks first also resolves SoC first
  (the Battlegrounds convention), or strict alternation.
- **Why it matters (concrete example):** Enemy Speed Demon's SoC grants +50% stats; player SoC damage
  (e.g. an archived Dawnfire-style opener) could kill the enemy demon **before** it grants — but only under
  player-first. Under initiative-first the same board resolves differently whenever the enemy out-boards
  you. Note `simulate()` is authoritative for BOTH seats in a lobby pairing, so "player side" here is really
  "whichever seat was passed first" — seat order silently decides SoC priority in mirror matches.
- **Proposed question:** "Start of Combat resolves the whole player/first-passed side before the enemy side,
  even when the enemy attacks first. Should it? — ✓ Approve = fixed side order is the rule. ✎ Revise = your
  ruling (e.g. initiative-side-first), in a sentence. ✕ Reject = this is a bug — tie SoC order to
  initiative."

## q-order-improve-steps-mid-resolution — improving grants step DURING a simultaneous wave

- **Current behaviour:** An improving on-summon grant (Beardsley: +3/+3, improving +3 every 3 Beasts)
  advances its step **mid-resolution**: when one Cleave kills two Mama Pups at once, the 4th Pup of that
  same simultaneous wave already receives +6/+6 while the first three got +3/+3 (golden G4).
- **Alternative reading:** Magnitudes lock when the trigger wave starts — everything that dies/summons
  "simultaneously" is paid at the same rate, and the step only advances between waves.
- **Why it matters (concrete example):** Two golden Mama Pups behind a Beardsley: whether the last Pup gets
  the stepped grant is worth +3/+3 of real stats, and the card text ("improve every 3") does not say when
  the step is read. The same question governs Den Mother's shop-side twin (next entry).
- **Proposed question:** "Improving grants re-read their step for every individual summon, even within one
  simultaneous death wave. Should they? — ✓ Approve = live steps are the rule (texts stay as printed).
  ✎ Revise = your ruling, in a sentence. ✕ Reject = steps should lock per wave — this is a bug."

## q-order-shop-aura-before-shout — shop: summon-buffs land before the played minion's own Shout

- **Current behaviour:** Playing a minion fires on-summon auras on it **before** its own Battlecry resolves
  (`playCard`: `fire('onSummon')` precedes the `onPlay` loop). Combined with an improving aura this is
  outcome-bearing: Den Mother gives the played Pennycat the base +2/+2, improves to +4/+4, and Pennycat's
  Shout-summoned Stray then receives the LARGER +4/+4 (golden G6).
- **Alternative reading:** Shout-first (the played card's own text resolves before passive watchers), under
  which the Stray gets +2/+2 and Pennycat +4/+4 — or "same wave, same rate", under which both get +2/+2.
- **Why it matters (concrete example):** Den Mother + any Shout summoner: today the TOKEN outgrows the card
  you actually played. Players tracking Den Mother's counter will see it advance one step per body but pay
  the improved rate to the battlecry token first, which is easy to read as a mispayment.
- **Proposed question:** "On a play, on-summon auras (and their improve steps) resolve before the played
  minion's own Shout. Should they? — ✓ Approve = aura-first is the rule. ✎ Revise = your ruling, in a
  sentence. ✕ Reject = Shout-first is intended — this is a bug (the token should get the base grant)."
