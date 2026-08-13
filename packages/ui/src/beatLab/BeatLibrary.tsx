/**
 * BEAT SYSTEM PR 7 — Library mode: browse and tune every registered beat WITHOUT playing a card.
 *
 * Left: the full policy registry (654 entries), searchable + policy-filterable. Right: the inspector for the
 * selected entry — effective windup/hold/recovery with per-field provenance (which override level supplies
 * it), numeric editing into the shared session draft, and a SYNTHETIC preview batch played through the same
 * scheduler/player Capture mode uses, so an edit is immediately watchable at real pace.
 */
import { useMemo, useState } from 'react';
import { BatchPlayer, POLICY_TINT } from './BeatLab';
import { fixtureBatch, filterRows, libraryRows, type LibraryRow } from './library';
import { resolveBeatTiming, timingProvenance, type BeatTiming, type BeatTimingOverrides } from './beatTiming';

const POLICIES = ['ownBeat', 'foldedCue', 'passive', 'intentionallySilent'] as const;
const FIELDS: Array<{ f: keyof BeatTiming; label: string }> = [
  { f: 'windupMs', label: 'Wind-up' },
  { f: 'holdMs', label: 'Hold' },
  { f: 'recoveryMs', label: 'Recovery' },
];

export function BeatLibrary({ draft, setDraft }: {
  draft: BeatTimingOverrides;
  setDraft: React.Dispatch<React.SetStateAction<BeatTimingOverrides>>;
}): React.ReactElement {
  const rows = useMemo(() => libraryRows(), []);
  const [query, setQuery] = useState('');
  const [policy, setPolicy] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const filtered = useMemo(() => filterRows(rows, query, policy), [rows, query, policy]);
  const selected: LibraryRow | null = useMemo(() => rows.find((r) => r.key === selectedKey) ?? null, [rows, selectedKey]);

  // The trigger-shaped identity the resolver keys on. For factory rows the source id is the FACTORY, which no
  // batch emits as a source — that's why their edits bind the family key (see library.ts).
  const trig = selected
    ? { source: { kind: (selected.kindPrefix === 'factory' ? 'minion' : selected.kindPrefix) as never, id: selected.id }, trigger: selected.trigger, policy: selected.entry.policy }
    : null;
  const effective = trig ? resolveBeatTiming(trig, draft) : null;
  const prov = trig ? timingProvenance(trig, draft) : null;

  const edit = (f: keyof BeatTiming, value: number): void => {
    if (!selected) return;
    setDraft((d) => ({ ...d, [selected.editKey]: { ...d[selected.editKey], [f]: Math.max(0, Math.round(value)) } }));
  };
  const resetSelected = (): void => {
    if (!selected) return;
    setDraft((d) => {
      const { [selected.editKey]: _gone, ...rest } = d;
      return rest;
    });
  };
  const hasEdit = !!(selected && draft[selected.editKey]);

  return (
    <div className="bl-lib">
      <div className="bl-lib-left">
        <div className="bl-lib-filters">
          <input
            className="bl-search"
            placeholder={`Search ${rows.length} beats…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {POLICIES.map((p) => (
            <button
              key={p}
              className={`bl-tab${policy === p ? ' bl-tab-on' : ''}`}
              style={{ borderColor: POLICY_TINT[p] }}
              onClick={() => setPolicy(policy === p ? null : p)}
            >{p}</button>
          ))}
          <span className="bl-kind">{filtered.length}</span>
        </div>
        <div className="bl-lib-list">
          {filtered.slice(0, 400).map((r) => (
            <div
              key={r.key}
              className={`bl-lib-row${r.key === selectedKey ? ' bl-selected' : ''}`}
              onClick={() => setSelectedKey(r.key)}
            >
              <span className="bl-policy" style={{ background: POLICY_TINT[r.entry.policy] ?? '#666' }}>{r.entry.policy}</span>
              <span className="bl-source">{r.id}</span>
              <span className="bl-kind">{r.kindPrefix}/{r.trigger} · {r.entry.family}</span>
              {draft[r.editKey] && <span className="bl-draft">✎</span>}
            </div>
          ))}
          {filtered.length > 400 && <div className="bl-empty">…{filtered.length - 400} more — narrow the search.</div>}
        </div>
      </div>
      <div className="bl-lib-right">
        {!selected && <div className="bl-empty">Select a beat to inspect and tune its timing.</div>}
        {selected && effective && prov && (
          <>
            <div className="bl-insp-head">
              <span className="bl-source">{selected.id}</span>
              <span className="bl-kind">{selected.key}</span>
              <span className="bl-kind">family: {selected.entry.family}{selected.entry.reason ? ` · ${selected.entry.reason}` : ''}</span>
              <span className="bl-kind">
                edits write to <code>{selected.editKey}</code>
                {selected.editsWholeFamily ? ' — the whole family (a factory has no per-card source key)' : ''}
              </span>
            </div>
            <div className="bl-insp-fields">
              {FIELDS.map(({ f, label }) => (
                <label key={f} className="bl-field">
                  <span>{label}</span>
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={effective[f]}
                    onChange={(e) => edit(f, Number(e.target.value))}
                  />
                  <span className="bl-prov">{prov[f]}</span>
                </label>
              ))}
              {hasEdit && <button className="bl-tbtn" onClick={resetSelected}>Reset to inherited</button>}
            </div>
            <div className="bl-fixture-banner">SYNTHETIC PREVIEW — fixture targets, not game state</div>
            <BatchPlayer batch={fixtureBatch(selected)} overrides={draft} resetKey={`${selected.key}|${JSON.stringify(draft[selected.editKey] ?? {})}`} />
          </>
        )}
      </div>
    </div>
  );
}
