# The Auctioneer's Pulse gets its effect and its sound

**Owner (2026-08-30):** an authored FX definition and a clip
(`SFX/Hero Sound Effects/Auctioneer/auctioneerhp.mp3`), with one instruction: *"the effect should be played on
the target minion"*.

## What was already there, and what was not

`packages/ui/src/fx/defs/auctioneer-hp.json` existed **in the working copy** — byte-identical in every
parameter to the JSON the owner pasted (900 ms, four layers: two `burst`, two `shockwave`, all anchored
`target`). The FX editor had written it and the owner had tuned it.

Two things were missing, and the second was only caught by CI:

1. **Nothing in the codebase referenced it.** A grep for `auctioneer-hp` outside the def file returned
   nothing, so the effect had never played once. The pasted JSON carries `"id": "workbench"` — the editor's
   scratch id — the tell that it was authored and saved but never bound.
2. **The def was never committed.** `git ls-files` came back empty and `git status` showed it as `??`: it was
   untracked, not ignored. It existed only on the owner's disk.

The second one is worth dwelling on, because the local run could not have found it. Every local check passed
— typecheck, 7840 tests, lint, and the effect firing on screen — precisely because the file *was* on disk.
CI clones clean, so it saw what a teammate would see and failed with `code plays defs that do not exist:
auctioneer-hp`. That guard is the only thing standing between "works on my machine" and an effect that
crashes for everyone else, and it earned its keep here.

## Bound to the Pulse, on the target

The Auctioneer (hero id `myra`, power `replayBattlecry` — *"Trigger a friendly minion's Shout"*) fires through
the shared aim gesture in `Recruit.tsx`, which until now played one generic `hero-power-target` spark at the
click point for every targeted power.

The Auctioneer now plays `auctioneer-hp` **instead of** that generic spark — a judgment call worth stating:
its def is two particle bursts plus two shockwaves, and stacking the generic burst underneath reads as two
effects fired by accident rather than one authored moment.

**Anchored on the minion, not the pointer.** The ask was "played on the target minion", and every layer in the
def anchors `target`, so the click point — which can land anywhere on a card, including a corner — is the
wrong origin. The card's rect centre is used instead, found with the same selector `minionAt` used to identify
the target, so the two cannot disagree about what a targetable minion is.

**The uid travels too.** `playDefUids.test.ts` refuses a `playDef` at a unit that does not pass one, and it is
right to: every layer here is Pixi today and needs only coordinates, but a def that omits the uid keeps
working right up until someone adds a `react` layer, which then animates nobody. That defect shipped three
times in one day, which is why the guard exists.

## The sound

`auctioneerhp.mp3` copied into `packages/ui/src/audio/`, where the eager glob registers it by basename. Added
as `sfx.auctioneerPower()` — hero-power specific rather than the generic `pulse`, with a synth fallback like
every other cue.

## Two registries caught the change, as designed

`directCalls.ts` is a committed snapshot of a scan over `packages/ui/src`, re-derived on every `npm test`.
Adding the call made it stale and CI named the def and the file. Its companion list of known ids in
`directCalls.test.ts` failed for the same reason. Both were updated rather than worked around — that
enforcement is the point of the mechanism.

## Verified live

Practice run as the Auctioneer, one minion on the board, power aimed and fired with a real mouse drag:

- **63 display objects spawned into the FX layer** on the fire (measured by wrapping the layer's `addChild`),
  and again on a second fire the next turn — the effect is playing, not merely wired.
- Screenshot shows the burst centred on the target minion.
- The clip resolves from the dev server, so the glob picked it up.

One incidental finding worth writing down: the shop turn timer expires while setting a scenario up by hand,
and `timeUp` blocks the hero-power fire path entirely — the first three attempts did nothing for that reason
alone. Practice's 4× timer option is the way to hold a board still long enough to test a targeted power.
