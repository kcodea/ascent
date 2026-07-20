import { useMemo, useState } from 'react';
import { CARD_INDEX } from '@game/content';
import type { BoardSnapshot, RunState, ShopCard } from '@game/sim';
import type { Keyword } from '@game/core';
import { useGame } from './store';
import { useDraggablePanel } from './useDraggablePanel';
import { turnClock } from './turnClock';

/**
 * DEV-only SCENE BUILDER — a sandbox rig for testing any board/effect/interaction (owner ask 2026-07-21).
 * Not a game mode: it mutates the LIVE run in place via the store, so every real system (buy-time effects,
 * combat, quests, FX) runs exactly as in a normal game. Search a card → drop it in the shop and buy it with
 * the unlimited gold; set the tavern tier; freeze the turn clock; and stock the next fight with dummies at a
 * chosen HP/Attack so you can watch an effect land against a glass or a tank.
 *
 * Everything here writes `useGame.setState({ run })` — the same door the reducer uses — so nothing bypasses
 * the sim. Stripped from production with the rest of the dev menu.
 */
type CardRow = { id: string; name: string; tier: number; spell: boolean; tribe: string };

function mutate(fn: (r: RunState) => RunState): void {
  const run = useGame.getState().run;
  if (!run) return;
  useGame.setState({ run: fn({ ...run }) });
}

let uidN = 0;
const uid = (): string => `sb${uidN++}`;

export function SceneBuilder() {
  const run = useGame((s) => s.run);
  const [query, setQuery] = useState('');
  const [enemyHp, setEnemyHp] = useState(5);
  const [enemyAtk, setEnemyAtk] = useState(0);
  const [enemyN, setEnemyN] = useState(5);
  const [refill, setRefill] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('scenebuilder');

  // All non-token cards, sorted by tier then name — the search pool.
  const all = useMemo<CardRow[]>(() => {
    return Object.values(CARD_INDEX)
      .filter((c) => !c.token)
      .map((c) => ({ id: c.id, name: c.name, tier: c.tier ?? 0, spell: !!c.spell, tribe: c.tribe ?? 'neutral' }))
      .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 60);
    return all.filter((c) => c.name.toLowerCase().includes(q) || c.id.includes(q) || c.tribe.includes(q)).slice(0, 60);
  }, [all, query]);

  // Unlimited gold: top the pool back up whenever it dips, while the toggle is on. Cheap — a subscribe on
  // `run.embers`. The manual "+1000" button works without it.
  if (refill && run && (run.embers ?? 0) < 900) {
    queueMicrotask(() => mutate((r) => ({ ...r, embers: 999 })));
  }

  const addToShop = (cardId: string): void =>
    mutate((r) => ({ ...r, shop: [...r.shop, { uid: uid(), cardId } as ShopCard] }));

  const setTier = (tier: number): void => mutate((r) => ({ ...r, tier }));
  const giveGold = (): void => mutate((r) => ({ ...r, embers: (r.embers ?? 0) + 1000 }));
  const clearShop = (): void => mutate((r) => ({ ...r, shop: [] }));
  const clearBoard = (): void => mutate((r) => ({ ...r, board: [] }));
  const freezeTime = (): void => turnClock.set(9999);

  // Stock the NEXT combat with N dummies at the chosen HP/Attack by pinning this wave's served board. Combat
  // reads `servedBoards[wave]` verbatim (see nextOpponent), so these fight exactly as authored.
  const setEnemies = (hp: number, atk: number, n: number): void => mutate((r) => {
    const board: BoardSnapshot = {
      v: 1, wave: r.wave, heroId: 'warden', resolve: 30, tier: 7, triples: 0, tribes: [],
      threat: 'glass', power: hp * n,
      minions: Array.from({ length: Math.max(1, n) }, () => ({
        cardId: 'sandbag', attack: Math.max(0, atk), health: Math.max(1, hp), keywords: [] as Keyword[],
      })),
      seed: 1, origin: 'self',
    };
    return { ...r, servedBoards: { ...(r.servedBoards ?? {}), [r.wave]: board } };
  });

  return (
    <div className="sfxmix lunge scenebuilder" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Scene Builder <span>dev · sandbox · drag</span></div>

      {/* Quick levers */}
      <div className="sb-quick">
        <button className="sfxmix-copy" onClick={giveGold} title="Add 1000 Gold">+1000 g</button>
        <label className="sb-toggle" title="Keep Gold topped up">
          <input type="checkbox" checked={refill} onChange={(e) => setRefill(e.target.checked)} /> ∞ gold
        </label>
        <button className="sfxmix-copy" onClick={freezeTime} title="Freeze the turn timer">❄ time</button>
      </div>
      <div className="sb-quick">
        <span className="sfxmix-name">tier</span>
        {[1, 2, 3, 4, 5, 6, 7].map((t) => (
          <button key={t} className={`sb-tier${run?.tier === t ? ' on' : ''}`} onClick={() => setTier(t)}>{t}</button>
        ))}
      </div>
      <div className="sb-quick">
        <button className="sfxmix-copy" onClick={clearShop}>clear shop</button>
        <button className="sfxmix-copy" onClick={clearBoard}>clear board</button>
      </div>

      {/* Enemy setup */}
      <div className="sb-quick">
        <span className="sfxmix-name">enemy</span>
        <label className="sb-num">n<input type="number" min={1} max={7} value={enemyN} onChange={(e) => setEnemyN(Number(e.target.value))} /></label>
        <label className="sb-num">hp<input type="number" min={1} value={enemyHp} onChange={(e) => setEnemyHp(Number(e.target.value))} /></label>
        <label className="sb-num">atk<input type="number" min={0} value={enemyAtk} onChange={(e) => setEnemyAtk(Number(e.target.value))} /></label>
      </div>
      <div className="sb-quick">
        <button className="sfxmix-copy" onClick={() => setEnemies(enemyHp, enemyAtk, enemyN)}>set enemies</button>
        <button className="sfxmix-copy" onClick={() => setEnemies(1, 0, 7)} title="7 glass dummies">glass ×7</button>
        <button className="sfxmix-copy" onClick={() => setEnemies(300, 0, 1)} title="1 tank dummy">tank</button>
      </div>

      {/* Card search → shop */}
      <input
        className="sb-search"
        placeholder="search cards → click to add to shop"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="sb-results">
        {results.map((c) => (
          <button key={c.id} className="sb-card" onClick={() => addToShop(c.id)} title={`Add ${c.name} (T${c.tier}) to the shop`}>
            <span className={`sb-t sb-t${c.tier}`}>{c.tier}</span>
            <span className="sb-name">{c.name}</span>
            {c.spell && <span className="sb-spell">spell</span>}
          </button>
        ))}
        {results.length === 0 && <div className="sb-empty">no matches</div>}
      </div>
    </div>
  );
}
