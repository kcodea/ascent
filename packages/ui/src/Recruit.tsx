import type { DragEvent } from 'react';
import { CARD_INDEX } from '@game/content';
import { CONFIG, type BoardCard } from '@game/sim';
import { Card, type CardView } from './Card';
import { HudBar } from './HudBar';
import { StatusBar } from './StatusBar';
import { Omen } from './Omen';
import { Legend } from './Legend';
import { Icon } from './Icon';
import { useGame } from './store';

type DragSource = 'shop' | 'hand' | 'board';
/** Module-scoped drag payload — works with real and synthetic drag events (dataTransfer optional). */
let dragPayload: { uid: string; source: DragSource } | null = null;

const VERDICT = { win: 'HELD', lose: 'BROKEN', draw: 'STALEMATE' } as const;

function shopView(cardId: string): CardView {
  const c = CARD_INDEX[cardId];
  return {
    name: c.name, tribe: c.tribe, attack: c.attack, health: c.health,
    keywords: c.keywords, text: c.text, cost: CONFIG.minionCost,
  };
}
function instView(inst: BoardCard): CardView {
  const c = CARD_INDEX[inst.cardId];
  return {
    name: c.name, tribe: inst.tribe, attack: inst.attack, health: inst.health,
    keywords: inst.keywords, text: c.text, golden: inst.golden,
  };
}

export function Recruit() {
  const run = useGame((s) => s.run);
  const dispatch = useGame((s) => s.dispatch);
  const heroArmed = useGame((s) => s.heroArmed);
  const lc = run.lastCombat;
  const emptySlots = Math.max(0, CONFIG.boardMax - run.board.length);

  const startDrag = (uid: string, source: DragSource) => (e: DragEvent) => {
    dragPayload = { uid, source };
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  };
  const allowDrop = (e: DragEvent) => e.preventDefault();
  const take = (e: DragEvent): typeof dragPayload => {
    e.preventDefault();
    e.stopPropagation();
    const p = dragPayload;
    dragPayload = null;
    return p;
  };
  const dropTavern = (e: DragEvent) => {
    const p = take(e);
    if (p?.source === 'board') dispatch({ type: 'sell', uid: p.uid });
  };
  const dropHand = (e: DragEvent) => {
    const p = take(e);
    if (p?.source === 'shop') dispatch({ type: 'buy', uid: p.uid });
  };
  const dropWarband = (toIndex: number) => (e: DragEvent) => {
    const p = take(e);
    if (!p) return;
    if (p.source === 'hand') dispatch({ type: 'play', uid: p.uid, toIndex });
    else if (p.source === 'board') dispatch({ type: 'reposition', uid: p.uid, toIndex });
  };

  return (
    <div className="app">
      <HudBar />

      {lc && (
        <div className={`toast ${lc.result}`}>
          <span className="vd">{VERDICT[lc.result]}</span>
          <span>
            {lc.result === 'lose'
              ? `The omen broke through — −${lc.playerDamage} Resolve.`
              : lc.result === 'draw'
                ? 'The last clash ended in a stalemate.'
                : 'You held the wave — no Resolve lost.'}
          </span>
        </div>
      )}

      <Omen />

      <div className="zone">
        <div className="zh">
          <span className="zt disp">
            The Tavern · Tier <b>{run.tier}</b>
          </span>
          <span className="hint">drag down to your hand to buy (3) · drag a minion here to sell (+1)</span>
        </div>
        <div className="shopctl">
          <button className="btn big" disabled={run.embers < CONFIG.refreshCost} onClick={() => dispatch({ type: 'roll' })}>
            <Icon name="refresh" />
            Refresh <span className="c">{CONFIG.refreshCost}</span>
          </button>
          <button className={`btn big${run.frozen ? ' frozen' : ''}`} onClick={() => dispatch({ type: 'freeze' })}>
            <Icon name="freeze" />
            Freeze
          </button>
          <button
            className="btn big"
            disabled={run.tier >= CONFIG.maxTier || run.embers < run.upgradeCost}
            onClick={() => dispatch({ type: 'upgrade' })}
          >
            <Icon name="up" />
            {run.tier >= CONFIG.maxTier ? 'Tier MAX' : (
              <>
                Tier <span className="c">{run.upgradeCost}</span>
              </>
            )}
          </button>
        </div>
        <div className="row" onDragOver={allowDrop} onDrop={dropTavern}>
          {run.shop.map((o) => (
            <Card key={o.uid} card={shopView(o.cardId)} draggable onDragStart={startDrag(o.uid, 'shop')} />
          ))}
        </div>
      </div>

      <div className="zone">
        <div className="zh">
          <span className="zt disp">
            Your Warband · <b>{run.board.length}/{CONFIG.boardMax}</b>
          </span>
          <span className="hint">
            {heroArmed ? 'click a minion to Temper it (+1/+1)' : 'drag from hand to play · drag to reorder'}
          </span>
        </div>
        <div className="row" onDragOver={allowDrop} onDrop={dropWarband(Math.ceil(run.board.length / 2))}>
          {/* Empty slots split around the minions so the board anchors from the centre. */}
          {Array.from({ length: Math.floor(emptySlots / 2) }).map((_, i) => (
            <div className="empty" key={`eb-${i}`}>
              Empty
            </div>
          ))}
          {run.board.map((m, i) => (
            <Card
              key={m.uid}
              card={instView(m)}
              highlight={heroArmed}
              onClick={heroArmed ? () => dispatch({ type: 'heroPower', uid: m.uid }) : undefined}
              draggable
              onDragStart={startDrag(m.uid, 'board')}
              onDragOver={allowDrop}
              onDrop={dropWarband(i)}
            />
          ))}
          {Array.from({ length: emptySlots - Math.floor(emptySlots / 2) }).map((_, i) => (
            <div className="empty" key={`ea-${i}`}>
              Empty
            </div>
          ))}
        </div>
      </div>

      <div className="zone">
        <div className="zh">
          <span className="zt disp">
            Your Hand · <b>{run.hand.length}</b>
          </span>
          <span className="sp" />
          <button className="btn go" onClick={() => dispatch({ type: 'faceOmen' })}>
            <Icon name="sword" />
            FACE THE OMEN
          </button>
        </div>
        <div className="row hand" onDragOver={allowDrop} onDrop={dropHand}>
          {run.hand.length === 0 ? (
            <div className="empty" style={{ flex: '0 1 auto', padding: '0 24px', borderStyle: 'dashed' }}>
              Drag a minion down from the tavern to buy it, then drag it up to your warband to play.
            </div>
          ) : (
            run.hand.map((m) => (
              <Card key={m.uid} card={instView(m)} draggable onDragStart={startDrag(m.uid, 'hand')} />
            ))
          )}
        </div>
      </div>

      <StatusBar />
      <Legend />

      {run.discover && (
        <div className="discover-ov" role="dialog" aria-label="Discover a card">
          <div className="discover-box">
            <div className="discover-title">
              Triple! <b>Discover</b> a card to add to your hand.
            </div>
            <div className="discover-cards">
              {run.discover.map((id, i) => {
                const c = CARD_INDEX[id];
                return (
                  <Card
                    key={`${id}-${i}`}
                    card={{ name: c.name, tribe: c.tribe, attack: c.attack, health: c.health, keywords: c.keywords, text: c.text }}
                    onClick={() => dispatch({ type: 'discover', index: i })}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
