/**
 * THE DIALS OF THE RAPID-INPUT PRESENTATION (R-PERF-APM-01), in one place.
 *
 * While the player acts three or more times a second in the Shop (`fx/actionPressure.ts`), the game presents the
 * newest action in short form so nothing queues behind the input. Each line below is one part of that short form and
 * can be turned off or retuned on its own. On a bench build (`VITE_PERF_BENCH=1`) the object is on
 * `window.__bench.rapidFx`, so `npm run perf:apm -- --rapid '{"dedupe":false}'` measures one bundle with and without
 * a part. Player builds read the values here and nothing writes them.
 *
 * None of it applies at up to two actions a second: there every effect, roll and wave plays exactly as authored.
 */
export const RAPID_FX = {
  /** A stat change lands at once, with the badge's one pop, instead of being withheld for a roll; the numbers an
   *  earlier action was still rolling in land with it (`fx/statHold.ts`). */
  snapStats: true,
  /** A new action drops the paced steps (later buff waves, chain links) of earlier actions that have not started
   *  (`fx/shopFxQueue.ts`). */
  dropStale: true,
  /** One live play of an effect per recipient (`fx/rapidPlay.ts`). */
  dedupe: true,
  /** With `dedupe`: a same-effect, same-recipient fire inside this many ms of the last is the same moment. */
  coalesceMs: 250,
  /** Effects play faster the faster the player acts: `actions a second / 3`, capped here (1 = never faster). At
   *  three actions a second they play at their authored speed; from about five, at this cap. A faster play is a
   *  shorter one, so fewer are alive at once. */
  maxSpeed: 1.6,
  /** ...and carry fewer particles: `3 / actions a second`, floored here (1 = never thinner). */
  minIntensity: 0.6,
};

/**
 * The shared stat roll steps at most this often (R-PERF-APM-02): 60 times a second. NOT part of the rapid form: it
 * holds at every speed, because a 60 Hz display already showed exactly this.
 */
export const STAT_ROLL = { stepMs: 1000 / 60 };
