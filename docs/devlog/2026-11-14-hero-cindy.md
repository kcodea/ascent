# 2026-11-14 — Cindy, a Duos-only hero (Golden Gratitude)

Owner design: Cindy, Duos only, 30 Health, 10 Armor. **Golden Gratitude** (0 Gold, once per game): "The next minion
your teammate buys gives you a **Gilded** copy of it." Rule R-DUOS-CINDY-01.

## How it works

- The press arms it on Cindy's run (`cindyGratitude: 'armed'`) and queues a new `gratitude` TeamEffect. The teammate's
  run stores `duos.gratitude`. This follows the same shape as Gild Pact's `listen`.
- `gratitudeBuy` (`packages/sim/src/goldenGratitude.ts`) is called from both minion branches of the `buy` action (the
  normal offer and the held Swap re-buy), next to `magicHatBuy`. Every minion that leaves a Shop through a buy goes
  through one of them, whatever put it there (rune reward such as Golden Monkey, Discover into the Shop, Contraband).
  Spells (slot and row) and Starforms are skipped and leave it armed.
- The copy is the plain base card, Gilded with `gildMinion(copy)` and no run, so it adds no Gild count to the
  teammate. It travels as an effect pass (`via: 'sale'`, `gratitude` / wire `passGratitude`). It works like a Magic Hat
  copy: free, held for hand room, not a pass for the pass watchers. Its stream starts from the bought minion and
  shows the minion's face (`passFlightOf`).
- Cindy's run marks `paid` when the copy lands or is held, and stores the card id for the "spent" text.
- Reload: `replayRestore` replays Cindy's own arm row as `restoreEffectPass { gratitude: 'arm' }` and the teammate's
  copy row as `{ gratitude: 'pay' }`. Neither can arm or pay twice.

## Presentation

- Hero power line: once per game / waiting for your teammate / spent / needs a teammate. The rule text is live.
- While armed, the button wears `.hpb-gratitude` (a static gold shadow with breathing opacity). The teammate portrait
  (`DuosMateDock`) wears `.duosdock.gratitude` whenever the run on screen holds `duos.gratitude`. That run is the
  teammate's own board, or Cindy watching her teammate. Only opacity and transform animate in either glow.
- Voice: `audio/heroes/cindy.gratitude.mp3` ("A great big golden thank you in advance!", Jessica) through
  `sfx.cindyGratitude` on the Hero Select fader. It plays on Cindy's screen as the arm is sent (`playEntryFlight`) and
  on the teammate's screen as the arm row lands (`duosPasses.applyRows`), once each (`versus/gratitudeVoice.ts`). The
  hero-select line is `audio/heroes/cindy.mp3` ("Let's grab some gold."). Both clips are 44.1 kHz mono 128 kbps, about
  -23 LUFS (Magician's format).
- Art: `art/heroes/cindy.webp`, `art/powers/cindy.webp` (owner art, as drawn).

## Judgement calls

- A Starform buy does not pay it, because no minion leaves the Shop.
- The copy is the plain base Gilded card, with no buffs. This is the Gild convention.
- Out of Mimic / Void / Power Shifter (every `duosOnly` hero already is).
- The press is refused with no Duos state, the same as Passaria.

## Deploy note

The Versus Worker bundles `@game/sim` (hero deal + engine), so it needs a redeploy after merge before Cindy can be
dealt in Versus Duos / Ranked Duos.
