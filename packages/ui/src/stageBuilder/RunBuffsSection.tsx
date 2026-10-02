import { useMemo, useState } from 'react';
import {
  GAUNTLET_BUFF_FIELDS, GAUNTLET_BUFF_GROUPS, buffSourceRound, effectiveBuffs, isBuffPair, isZeroBuff,
  type GauntletBuffField, type GauntletBuffPair, type GauntletBuffs, type GauntletStage,
} from '@game/content';
import { Sec } from '../SceneBuilder';
import { setRoundBuff } from './stageDraft';

/**
 * The Stage Builder's RUN BUFFS section (owner ask 2026-10-02: "kobolds buff gems throughout a match, but theres no
 * way for me to reflect that, so rubys stay at 1/1"). One row per run-wide scaler, grouped by tribe/theme, showing the
 * value IN FORCE on the selected round. Buffs carry forward: a value the round does not set is inherited (dimmed,
 * "from round N"); typing sets an override on THIS round; ✕ clears it back to the inherited value. Every edit goes
 * through `editDraft`, so the round turns dirty and the sandbox pin re-builds with the new scalers.
 */

const ONLY_KEY = 'ascent.stb.buffsOnly';
function loadOnly(): boolean {
  try { return localStorage.getItem(ONLY_KEY) === '1'; } catch { return false; }
}

/** A whole-number field ≥ 0 whose draft is a local string, so clearing it to retype never fights you (the
 *  `StatBadgeField` rule): each parsable keystroke commits at once; blur drops the draft. */
function BuffNum({ value, label, onCommit }: { value: number; label: string; onCommit: (n: number) => void }) {
  // The draft remembers the value it was typed against: when the value moves for another reason (✕ cleared the
  // override, another round was selected) a stale draft is ignored rather than masking the real value.
  const [draft, setDraft] = useState<{ text: string; at: number } | null>(null);
  return (
    <input className="sb-search stb-buffin" type="number" min={0} step={1} inputMode="numeric"
      value={draft && draft.at === value ? draft.text : String(value)} aria-label={label}
      onChange={(e) => {
        const text = e.target.value;
        const n = Number(text);
        const ok = text.trim() !== '' && Number.isFinite(n);
        const next = ok ? Math.max(0, Math.round(n)) : value;
        setDraft({ text, at: next });
        if (ok) onCommit(next);
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); } }} />
  );
}

export function RunBuffsSection({ draft, round, edit, folded, onFold }: {
  draft: GauntletStage;
  round: number;
  edit: (fn: (s: GauntletStage) => GauntletStage) => void;
  folded: Record<string, boolean>;
  onFold: (id: string, closed: boolean) => void;
}) {
  const [onlyActive, setOnlyActive] = useState(loadOnly);
  const toggleOnly = (on: boolean): void => {
    setOnlyActive(on);
    try { localStorage.setItem(ONLY_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  };
  const eff = useMemo(() => effectiveBuffs(draft, round), [draft, round]);
  const own = draft.rounds[round - 1]?.buffs ?? {};
  const inForce = GAUNTLET_BUFF_FIELDS.filter((f) => !isZeroBuff(eff[f.key])).length;
  const visible = (f: GauntletBuffField): boolean => !onlyActive || own[f.key] !== undefined || !isZeroBuff(eff[f.key]);

  const set = <K extends keyof GauntletBuffs>(key: K, value: GauntletBuffs[K] | undefined): void =>
    edit((s) => setRoundBuff(s, round, key, value));

  return (
    <Sec id="buffs" title="Run buffs" folded={folded} onFold={onFold}
      right={<span className="sb-count" aria-label={`${inForce} run buffs in force on round ${round}`}>{inForce} in force</span>}>
      <label className="sb-row stb-buffonly">
        <input type="checkbox" checked={onlyActive} onChange={(e) => toggleOnly(e.target.checked)} />
        <span className="sb-mini">show only buffs in force</span>
      </label>
      {GAUNTLET_BUFF_GROUPS.map((group) => {
        const fields = GAUNTLET_BUFF_FIELDS.filter((f) => f.group === group && visible(f));
        if (fields.length === 0) return null;
        return (
          <div key={group} className="stb-buffgroup" data-group={group}>
            <div className="sb-mini stb-buffgh">{group}</div>
            {fields.map((f) => {
              const overridden = own[f.key] !== undefined;
              const src = overridden ? round : buffSourceRound(draft, round, f.key);
              const v = eff[f.key];
              const zero = isZeroBuff(v);
              return (
                <div key={f.key} data-buff={f.key} className={`sb-row stb-buff${overridden ? ' set' : ' inherited'}${zero ? ' zero' : ''}`}>
                  <span className="stb-buffname" aria-description={f.hint}>{f.label}</span>
                  {isBuffPair(v) ? (
                    <span className="stb-buffpair">
                      <BuffNum value={v.attack} label={`${f.label} Attack`} onCommit={(n) => set(f.key, { attack: n, health: (v as GauntletBuffPair).health } as GauntletBuffs[typeof f.key])} />
                      <span className="stb-buffslash" aria-hidden>/</span>
                      <BuffNum value={v.health} label={`${f.label} Health`} onCommit={(n) => set(f.key, { attack: (v as GauntletBuffPair).attack, health: n } as GauntletBuffs[typeof f.key])} />
                    </span>
                  ) : (
                    <BuffNum value={v} label={f.label} onCommit={(n) => set(f.key, n as GauntletBuffs[typeof f.key])} />
                  )}
                  <span className="stb-bufftail">
                    {overridden ? (
                      <button type="button" className="sb-btn stb-ico stb-x stb-buffclear" onClick={() => set(f.key, undefined)}
                        aria-label={`Clear round ${round}'s ${f.label} (back to the inherited value)`}>✕</button>
                    ) : (
                      <span className="sb-mini stb-bufffrom">{src !== null ? `from round ${src}` : ''}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
      {onlyActive && inForce === 0 && Object.keys(own).length === 0 && (
        <div className="sb-empty">no buffs in force on round {round} — untick to set one</div>
      )}
    </Sec>
  );
}
