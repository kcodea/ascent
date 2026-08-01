import { CARD_INDEX } from '@game/content';
import type { FxBinding, UnbindOp } from '../../choreo/bindings';
import { SeedBakeWarning } from '../ui/SeedBakeWarning';
import type { CommitPlan } from './commitPlan';
import type { UnbindPlan } from './unbindPlan';

/**
 * The "commit animation" control: turn the live draft into a committed def plus a committed binding.
 *
 * Renders a `CommitPlan` and nothing else — every decision was made in `planCommit`, which is pure and
 * tested. This repo has no jsdom, so logic left here could not be tested at all.
 */
export interface CommitPanelProps {
  /** Null when a card or a moment has yet to be chosen — `missing` explains which. */
  plan: CommitPlan | null;
  missing: string | null;
  scope: 'card' | 'global';
  onScopeChange: (scope: 'card' | 'global') => void;
  fanOut: FxBinding['fanOut'];
  onFanOutChange: (fanOut: FxBinding['fanOut']) => void;
  busy: boolean;
  error: string | null;
  note: string | null;
  onCommit: () => void;
  /**
   * Seed-lock state, threaded down purely so the seed-bake warning can render HERE too.
   *
   * `commit()` writes the same `seedLocked ? seed : undefined` that `save()` does, and Commit is the path that
   * matters more — it writes `bindings.json` and makes the effect live for real. The warning next to Save is
   * in `.fxwb-side`, a different independently-scrolling column from this panel's `.fxrail`, so it could be
   * scrolled out of view while an author commits a baked seed. See `SeedBakeWarning`.
   */
  seedLocked: boolean;
  seed: number;
  onUnlockSeed: () => void;
  /**
   * What is bound at the selected row right now, or null when nothing is.
   *
   * Null renders NOTHING rather than a disabled control: a permanently-present "Unbind" implies a binding
   * exists whenever a card and moment are selected, and most rows inherit rather than own one.
   */
  unbind: UnbindPlan | null;
  onUnbind: (op: UnbindOp) => void;
}

const refLabel = (cardId: string | null, kind: string): string =>
  cardId === null ? `every ${kind}` : `${CARD_INDEX[cardId]?.name ?? cardId} · ${kind}`;

const bindingLabel = (b: FxBinding): string => (b.fanOut === undefined ? b.def : `${b.def} · ${b.fanOut}`);

export function CommitPanel({
  plan, missing, scope, onScopeChange, fanOut, onFanOutChange, busy, error, note, onCommit,
  seedLocked, seed, onUnlockSeed, unbind, onUnbind,
}: CommitPanelProps): React.ReactElement {
  return (
    <div className="fxcommit">
      <div className="fxcommit-h">Commit animation</div>

      <div className="fxcommit-scope">
        <label>
          <input type="radio" checked={scope === 'card'} onChange={() => onScopeChange('card')} />
          This card only
        </label>
        <label>
          <input type="radio" checked={scope === 'global'} onChange={() => onScopeChange('global')} />
          Everywhere
        </label>
      </div>

      <label htmlFor="fxcommit-fanout" title="How many copies play, and on which units">Plays</label>
      <select
        id="fxcommit-fanout"
        value={fanOut ?? 'primary'}
        onChange={(e) => onFanOutChange(e.target.value as NonNullable<FxBinding['fanOut']>)}
      >
        <option value="primary">once, between the moment&apos;s two units</option>
        <option value="damaged">once per enemy damaged</option>
        <option value="selfBuffed">once per unit that buffed itself</option>
      </select>

      {plan !== null && (
        <div className="fxcommit-plan">
          <div>
            Writes <code>{plan.defId}.json</code>
            {plan.overwritesExisting && <span className="fxcommit-warn"> · overwrites existing</span>}
            {plan.forkedFrom !== null && <span className="fxcommit-note"> · forked from {plan.forkedFrom}</span>}
          </div>
          <div>Binds {refLabel(plan.bindingTarget.cardId, plan.bindingTarget.kind)}</div>
          {/* The blast radius. Shown BEFORE the button rather than confirmed after, because "I overwrote the
              shared one by accident" is unrecoverable once you've forgotten which numbers you changed. */}
          {plan.alsoAffects.length > 0 && (
            <div className="fxcommit-warn">
              Also changes: {plan.alsoAffects.map((r) => refLabel(r.cardId, r.kind)).join(', ')}
            </div>
          )}
        </div>
      )}

      {/* ── Currently bound ──────────────────────────────────────────────────────────────────────────────
          Below the commit plan and above the Commit button, and only when the selected row actually HAS a
          binding. Removing one used to mean hand-editing `bindings.json`, so the tool could create bindings
          and never take one back.

          Each removal states its outcome next to the button rather than after it, the same standard the
          "Also changes:" line sets — a write that reloads the page is not a thing to discover afterwards.
          The two outcomes are genuinely different on a card row (fall through to the kind default, versus
          play nothing at all), so both are offered and each says which; where they collapse `planUnbind`
          returns one option and there is nothing to choose between. */}
      {unbind !== null && (
        <div className="fxcommit-unbind">
          <div className="fxcommit-h">Currently bound</div>
          <div className="fxcommit-plan">
            <div>
              {refLabel(unbind.target.cardId, unbind.target.kind)} →{' '}
              {unbind.current === null ? <em>plays nothing</em> : <code>{bindingLabel(unbind.current)}</code>}
              <span className="fxcommit-note">
                {' '}· {unbind.source === 'file' ? 'in bindings.json' : 'this session, not committed'}
              </span>
            </div>
          </div>
          {unbind.options.map((o) => (
            <div className="fxcommit-unbind-row" key={o.op}>
              <button className="fxwb-btn" disabled={busy} onClick={() => onUnbind(o.op)}>
                {o.label}
              </button>
              <span className="fxcommit-note">{o.consequence}</span>
            </div>
          ))}
        </div>
      )}

      {/* Directly above the button that writes it — this panel is in its own scroll column, so the copy next
          to Save cannot be relied on to have been seen. */}
      <SeedBakeWarning
        seedLocked={seedLocked}
        seed={seed}
        onUnlock={onUnlockSeed}
        writeVerb="Committing"
      />

      {/* A blocked plan is still RENDERED above — the author needs to see which id their name produced to
          understand the refusal — but it can never be executed, so it disables the button exactly as an
          incomplete selection does. */}
      <button className="fxwb-btn" disabled={busy || plan === null || plan.blocked !== null} onClick={onCommit}>
        {busy ? 'Committing…' : 'Commit animation'}
      </button>
      {plan?.blocked != null && <p className="fxcommit-error">{plan.blocked}</p>}
      {missing !== null && <p className="fxcommit-missing">{missing}</p>}
      {error !== null && <p className="fxcommit-error">{error}</p>}
      {note !== null && <p className="fxcommit-note">{note}</p>}
    </div>
  );
}
