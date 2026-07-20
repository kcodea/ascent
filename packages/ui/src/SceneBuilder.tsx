import { useMemo, useState } from 'react';
import { CARD_INDEX } from '@game/content';
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
type CardRow = { id: string; name: string; tier: number; spell: boolean; tribe: string };

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
      .map((c) => ({ id: c.id, name: c.name, tier: c.tier ?? 0, spell: !!c.spell, tribe: c.tribe ?? 'neutral' }))
      .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)),
  []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? all.filter((c) => c.name.toLowerCase().includes(q) || c.id.includes(q) || c.tribe.includes(q)) : all;
    return pool.slice(0, 80);
  }, [all, query]);

  // ∞ gold — top the pool back up whenever it dips (default on). Cheap: a subscribe on `run.embers`.
  if (refill && run && (run.embers ?? 0) < 900) {
    queueMicrotask(() => mutate((r) => ({ ...r, embers: 999 })));
  }

  const addToShop = (cardId: string): void => mutate((r) => ({ ...r, shop: [...r.shop, { uid: uid(), cardId } as ShopCard] }));
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

          {/* CARDS */}
          <div className="sb-sec">
            <div className="sb-label">Cards → shop <span className="sb-count">{results.length}</span></div>
            <input className="sb-search" placeholder="search by name, id, or tribe…" value={query} onChange={(e) => setQuery(e.target.value)} />
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
        </div>
      )}
    </div>
  );
}
