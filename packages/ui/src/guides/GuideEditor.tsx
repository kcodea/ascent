import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Tribe } from '@game/core';
import type { SetId } from '@game/content';
import { GUIDE_LIMITS, TEAM_BYLINE } from '@game/guides';
import type { RunState } from '@game/sim';
import { Card, type CardView } from '../Card';
import { Icon } from '../Icon';
import { sfx } from '../sfx';
import { toGuide, tribeInk, type Guide } from './guides';
import { GuideCardPicker } from './GuideCardPicker';
import { GuideEmblem, GuideText, TRIBE_NAME, guideAccent, useGuideViews } from './GuideParts';
import { draftFromGuide, draftProblems, missingIn, sameDraft, toWire, type EditorDraft } from './guideDrafts';
import { clearLocalDraft, saveLocalDraft } from './guideDraftStore';
import { guideErrorMessage } from './guideMessages';
import { deleteGuideRemote, fetchGuideById, saveGuideRemote } from './guidesRemote';
import { guideDeleted, guideSaved } from './guidesStore';
import './lobbyGuides.css';
import './compendiumGuides.css';
import './guideEditor.css';

/**
 * THE GUIDE EDITOR (owner ask 2026-10-11: "the ability to edit existing guides while in game and save them ... create
 * a new guide either from scratch or by duplicating an existing guide"). The Compendium's guide card with its parts
 * made editable: the same header, write-up and portrait rows a reader sees, so the author edits what players get.
 *
 * The author types text and picks cards. Which cards the write-up names, and which sets the guide shows in, are
 * worked out for them at save (guideDrafts.ts). The server decides whether the save is allowed; a refusal keeps the
 * editor open with the text intact and a plain sentence.
 *
 * KEYS. The game closes the Compendium on Esc and toggles it on Tab (window listeners in Game.tsx). While this is
 * mounted a CAPTURE listener stops both first: Tab moves focus as usual, Esc closes the card picker if it is open,
 * else asks to leave the editor. Nothing else is touched.
 *
 * THE DEVICE DRAFT. A changed draft is written to this device shortly after each change and cleared by a save, a
 * delete or a confirmed discard, so closing the Compendium mid-edit loses nothing (guideDraftStore.ts).
 *
 * PERFORMANCE. Nothing animates. The preview and the derived card list follow a deferred copy of the draft, so
 * typing never waits on them. Portraits are the memoized compact `Card`.
 */

const len = (s: string): number => [...s].length;

/** A character counter that only appears near the limit. */
function Count({ value, max }: { value: string; max: number }): JSX.Element | null {
  const n = len(value);
  if (n < max - Math.max(10, Math.floor(max / 10))) return null;
  return <span className={`gedit-count${n > max ? ' over' : ''}`} aria-live="polite">{n}/{max}</span>;
}

const moved = (ids: readonly string[], from: number, to: number): string[] => {
  const next = [...ids];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  return next;
};

/** The draft as a `Guide`, for the shared read-only pieces (the emblem, the highlighted write-up). */
function previewOf(d: EditorDraft, mentions: readonly string[], aliases: Readonly<Record<string, string>>, setId: SetId): Guide {
  return {
    id: 'draft', rowId: d.rowId, sets: [setId], tribes: d.tribes, pairsWith: d.pairsWith.length ? d.pairsWith : undefined,
    iconCard: d.iconCard || d.core[0] || '', title: d.title, tagline: d.tagline, body: d.body, core: d.core, enablers: d.enablers,
    mentions: mentions.length ? mentions : undefined, aliases: Object.keys(aliases).length ? aliases : undefined,
    byline: d.official ? TEAM_BYLINE : d.byline, official: d.official, published: d.official, hidden: false, authorId: null,
    revision: d.revision ?? 0, order: 0,
  };
}

/** One editable portrait row (Core or Enablers): each card with move and remove buttons, and Add. */
function EditRow({ row, label, ids, max, views, missing, adding, setId, onChange, onToggleAdd }: {
  row: 'core' | 'enablers'; label: string; ids: readonly string[]; max: number; views: Map<string, CardView>;
  missing: ReadonlySet<string>; adding: boolean; setId: SetId; onChange: (ids: string[]) => void; onToggleAdd: () => void;
}): JSX.Element {
  return (
    <div className="lobbyguide-units gedit-row" data-row={row}>
      <div className="lobbyguide-unitslabel">{label} <span className="gedit-rowcount">{ids.length}/{max}</span></div>
      <div className="lobbyguide-unitrow">
        {ids.map((id, i) => {
          const v = views.get(id);
          const gone = !v || missing.has(id);
          const name = v?.name ?? 'this card';
          return (
            <div className="gedit-unit" data-card={id} key={`${id}-${i}`}>
              <div className={`lobbyguide-unit${gone ? ' missing' : ''}`} role={gone ? 'img' : undefined} aria-label={gone ? (v ? `${v.name}: missing or removed` : 'Missing or removed card') : undefined}>
                {v ? <div className="lobbyguide-unitscale"><Card card={v} forceCompact suppressPop /></div> : <div className="lobbyguide-blank" />}
                {gone && <span className="lobbyguide-missing" aria-hidden="true">Missing or removed</span>}
              </div>
              <div className="gedit-unitbtns">
                <button type="button" className="gedit-mini gedit-earlier" disabled={i === 0} aria-label={`Move ${name} earlier`} onClick={() => onChange(moved(ids, i, i - 1))}><Icon name="chevron" /></button>
                <button type="button" className="gedit-mini gedit-remove" aria-label={`Remove ${name}`} onClick={() => onChange(ids.filter((_, j) => j !== i))}>x</button>
                <button type="button" className="gedit-mini gedit-later" disabled={i === ids.length - 1} aria-label={`Move ${name} later`} onClick={() => onChange(moved(ids, i, i + 1))}><Icon name="chevron" /></button>
              </div>
            </div>
          );
        })}
        <button type="button" className="gbtn gedit-add" disabled={ids.length >= max} aria-expanded={adding} onClick={onToggleAdd}>Add</button>
      </div>
      {adding && <GuideCardPicker setId={setId} label={`Add to ${label}`} exclude={ids} onPick={(id) => { onChange([...ids, id]); onToggleAdd(); }} />}
    </div>
  );
}

export const GuideEditor = memo(function GuideEditor({ initial, setId, tribes, run, userId, canBeOfficial, onClose }: {
  initial: EditorDraft;
  /** The set being edited in: its cards fill the picker, and the guide must be whole in it to save. */
  setId: SetId;
  /** That set's whole tribe roster. */
  tribes: readonly Tribe[];
  run: RunState | undefined;
  /** Whose device draft this is. */
  userId: string;
  /** A team member creating a NEW guide may make it a Team Ascent guide. */
  canBeOfficial: boolean;
  onClose: () => void;
}): JSX.Element {
  // `base` is what "unchanged" means. It only moves when the author loads someone else's newer version.
  const [base, setBase] = useState(initial);
  const [d, setD] = useState(initial);
  const [picker, setPicker] = useState<'icon' | 'core' | 'enablers' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<'discard' | 'delete' | 'conflict' | null>(null);
  const patch = (p: Partial<EditorDraft>): void => { setD((cur) => ({ ...cur, ...p })); setError(null); };
  const dirty = !sameDraft(d, base);
  const isNew = d.rowId === null;

  // Keys: see the header. The handler reads the latest state through a ref so it is installed once.
  const live = useRef({ picker, dirty, busy });
  live.current = { picker, dirty, busy };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Tab') { e.stopPropagation(); return; }
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      if (live.current.busy) return;
      if (live.current.picker) { setPicker(null); return; }
      if (live.current.dirty) setAsk('discard'); else onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // The device draft: written shortly after a change, so a burst of typing is one write.
  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => saveLocalDraft(userId, d), 400);
    return () => window.clearTimeout(t);
  }, [d, dirty, userId]);

  // Derived from a deferred copy, so typing never waits on the name scan.
  const shown = useDeferredValue(d);
  const wire = useMemo(() => toWire(shown, setId), [shown, setId]);
  const preview = useMemo(() => previewOf(shown, wire.mentions, wire.aliases, setId), [shown, wire, setId]);
  const ids = useMemo(() => [...new Set([...d.core, ...d.enablers, ...wire.mentions])], [d.core, d.enablers, wire.mentions]);
  const { views, refs } = useGuideViews(ids, run);
  const missing = useMemo(() => new Set(missingIn(d, setId)), [d, setId]);
  const chips: Tribe[] = d.tribes.length ? [...d.tribes, ...d.pairsWith] : ['neutral'];
  const listed = useMemo(() => [...new Set([...d.core, ...d.enablers, ...wire.mentions])].filter((id) => views.has(id)), [d.core, d.enablers, wire.mentions, views]);

  const save = async (override?: EditorDraft): Promise<void> => {
    const cur = override ?? d;
    const problems = draftProblems(cur, setId);
    if (problems.length > 0) { setError(problems[0]!.message); sfx.tick(); return; }
    setBusy(true);
    setError(null);
    const res = await saveGuideRemote(toWire(cur, setId));
    setBusy(false);
    if (res.ok) {
      clearLocalDraft();
      const g = toGuide(res.value);
      if (g) guideSaved(g);
      sfx.pulse();
      onClose();
      return;
    }
    if (res.code === 'conflict') { setAsk('conflict'); return; }
    setError(guideErrorMessage(res.code, res.field));
  };

  /** The server's current version of the guide being edited, or null with the reason shown. */
  const theirs = async (): Promise<Guide | null> => {
    if (!d.rowId) return null;
    setBusy(true);
    const rec = await fetchGuideById(d.rowId);
    setBusy(false);
    const g = rec ? toGuide(rec) : null;
    if (!g) { setAsk(null); setError(guideErrorMessage(rec === null ? 'not_found' : 'offline')); }
    return g;
  };
  const loadTheirs = async (): Promise<void> => {
    const g = await theirs();
    if (!g) return;
    const fresh = draftFromGuide(g);
    setBase(fresh);
    setD(fresh);
    setAsk(null);
    clearLocalDraft();
  };
  const overwrite = async (): Promise<void> => {
    const g = await theirs();
    if (!g) return;
    const next = { ...d, revision: g.revision };
    setD(next);
    setAsk(null);
    await save(next);
  };
  const remove = async (): Promise<void> => {
    if (!d.rowId) return;
    setBusy(true);
    const res = await deleteGuideRemote(d.rowId);
    setBusy(false);
    // A guide the server no longer has is as good as deleted: finish the same way (its sentence would say the text is
    // kept on this device, which is not true after a delete).
    if (!res.ok && res.code !== 'not_found') { setAsk(null); setError(guideErrorMessage(res.code, res.field)); return; }
    clearLocalDraft();
    guideDeleted(d.rowId);
    sfx.tick();
    onClose();
  };
  const discard = (): void => { clearLocalDraft(); sfx.tick(); onClose(); };
  const cancel = (): void => { if (dirty) setAsk('discard'); else onClose(); };

  const toggleTribe = (t: Tribe): void => {
    if (d.tribes.includes(t)) patch({ tribes: d.tribes.filter((x) => x !== t) });
    else if (d.tribes.length < GUIDE_LIMITS.tribes) patch({ tribes: [...d.tribes, t], pairsWith: d.pairsWith.filter((x) => x !== t) });
  };

  return (
    <article className="bookguide gedit" style={guideAccent(chips)} aria-label={isNew ? 'New guide' : `Editing ${base.title}`}>
      <header className="bookguide-head gedit-head">
        <button type="button" className="gedit-icon" aria-label="Change the art icon" aria-expanded={picker === 'icon'} onClick={() => setPicker(picker === 'icon' ? null : 'icon')}>
          <GuideEmblem guide={preview} chips={chips} />
          <span className="gedit-iconhint" aria-hidden="true">Change</span>
        </button>
        <div className="bookguide-headtext gedit-headtext">
          <label className="gedit-field">
            <span className="gedit-label">Title <Count value={d.title} max={GUIDE_LIMITS.title} /></span>
            <input className="gedit-input gedit-title" value={d.title} placeholder="Name the build" onChange={(e) => patch({ title: e.target.value })} />
          </label>
          <label className="gedit-field">
            <span className="gedit-label">Tagline <Count value={d.tagline} max={GUIDE_LIMITS.tagline} /></span>
            <input className="gedit-input gedit-tagline" value={d.tagline} placeholder="One line on how it wins" onChange={(e) => patch({ tagline: e.target.value })} />
          </label>
          {isNew && canBeOfficial && (
            <div className="gedit-who" role="group" aria-label="Who this guide is by">
              <button type="button" className={`book-runetribe${d.official ? ' on' : ''}`} style={{ '--c': 'var(--ui-title)' } as CSSProperties} aria-pressed={d.official} onClick={() => patch({ official: true })}>Team Ascent guide</button>
              <button type="button" className={`book-runetribe${d.official ? '' : ' on'}`} style={{ '--c': 'var(--ui-title)' } as CSSProperties} aria-pressed={!d.official} onClick={() => patch({ official: false })}>My own guide</button>
            </div>
          )}
          {d.official
            ? <div className="gedit-by">by {TEAM_BYLINE}</div>
            : (
              <label className="gedit-field gedit-field-inline">
                <span className="gedit-label">by <Count value={d.byline} max={GUIDE_LIMITS.byline} /></span>
                <input className="gedit-input gedit-byline" value={d.byline} placeholder="Your name" onChange={(e) => patch({ byline: e.target.value })} />
              </label>
            )}
        </div>
      </header>
      {picker === 'icon' && (
        <div className="gedit-iconpick">
          <GuideCardPicker setId={setId} label="Pick the art icon" onPick={(id) => { patch({ iconCard: id }); setPicker(null); }} />
        </div>
      )}
      <div className="bookguide-body gedit-bodywrap">
        <div className="gedit-tribes" role="group" aria-label="Tribes this guide is for. None means Neutral.">
          <span className="gedit-label">Tribes</span>
          {tribes.map((t) => (
            <button type="button" key={t} className={`book-runetribe${d.tribes.includes(t) ? ' on' : ''}`} style={{ '--c': tribeInk(t) } as CSSProperties}
              aria-pressed={d.tribes.includes(t)} onClick={() => toggleTribe(t)}>{TRIBE_NAME[t] ?? t}</button>
          ))}
          <label className="gedit-field gedit-field-inline">
            <span className="gedit-label">Pairs with</span>
            <select className="gedit-input gedit-pairs" value={d.pairsWith[0] ?? ''} onChange={(e) => patch({ pairsWith: e.target.value ? [e.target.value as Tribe] : [] })}>
              <option value="">None</option>
              {tribes.filter((t) => !d.tribes.includes(t)).map((t) => <option key={t} value={t}>{TRIBE_NAME[t] ?? t}</option>)}
            </select>
          </label>
        </div>
        <label className="gedit-field">
          <span className="gedit-label">Write-up <Count value={d.body} max={GUIDE_LIMITS.body} /></span>
          <textarea className="gedit-input gedit-body" rows={6} value={d.body} placeholder="How the build works, what to look for, when to commit. Card names light up for readers." onChange={(e) => patch({ body: e.target.value })} />
        </label>
        {d.body.trim() !== '' && (
          <div className="gedit-preview">
            <span className="gedit-label">Preview</span>
            <GuideText guide={preview} ids={ids} views={views} refs={refs} missing={missing} />
          </div>
        )}
        <EditRow row="core" label="Core" ids={d.core} max={GUIDE_LIMITS.core} views={views} missing={missing} adding={picker === 'core'} setId={setId}
          onChange={(core) => patch({ core })} onToggleAdd={() => setPicker(picker === 'core' ? null : 'core')} />
        <EditRow row="enablers" label="Enablers" ids={d.enablers} max={GUIDE_LIMITS.enablers} views={views} missing={missing} adding={picker === 'enablers'} setId={setId}
          onChange={(enablers) => patch({ enablers })} onToggleAdd={() => setPicker(picker === 'enablers' ? null : 'enablers')} />
        <div className="gedit-aliases">
          <span className="gedit-label">Nicknames <span className="gedit-hint">A short word in your write-up that means one of the guide's cards.</span></span>
          {d.aliases.map((a, i) => {
            const gone = a.card !== '' && missing.has(a.card);
            return (
              <div className={`gedit-alias${gone ? ' missing' : ''}`} key={i}>
                <input className="gedit-input gedit-alias-word" value={a.word} placeholder="Word" aria-label={`Nickname ${i + 1}: the word`}
                  onChange={(e) => patch({ aliases: d.aliases.map((x, j) => (j === i ? { ...x, word: e.target.value } : x)) })} />
                <select className="gedit-input gedit-alias-card" value={a.card} aria-label={`Nickname ${i + 1}: the card it means`}
                  onChange={(e) => patch({ aliases: d.aliases.map((x, j) => (j === i ? { ...x, card: e.target.value } : x)) })}>
                  <option value="">Pick a card</option>
                  {[...new Set([...listed, ...(a.card ? [a.card] : [])])].map((id) => <option key={id} value={id}>{views.get(id)?.name ?? id}</option>)}
                </select>
                {gone && <span className="gedit-alias-missing">Missing or removed</span>}
                <button type="button" className="gedit-mini gedit-remove" aria-label={`Remove nickname ${i + 1}`} onClick={() => patch({ aliases: d.aliases.filter((_, j) => j !== i) })}>x</button>
              </div>
            );
          })}
          <button type="button" className="gbtn" disabled={d.aliases.length >= GUIDE_LIMITS.aliases} onClick={() => patch({ aliases: [...d.aliases, { word: '', card: '' }] })}>Add nickname</button>
        </div>
      </div>
      <footer className="gedit-foot">
        {error && <p className="gedit-error" role="alert">{error}</p>}
        {ask === 'discard' && (
          <div className="gedit-ask" role="alertdialog" aria-label="Discard your changes?">
            <span>Discard your changes?</span>
            <button type="button" className="gbtn gbtn-danger" onClick={discard}>Discard</button>
            <button type="button" className="gbtn" onClick={() => setAsk(null)}>Keep editing</button>
          </div>
        )}
        {ask === 'delete' && (
          <div className="gedit-ask" role="alertdialog" aria-label="Delete this guide?">
            <span>Delete this guide? It cannot be brought back.</span>
            <button type="button" className="gbtn gbtn-danger" disabled={busy} onClick={() => void remove()}>Delete for good</button>
            <button type="button" className="gbtn" onClick={() => setAsk(null)}>Keep it</button>
          </div>
        )}
        {ask === 'conflict' && (
          <div className="gedit-ask" role="alertdialog" aria-label="Someone else saved this guide">
            <span>{guideErrorMessage('conflict')}</span>
            <button type="button" className="gbtn" disabled={busy} onClick={() => void loadTheirs()}>Load their version</button>
            <button type="button" className="gbtn gbtn-danger" disabled={busy} onClick={() => void overwrite()}>Overwrite with mine</button>
          </div>
        )}
        <div className="gedit-actions">
          {missing.size > 0 && (
            <button type="button" className="gbtn" onClick={() => patch({
              core: d.core.filter((id) => !missing.has(id)),
              enablers: d.enablers.filter((id) => !missing.has(id)),
              aliases: d.aliases.filter((a) => !missing.has(a.card)),
            })}>Remove missing cards</button>
          )}
          {!isNew && <button type="button" className="gbtn gbtn-danger" disabled={busy} onClick={() => setAsk('delete')}>Delete</button>}
          <span className="gedit-spacer" />
          <button type="button" className="gbtn" disabled={busy} onClick={cancel}>Cancel</button>
          <button type="button" className="gbtn gbtn-primary" disabled={busy || (!isNew && !dirty)} onClick={() => void save()}>{busy ? 'Saving' : 'Save'}</button>
        </div>
      </footer>
    </article>
  );
});
