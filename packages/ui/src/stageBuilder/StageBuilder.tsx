import { useCallback, useMemo, useRef, useState } from 'react';
import {
  CARD_INDEX, EPIC_RUNES, GAUNTLET_BOARD_MAX, GAUNTLET_STAGES, RUNES, stageDrift, validateStage,
  type GauntletRound, type GauntletStage,
} from '@game/content';
import { GAUNTLET_DEFAULT_TIERS } from '@game/sim';
import type { Keyword } from '@game/core';
import { useGame } from '../store';
import { useDraggablePanel, DevPanelContext } from '../useDraggablePanel';
import { SceneBuilder, Sec } from '../SceneBuilder';
import { SceneBuilderPreview, type SbPreviewTarget } from '../SceneBuilderPreview';
import { StatBadgeField } from '../StatBadgeField';
import { EDITABLE_KEYWORDS, KEYWORD_LABEL } from '../UnitEditor';
import { toStage } from '../stage';
import { useStageBuilder } from './stageBuilderStore';
import {
  addMinion as addToRound, copyPreviousRound, moveMinion, removeMinion, setMinionStats, toggleAddedKeyword,
  toggleMinionGolden, without,
} from './stageDraft';
import { searchMinions } from './minionSearch';
import { runeActsForOpponent } from './runeEffect';
import { StageBoardCanvas } from './StageBoardCanvas';
import { RunBuffsSection } from './RunBuffsSection';

/**
 * DEV-only STAGE BUILDER panel — authors a Gauntlet stage's OPPONENT warband round by round. All state lives in
 * `stageBuilderStore.ts`; this is the input surface, beside the full-stage board canvas (`StageBoardCanvas.tsx`,
 * the visual editor). Every edit goes through `editDraft`, shaped by the pure `stageDraft.ts` helpers, so the two
 * surfaces always show the same draft. Sections: Stage (slot + opponent name) · Rounds (dirty dot, red =
 * `validateStage` issue, amber = `stageDrift`) · Round N (tier + the ≤7 minions + a card search) · Run buffs (the
 * round's run-wide scalers, carried forward — `RunBuffsSection.tsx`) · Runes (rounds 6 and 9) · Actions.
 *
 * Mounted lazily by Game.tsx through `SandboxDevPanels` (DEV + sandbox), so neither this nor its store reaches the
 * player chunk. Wears the Scene Builder's slate (`.scenebuilder`) plus a few `.stb-*` pieces in styles.css.
 */

const RUNE_OPTIONS = [...RUNES, ...EPIC_RUNES]
  .map((r) => ({ id: r.id, name: r.name, epic: !!r.epic }))
  .sort((a, b) => Number(a.epic) - Number(b.epic) || a.name.localeCompare(b.name));

/** The round a `validateStage` line is about: "round 3…" (rule checks) or "rounds.2.…" (schema paths, 0-based). */
function issueRound(issue: string): number | null {
  const rule = /^round (\d+)\b/.exec(issue);
  if (rule) return Number(rule[1]);
  const path = /^rounds\.(\d+)\b/.exec(issue);
  return path ? Number(path[1]) + 1 : null;
}

const withRound = (s: GauntletStage, round: number, fn: (r: GauntletRound) => GauntletRound): GauntletStage =>
  ({ ...s, rounds: s.rounds.map((r, i) => (i === round - 1 ? fn(r) : r)) });

const SB_FOLD_KEY = 'ascent.stb.fold';
function loadFolded(): Record<string, boolean> {
  try { return (JSON.parse(localStorage.getItem(SB_FOLD_KEY) || '{}') as Record<string, boolean>) ?? {}; } catch { return {}; }
}

/** Outer shell: owns the arm-to-confirm Close so the injected ✕ (DevPanelContext) and the Close button share it. */
export function StageBuilder() {
  const close = useStageBuilder((s) => s.close);
  const [confirming, setConfirming] = useState(false);
  const requestClose = useCallback((): void => {
    if (useStageBuilder.getState().dirtyRounds().length > 0) setConfirming(true);
    else close();
  }, [close]);
  return (
    <DevPanelContext.Provider value={{ close: requestClose }}>
      <StageBuilderInner confirming={confirming} setConfirming={setConfirming} requestClose={requestClose} />
    </DevPanelContext.Provider>
  );
}

/**
 * What Game.tsx mounts beside a sandbox run: the Scene Builder panel normally, and — once the Stage Builder is
 * opened from the title — the board canvas + this panel INSTEAD (owner 2026-09-29: the stage is authored purely as
 * the opponent's boards, so the sandbox's own panel, warband and shop have no part in it).
 */
export function SandboxDevPanels() {
  const open = useStageBuilder((s) => s.open);
  if (!open) return <SceneBuilder />;
  return (
    <>
      <StageBoardCanvas />
      <StageBuilder />
    </>
  );
}

function StageBuilderInner({ confirming, setConfirming, requestClose }: {
  confirming: boolean; setConfirming: (on: boolean) => void; requestClose: () => void;
}) {
  const run = useGame((s) => s.run);
  const { stageNumber, saved, draft, round, status } = useStageBuilder();
  const { selectStage, selectRound, editDraft, discard, save, close } = useStageBuilder.getState();
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('stagebuilder');
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const [portraitQuery, setPortraitQuery] = useState('');
  const [preview, setPreview] = useState<SbPreviewTarget | null>(null);
  const [runeOpen, setRuneOpen] = useState<'round6' | 'round9' | null>(null);
  const [folded, setFolded] = useState<Record<string, boolean>>(loadFolded);
  const fold = (id: string, closed: boolean): void => setFolded((f) => {
    const next = { ...f, [id]: closed };
    try { localStorage.setItem(SB_FOLD_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  // Derived from the draft; recomputed only when it changes (a stat keystroke is one recompute, not per render).
  const dirty = useMemo(() => useStageBuilder.getState().dirtyRounds(), [draft, saved]);
  const issues = useMemo(() => (draft ? validateStage(draft) : []), [draft]);
  const drift = useMemo(() => (draft ? stageDrift(draft) : []), [draft]);
  const issueRounds = useMemo(() => new Set(issues.map(issueRound).filter((n): n is number => n !== null)), [issues]);
  const driftRounds = useMemo(() => new Set(drift.map((d) => d.round)), [drift]);
  const driftSlots = useMemo(() => new Set(drift.filter((d) => d.round === round).map((d) => d.index)), [drift, round]);
  // The first full pass builds a scratch run per rune (~25 ms for all of them, measured) — once per session.
  const runeActs = useMemo(() => new Map(RUNE_OPTIONS.map((r) => [r.id, runeActsForOpponent(r.id)])), []);

  const results = useMemo(() => searchMinions(query), [query]);
  const portraitResults = useMemo(() => searchMinions(portraitQuery).slice(0, 8), [portraitQuery]);

  const previewRow = useCallback((kind: 'card' | 'rune', id: string, el: HTMLElement): void => {
    const row = el.getBoundingClientRect();
    const panel = el.closest('.stagebuilder')?.getBoundingClientRect();
    const right = Math.max(row.right, panel?.right ?? 0);
    setPreview({ kind, id, anchor: new DOMRect(toStage(row.left), toStage(row.top), toStage(right - row.left), toStage(row.height)) });
  }, []);
  const clearPreview = useCallback((): void => setPreview(null), []);

  const cur = draft?.rounds[round - 1];
  const board = cur?.board ?? [];
  const full = board.length >= GAUNTLET_BOARD_MAX;
  const defaultTier = GAUNTLET_DEFAULT_TIERS[round - 1] ?? 6;

  const edit = editDraft;
  const addMinion = (cardId: string): void => { if (!full) edit((s) => addToRound(s, round, cardId)); };
  const setTier = (text: string): void => {
    const n = Math.round(Number(text));
    edit((s) => withRound(s, round, (r) => (text.trim() === '' || !Number.isFinite(n)
      ? without(r, 'tier')
      : { ...r, tier: Math.min(Math.max(n, 1), 6) })));
  };
  const setRune = (slot: 'round6' | 'round9', id: string): void =>
    edit((s) => ({ ...s, runes: id ? { ...s.runes, [slot]: id } : without(s.runes, slot) }));
  const toggleKeyword = (idx: number, kw: Keyword): void => edit((s) => toggleAddedKeyword(s, round, idx, kw));

  const stageDirty = dirty.includes(0);
  const anyDirty = dirty.length > 0;

  return (
    <>
    <div className={`sfxmix lunge scenebuilder stagebuilder${collapsed ? ' collapsed' : ''}`} ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag sb-head" onPointerDown={headerPointerDown}>
        <span className="sb-emblem" aria-hidden>⚔</span>
        <span className="sb-title">Stage Builder</span>
        <span className="sb-status">stage {stageNumber} · round {round}{anyDirty ? ' · unsaved' : ''}</span>
        <button className="sb-collapse" onPointerDown={(e) => e.stopPropagation()} onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand' : 'Collapse'}>{collapsed ? '▸' : '▾'}</button>
      </div>

      {/* Right under the header, outside every Sec and the collapse: the header ✕ arms this too, so it must show
          even with Actions folded or the whole panel collapsed. */}
      {confirming && anyDirty && (
        <div className="sb-row stb-confirm" role="alert">
          <span className="sb-mini sb-warn">Unsaved edits — Close anyway?</span>
          <button type="button" className="sb-btn stb-close-yes" onClick={() => { setConfirming(false); close(true); }}>Close anyway</button>
          <button type="button" className="sb-btn" onClick={() => setConfirming(false)}>Keep editing</button>
        </div>
      )}

      {!collapsed && (
        <div className="sb-body">
          {/* STAGE — the ten slots (only stages with a file are editable; adding one is a JSON + an import). */}
          <Sec id="stage" title="Stage" folded={folded} onFold={fold}
            right={stageDirty ? <span className="stb-dot" aria-label="Unsaved stage edits" /> : undefined}>
            <div className="stb-grid stb-grid-5">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
                const st = GAUNTLET_STAGES.find((s) => s.number === n);
                return (
                  <button key={n} type="button" className={`sb-btn stb-stage${n === stageNumber ? ' on' : ''}`} disabled={!st}
                    aria-pressed={n === stageNumber} onClick={() => void selectStage(n)}
                    aria-description={st ? `Edit stage ${n} (${st.name})` : 'No stage file yet — add its JSON + one import in the gauntlet index'}>
                    <b>{n}</b> {st ? st.name : 'no file yet'}
                  </button>
                );
              })}
            </div>
            {draft && (
              <label className="sb-field">
                <span className="sb-mini">opponent name</span>
                <input className="sb-search" value={draft.opponentName}
                  onChange={(e) => { const v = e.target.value; edit((s) => ({ ...s, opponentName: v })); }}
                  aria-label="Opponent name shown on the in-run portrait" />
              </label>
            )}
            {draft && (
              /* PORTRAIT CARD — the card whose art is the opponent's face (shop foe, combat, recap, Now Facing).
                 Blank = the tribe emblem. Stage-level, so a change counts as round 0 in the dirty tracking. */
              <div className="sb-field stb-portrait">
                <span className="sb-mini">portrait card</span>
                <div className="sb-row">
                  <span className={`stb-mname${draft.portraitCardId && !CARD_INDEX[draft.portraitCardId] ? ' err' : ''}`} aria-label="Current portrait card">
                    {draft.portraitCardId ? (CARD_INDEX[draft.portraitCardId]?.name ?? `unknown card '${draft.portraitCardId}'`) : 'none (tribe emblem)'}
                  </span>
                  <button type="button" className="sb-btn" disabled={!draft.portraitCardId}
                    onClick={() => edit((s) => { const { portraitCardId: _drop, ...rest } = s; return rest; })}
                    aria-description="Clear the portrait card so the opponent wears its tribe emblem">Clear</button>
                </div>
                <input className="sb-search" placeholder="pick a portrait: name, id, tribe…" value={portraitQuery}
                  onChange={(e) => setPortraitQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && portraitResults[0]) {
                      e.preventDefault(); const id = portraitResults[0].id;
                      edit((s) => ({ ...s, portraitCardId: id })); setPortraitQuery('');
                    }
                  }}
                  aria-label="Search cards for the opponent's portrait art. ↵ picks the top match." />
                {portraitResults.length > 0 && (
                  <div className="sb-results">
                    {portraitResults.map((c) => (
                      <div key={c.id} className="stb-result">
                        <span className={`sb-t sb-t${c.tier}`}>{c.tier}</span>
                        <span className="sb-name">{c.name}</span>
                        <button type="button" className="sb-btn stb-add" data-portrait-pick={c.id}
                          onClick={() => { edit((s) => ({ ...s, portraitCardId: c.id })); setPortraitQuery(''); }}
                          aria-label={`Use ${c.name} as the opponent portrait`}>use</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {status && <div className="sb-mini stb-status" role="status">{status}</div>}
          </Sec>

          {draft && (
            <>
              {/* ROUNDS — which round the panel edits (and the sandbox pins). Dot = unsaved, red = a validation
                  issue in that round, amber = a minion whose card changed since the stage was saved. */}
              <Sec id="rounds" title="Rounds" folded={folded} onFold={fold}>
                <div className="stb-grid stb-grid-10">
                  {draft.rounds.map((_, i) => {
                    const n = i + 1;
                    const flags = [issueRounds.has(n) ? ' err' : '', driftRounds.has(n) ? ' drift' : ''].join('');
                    return (
                      <button key={n} type="button" data-round={n} className={`sb-btn stb-round${n === round ? ' on' : ''}${flags}`}
                        aria-pressed={n === round} onClick={() => selectRound(n)}
                        aria-description={[`Round ${n}`, dirty.includes(n) ? 'unsaved' : '', issueRounds.has(n) ? 'has a problem' : '', driftRounds.has(n) ? 'a card changed since saved' : ''].filter(Boolean).join(' · ')}>
                        {n}
                        {dirty.includes(n) && <span className="stb-dot" aria-hidden />}
                      </button>
                    );
                  })}
                </div>
                <div className="sb-row">
                  <button type="button" className="sb-btn" disabled={round <= 1} onClick={() => edit((s) => copyPreviousRound(s, round))}
                    aria-description={`Replace round ${round}'s board and tier with round ${round - 1}'s`}>Copy from previous round</button>
                </div>
              </Sec>

              {/* ROUND N — tier, the board (≤7), and a search to add to it. */}
              <Sec id="round" title={`Round ${round}`} folded={folded} onFold={fold}
                right={<span className="sb-count">{board.length} / {GAUNTLET_BOARD_MAX}</span>}>
                <label className="sb-row stb-tier">
                  <span className="sb-mini">tier</span>
                  <input className="sb-search stb-tierin" type="number" min={1} max={6} value={cur?.tier ?? ''}
                    placeholder={`default: ${defaultTier}`} onChange={(e) => setTier(e.target.value)}
                    aria-label={`Opponent tavern tier this round (blank = the default, ${defaultTier})`} />
                </label>
                <div className="stb-board">
                  {board.map((m, idx) => {
                    const def = CARD_INDEX[m.cardId];
                    const printed = def?.keywords ?? [];
                    const added = m.addedKeywords ?? [];
                    return (
                      <div key={idx} className="stb-minion">
                        <div className="sb-row stb-mrow">
                          <span className={`stb-mname${def ? '' : ' err'}`}>{def ? def.name : `unknown card '${m.cardId}'`}</span>
                          {driftSlots.has(idx) && <span className="sb-tag stb-drift">changed since saved</span>}
                          <button type="button" className="sb-btn stb-ico" disabled={idx === 0} onClick={() => edit((s) => moveMinion(s, round, idx, idx - 1))} aria-label="Move left">◀</button>
                          <button type="button" className="sb-btn stb-ico" disabled={idx === board.length - 1} onClick={() => edit((s) => moveMinion(s, round, idx, idx + 1))} aria-label="Move right">▶</button>
                          <button type="button" className="sb-btn stb-ico stb-x" onClick={() => edit((s) => removeMinion(s, round, idx))} aria-label="Remove">✕</button>
                        </div>
                        <div className="sb-row stb-mrow">
                          <span className="sb-stats" aria-label="Stats">
                            <StatBadgeField stat="atk" value={m.attack} min={0} onCommit={(n) => edit((s) => setMinionStats(s, round, idx, { attack: n }))} title="Attack — click to type, ↑/↓ or wheel to step (Shift = 5)" />
                            <StatBadgeField stat="hp" value={m.health} min={1} onCommit={(n) => edit((s) => setMinionStats(s, round, idx, { health: n }))} title="Health — click to type, ↑/↓ or wheel to step (Shift = 5)" />
                          </span>
                          <button type="button" className={`uned-kwbtn stb-gold${m.golden ? ' on' : ''}`} aria-pressed={!!m.golden}
                            onClick={() => edit((s) => toggleMinionGolden(s, round, idx))}>Golden</button>
                          {EDITABLE_KEYWORDS.map((kw) => {
                            const locked = printed.includes(kw);
                            const on = locked || added.includes(kw);
                            return (
                              <button key={kw} type="button" className={`uned-kwbtn${on ? ' on' : ''}${locked ? ' locked' : ''}`} disabled={locked}
                                aria-pressed={on} onClick={() => toggleKeyword(idx, kw)}
                                aria-label={`${KEYWORD_LABEL[kw] ?? kw}${locked ? ' (printed on the card)' : ''}`}>{kw}</button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {board.length === 0 && <div className="sb-empty">no minions — search below to add one</div>}
                </div>
                <input className="sb-search" placeholder="add a minion: name, id, tribe, keyword…" value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); addMinion(results[0].id); e.currentTarget.select(); } }}
                  aria-label="Search every minion card. Space-separated terms must all match. ↵ adds the top match." />
                {results.length > 0 && (
                  <div className="sb-results" onMouseLeave={clearPreview}>
                    {results.map((c) => (
                      <div key={c.id} className="stb-result" onMouseEnter={(e) => previewRow('card', c.id, e.currentTarget)}>
                        <span className={`sb-t sb-t${c.tier}`}>{c.tier}</span>
                        <span className="sb-name">{c.name}</span>
                        <button type="button" className="sb-btn stb-add" disabled={full} onClick={() => addMinion(c.id)}
                          onFocus={(e) => previewRow('card', c.id, e.currentTarget)} onBlur={clearPreview}
                          aria-label={full ? `Board full (${GAUNTLET_BOARD_MAX})` : `Add ${c.name} to round ${round}`}>+ add</button>
                      </div>
                    ))}
                  </div>
                )}
              </Sec>

              {/* RUN BUFFS — the round's run-wide scalers (Ruby strength, spell power, auras, counters), carried forward. */}
              <RunBuffsSection draft={draft} round={round} edit={edit} folded={folded} onFold={fold} />

              {/* RUNES — the opponent's two rune slots: a picker per slot whose rows preview the REAL rune on hover /
                  keyboard focus (owner 2026-09-29). Greyed + badged = no combat effect for an opponent (shop-only). */}
              <Sec id="runes" title="Runes" folded={folded} onFold={fold}>
                {(['round6', 'round9'] as const).map((slot) => (
                  <RunePicker key={slot} slot={slot} value={draft.runes[slot] ?? ''} runeActs={runeActs}
                    open={runeOpen === slot} setOpen={(on) => { setRuneOpen(on ? slot : null); if (!on) clearPreview(); }}
                    onPick={(id) => { setRune(slot, id); setRuneOpen(null); clearPreview(); }}
                    onPreview={(id, el) => previewRow('rune', id, el)} onClearPreview={clearPreview} />
                ))}
              </Sec>

              {/* ACTIONS — Save validates, stamps and writes the file. */}
              <Sec id="actions" title="Actions" folded={folded} onFold={fold}>
                <div className="sb-row">
                  <button type="button" className="sb-btn sb-primary stb-save" disabled={!anyDirty} onClick={() => void save()}
                    aria-description="Validate, stamp each card's version and write the stage file">Save all edits</button>
                  <button type="button" className="sb-btn" disabled={!anyDirty} onClick={() => { setConfirming(false); discard(); }}
                    aria-description="Throw away every unsaved edit">Discard</button>
                  <button type="button" className="sb-btn stb-close" onClick={requestClose} aria-description="Close the Stage Builder">Close</button>
                </div>
              </Sec>
            </>
          )}
          {!draft && (
            <Sec id="actions" title="Actions" folded={folded} onFold={fold}>
              <div className="sb-row">
                <button type="button" className="sb-btn stb-close" onClick={requestClose}>Close</button>
              </div>
            </Sec>
          )}
        </div>
      )}
    </div>
    <SceneBuilderPreview target={collapsed ? null : preview} run={run} />
    </>
  );
}

type RuneOption = (typeof RUNE_OPTIONS)[number];

/**
 * One rune slot's picker: a trigger showing the chosen rune, opening a searchable list ("none" + every rune).
 * Hovering or focusing a row previews the REAL rune tablet (`SceneBuilderPreview`, via `onPreview`) — focus covers
 * the keyboard (↑/↓ walk the rows) and touch (a tap focuses the row before it picks), so no hover-only CSS is added.
 */
function RunePicker({ slot, value, runeActs, open, setOpen, onPick, onPreview, onClearPreview }: {
  slot: 'round6' | 'round9';
  value: string;
  runeActs: Map<string, boolean>;
  open: boolean;
  setOpen: (on: boolean) => void;
  onPick: (id: string) => void;
  onPreview: (id: string, el: HTMLElement) => void;
  onClearPreview: () => void;
}) {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const from = slot === 'round6' ? 6 : 9;
  const chosen = RUNE_OPTIONS.find((r) => r.id === value);
  const inert = value !== '' && runeActs.get(value) === false;
  const shown = useMemo<RuneOption[]>(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return terms.length ? RUNE_OPTIONS.filter((r) => terms.every((t) => `${r.name} ${r.id}`.toLowerCase().includes(t))) : RUNE_OPTIONS;
  }, [query]);
  const walk = (e: React.KeyboardEvent<HTMLElement>): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button.stb-runerow') ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : at - 1;
    rows[next]?.focus();
  };
  const noEffect = (id: string): boolean => runeActs.get(id) === false;

  return (
    <div className="sb-field stb-runeslot">
      <span className="sb-mini">from round {from}</span>
      <button type="button" className={`sb-btn stb-runepick${inert ? ' stb-noeffect' : ''}${open ? ' on' : ''}`} data-slot={slot}
        aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen(!open)}
        onMouseEnter={(e) => { if (value) onPreview(value, e.currentTarget); }} onMouseLeave={() => { if (!open) onClearPreview(); }}
        aria-label={`The opponent's rune from round ${from} onward: ${chosen ? chosen.name : 'none'}${inert ? ' (no effect for opponents)' : ''}`}>
        <span className="sb-name">{chosen ? chosen.name : 'none'}</span>
        {inert && <span className="sb-tag stb-noeffect">no effect for opponents</span>}
        <span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <>
          <input className="sb-search" autoFocus value={query} placeholder="search runes…" onChange={(e) => setQuery(e.target.value)}
            onKeyDown={walk} aria-label="Search runes. ↓ walks the list; hovering or focusing a rune previews it." />
          <div className="sb-results stb-runes" role="listbox" ref={listRef} data-slot={slot} onMouseLeave={onClearPreview}>
            <button type="button" role="option" aria-selected={value === ''} className={`sb-card stb-runerow${value === '' ? ' on' : ''}`} data-rune=""
              onClick={() => onPick('')} onFocus={onClearPreview} onMouseEnter={onClearPreview} onKeyDown={walk}>
              <span className="sb-name">none</span>
            </button>
            {shown.map((r) => (
              <button key={r.id} type="button" role="option" aria-selected={r.id === value} data-rune={r.id}
                className={`sb-card stb-runerow${r.id === value ? ' on' : ''}${noEffect(r.id) ? ' stb-noeffect' : ''}`}
                onClick={() => onPick(r.id)} onMouseEnter={(e) => onPreview(r.id, e.currentTarget)}
                onFocus={(e) => onPreview(r.id, e.currentTarget)} onBlur={onClearPreview} onKeyDown={walk}>
                <span className="sb-name">{r.name}</span>
                {r.epic && <span className="sb-tag">epic</span>}
                {noEffect(r.id) && <span className="sb-tag stb-noeffect">no effect for opponents</span>}
              </button>
            ))}
            {shown.length === 0 && <div className="sb-empty">no matches</div>}
          </div>
        </>
      )}
    </div>
  );
}
