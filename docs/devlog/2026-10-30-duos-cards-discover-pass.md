# 2026-10-30 · Duos cards: Disco, Matchmaker, CueBee + effect passes wait for hand room

Branch `feat/duos-cards-discover-pass`, on the #2468 foundation. Rules R-DUOS-CARDS-05, R-DUOS-EFFECT-PASS-QUEUE-01.

## The cards

- **Disco** (T5 spell, 4): a minion Discover with a Duos rider (`DiscoverSpec.duos: 'rest'`). `takeDiscoverPick` reads the
  open offer's `discoverDuos` (same one-shot lifecycle as `discoverLockTier`) and queues one `gift { cardId }` team effect
  per option not taken. Deterministic: the offer comes from the sender's RNG; the gifts carry exact ids.
- **Matchmaker** (T3 3/2 neutral): Shout `discoverMateTribePass` opens a `pool` Discover (`duos: 'pass'`) of the set's Duos
  pool, any tribe the set has (NOT narrowed to the sender's run tribes: the teammate rolled their own), up to the Shop tier,
  of the teammate's most common type. The pick goes out through `effectPassCard(..., 'hand')`. Gilded: twice. Combat
  re-fire: a `giftTeammate { mateTribe }` sent in real time (R-DUOS-RUNES-02; no Discover / pass mid-fight).
- **CueBee** (T4 6/6 neutral): `grantWhisper` naming `duo_w_pass` with `goldenCopies` (Gilded = 2 plain Passes, since a
  Pass has no magnitude). `duo_w_pass` lives in `cards/duos/whispers.ts` (`DUOS_WHISPERS`), outside `DUOS_CARDS` so it never
  joins the Duos Shop spell pool; it is in `WHISPER_IDS`, tier 4 from CueBee. The reducer's Whisper branch now accepts a
  Shop-minion target for an `any` Whisper (`castSpellOnOffer`) and honours `targetNoGolden`. The pass animation is the
  existing spell-pass stream (`playSpellPass`, fired by `duosAfterRun` for every `via: 'spell'` entry).

## The teammate's most common type on the SENDER's run

The sender's run has no copy of the teammate's board. Chosen design: a recorded action `noteMateTribes { tribes }`
(minions per tribe of the TEAMMATE's run, `mateTribeCounts` with the shared `isTribe`), stored on `duos.mateTribes`. The
client feeds it (`duosNoteMate`, duosPasses.ts) from the teammate's live spectator frame, after my run changes and when a
teammate frame arrives, ONLY when the counts changed and only while a Matchmaker is in hand or on board
(`runReadsMateTribes`), so ordinary Duos games record nothing extra. The reducer handles it with a shallow update (no
draft clone). Replays reproduce it because it is an action. `mostCommonMateTribe`: most wins, ties a seeded pick, never
seen = the sender's own tribes tie.

## Effect passes wait for room (owner ruling 2026-10-30)

"if your teammate's hand is full, they get the card once there is space in their hand". An effect pass
(`passFrom: 'spell'`) arriving to a full hand (or behind one already waiting) is RECEIVED (answered landed) and kept on
`duos.waiting`; `landWaitingPasses` (run in `reduce` after every action) moves them into the hand in order as room
appears, then `checkTriples`. The Worker no longer applies the hand-room refusal to `spell` passes. The client reports
hand room minus waiting cards, so a manual drag is refused up front. The teammate portrait shows "Hand full: N cards
waiting" (`.duosdock-note` pill). Manual passes are unchanged.

Golden override: the runes PR's `effectPassCard(..., { allowGolden: true, via: 'sale' })` (`passFrom: 'sale'`); the Worker's
hand-room skip covers `sale` as well as `spell`, and the receiver queues both.

## Open / flagged

- Matchmaker's tribe is not printed live on the card (a tribe, not a magnitude; ties are random).
- Every card GIFT (Disco's leftovers, Antsy, Toot Toot, Tribe Bundle, Bratworst, Monstrocity, Gold Pouch, Shoutful Bounty /
  Echoing Results) also waits in `duos.waiting` (lead ruling 2026-10-30, same owner quote): what fits lands now, the rest is
  rolled at arrival on the receiver's RNG and waits (no pass key: a gift is not a pass). Not cards (Gold, max Gold, Triple
  Reward, upgrade discount) are unaffected. The golden override is the runes PR's `via: 'sale'` (Salesman of the Year), which
  waits like any effect pass; my earlier `passGolden` flag was dropped in its favour.
- In a Duos run Jar of Secrets / Woozy can roll Pass (its owner CueBee is in the Duos pool).
