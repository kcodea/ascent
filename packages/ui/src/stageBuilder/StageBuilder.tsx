import { useCallback, useMemo, useState } from 'react';
import {
  CARD_INDEX, EPIC_RUNES, GAUNTLET_BOARD_MAX, GAUNTLET_STAGES, RUNES, cardRevision, stageDrift, validateStage,
  type GauntletMinion, type GauntletRound, type GauntletStage,
} from '@game/content';
import { GAUNTLET_DEFAULT_TIERS } from '@game/sim';
import type { Keyword } from '@game/core';
import { useGame } from '../store';
import { useDraggablePanel, DevPanelContext } from '../useDraggablePanel';
import { Sec } from '../SceneBuilder';
import { SceneBuilderPreview, type SbPreviewTarget } from '../SceneBuilderPreview';
import { StatBadgeField } from '../StatBadgeField';
import { EDITABLE_KEYWORDS, KEYWORD_LABEL } from '../UnitEditor';
import { toStage } from '../stage';
import { useStageBuilder } from './stageBuilderStore';
import { copyPreviousRound, moveMinion } from './stageDraft';
import { runeActsForOpponent } from './runeEffect';

/**
 * DEV-only STAGE BUILDER panel — authors a Gauntlet stage round by round, beside the Scene Builder. All state and
 * the board-pin link live in `stageBuilderStore.ts`; this is the input surface. Every edit goes through
 * `editDraft` (so the selected round re-pins as the next fight's opponent), shaped by the pure `stageDraft.ts`
 * helpers. Sections: Stage (slot + opponent name) · Rounds (dirty dot, red = `validateStage` issue, amber =
 * `stageDrift`) · Round N (tier + the ≤7 minions + a card search) · Runes (rounds 6 and 9) · Actions.
 *
 * Mounted lazily by Game.tsx (DEV + sandbox + `open`), so neither this nor its store reaches the player chunk.
 * Wears the Scene Builder's slate (`.scenebuilder`) plus a few `.stb-*` pieces in styles.css.
 */

/** Everything a search row matches on, lowercased once (the Scene Builder Library's `hay`/`matches` approach). */
const hay = (...parts: (string | undefined)[]): string => parts.filter(Boolean).join(' ').toLowerCase();
const matches = (haystack: string, terms: string[]): boolean => terms.every((t) => haystack.includes(t));

type CardRow = { id: string; name: string; tier: number; hay: string };
/** Every minion card (tokens included — an opponent may field one), sorted by tier then name. Built once. */
let minionRows: CardRow[] | null = null;
const allMinions = (): CardRow[] => (minionRows ??= Object.values(CARD_INDEX)
  .filter((c) => !c.spell)
  .map((c) => ({
    id: c.id, name: c.name, tier: c.tier ?? 0,
    hay: hay(c.name, c.id, c.tribe, c.tribe2, c.text, (c.keywords ?? []).join(' ')),
  }))
  .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)));

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
const withMinion = (s: GauntletStage, round: number, idx: number, fn: (m: GauntletMinion) => GauntletMinion): GauntletStage =>
  withRound(s, round, (r) => ({ ...r, board: r.board.map((m, i) => (i === idx ? fn(m) : m)) }));
/** Drop an optional key rather than writing `undefined`, so a toggled-back minion compares equal to its saved self. */
function without<T extends object, K extends keyof T>(o: T, k: K): T {
  const next = { ...o };
  delete next[k];
  return next;
}

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

/** What Game.tsx mounts: nothing until the builder is opened from the title. */
export function StageBuilderMount() {
  const open = useStageBuilder((s) => s.open);
  return open ? <StageBuilder /> : null;
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
  const [testHint, setTestHint] = useState(false);
  const [preview, setPreview] = useState<SbPreviewTarget | null>(null);
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

  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const results = useMemo(() => (terms.length ? allMinions().filter((c) => matches(c.hay, terms)) : []), [terms]);

  const previewRow = useCallback((id: string, el: HTMLElement): void => {
    const row = el.getBoundingClientRect();
    const panel = el.closest('.stagebuilder')?.getBoundingClientRect();
    const right = Math.max(row.right, panel?.right ?? 0);
    setPreview({ kind: 'card', id, anchor: new DOMRect(toStage(row.left), toStage(row.top), toStage(right - row.left), toStage(row.height)) });
  }, []);
  const clearPreview = useCallback((): void => setPreview(null), []);

  const cur = draft?.rounds[round - 1];
  const board = cur?.board ?? [];
  const full = board.length >= GAUNTLET_BOARD_MAX;
  const defaultTier = GAUNTLET_DEFAULT_TIERS[round - 1] ?? 6;

  const edit = (fn: (s: GauntletStage) => GauntletStage): void => { setTestHint(false); editDraft(fn); };
  const editMinion = (idx: number, fn: (m: GauntletMinion) => GauntletMinion): void => edit((s) => withMinion(s, round, idx, fn));
  const addMinion = (cardId: string): void => {
    const def = CARD_INDEX[cardId];
    if (!def || full) return;
    edit((s) => withRound(s, round, (r) => ({
      ...r, board: [...r.board, { cardId, attack: def.attack, health: def.health, cardVersion: cardRevision(def) }],
    })));
  };
  const setTier = (text: string): void => {
    const n = Math.round(Number(text));
    edit((s) => withRound(s, round, (r) => (text.trim() === '' || !Number.isFinite(n)
      ? without(r, 'tier')
      : { ...r, tier: Math.min(Math.max(n, 1), 6) })));
  };
  const setRune = (slot: 'round6' | 'round9', id: string): void =>
    edit((s) => ({ ...s, runes: id ? { ...s.runes, [slot]: id } : without(s.runes, slot) }));
  const toggleKeyword = (idx: number, kw: Keyword): void => editMinion(idx, (m) => {
    const added = m.addedKeywords ?? [];
    const next = added.includes(kw) ? added.filter((k) => k !== kw) : [...added, kw];
    return next.length ? { ...m, addedKeywords: next } : without(m, 'addedKeywords');
  });

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
                        aria-pressed={n === round} onClick={() => { setTestHint(false); selectRound(n); }}
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
                          <button type="button" className="sb-btn stb-ico stb-x" onClick={() => edit((s) => withRound(s, round, (r) => ({ ...r, board: r.board.filter((_, i) => i !== idx) })))} aria-label="Remove">✕</button>
                        </div>
                        <div className="sb-row stb-mrow">
                          <span className="sb-stats" aria-label="Stats">
                            <StatBadgeField stat="atk" value={m.attack} min={0} onCommit={(n) => editMinion(idx, (x) => ({ ...x, attack: n }))} title="Attack — click to type, ↑/↓ or wheel to step (Shift = 5)" />
                            <StatBadgeField stat="hp" value={m.health} min={1} onCommit={(n) => editMinion(idx, (x) => ({ ...x, health: n }))} title="Health — click to type, ↑/↓ or wheel to step (Shift = 5)" />
                          </span>
                          <button type="button" className={`uned-kwbtn stb-gold${m.golden ? ' on' : ''}`} aria-pressed={!!m.golden}
                            onClick={() => editMinion(idx, (x) => (x.golden ? without(x, 'golden') : { ...x, golden: true }))}>Golden</button>
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
                      <div key={c.id} className="stb-result" onMouseEnter={(e) => previewRow(c.id, e.currentTarget)}>
                        <span className={`sb-t sb-t${c.tier}`}>{c.tier}</span>
                        <span className="sb-name">{c.name}</span>
                        <button type="button" className="sb-btn stb-add" disabled={full} onClick={() => addMinion(c.id)}
                          onFocus={(e) => previewRow(c.id, e.currentTarget)} onBlur={clearPreview}
                          aria-label={full ? `Board full (${GAUNTLET_BOARD_MAX})` : `Add ${c.name} to round ${round}`}>+ add</button>
                      </div>
                    ))}
                  </div>
                )}
              </Sec>

              {/* RUNES — the opponent's two rune slots. Greyed = no combat effect for an opponent (shop-only). */}
              <Sec id="runes" title="Runes" folded={folded} onFold={fold}>
                {(['round6', 'round9'] as const).map((slot) => {
                  const value = draft.runes[slot] ?? '';
                  const inert = value !== '' && runeActs.get(value) === false;
                  return (
                    <label key={slot} className="sb-field">
                      <span className="sb-mini">from round {slot === 'round6' ? 6 : 9}</span>
                      <select className={`sb-select stb-rune${inert ? ' stb-noeffect' : ''}`} data-slot={slot} value={value}
                        onChange={(e) => setRune(slot, e.target.value)}
                        aria-label={`The opponent's rune from round ${slot === 'round6' ? 6 : 9} onward`}>
                        <option value="">none</option>
                        {RUNE_OPTIONS.map((r) => {
                          const acts = runeActs.get(r.id) !== false;
                          return (
                            <option key={r.id} value={r.id} className={acts ? '' : 'stb-noeffect'}>
                              {acts ? r.name : `${r.name} — no effect for opponents`}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  );
                })}
              </Sec>

              {/* ACTIONS — Test re-pins this round as the next fight; Save validates, stamps and writes the file. */}
              <Sec id="actions" title="Actions" folded={folded} onFold={fold}>
                <div className="sb-row">
                  <button type="button" className="sb-btn" onClick={() => { selectRound(round); setTestHint(true); }}
                    aria-description="Pin this round as the next fight's opponent (runes included)">Test this round</button>
                  <button type="button" className="sb-btn sb-primary stb-save" disabled={!anyDirty} onClick={() => void save()}
                    aria-description="Validate, stamp each card's version and write the stage file">Save all edits</button>
                  <button type="button" className="sb-btn" disabled={!anyDirty} onClick={() => { setConfirming(false); discard(); }}
                    aria-description="Throw away every unsaved edit">Discard</button>
                  <button type="button" className="sb-btn stb-close" onClick={requestClose} aria-description="Close the Stage Builder">Close</button>
                </div>
                {testHint && <div className="sb-mini sb-note">End Turn to fight it</div>}
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
