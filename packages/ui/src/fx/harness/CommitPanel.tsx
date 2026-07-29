import { CARD_INDEX } from '@game/content';
import type { FxBinding } from '../../choreo/bindings';
import type { CommitPlan } from './commitPlan';

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
}

const refLabel = (cardId: string | null, kind: string): string =>
  cardId === null ? `every ${kind}` : `${CARD_INDEX[cardId]?.name ?? cardId} · ${kind}`;

export function CommitPanel({
  plan, missing, scope, onScopeChange, fanOut, onFanOutChange, busy, error, note, onCommit,
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
