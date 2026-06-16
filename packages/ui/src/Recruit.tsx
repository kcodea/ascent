import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
type Zone = 'tavern' | 'warband' | 'hand';

const DRAG_THRESHOLD = 5; // px the pointer must move before a click becomes a drag
const TURN_SECONDS = 30; // round timer; at 0 the player is forced into combat
const RING = 2 * Math.PI * 17; // countdown ring circumference

function shopView(cardId: string): CardView {
  const c = CARD_INDEX[cardId];
  return {
    name: c.name, tribe: c.tribe, attack: c.attack, health: c.health,
    keywords: c.keywords, text: c.text, cost: CONFIG.minionCost, tier: c.tier,
    baseAttack: c.attack, baseHealth: c.health,
  };
}
function instView(inst: BoardCard): CardView {
  const c = CARD_INDEX[inst.cardId];
  const spell = c.id === 'discoverspell';
  return {
    name: c.name, tribe: inst.tribe, attack: inst.attack, health: inst.health,
    keywords: inst.keywords, text: c.text, golden: inst.golden,
    tier: spell ? undefined : c.tier, spell,
    baseAttack: inst.golden ? c.attack * 2 : c.attack,
    baseHealth: inst.golden ? c.health * 2 : c.health,
  };
}

interface DragState {
  uid: string;
  source: DragSource;
  view: CardView;
  ox: number; oy: number; // pointer offset within the card
  w: number; h: number; // the source card's size, so the floating card matches exactly
  startX: number; startY: number; // pointer position at press
  x: number; y: number; // current pointer
  active: boolean; // crossed the drag threshold (vs a click)
}

export function Recruit() {
  const run = useGame((s) => s.run);
  const dispatch = useGame((s) => s.dispatch);
  const heroArmed = useGame((s) => s.heroArmed);
  const emptySlots = Math.max(0, CONFIG.boardMax - run.board.length);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [overZone, setOverZone] = useState<Zone | null>(null);
  const [snapping, setSnapping] = useState(false);
  const [aim, setAim] = useState<{ ox: number; oy: number; tx: number; ty: number; onTarget: boolean } | null>(null);
  const [seconds, setSeconds] = useState(TURN_SECONDS);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const timeUp = seconds <= 0; // turn timer expired: lock everything but End Turn

  const zoneAt = (x: number, y: number): Zone | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-zone]');
    return (el?.getAttribute('data-zone') as Zone) ?? null;
  };
  // Insertion index in the warband, from the pointer's x against the cards' centres.
  const warbandIndexAt = (x: number): number => {
    const cards = [...document.querySelectorAll('[data-zone="warband"] .card')];
    let i = 0;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (x > r.left + r.width / 2) i++;
    }
    return i;
  };

  const beginDrag = (uid: string, source: DragSource, view: CardView) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || timeUp) return; // no dragging once the turn timer is up
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDrag({
      uid, source, view,
      ox: e.clientX - r.left, oy: e.clientY - r.top,
      w: r.width, h: r.height,
      startX: e.clientX, startY: e.clientY,
      x: e.clientX, y: e.clientY,
      active: false,
    });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent): void => {
      setDrag((d) => {
        if (!d) return d;
        const active = d.active || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_THRESHOLD;
        return { ...d, x: e.clientX, y: e.clientY, active };
      });
      setOverZone(zoneAt(e.clientX, e.clientY));
    };
    const onUp = (e: PointerEvent): void => {
      document.body.classList.remove('dragging'); // cursor reverts on release, before any snap-back
      const d = dragRef.current;
      if (!d || !d.active) {
        // a click, not a drag — let onClick (hero targeting) handle it
        setDrag(null);
        setOverZone(null);
        return;
      }
      const zone = zoneAt(e.clientX, e.clientY);
      const acted = applyDrop(d, zone, e.clientX);
      if (acted) {
        setDrag(null);
        setOverZone(null);
      } else {
        // invalid drop — snap the card cleanly back to where it came from
        setSnapping(true);
        setDrag((cur) => (cur ? { ...cur, x: cur.startX, y: cur.startY } : cur));
        window.setTimeout(() => {
          setSnapping(false);
          setDrag(null);
          setOverZone(null);
        }, 150);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag?.uid]);

  // Drive the closed-fist cursor strictly off drag state, so it can never get
  // stranded on (the bug where the grab cursor stuck after the first drag).
  useEffect(() => {
    if (!drag?.active) return;
    document.body.classList.add('dragging');
    return () => document.body.classList.remove('dragging');
  }, [drag?.active]);

  // Hero Power targeting: while armed, draw a glowing line from the hero to the
  // cursor, snapping to the friendly minion under it. (A future single-target
  // Battlecry would reuse this — random/tribe-wide effects never arm targeting.)
  useEffect(() => {
    if (!heroArmed) {
      setAim(null);
      return;
    }
    const move = (e: PointerEvent): void => {
      const f = document.querySelector('.statusbar .hero .f');
      if (!f) return;
      const r = f.getBoundingClientRect();
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-zone="warband"] .card');
      let tx = e.clientX;
      let ty = e.clientY;
      if (target) {
        const cr = target.getBoundingClientRect();
        tx = cr.left + cr.width / 2;
        ty = cr.top + cr.height / 2;
      }
      setAim({ ox: r.left + r.width / 2, oy: r.top + r.height / 2, tx, ty, onTarget: !!target });
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [heroArmed]);

  // Round timer: count down each recruit turn; at 0 the player is forced into
  // combat (paused while a Discover pick is open). UI-only — the engine is untimed.
  useEffect(() => {
    // At 0 the timer just stops — actions lock (except End Turn); no auto-combat.
    if (run.phase !== 'recruit' || seconds <= 0 || run.discover) return;
    const id = window.setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [seconds, run.phase, run.discover]);

  const applyDrop = (d: DragState, zone: Zone | null, x: number): boolean => {
    if (d.source === 'shop' && zone === 'hand') {
      dispatch({ type: 'buy', uid: d.uid });
      return true;
    }
    if (d.source === 'hand' && zone === 'warband') {
      dispatch({ type: 'play', uid: d.uid, toIndex: warbandIndexAt(x) });
      return true;
    }
    if (d.source === 'board' && zone === 'warband') {
      dispatch({ type: 'reposition', uid: d.uid, toIndex: warbandIndexAt(x) });
      return true;
    }
    if ((d.source === 'board' || d.source === 'hand') && zone === 'tavern') {
      dispatch({ type: 'sell', uid: d.uid });
      return true;
    }
    return false;
  };

  // Gold sell-preview glow: an owned card hovered over the tavern.
  const sellGlow = overZone === 'tavern' && (drag?.source === 'board' || drag?.source === 'hand');
  const isDragging = (uid: string): boolean => drag?.active === true && drag.uid === uid;

  return (
    <div className="app">
      <HudBar />

      <div className="rtimer" data-low={seconds <= 5} title="Time left this turn — at 0 your actions lock; hit End Turn to fight">
        <svg viewBox="0 0 40 40">
          <circle className="rt-bg" cx="20" cy="20" r="17" />
          <circle
            className="rt-fg"
            cx="20"
            cy="20"
            r="17"
            style={{ strokeDasharray: RING, strokeDashoffset: RING * (1 - Math.max(0, seconds) / TURN_SECONDS) }}
          />
        </svg>
        <span className="rt-n">{Math.max(0, seconds)}</span>
      </div>

      <Omen />

      <div className={`zone${sellGlow ? ' sellglow' : ''}`} data-zone="tavern">
        <div className="zh">
          <span className="zt disp">
            The Tavern · Tier <b>{run.tier}</b>
          </span>
          <span className="hint">drag down to your hand to buy (3) · drag a minion here to sell (+1)</span>
        </div>
        <div className="shopctl">
          <button className="btn big" disabled={run.embers < CONFIG.refreshCost || timeUp} onClick={() => dispatch({ type: 'roll' })}>
            <Icon name="refresh" />
            Refresh <span className="c">{CONFIG.refreshCost}</span>
          </button>
          <button className={`btn big${run.frozen ? ' frozen' : ''}`} disabled={timeUp} onClick={() => dispatch({ type: 'freeze' })}>
            <Icon name="freeze" />
            Freeze
          </button>
          <button
            className="btn big"
            disabled={run.tier >= CONFIG.maxTier || run.embers < run.upgradeCost || timeUp}
            onClick={() => dispatch({ type: 'upgrade' })}
          >
            <Icon name="up" />
            {run.tier >= CONFIG.maxTier ? 'Tier MAX' : (
              <>
                Tier <span className="c">{run.upgradeCost}</span>
              </>
            )}
          </button>
          <button className={`btn big endturn${timeUp ? ' urgent' : ''}`} onClick={() => dispatch({ type: 'faceOmen' })}>
            <Icon name="sword" />
            End Turn
          </button>
        </div>
        <div className="row">
          {run.shop.map((o) => (
            <Card
              key={o.uid}
              card={shopView(o.cardId)}
              dimmed={isDragging(o.uid)}
              onPointerDown={beginDrag(o.uid, 'shop', shopView(o.cardId))}
            />
          ))}
        </div>
      </div>

      <div className="zone" data-zone="warband">
        <div className="zh">
          <span className="zt disp">
            Your Warband · <b>{run.board.length}/{CONFIG.boardMax}</b>
          </span>
          <span className="hint">
            {heroArmed ? 'click a minion to Temper it (+1/+1)' : 'drag from hand to play · drag to reorder'}
          </span>
        </div>
        <div className="row">
          {Array.from({ length: Math.floor(emptySlots / 2) }).map((_, i) => (
            <div className="empty" key={`eb-${i}`}>
              Empty
            </div>
          ))}
          {run.board.map((m) => (
            <Card
              key={m.uid}
              card={instView(m)}
              highlight={heroArmed}
              dimmed={isDragging(m.uid)}
              onClick={heroArmed && !timeUp ? () => dispatch({ type: 'heroPower', uid: m.uid }) : undefined}
              onPointerDown={beginDrag(m.uid, 'board', instView(m))}
            />
          ))}
          {Array.from({ length: emptySlots - Math.floor(emptySlots / 2) }).map((_, i) => (
            <div className="empty" key={`ea-${i}`}>
              Empty
            </div>
          ))}
        </div>
      </div>

      <div className="zone" data-zone="hand">
        <div className="zh">
          <span className="zt disp">
            Your Hand · <b>{run.hand.length}</b>
          </span>
        </div>
        <div className="row hand">
          {run.hand.length === 0 ? (
            <div className="empty" style={{ flex: '0 1 auto', padding: '0 24px', borderStyle: 'dashed' }}>
              Drag a minion down from the tavern to buy it, then drag it up to your warband to play.
            </div>
          ) : (
            run.hand.map((m) => (
              <Card
                key={m.uid}
                card={instView(m)}
                dimmed={isDragging(m.uid)}
                onPointerDown={beginDrag(m.uid, 'hand', instView(m))}
              />
            ))
          )}
        </div>
      </div>

      <StatusBar />
      <Legend />

      {drag?.active && (
        <div
          className={`dragcard${snapping ? ' snap' : ''}`}
          style={{
            width: drag.w,
            height: drag.h,
            transform: `translate(${drag.x - drag.ox}px, ${drag.y - drag.oy}px) scale(1.04) rotate(-2deg)`,
          }}
        >
          <Card card={drag.view} />
        </div>
      )}

      {heroArmed && aim && (
        <svg className="aimline" aria-hidden="true">
          <line x1={aim.ox} y1={aim.oy} x2={aim.tx} y2={aim.ty} />
          <circle cx={aim.tx} cy={aim.ty} r={aim.onTarget ? 16 : 7} className={aim.onTarget ? 'on' : ''} />
        </svg>
      )}

      {run.discover && (
        <div className="discover-ov" role="dialog" aria-label="Discover a card">
          <div className="discover-box">
            <div className="discover-title">
              <b>Discover</b> — choose a minion from the next tier.
            </div>
            <div className="discover-cards">
              {run.discover.map((id, i) => {
                const c = CARD_INDEX[id];
                return (
                  <Card
                    key={`${id}-${i}`}
                    card={{ name: c.name, tribe: c.tribe, attack: c.attack, health: c.health, keywords: c.keywords, text: c.text, tier: c.tier }}
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
