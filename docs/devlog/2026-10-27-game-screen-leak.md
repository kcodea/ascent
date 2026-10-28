# 2026-10-27 — Every finished game's screen stayed in memory (a paused lunge, and the perf ring)

The owner: "sometimes interactions just start to feel chopppy even when im not moving that quickly ... like memory or
cpu issues?" Found with the new soak mode of the perf gauntlet (`npm run perf:gauntlet -- --games 5`, PR #2341). It
plays the same seeded Dwarf Practice game five times in ONE page. After each game it runs a full garbage collection
and records the JS heap, DOM nodes, event listeners and the shop's frame times.

**Before.** Every game left ~1,100 DOM nodes and ~450 event listeners alive. Over five games the counts climbed from
4,061 nodes / 1,216 listeners to 7,618 / 2,621. Shop work per frame in the buy-and-play turn climbed from 4.9 to
7.3 ms (+49%) for the identical game. (An overlapping harness run on the same machine adds noise to that last column;
the node and listener counts are unaffected.)

**Finding it.** The page itself held only ~500 elements, so the growth was DETACHED DOM: elements already removed
from the page that JavaScript still referenced. To find which:
- `Runtime.queryObjects(Element.prototype)` grouped the detached elements by the root of their detached tree. Whole
  `div.app` trees topped the list: every previous game's screen.
- A heap snapshot's shortest retainer path from one of those roots gave the two holders below.

**Holder 1: a lunge timeline nobody killed.**
- The chain: `window` → gsap's global timeline → a lunge timeline's `onUpdate` → the lunge callbacks (`onContact`,
  `onRallyPulse`, `onImpactAuras`) → the shop screen's scope → a ref holding a GSAP Flip state (`elementStates`) →
  the old warband row → the old `.app`.
- A held-windup lunge (`holdAfterWindup`, lunge.ts) parks itself as a PAUSED timeline, and a paused timeline stays in
  gsap's global timeline until it is resumed or killed.
- The replay's per-fight reset killed the tracked park. But leaving the game unmounts the replay with no next fight,
  and at least one release path drops its reference without a kill.
- Fix: `playLunge` registers every lunge in `liveLunges` until it completes (`onComplete`) or is killed
  (`onInterrupt`), and the replay's unmount calls `killLiveLunges()`.

**Holder 2: the perf monitor's input-event ring.**
- `perfEventRing.ts` kept a strong reference to each of its last 32 input events' DOM targets (for long-task
  attribution). Each one kept the whole screen around it alive until 32 newer events overwrote the slot.
- Fix: targets are held through `WeakRef`, and `lastBefore` derefs them.

**After.** The same five-game soak: +~50 nodes and +~25 listeners a game, so old screens are freed. Rule
R-PERF-LUNGE-LEAK-01; test `packages/ui/src/choreo/parkedLungeLeak.test.ts`.

**Still to watch.** The heap still rises ~1.5 MB a game in the soak. That may be warm-up (compiled code, caches) rather
than a leak; a longer soak would tell. The perf monitor's 1-second DOM scan and its never-reset bucket history are
untouched here.
