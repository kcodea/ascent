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
  const boardCards = useGame((s) => {
    const board = s.run?.board ?? [];
    return [...new Set(board.map((m) => m.cardId))];
  });

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
   */
  const stage = (): void => {
    const run = useGame.getState().run;
    if (!run) return;
    const board = sandbagBoard(run.wave, spec);
    useGame.setState({
      run: {
        ...run,
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
          proc gets to fire at all. */}
      <label htmlFor="fxh-hp">Sandbag HP</label>
      <input id="fxh-hp" type="range" min={1} max={200} step={1}
        value={spec.hp} onChange={(e) => setSpec({ ...spec, hp: Number(e.target.value) })} />
      <span className="fxharness-val">{spec.hp}</span>

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
