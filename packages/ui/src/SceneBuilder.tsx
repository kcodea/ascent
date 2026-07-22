import { useMemo, useState } from 'react';
import { CARD_INDEX, QUEST_DEFS, RUNES, EPIC_RUNES } from '@game/content';
import { HEROES, type BoardSnapshot, type RunState, type ShopCard } from '@game/sim';
import type { Keyword } from '@game/core';
import { useGame } from './store';
import { useDraggablePanel } from './useDraggablePanel';
import { turnClock } from './turnClock';

/**
 * DEV-only SCENE BUILDER control panel — the sandbox rig launched from the title (its own mode, see
 * `startSceneBuilder`). It mutates the LIVE run via the store, so every real system (buy-time effects,
 * combat, quests, FX) runs exactly as in a normal game — nothing bypasses the sim.
 *
 * Layout: a header, then labelled sections (Hero · Economy · Board · Enemies · Cards), each a compact row so
 * the whole rig reads at a glance. Collapsible so it can tuck out of the way while you watch a fight.
 * Stripped from production with the rest of the dev tooling.
 */
type CardRow = { id: string; name: string; tier: number; spell: boolean; tribe: string; hay: string };
type QuestRow = { id: string; name: string; tribe: string; tier: string; hay: string };
type RuneRow = { id: string; name: string; cost: number; epic: boolean; hay: string };

/** Everything a row can be matched on, lowercased once at module load. Searching the card's TEXT (not just
 *  its name/tribe) is what makes keyword queries work — "avenge", "deathrattle", "taunt", "magnetic" all live
 *  in the rules text or the keyword list rather than the title. Effect trigger/factory ids go in too, so a
 *  mechanic can be found even when the printed text words it differently. */
const hay = (...parts: (string | undefined)[]): string => parts.filter(Boolean).join(' ').toLowerCase();

/** Split a query on whitespace and require EVERY term to match (AND), so "avenge beast" narrows instead of
 *  widening. Each term is a plain substring test against the row's haystack. */
const matches = (haystack: string, terms: string[]): boolean => terms.every((t) => haystack.includes(t));

function mutate(fn: (r: RunState) => RunState): void {
  const run = useGame.getState().run;
  if (!run) return;
  useGame.setState({ run: fn({ ...run }) });
}

let uidN = 0;
const uid = (): string => `sb${uidN++}`;

const HERO_OPTIONS = HEROES.map((h) => ({ id: h.id, name: h.name })).sort((a, b) => a.name.localeCompare(b.name));

export function SceneBuilder() {
  const run = useGame((s) => s.run);
  const startSceneBuilder = useGame((s) => s.startSceneBuilder);
  const dispatch = useGame((s) => s.dispatch);
  const [query, setQuery] = useState('');
  const [enemyHp, setEnemyHp] = useState(5);
  const [enemyAtk, setEnemyAtk] = useState(0);
  const [enemyN, setEnemyN] = useState(5);
  const [refill, setRefill] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('scenebuilder');

  const all = useMemo<CardRow[]>(() =>
    Object.values(CARD_INDEX)
      .filter((c) => !c.token)
      .map((c) => ({
        id: c.id, name: c.name, tier: c.tier ?? 0, spell: !!c.spell, tribe: c.tribe ?? 'neutral',
        // Keywords + rules text + effect ids, so "avenge" / "deathrattle" / "magnetic" find their cards.
        hay: hay(c.name, c.id, c.tribe, c.tribe2, c.text, (c.keywords ?? []).join(' '),
          (c.effects ?? []).map((e) => `${e.on} ${e.do}`).join(' ')),
      }))
      .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)),
  []);

  const allQuests = useMemo<QuestRow[]>(() =>
    QUEST_DEFS
      .map((q) => ({
        id: q.id, name: q.name, tribe: q.tribe ?? 'neutral', tier: String(q.tier),
        hay: hay(q.name, q.id, q.tribe, String(q.tier), q.objective?.event, q.reward?.kind),
      }))
      .sort((a, b) => a.tier.localeCompare(b.tier) || a.name.localeCompare(b.name)),
  []);

  const allRunes = useMemo<RuneRow[]>(() =>
    [...RUNES, ...EPIC_RUNES]
      .map((r) => ({
        id: r.id, name: r.name, cost: r.cost, epic: !!r.epic,
        hay: hay(r.name, r.id, r.text, r.reward?.kind, r.epic ? 'epic' : 'basic'),
      }))
      .sort((a, b) => Number(a.epic) - Number(b.epic) || a.name.localeCompare(b.name)),
  []);

  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const results = useMemo(() => all.filter((c) => matches(c.hay, terms)).slice(0, 80), [all, terms]);
  const questResults = useMemo(() => allQuests.filter((q) => matches(q.hay, terms)), [allQuests, terms]);
  const runeResults = useMemo(() => allRunes.filter((r) => matches(r.hay, terms)), [allRunes, terms]);

  // ∞ gold — top the pool back up whenever it dips (default on). Cheap: a subscribe on `run.embers`.
  if (refill && run && (run.embers ?? 0) < 900) {
    queueMicrotask(() => mutate((r) => ({ ...r, embers: 999 })));
  }

  const addToShop = (cardId: string): void => mutate((r) => ({ ...r, shop: [...r.shop, { uid: uid(), cardId } as ShopCard] }));
  // Quests / runes go through the REAL reducer (not `mutate`), so the reward engine, triple checks and modal
  // queueing all run exactly as they would in a played run — which is the only way the interaction under test
  // is the real one. Clicking a quest completes it (pays the reward); "◷" adds it un-started to watch it fill.
  const grantQuest = (id: string, completed: boolean): void => dispatch({ type: 'devGrant', kind: 'quest', id, completed });
  const grantRune = (id: string): void => dispatch({ type: 'devGrant', kind: 'rune', id });
  const setTier = (tier: number): void => mutate((r) => ({ ...r, tier }));
  const giveGold = (): void => mutate((r) => ({ ...r, embers: (r.embers ?? 0) + 1000 }));
  const freezeTime = (): void => turnClock.set(9999);
  const clearShop = (): void => mutate((r) => ({ ...r, shop: [] }));
  const clearBoard = (): void => mutate((r) => ({ ...r, board: [] }));
  const clearAll = (): void => mutate((r) => ({ ...r, shop: [], board: [], hand: [] }));

  // Stock the NEXT combat with N dummies at the chosen HP/Attack — pins this wave's served board, which combat
  // reads verbatim (`nextOpponent`), so they fight exactly as authored.
  const setEnemies = (hp: number, atk: number, n: number): void => mutate((r) => {
    const board: BoardSnapshot = {
      v: 1, wave: r.wave, heroId: 'warden', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: hp * n,
      minions: Array.from({ length: Math.max(1, n) }, () => ({
        cardId: 'sandbag', attack: Math.max(0, atk), health: Math.max(1, hp), keywords: [] as Keyword[],
      })),
      seed: 1, origin: 'self',
    };
    return { ...r, servedBoards: { ...(r.servedBoards ?? {}), [r.wave]: board } };
  });

  return (
    <div className={`sfxmix lunge scenebuilder${collapsed ? ' collapsed' : ''}`} ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag sb-head" onPointerDown={headerPointerDown}>
        <span>🧩 Scene Builder</span>
        <button className="sb-collapse" onPointerDown={(e) => e.stopPropagation()} onClick={() => setCollapsed((c) => !c)} title={collapsed ? 'Expand' : 'Collapse'}>{collapsed ? '▸' : '▾'}</button>
      </div>

      {!collapsed && (
        <div className="sb-body">
          {/* HERO */}
          <div className="sb-sec">
            <div className="sb-label">Hero</div>
            <select
              className="sb-select"
              value={run?.heroId ?? 'warden'}
              onChange={(e) => startSceneBuilder(e.target.value)}
              title="Switch hero (restarts the sandbox so the hero's opener runs)"
            >
              {HERO_OPTIONS.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>

          {/* ECONOMY */}
          <div className="sb-sec">
            <div className="sb-label">Economy</div>
            <div className="sb-row">
              <button className="sb-btn" onClick={giveGold}>+1000 g</button>
              <label className="sb-chk" title="Keep Gold topped up">
                <input type="checkbox" checked={refill} onChange={(e) => setRefill(e.target.checked)} /> ∞ gold
              </label>
              <button className="sb-btn" onClick={freezeTime} title="Freeze the turn timer">❄ freeze time</button>
            </div>
            <div className="sb-row">
              <span className="sb-mini">tier</span>
              {[1, 2, 3, 4, 5, 6, 7].map((t) => (
                <button key={t} className={`sb-tier${run?.tier === t ? ' on' : ''}`} onClick={() => setTier(t)}>{t}</button>
              ))}
            </div>
          </div>

          {/* BOARD */}
          <div className="sb-sec">
            <div className="sb-label">Board</div>
            <div className="sb-row">
              <button className="sb-btn" onClick={clearShop}>clear shop</button>
              <button className="sb-btn" onClick={clearBoard}>clear board</button>
              <button className="sb-btn" onClick={clearAll}>clear all</button>
            </div>
          </div>

          {/* ENEMIES */}
          <div className="sb-sec">
            <div className="sb-label">Next enemy</div>
            <div className="sb-row">
              <label className="sb-num">×<input type="number" min={1} max={7} value={enemyN} onChange={(e) => setEnemyN(Number(e.target.value))} /></label>
              <label className="sb-num">hp<input type="number" min={1} value={enemyHp} onChange={(e) => setEnemyHp(Number(e.target.value))} /></label>
              <label className="sb-num">atk<input type="number" min={0} value={enemyAtk} onChange={(e) => setEnemyAtk(Number(e.target.value))} /></label>
              <button className="sb-btn sb-primary" onClick={() => setEnemies(enemyHp, enemyAtk, enemyN)}>set</button>
            </div>
            <div className="sb-row">
              <button className="sb-btn" onClick={() => setEnemies(1, 0, 7)} title="7 glass dummies (1 hp)">glass ×7</button>
              <button className="sb-btn" onClick={() => setEnemies(300, 0, 1)} title="1 tank dummy (300 hp)">tank</button>
              <button className="sb-btn" onClick={() => setEnemies(20, 20, 5)} title="5 bruisers (20/20)">bruisers</button>
            </div>
          </div>

          {/* SEARCH — one box filters the three libraries below (cards, quests, runes). */}
          <div className="sb-sec">
            <div className="sb-label">Search</div>
            <input
              className="sb-search"
              placeholder="name, id, tribe, or keyword (e.g. avenge, deathrattle)…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              title="Matches name, id, tribe, keywords, rules text and effect ids. Space-separated terms must ALL match."
            />
          </div>

          {/* CARDS */}
          <div className="sb-sec">
            <div className="sb-label">Cards → shop <span className="sb-count">{results.length}</span></div>
            <div className="sb-results">
              {results.map((c) => (
                <button key={c.id} className="sb-card" onClick={() => addToShop(c.id)} title={`Add ${c.name} (Tier ${c.tier}) to the shop`}>
                  <span className={`sb-t sb-t${c.tier}`}>{c.tier}</span>
                  <span className="sb-name">{c.name}</span>
                  {c.spell && <span className="sb-tag">spell</span>}
                </button>
              ))}
              {results.length === 0 && <div className="sb-empty">no matches</div>}
            </div>
          </div>

          {/* QUESTS — click completes it (reward pays out now); ◷ adds it un-started to watch the bar fill. */}
          <div className="sb-sec">
            <div className="sb-label">Quests → completed <span className="sb-count">{questResults.length}</span></div>
            <div className="sb-results">
              {questResults.map((q) => (
                <div key={q.id} className="sb-card sb-qrow">
                  <button className="sb-qmain" onClick={() => grantQuest(q.id, true)} title={`Complete ${q.name} now — its reward pays out immediately`}>
                    <span className="sb-name">{q.name}</span>
                    <span className="sb-tag">{q.tribe}</span>
                  </button>
                  <button className="sb-qadd" onClick={() => grantQuest(q.id, false)} title={`Add ${q.name} un-started, to watch it progress`}>◷</button>
                </div>
              ))}
              {questResults.length === 0 && <div className="sb-empty">no matches</div>}
            </div>
          </div>

          {/* RUNES — granting one applies its reward for the run, exactly like buying it in the Runeforge. */}
          <div className="sb-sec">
            <div className="sb-label">Runes → owned <span className="sb-count">{runeResults.length}</span></div>
            <div className="sb-results">
              {runeResults.map((r) => (
                <button key={r.id} className="sb-card" onClick={() => grantRune(r.id)} title={`Grant ${r.name} — its reward applies for the run (free here)`}>
                  <span className="sb-name">{r.name}</span>
                  {r.epic && <span className="sb-tag">epic</span>}
                </button>
              ))}
              {runeResults.length === 0 && <div className="sb-empty">no matches</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
