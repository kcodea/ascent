/**
 * BEAT SYSTEM PR 9 — Library mode, reorganized around CARDS/RUNES/QUESTS you recognize.
 *
 * Left: sources by NAME (search "Fleeting Vigor", not "spellPendingSCBuff"), each expanding to its trigger
 * moments with a coverage badge — CLASSIFIED (has a policy), silent, or EMPTY (a combat moment with no beat
 * at all, like Fleeting Vigor's Start of Combat). Right: the inspector for the selected trigger — numeric +
 * drag timing editing and a synthetic preview; for an EMPTY trigger it explains that emission is an engine
 * follow-up while still letting you record the intended timing. Per-source edit keys, so tuning one card never
 * moves a sibling.
 */
import { useMemo, useState } from 'react';
import { BatchPlayer, POLICY_TINT } from './BeatLab';
import { BeatTimelineStrip } from './BeatTimelineStrip';
import { sourceEntries, filterSources, fixtureBatchForTrigger, type SourceEntry, type TriggerRow, type SourceKind } from './sourceLibrary';
import { resolveBeatTiming, resolvePolicy, timingProvenance, type BeatTiming, type BeatTimingOverrides, type BeatPolicyOverrides } from './beatTiming';
import type { PresentationPolicy } from '@game/core';

const POLICIES: PresentationPolicy[] = ['ownBeat', 'foldedCue', 'passive', 'intentionallySilent'];

const FIELDS: Array<{ f: keyof BeatTiming; label: string }> = [
  { f: 'windupMs', label: 'Wind-up' }, { f: 'holdMs', label: 'Hold' }, { f: 'recoveryMs', label: 'Recovery' },
];
const KINDS: Array<{ k: SourceKind; label: string }> = [
  { k: 'minion', label: 'Minions' }, { k: 'spell', label: 'Spells' }, { k: 'rune', label: 'Runes' }, { k: 'quest', label: 'Quests' }, { k: 'hero', label: 'Heroes' },
];
const COVER_TINT: Record<string, string> = { classified: '#7fd18a', silent: '#8a93a8', empty: '#e0b34d' };
const COVER_LABEL: Record<string, string> = { classified: 'beat', silent: 'silent', empty: 'EMPTY' };

export function BeatLibrary({ draft, setDraft, policyDraft, setPolicyDraft }: {
  draft: BeatTimingOverrides;
  setDraft: React.Dispatch<React.SetStateAction<BeatTimingOverrides>>;
  policyDraft: BeatPolicyOverrides;
  setPolicyDraft: React.Dispatch<React.SetStateAction<BeatPolicyOverrides>>;
}): React.ReactElement {
  const all = useMemo(() => sourceEntries(), []);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SourceKind | null>(null);
  const [emptyOnly, setEmptyOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sel, setSel] = useState<{ sourceId: string; triggerId: string } | null>(null);

  const filtered = useMemo(() => filterSources(all, query, { kind, emptyOnly }), [all, query, kind, emptyOnly]);
  const emptyCount = useMemo(() => all.reduce((n, s) => n + s.triggers.filter((t) => t.coverage === 'empty').length, 0), [all]);

  const source: SourceEntry | null = sel ? all.find((s) => s.id === sel.sourceId) ?? null : null;
  const row: TriggerRow | null = source && sel ? source.triggers.find((t) => t.id === sel.triggerId) ?? null : null;

  const trig = source && row ? { source: { kind: (source.kind === 'spell' ? 'spell' : source.kind) as never, id: source.id }, trigger: row.trigger, policy: row.policy ?? 'ownBeat' } : null;
  const effective = trig ? resolveBeatTiming(trig, draft, policyDraft) : null;
  const prov = trig ? timingProvenance(trig, draft) : null;
  const effectivePolicy = trig ? resolvePolicy(trig, policyDraft) : null;
  const setPolicy = (p: PresentationPolicy): void => {
    if (!row) return;
    // Setting the effective policy back to the registry default clears the override rather than pinning it.
    setPolicyDraft((d) => {
      if (row.policy && p === row.policy) { const { [row.editKey]: _gone, ...rest } = d; return rest; }
      return { ...d, [row.editKey]: p };
    });
  };

  const edit = (f: keyof BeatTiming, value: number): void => {
    if (!row) return;
    setDraft((d) => ({ ...d, [row.editKey]: { ...d[row.editKey], [f]: Math.max(0, Math.round(value)) } }));
  };
  const setHold = (key: string, holdMs: number): void => setDraft((d) => ({ ...d, [key]: { ...d[key], holdMs } }));
  const resetSelected = (): void => {
    if (!row) return;
    setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== row.editKey)));
  };
  const hasEdit = !!(row && draft[row.editKey]);

  return (
    <div className="bl-lib">
      <div className="bl-lib-left">
        <div className="bl-lib-filters">
          <input className="bl-search" placeholder={`Search ${all.length} sources by name…`} value={query} onChange={(e) => setQuery(e.target.value)} />
          {KINDS.map(({ k, label }) => (
            <button key={k} className={`bl-tab${kind === k ? ' bl-tab-on' : ''}`} onClick={() => setKind(kind === k ? null : k)}>{label}</button>
          ))}
          <button className={`bl-tab${emptyOnly ? ' bl-tab-on' : ''}`} style={{ borderColor: COVER_TINT.empty }} onClick={() => setEmptyOnly((v) => !v)} title="Show only sources with an unassigned trigger">
            EMPTY ({emptyCount})
          </button>
          <span className="bl-kind">{filtered.length}</span>
        </div>
        <div className="bl-lib-list">
          {filtered.slice(0, 300).map((s) => {
            const open = openId === s.id || (!!query && filtered.length <= 30);
            return (
              <div key={s.id} className="bl-src">
                <div className={`bl-src-head${s.hasEmpty ? ' bl-has-empty' : ''}`} onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                  <span className="bl-src-caret">{open ? '▾' : '▸'}</span>
                  <span className="bl-source">{s.name}</span>
                  <span className="bl-kind">{s.kind}{s.tier != null ? ` · T${s.tier}` : ''}{s.tribe ? ` · ${s.tribe}` : ''}</span>
                  {s.hasEmpty && <span className="bl-cover" style={{ background: COVER_TINT.empty }}>has EMPTY</span>}
                </div>
                {open && s.triggers.map((t) => (
                  <div
                    key={t.id}
                    className={`bl-trig${sel?.sourceId === s.id && sel?.triggerId === t.id ? ' bl-selected' : ''}`}
                    onClick={() => { setSel({ sourceId: s.id, triggerId: t.id }); setOpenId(s.id); }}
                  >
                    <span className="bl-cover" style={{ background: COVER_TINT[t.coverage] }}>{COVER_LABEL[t.coverage]}</span>
                    <span className="bl-trig-moment">{t.moment}</span>
                    {t.policy && <span className="bl-policy" style={{ background: POLICY_TINT[t.policy] ?? '#666' }}>{t.policy}</span>}
                    {draft[t.editKey] && <span className="bl-draft">✎</span>}
                  </div>
                ))}
              </div>
            );
          })}
          {filtered.length > 300 && <div className="bl-empty">…{filtered.length - 300} more — narrow the search.</div>}
        </div>
      </div>
      <div className="bl-lib-right">
        {!row && <div className="bl-empty">Search a card by name, expand it, and pick a trigger to inspect or tune. The <b style={{ color: COVER_TINT.empty }}>EMPTY</b> filter shows the {emptyCount} triggers with no beat yet.</div>}
        {source && row && effective && prov && (
          <>
            <div className="bl-insp-head">
              <span className="bl-source">{source.name} — {row.moment}</span>
              <span className="bl-kind">{source.kind}:{source.id} · {row.factory ? `factory ${row.factory}` : 'derived (simulator)'}{row.family ? ` · family ${row.family}` : ''}</span>
              <span className="bl-kind">edits write to <code>{row.editKey}</code> (this {source.kind} only)</span>
            </div>
            {/* Policy toggle: flip folded ↔ own beat (etc.). Re-bases the timing and drives how it reads. */}
            <div className="bl-policy-row">
              <span>Policy</span>
              <select value={effectivePolicy ?? 'ownBeat'} onChange={(e) => setPolicy(e.target.value as PresentationPolicy)}>
                {POLICIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <span className="bl-prov">
                {policyDraft[row.editKey]
                  ? `override (was ${row.policy ?? 'unclassified'})`
                  : `registry default${row.policy ? ` · ${row.policy}` : ''}`}
              </span>
            </div>
            {row.coverage === 'empty' && (
              <div className="bl-empty-banner">
                <b>EMPTY trigger — no beat emitted yet.</b> This is a combat moment the simulator applies silently
                (e.g. a next-combat buff landing at Start of Combat). Setting a timing here records the INTENDED
                beat; making it actually play needs a one-line engine change to emit the source-attributed event
                (a follow-up). The preview below shows how it would read.
              </div>
            )}
            <div className="bl-insp-fields">
              {FIELDS.map(({ f, label }) => (
                <label key={f} className="bl-field">
                  <span>{label}</span>
                  <input type="number" min={0} step={10} value={effective[f]} onChange={(e) => edit(f, Number(e.target.value))} />
                  <span className="bl-prov">{prov[f]}</span>
                </label>
              ))}
              {hasEdit && <button className="bl-tbtn" onClick={resetSelected}>Reset to inherited</button>}
            </div>
            <BeatTimelineStrip batch={fixtureBatchForTrigger(source, row)} overrides={draft} policyOverrides={policyDraft} editKey={row.editKey} onHoldChange={setHold} />
            <div className="bl-fixture-banner">SYNTHETIC PREVIEW — fixture targets, not game state</div>
            <BatchPlayer batch={fixtureBatchForTrigger(source, row)} overrides={draft} policyOverrides={policyDraft} resetKey={`${source.id}:${row.id}|${JSON.stringify(draft[row.editKey] ?? {})}|${effectivePolicy}`} />
          </>
        )}
      </div>
    </div>
  );
}
