# 2026-11-12: Magician's hat takes 3 buys, copies a random one of them, and sends from the hat

Owner asks, in order:

- "Change magician to be 3 buys, and it passes a random minion from those 3 buys, so the pass will come from his hat hero
  power instead of the minion bought area"
- "The hat can send spells too, it's whatever 3 cards were 'put in his hat' so to speak" (so there is no minion
  preference: the pick is over all three cards)
- "Come up with 5 different pass lines that he can randomly say when triggering his hero power. The teammate should hear
  these lines too." The five recorded lines were then approved as they are ("Those are great").

The first write-up of the hero is `2026-11-10-hero-magician.md`. What it says about the copy's route, the receiver, the
recorded teams and the Worker is unchanged. This entry is what changed.

## The rule, as built (`packages/sim/src/magicHat.ts`)

- `MAGIC_HAT_BUYS` is 3. The same five `buy` branches call `magicHatBuy(s, bought)`; nothing else does.
- Each counted buy puts a `structuredClone` of the bought card into `RunState.magicHatCards` (the card as it sits in the
  hand right after the buy, before `checkTriples`). A Starform buy counts and puts nothing in.
- The buy that fills the hat fires it in the same action (`fireHat`): one card of `magicHatCards` is picked, cloned under
  a fresh `hat<n>` uid, and recorded as the outbox entry `{ via: 'sale', hat: true }`. The count goes to 0 and
  `magicHatCards` is cleared. There is no longer an "active, waiting for the next buy" state between filling and firing.
- The Magician keeps all three cards. Because the hat holds clones, playing, selling, buffing or tripling them later
  cannot change or cancel the copy.
- **The pick** is uniform over the cards in the hat, minions and spells alike. It is one `rng.int(n)` off the run cursor
  (`makeRng(s.rngCursor)` then `s.rngCursor = rng.state()`, the reducer's convention), so the same run replays the same
  pick. A hat holding one card draws nothing.
- `magicHatCards` is an ordinary run field: it is saved, restored and snapshotted with `magicHatBuys` (no field list
  needed a change). A save with cards in the hat, loaded again, picks the same card (tested).
- A spell needs nothing a minion did not. A bought spell is a plain `BoardCard` in the hand, the hat already copied
  bought spells under the old rule, and `receiveDuosPass` lands it as a spell (tested end to end: minion, spell, minion
  with the pick forced onto the spell).

`magicHatView` is still the one read for the buy, the text, the badge and the glow. `active` now means "the next card
bought sends a copy": one buy short of full (2/3), or full, with a copy left this turn. `full` is new on the view.

## Owner call still open: a hat that fills past the per-turn cap

Twice per turn is unchanged. With a hat that fires the moment it fills, "full but capped" needed a rule. Built:

- Past the cap, buys still go into the hat up to 3 and then stop. The hat keeps the first three cards that filled it.
- That hat fires on the **first buy of a later turn**, from the three cards it already holds. The buy that triggers it is
  not in that pick; it becomes the first card of the next hat (1/3).

Why this one: it needs no new turn-flip hook. The per-turn count is stamped with its turn (`magicHatSentWave`), so the
cap simply reads 0 on the next turn, exactly as before, and the reducer's only hat entry point stays the buy. The
alternative is to fire the held hat as the next turn opens (a Start of Turn beat). That is a small addition if wanted,
but it is a new trigger point with its own presentation timing, so it is left as a decision.

## Reload

Unchanged in shape: the restore replay dispatches `restoreEffectPass { hat: true }` for each `passHat` row the server
holds. `restoreMagicHatSend` now also clears `magicHatCards`, so each replayed copy counts against the turn and leaves an
empty hat. A reload cannot produce a third copy in a turn, including when the lock held a full hat carried over from a
capped turn (tested). The restore draws nothing off the run cursor.

## Ancients (dev only)

`ancientHatShape` still shapes the hat. Genesis ("needs 8 buys") now means the hat holds up to 8 cards and picks among
those 8; the Gilded minion / three spell copies apply to the picked card. Bonds (no cap) fires every third buy. The
pairing texts did not need a change. `ancientsMagician.test.ts` fills a whole hat with one offer where a test needs to
know which card is copied.

## Presentation

- **From the hat, showing the card** (`packages/ui/src/versus/hatSend.tsx`). `passFlightOf` maps every `hat` entry to
  `{ at: 'hat' }`, whatever `src` says. The copy's own face (drawn from the outbox entry's card, so it is right even if
  the bought card was already played or sold) rises out of the Magic Hat hero power button, holds about 0.6 s so it can
  be read, then `playDrop` does what it does for every send: the face fades, its plate dissolves, and the
  `duos-pass-send` stream flies into the teammate portrait. Nothing new is authored and nothing loops: one `Card` in its
  own React root inside the `.duoslob` / `.dragcard` context, one transform and opacity one-shot, two timers.
  `duosPassConfig` values are untouched. The module registers itself with `passLob.ts` (`setHatSender`) so the pass
  module stays free of React; `StatusBar.tsx` imports it.
- **Watching.** The stands get it through `watchedPassFlights` as before. A Duos player viewing the Magician's board now
  sees the hat send too (hat entries only; every other pass on that view is unchanged). The copy still lands with the
  normal arrival when they are back on their own screen.
- **Counter and glow.** The pill reads "x/3". The ready call shows at 2/3 with a copy left this turn (and on a full hat
  a new turn has uncapped), in the Shop only.
- **Text.** Fallback: `After you buy **3** cards, your teammate gets a copy of a random one. Twice per turn.` Live: the
  same with the count, `Your hat is **ready** (**2/3**). ...` when the next buy sends, and
  `**3/3**, sends on your first buy next turn` when capped.

## The five lines

Clips: `packages/ui/src/audio/heroes/magician.pass1.mp3` to `magician.pass5.mp3`, copied in order from the owner's
`pass1-is-this-your-card`, `pass2-pick-a-card`, `pass3-next-trick`, `pass4-nothing-up-my-sleeve` and
`pass5-abracadabra` recordings, each levelled once to the hero line target
(`normalizeFile(file, HERO_SELECT_LUFS)`). Replace a file to swap a line. They play on the Hero Select fader, like every
hero's spoken line (`sfx.magicianPass`).

`packages/ui/src/versus/hatLines.ts`:

- **Both players hear the same line.** The line is a pure function (a string hash) of the copy's uid, `hat<n>`. The
  sender reads it off its outbox entry. The teammate reads it off the pass row's card: the uid already rides the wire
  with the card. So there is no wire change, nothing in run state, and no random call on either client.
- **When.** Sender: as the copy starts to rise out of the hat. Teammate: the moment the pass row is taken on their own
  screen (the same moment the arrival plays), or, if they are viewing the Magician's board, with the hat send they see
  there.
- **Once per copy.** A uid that already spoke on this screen is silent. That covers a row delivered again, a teammate
  who saw the send on the Magician's board and then gets the row, and the Scene Builder (both runs on one page). A copy
  that waits for hand room speaks when its row arrives, not when it lands. A reload's restore says nothing.
- Not covered: someone in the stands watching the TEAMMATE's board sees the arrival but hears no line, because the landed
  card no longer says it came from a hat. Watching the Magician's board they hear it.

## Checked

- Unit: `heroMagician.test.ts` (third buy fires; uniform pick over all three including a spell that lands as a spell; the
  as-bought snapshot against a later buff, sale and triple; seeded pick, the same after save and load; the cap and the
  held hat; three reload cases), `ancientsMagician.test.ts`, `magicHat.test.tsx`, `versus/hatLines.test.ts` (the
  teammate's transport path).
- Headless Scene Builder Duos on a private dev server, with every non-local host blocked: 2/3 with the glow, the picked
  card's face at the hat, the stream into the teammate portrait, the copy in the teammate's hand, one line spoken.
- `scripts/versus-qa/magician-hat.mjs` was updated to the three-buy flow but NOT run (it needs the local Worker stack).
- Not checked by ear: the clips' loudness in the mix next to the other hero lines.

## Left for the owner

- The cap behaviour above.
- The Versus Worker bundles the content, so it needs a redeploy for the new hero text; the pass handler is unchanged.
