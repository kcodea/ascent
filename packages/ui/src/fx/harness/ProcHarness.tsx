import { useMemo, useState } from 'react';
import { CARD_INDEX } from '@game/content';
import type { RunState } from '@game/sim';
import { useGame } from '../../store';
import { sandbagBoard, SANDBAG_LIMITS, type SandbagSpec } from './procStage';
import { scanProcs, type ProcMoment } from './procScan';

/**
 * The proc harness: stage a controlled fight, find the moments a card caused, and replay any of them.
 *
 * Hosted by the workbench in rail mode so tuning and watching happen without a context switch — the whole
 * point is the loop "tune a param → watch it on the real card → tune again", which a separate window breaks.
 *
 * Deliberately thin. Everything worth testing lives in `procScan.ts` and `procStage.ts`, because this repo
 * has no jsdom and a component test cannot run.
 */
export interface ProcHarnessProps {
  /** Jump the live replay to a moment index (from `useCombatReplay`). */
  onSeek: (index: number) => void;
  /** The fight currently loaded in the replay, or null when none has been staged yet. */
  combat: RunState['lastCombat'];
}

const DEFAULT_SANDBAGS: SandbagSpec = { count: 4, hp: 40, attack: 1 };

export function ProcHarness({ onSeek, combat }: ProcHarnessProps): React.ReactElement {
  const [cardId, setCardId] = useState('');
  const [spec, setSpec] = useState<SandbagSpec>(DEFAULT_SANDBAGS);
  const [runUp, setRunUp] = useState(2);
  const [staged, setStaged] = useState(false);

  // Only cards actually on the board can proc — offering the whole index would let you pick a card that
  // cannot possibly appear in the fight you are about to stage, and then wonder why the list is empty.
  //
  // The dedupe is a `useMemo` OUTSIDE the selector, not inside it. Zustand's `useSyncExternalStore` compares
  // each snapshot by reference, so a selector that builds a fresh array every call never settles: React
  // re-reads, sees a new identity, re-renders, forever. That is not a slow render — it throws
  // "Maximum update depth exceeded" and the ErrorBoundary tears the whole game down the instant rail mode
  // opens (seen live 2026-07-28). Select the board's own stable reference, derive from it here.
  const board = useGame((s) => s.run?.board);
  const boardCards = useMemo(() => [...new Set((board ?? []).map((m) => m.cardId))], [board]);

  const procs: ProcMoment[] = useMemo(
    () => (combat && cardId ? scanProcs(combat, cardId) : []),
    [combat, cardId],
  );

  /**
   * Pin the sandbag board at the current wave, then run the real combat dispatch.
   *
   * A served board's `tier` feeds loss damage directly (`simulate.ts`: `enemyState.tier +
   * Σ(survivor tiers)`, `sandbagBoard` uses the max tavern tier for parity with SceneBuilder), so a handful
   * of lost harness fights would otherwise burn through a run's ~30 Resolve and end the sandbox — which
   * would present as "the tool broke", not "you ran out of Resolve". Restoring Resolve to the run's own max
   * as part of every stage() call undoes any loss from the PREVIOUS staged fight before the next one runs,
   * so re-staging is unbounded on that axis.
   *
   * The wave is NOT reset back. `faceOmen` reads `s.wave` for both the served-board lookup and the
   * loss-damage tier math, and `advanceCombat` (fired later by the real replay-finish flow, not by this
   * dispatch) increments it and ends the run once `s.wave >= CONFIG.courseRounds` (17). Winding the wave
   * back to keep staging alive forever would re-arm every wave-keyed side effect in `advanceCombat`
   * (Money Bot's Gold curve, the wave-6/7/9 Runeforge offers, `secondHand`'s "every 3rd wave" grant, …) each
   * time it passed those waves again — a bigger and less predictable disruption than the ceiling itself.
   * So this DOES still leave a ~17-stage ceiling per sandbox run: Resolve stops being the limiter, but the
   * course length isn't. Starting a fresh sandbox run (Scene Builder's hero/set pickers already do this)
   * resets the wave for another ~17 stages. Acceptable for a dev-only harness.
   *
   * `phase` is reset to `'recruit'` in the SAME `setState`, alongside `resolve` — this is load-bearing, not
   * defensive noise. `reduceCore` (reducer.ts:482) drops every dispatch outright once `phase` is
   * `'gameover'`/`'victory'`, and `faceOmen` itself only runs in `phase === 'recruit'` (:485). A staged fight
   * that goes to 0 Resolve flips `s.resolve <= 0` in `advanceCombat` to `'gameover'` BEFORE the wave is
   * touched (:2237) — restoring `resolve` alone left `phase` at `'gameover'`, so the very next `faceOmen`
   * dispatch was silently swallowed and `stage()` re-scanned the stale previous fight, indistinguishable from
   * a genuine empty scan. The same silent no-op happens if Stage is clicked again while the last staged
   * fight is still `phase === 'combat'` (never watched/settled). Forcing `phase: 'recruit'` here makes
   * `faceOmen` always eligible to run regardless of what the previous stage left behind.
   *
   * Nothing else needs resetting for `faceOmen` to be accepted: `combatSettled` is set unconditionally by
   * `faceOmen` itself (reducer.ts:1704), and `pendingTarget` is specifically EXEMPTED from the modal-block
   * check for `faceOmen` (`endTurnEscapesAim`, :502) — it auto-resolves onto the highest-Attack legal carry
   * rather than blocking. The other modal fields (`discover`/`chooseOne`/`questOffer`/`runeforgeOffer`/
   * `scoutedNextOpponent`, `modalOpen()` in recruit.ts) are deliberately left alone: they can only be set
   * while `phase === 'recruit'` (every action that opens one is itself phase-gated), so they can't be a
   * stale leftover from a previous STAGE the way `phase`/`resolve` can — and if one is genuinely open (the
   * user had a live Discover pending in the real game), that's real game state whose semantics `faceOmen`
   * should honor exactly as a normal End Turn would, not blow away.
   */
  const stage = (): void => {
    const run = useGame.getState().run;
    if (!run) return;
    const board = sandbagBoard(run.wave, spec);
    useGame.setState({
      run: {
        ...run,
        phase: 'recruit',
        resolve: run.maxResolve,
        servedBoards: { ...(run.servedBoards ?? {}), [run.wave]: board },
      },
    });
    useGame.getState().dispatch({ type: 'faceOmen' });
    setStaged(true);
  };

  return (
    <div className="fxharness">
      <div className="fxharness-h">🎯 Proc harness</div>

      <label htmlFor="fxh-card">Card</label>
      <select id="fxh-card" value={cardId} onChange={(e) => setCardId(e.target.value)}>
        <option value="">— pick a card on your board —</option>
        {boardCards.map((id) => (
          <option key={id} value={id}>{CARD_INDEX[id]?.name ?? id}</option>
        ))}
      </select>

      <label htmlFor="fxh-count">Sandbags</label>
      <input id="fxh-count" type="range" min={1} max={SANDBAG_LIMITS.maxCount} step={1}
        value={spec.count} onChange={(e) => setSpec({ ...spec, count: Number(e.target.value) })} />
      <span className="fxharness-val">{spec.count}</span>

      {/* Health is the real knob: it sets how LONG the fight runs, which is what decides whether a periodic
          proc gets to fire at all. The slider tops out at 200, well under `SANDBAG_LIMITS.maxHp` (9999) —
          that ceiling is `sandbagBoard`'s safety clamp against garbage input, not an ergonomic range,
          and nobody drags a slider to 9999 to test a proc. Deliberate divergence; don't "fix" the two
          numbers into agreement. */}
      <label htmlFor="fxh-hp">Sandbag HP</label>
      <input id="fxh-hp" type="range" min={1} max={200} step={1}
        value={spec.hp} onChange={(e) => setSpec({ ...spec, hp: Number(e.target.value) })} />
      <span className="fxharness-val">{spec.hp}</span>

      {/* Same deliberate divergence as HP above: 20 is a usable range, `SANDBAG_LIMITS.maxAttack` (99) is
          the clamp. */}
      <label htmlFor="fxh-atk">Sandbag Attack</label>
      <input id="fxh-atk" type="range" min={0} max={20} step={1}
        value={spec.attack} onChange={(e) => setSpec({ ...spec, attack: Number(e.target.value) })} />
      <span className="fxharness-val">{spec.attack}</span>

      <button className="fxwb-btn" onClick={stage}>Stage fight</button>

      <label htmlFor="fxh-runup" title="How many beats before the moment to start from, so you see it in context">
        Run-up
      </label>
      <input id="fxh-runup" type="range" min={0} max={8} step={1}
        value={runUp} onChange={(e) => setRunUp(Number(e.target.value))} />
      <span className="fxharness-val">{runUp} beats</span>

      <div className="fxharness-list">
        {procs.map((p) => (
          <button
            key={p.index}
            className="fxharness-row"
            onClick={() => onSeek(Math.max(0, p.index - runUp))}
          >
            <span className="fxharness-kind">{p.kind}</span>
            {p.boundDef === null ? (
              <span className="fxharness-unbound">nothing bound</span>
            ) : (
              <span className="fxharness-def">{p.boundDef}</span>
            )}
          </button>
        ))}
        {/* Loud about the empty case, on purpose. An empty list reads identically to "the scan is broken",
            and every significant defect in this subsystem so far has presented as "nothing happened". */}
        {staged && cardId !== '' && procs.length === 0 && (
          <p className="fxharness-empty">
            No moments from {CARD_INDEX[cardId]?.name ?? cardId} in this fight. Try more sandbag HP so the
            fight runs longer, or check the card is on your board.
          </p>
        )}
        {!staged && <p className="fxharness-empty">Stage a fight to see this card&apos;s moments.</p>}
      </div>
    </div>
  );
}
