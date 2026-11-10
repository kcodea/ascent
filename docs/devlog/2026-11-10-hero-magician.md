# 2026-11-10: Magician, a Duos-only hero whose hat copies a bought card to the teammate

Owner asks, in order: "Create new duos hero: magician - 8 armor, magic hat - when you buy 5 cards, your hat is activated.
The next card you buy, your teammate gets a copy of it." Then: "Add a counter for magician and when it activates, the hero
power should get an obvious animation / glow that it's going to fire. You can use the hero power ready animation for
this". Then: "Add a twice per turn max to magician". Then: "Make sure the pass animation fires when this happens too".

## The rule, as built (`packages/sim/src/magicHat.ts`)

- `magicHatBuy(s, bought, srcUid)` is called from every `buy` branch of the reducer (the spell slot, a spell in the minion
  row, a Starform, a re-bought displaced minion, the ordinary minion buy). A hook wired to only one buy route is the
  recurring bug in that file, so all five carry it. Nothing else calls it, so a Discover, a gift, a pass or a token never
  counts.
- State is three run fields: `magicHatBuys` (0..5, carries across turns) and `magicHatSent` + `magicHatSentWave` (copies
  sent on that turn). The per-turn count is stamped with its turn, so nothing has to run at the turn flip: a stamp from
  an earlier turn reads 0. `magicHatView` is the one read (count, copies left, `active`, `capped`) that the buy, the
  power's text, the counter badge and the ready glow all share.
- Active = 5 buys AND a copy left this turn. The buy made while active sends the copy, puts the count at 0 and does not
  count toward the next 5. Past the cap, buys still count up to 5 and stop; the full hat is active again the moment the
  turn number changes.
- The copy is `structuredClone` of the card as it sits in the hand right after the buy (offer buffs, tribe auras, Golden
  Touch), under its own uid (`hat<n>`). In the minion branch the hook runs BEFORE `checkTriples`, so a buy that completes
  a triple still copies the plain card that was bought.

## The copy's route: the pass channel, without the pass rules

The copy is an outbox entry `{ via: 'sale', hat: true }`. `via: 'sale'` already means exactly what a copy needs: free, may
be Golden, never refused for a full hand (it waits in the teammate's `duos.waiting`), and a room refusal returns nothing
(the Magician keeps the card they bought, so there is nothing to give back). On the wire it is `passFrom: 'sale'` plus
`passHat: true`, so **the Worker's pass handler needed no change**.

What is kept separate from a pass:

- The sender records it with `recordSpellPass` directly, not `effectPassCard`, so `fireTeamPassTriggers` does not run.
- The receiver's `receivePass` skips `fireTeamPassTriggers` for a `passHat` card.
- No Gold moves on either run.

What is shared with a pass, on purpose: the server's exactly-once-per-seq row, the receiver's `received` key (a second
delivery changes nothing), the 10 card passes per round cap, and all of the presentation.

## Presentation (reused, nothing authored)

- **Sender.** `duosAfterRun` ships the entry and calls `playEntryFlight`, as for every effect send. `passFlightOf` maps a
  `hat` entry to the Shop offer that was bought (`src.uid`, still on screen inside the commit): a copy of its face
  dissolves there and the existing `duos-pass-send` stream flies into the teammate portrait. With no card element to
  leave from, the stream leaves the hero power button instead.
- **Receiver.** Nothing new: the row lands through `receivePass`, the new hand card carries its pass key, and
  `playArrival` plays the existing arrival. A full hand shows the existing "cards waiting" pill.
- **Watching.** `watchedPasses` already turns a new outbox entry of the watched run into a send and a new pass-keyed
  hand card into an arrival, so a teammate viewing the Magician's board, and the stands, see both.
- **The power.** `magicHatBadge` (`packages/ui/src/magicHatUi.ts`) feeds `StatusBar`: the counter pill above the power
  ("3/5"), and the existing `ready` classes on the panel and the button while the hat is active in the Shop. That is the
  READY CALL exactly as authored; the power stays `passive` and disabled. Turning active plays the existing one-shot
  refresh bloom; the send plays the existing hero power burst. No new CSS, no new looping animation, no art.

## Reload

A reload drops the turn's unlocked actions, so the buys that filled and fired the hat are gone while the teammate keeps
the copy. The restore replay sees the server's `passHat` rows and dispatches `restoreEffectPass { hat: true }`: nothing
leaves the run, the copy counts against the turn's two again and the hat starts over. So a reload can never get a third
copy out of one turn. It can still re-fill the hat from 0 with re-bought cards inside the cap, the same way a reload
gives back any Gold spent since the last lock.

## Recorded teams

Ranked Duos serves recorded teams as board snapshots per round (`rounds[].sides`), never as a replayed run. A recorded
Magician is a hero id on a snapshot: no reducer runs for it, so no copy is sent, owed or dropped, and whatever the hat
gave during the recording is already inside the recorded teammate's boards. Pinned by `heroMagician.test.ts` (snapshot
round trip, a Duos round with Magician seats resolved twice to the same bytes).

## Live check (local stack, two headless browsers)

`scripts/versus-qa/magician-hat.mjs` drives a Ranked Duos party against `wrangler dev` with every non-local host
blocked at the resolver. Seen, across two rounds: the counter at 3/5; the ready call at 5/5 on the Magician's screen and
on the teammate's view of that board; the copy streaming from the bought Shop card into the teammate portrait and
coalescing in the teammate's hand (screencast bursts on both screens); two copies in a turn, then a full hat at 5/5
with no glow; no glow in the fight; the full hat active again as turn 2 opens; a copy sent while the teammate was
watching the Magician's board landing when they came back; a copy to a full hand waiting ("Hand full: 1 card waiting")
and landing when room was made.

One thing that is the same for every pass today, and so for the hat: a Duos player who is VIEWING their teammate's
board does not see that teammate's send stream (`watchedPassFlights` plays sends only for the stands). They see the
counter reset, the hat's burst and the bought card land, and the copy arrives with the normal arrival the moment they
are back on their own screen. Streaming sends into the "Back to your board" portrait on that view would be a change to
all passes, so it is left as a follow-up.

## Left for the owner

- Art is owed: the hero portrait and the Magic Hat power icon. Both use the game's no-art fallback until they exist.
- Magic Hat is out of the Mimic / Void / Power Shifter pools (every Duos-only hero is). Confirm that is wanted.
- The Versus Worker deals the heroes from the bundled content, so it needs a redeploy before a live Duos game can offer
  Magician. The pass handler itself is unchanged.
