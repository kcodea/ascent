import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { CARD_INDEX } from '@game/content';
import { CONFIG, type BoardCard } from '@game/sim';
import { Card, type CardView } from './Card';
import { HudBar } from './HudBar';
import { Omen } from './Omen';
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
  const armHero = useGame((s) => s.armHero);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [overZone, setOverZone] = useState<Zone | null>(null);
  const [snapping, setSnapping] = useState(false);
  const [aim, setAim] = useState<{ ox: number; oy: number; tx: number; ty: number; onTarget: boolean } | null>(null);
  const [seconds, setSeconds] = useState(TURN_SECONDS);
  const [buffedUids, setBuffedUids] = useState<Set<string>>(new Set());
  const prevStatsRef = useRef<Map<string, number>>(new Map());
  const flipRef = useRef<Map<string, number>>(new Map());
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

  // Hero Power targeting: arm by pressing the hero, then drag a glowing line to a
  // friendly minion and release on it (anywhere on the card is a valid target);
  // release off a minion to cancel. A plain click stays armed for a follow-up
  // click. (A future single-target Battlecry would reuse this exact flow.)
  useEffect(() => {
    if (!heroArmed) {
      setAim(null);
      return;
    }
    let moved = false;
    const minionAt = (x: number, y: number): BoardCard | null => {
      const el = document.elementFromPoint(x, y)?.closest('[data-zone="warband"] .row .card');
      if (!el) return null;
      const cards = [...document.querySelectorAll('[data-zone="warband"] .row .card')];
      return run.board[cards.indexOf(el)] ?? null;
    };
    const move = (e: PointerEvent): void => {
      moved = true;
      const f = document.querySelector('.statusbar .hero .f');
      if (!f) return;
      const r = f.getBoundingClientRect();
      const targetEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-zone="warband"] .row .card');
      let tx = e.clientX;
      let ty = e.clientY;
      if (targetEl) {
        const cr = targetEl.getBoundingClientRect();
        tx = cr.left + cr.width / 2;
        ty = cr.top + cr.height / 2;
      }
      setAim({ ox: r.left + r.width / 2, oy: r.top + r.height / 2, tx, ty, onTarget: !!targetEl });
    };
    const up = (e: PointerEvent): void => {
      if (!moved) return; // a plain click — stays armed for a follow-up click
      const target = minionAt(e.clientX, e.clientY);
      if (target && !timeUp) dispatch({ type: 'heroPower', uid: target.uid });
      else armHero(); // released without a valid target — snaps back / cancels
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [heroArmed, run.board, timeUp, dispatch, armHero]);

  // Round timer: count down each recruit turn; at 0 the player is forced into
  // combat (paused while a Discover pick is open). UI-only — the engine is untimed.
  useEffect(() => {
    // At 0 the timer just stops — actions lock (except End Turn); no auto-combat.
    if (run.phase !== 'recruit' || seconds <= 0 || run.discover) return;
    const id = window.setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [seconds, run.phase, run.discover]);

  // Flash a card green when its stats jump in the recruit phase (a buff landed).
  useEffect(() => {
    const prev = prevStatsRef.current;
    const next = new Map<string, number>();
    const newly: string[] = [];
    for (const c of [...run.board, ...run.hand]) {
      const cur = c.attack + c.health;
      next.set(c.uid, cur);
      if (prev.has(c.uid) && cur > (prev.get(c.uid) ?? 0)) newly.push(c.uid);
    }
    prevStatsRef.current = next;
    if (newly.length === 0) return;
    setBuffedUids((s) => new Set([...s, ...newly]));
    const t = window.setTimeout(() => {
      setBuffedUids((s) => {
        const n = new Set(s);
        for (const u of newly) n.delete(u);
        return n;
      });
    }, 700);
    return () => window.clearTimeout(t);
  }, [run.board, run.hand]);

  // FLIP: when the warband reorders (a minion played / sold / repositioned), slide
  // the existing cards from their old spots to their new ones (a quick shuffle).
  useLayoutEffect(() => {
    const cards = document.querySelectorAll<HTMLElement>('[data-zone="warband"] .row .card[data-uid]');
    const next = new Map<string, number>();
    cards.forEach((el) => {
      const id = el.getAttribute('data-uid');
      if (!id) return;
      const left = el.getBoundingClientRect().left;
      next.set(id, left);
      const prev = flipRef.current.get(id);
      if (prev !== undefined && Math.abs(prev - left) > 1) {
        el.style.transition = 'none';
        el.style.transform = `translateX(${prev - left}px)`;
        requestAnimationFrame(() => {
          el.style.transition = 'transform 0.28s ease';
          el.style.transform = '';
        });
      }
    });
    flipRef.current = next;
  }, [run.board]);

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
  // Electric flair while a Magnetic minion hovers a friendly Mech (it'll merge on drop).
  const wouldMagnetize =
    !!drag?.active &&
    drag.source === 'hand' &&
    drag.view.keywords.includes('M') &&
    overZone === 'warband' &&
    run.board[warbandIndexAt(drag.x)]?.tribe === 'mech';

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
          <span className="tavernbox">
            Tavern · Tier <b>{run.tier}</b>
          </span>
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

      {seconds <= 15 && (
        <div className="rope" title={`${seconds}s left`}>
          <div className="rope-lit" style={{ width: `${((15 - Math.max(0, seconds)) / 15) * 100}%` }} />
          <div className="rope-flame" style={{ left: `${((15 - Math.max(0, seconds)) / 15) * 100}%` }} />
        </div>
      )}

      <div className="zone" data-zone="warband">
        <div className="zh">
          <span className="zt disp">
            Your Warband · <b>{run.board.length}/{CONFIG.boardMax}</b>
          </span>
          <span className="hint">
            {heroArmed ? 'click a minion to Temper it (+1/+1)' : 'drag from hand to play · drag to reorder'}
          </span>
        </div>
        <div className="row warband">
          {run.board.length === 0 && <div className="warband-hint">Drag minions up from your hand to play them here.</div>}
          {run.board.map((m) => (
            <Card
              key={m.uid}
              uid={m.uid}
              card={instView(m)}
              highlight={heroArmed}
              dimmed={isDragging(m.uid)}
              buffed={buffedUids.has(m.uid)}
              onPointerDown={heroArmed ? undefined : beginDrag(m.uid, 'board', instView(m))}
            />
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
            <div className="empty handempty">
              Drag a minion down from the tavern to buy it, then drag it up to your warband to play.
            </div>
          ) : (
            run.hand.map((m) => (
              <Card
                key={m.uid}
                card={instView(m)}
                dimmed={isDragging(m.uid)}
                buffed={buffedUids.has(m.uid)}
                onPointerDown={beginDrag(m.uid, 'hand', instView(m))}
              />
            ))
          )}
        </div>
      </div>

      {drag?.active && (
        <div
          className={`dragcard${snapping ? ' snap' : ''}${wouldMagnetize ? ' electric' : ''}`}
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
