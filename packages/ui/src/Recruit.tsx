import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { CARD_INDEX } from '@game/content';
import { CONFIG, THREATS, type BoardCard, type ShopCard } from '@game/sim';
import { Card, type CardView } from './Card';
import { HudBar } from './HudBar';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame } from './store';
import { Unit } from './Unit';
import { useCombatReplay } from './useCombatReplay';

type DragSource = 'shop' | 'hand' | 'board';
type Zone = 'tavern' | 'warband' | 'hand';

const DRAG_THRESHOLD = 5; // px the pointer must move before a click becomes a drag
// How far into a card the cursor must reach (fraction of width) before the insertion point
// moves past it — below 0.5 so cards slide out of the way sooner / more sensitively.
const INSERT_FRAC = 0.35;
const TURN_SECONDS = 30; // base round timer (wave 1); grows +5s/wave, capped at 70 (see turnSeconds)
const RING = 2 * Math.PI * 17; // countdown ring circumference

function shopView(card: ShopCard, spellCostMod = 0): CardView {
  const c = CARD_INDEX[card.cardId];
  if (c.spell) {
    // A tavern spell: its own (modifiable) cost + a tier pill, no stat footer.
    return {
      name: c.name, cardId: c.id, tribe: c.tribe, attack: 0, health: 0,
      keywords: c.keywords, text: c.text, cost: Math.max(0, (c.cost ?? 0) - spellCostMod), spell: true,
      target: c.target, tier: c.tier,
    };
  }
  // A minion offer — fold in any tavern buff (e.g. the hero power) over its base stats,
  // so a buffed offer reads its new stats (green) and carries them in when bought.
  return {
    name: c.name, cardId: c.id, tribe: c.tribe,
    attack: c.attack + (card.atk ?? 0), health: c.health + (card.hp ?? 0),
    keywords: [...c.keywords, ...(card.keywords ?? []).filter((k) => !c.keywords.includes(k))],
    text: c.text, cost: CONFIG.minionCost, tier: c.tier,
    baseAttack: c.attack, baseHealth: c.health,
  };
}
function instView(inst: BoardCard): CardView {
  const c = CARD_INDEX[inst.cardId];
  const spell = c.spell === true || c.id === 'discoverspell';
  return {
    name: c.name, cardId: c.id, tribe: inst.tribe, attack: inst.attack, health: inst.health,
    keywords: inst.keywords, text: c.text, golden: inst.golden,
    tier: spell ? undefined : c.tier, spell, target: c.target,
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

  // Round timer grows +5s each wave, capped at 70s. (Recruit now stays mounted across
  // combat, so the per-wave reset is an effect keyed on the wave — see below.)
  const turnSeconds = Math.min(70, TURN_SECONDS + (run.wave - 1) * 5);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [overZone, setOverZone] = useState<Zone | null>(null);
  const [snapping, setSnapping] = useState(false);
  const [aim, setAim] = useState<{ ox: number; oy: number; tx: number; ty: number; onTarget: boolean; targetUid: string | null } | null>(null);
  const [seconds, setSeconds] = useState(turnSeconds);
  const [buffedUids, setBuffedUids] = useState<Set<string>>(new Set());
  // A one-shot spark burst at a screen point, fired when a spell is cast.
  const [spark, setSpark] = useState<{ x: number; y: number; key: number } | null>(null);
  const sparkKeyRef = useRef(0);

  // --- In-place combat. Instead of swapping to a separate arena screen, the fight
  // plays out on this same board: the shop "closes" (the tavern offers, controls,
  // timer, rope and hand animate away), then the enemy team "arrives" where the
  // tavern was — the warband, hero frame, HUD (ASCENT/wave/tribes/mute) never move.
  // `combatStage` sequences the intro (close → fight); the replay engine runs once
  // the enemies have arrived. After the fight, the warband plays a reset animation. ---
  const inCombat = run.phase === 'combat';
  const [combatStage, setCombatStage] = useState<'closing' | 'fighting'>('closing');
  const fighting = inCombat && combatStage === 'fighting';
  const [resetting, setResetting] = useState(false);
  const [showLog, setShowLog] = useState(false); // the post-combat Combat Log overlay
  const prevPhaseRef = useRef(run.phase);
  const findEl = useCallback(
    (uid: string): Element | null =>
      document.querySelector(
        `[data-zone="warband"] [data-uid="${uid}"], [data-zone="tavern"] [data-uid="${uid}"]`,
      ),
    [],
  );
  const replay = useCombatReplay(run.lastCombat, { active: fighting, findEl });

  // Entering combat: hold on the "shop closing" intro, then let the enemies arrive
  // and the replay begin.
  useEffect(() => {
    if (!inCombat) {
      setCombatStage('closing');
      setShowLog(false); // close the log when the fight is over
      return;
    }
    setCombatStage('closing');
    const t = window.setTimeout(() => setCombatStage('fighting'), 480);
    return () => window.clearTimeout(t);
  }, [inCombat, run.lastCombat]);

  // Returning to recruit after a fight: play a one-shot board "reset" on the warband.
  useEffect(() => {
    if (prevPhaseRef.current === 'combat' && run.phase === 'recruit') {
      prevPhaseRef.current = run.phase;
      setResetting(true);
      const t = window.setTimeout(() => setResetting(false), 650);
      return () => window.clearTimeout(t);
    }
    prevPhaseRef.current = run.phase;
  }, [run.phase]);
  const prevStatsRef = useRef<Map<string, number>>(new Map());
  const flipRef = useRef<Map<string, number>>(new Map());
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const timeUp = seconds <= 0; // turn timer expired: lock everything but End Turn

  const zoneAt = (x: number, y: number): Zone | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-zone]');
    return (el?.getAttribute('data-zone') as Zone) ?? null;
  };
  /** The uid of the board minion under a point (for spell / battlecry targeting), or null. */
  const boardUidAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-zone="warband"] .row .card[data-uid]');
    return el?.getAttribute('data-uid') ?? null;
  };
  // Insertion index in the warband, from the pointer's x against the cards' centres.
  // `excludeUid` drops the dragged card from the count when *reordering* a board minion
  // (it's still in the DOM, so without this a rightward drag overshoots by one).
  const warbandIndexAt = (x: number, excludeUid?: string): number => {
    const cards = [...document.querySelectorAll<HTMLElement>('[data-zone="warband"] .row .card[data-uid]')];
    let i = 0;
    for (const c of cards) {
      if (c.getAttribute('data-uid') === excludeUid) continue;
      const r = c.getBoundingClientRect();
      if (x > r.left + r.width * INSERT_FRAC) i++;
    }
    return i;
  };
  // Insertion index among the shop's *minion* offers (the spell stays pinned at the end).
  const shopIndexAt = (x: number, excludeUid?: string): number => {
    const cards = [...document.querySelectorAll<HTMLElement>('[data-zone="tavern"] .row .card[data-uid]')].filter(
      (c) => c.getAttribute('data-uid') !== run.spell?.uid,
    );
    let i = 0;
    for (const c of cards) {
      if (c.getAttribute('data-uid') === excludeUid) continue;
      const r = c.getBoundingClientRect();
      if (x > r.left + r.width * INSERT_FRAC) i++;
    }
    return i;
  };

  const beginDrag = (uid: string, source: DragSource, view: CardView) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || timeUp || inCombat) return; // no dragging once the turn timer is up / in combat
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    // capture the pointer so move/up keep firing even if it leaves the window or races
    // ahead of the floating card — events still bubble to the window listeners.
    try { el.setPointerCapture(e.pointerId); } catch { /* unsupported / detached */ }
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
      const d = dragRef.current;
      if (!d || !d.active) {
        document.body.classList.remove('dragging');
        // a click, not a drag — let onClick (hero targeting) handle it
        setDrag(null);
        setOverZone(null);
        return;
      }
      // Resolve the drop zone *before* clearing body.dragging, so the status bar (and
      // hero) stay click-through and a card can land on the hand tucked behind them.
      const zone = zoneAt(e.clientX, e.clientY);
      document.body.classList.remove('dragging'); // cursor reverts on release
      const acted = applyDrop(d, zone, e.clientX, e.clientY);
      if (acted || d.view.spell) {
        // a spell that misses just ends — it was never lifted from the hand
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
    // Right-click while aiming a spell cancels it (snaps back to the hand).
    const onCtx = (e: MouseEvent): void => {
      if (dragRef.current?.view.spell) {
        e.preventDefault();
        setDrag(null);
        setOverZone(null);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('contextmenu', onCtx);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('contextmenu', onCtx);
    };
  }, [drag?.uid]);

  // Drive the closed-fist cursor strictly off drag state, so it can never get
  // stranded on (the bug where the grab cursor stuck after the first drag).
  useEffect(() => {
    if (!drag?.active) return;
    document.body.classList.add('dragging');
    return () => document.body.classList.remove('dragging');
  }, [drag?.active]);

  // Hero Power targeting: arm by pressing the hero, then drag a glowing line to a minion
  // and release on it. Fortify targets "a minion" — your warband OR a tavern offer (not the
  // tavern spell); a tavern buff rides in when the offer is bought. Release off a minion to
  // cancel; a plain click stays armed for a follow-up click.
  useEffect(() => {
    if (!heroArmed || inCombat) {
      setAim(null);
      return;
    }
    let moved = false;
    const minionAt = (x: number, y: number): { uid: string } | null => {
      const el = document
        .elementFromPoint(x, y)
        ?.closest('[data-zone="warband"] .row .card[data-uid], [data-zone="tavern"] .row .card[data-uid]');
      const uid = el?.getAttribute('data-uid');
      if (!uid || uid === run.spell?.uid) return null; // a minion (warband or tavern), never the spell
      return { uid };
    };
    const move = (e: PointerEvent): void => {
      moved = true;
      const f = document.querySelector('.statusbar .hero .f');
      if (!f) return;
      const r = f.getBoundingClientRect();
      // The aim point follows the cursor exactly — you can target anywhere on a
      // minion's card (no snap to centre); the hovered minion lights up.
      const target = minionAt(e.clientX, e.clientY);
      setAim({
        ox: r.left + r.width / 2,
        oy: r.top + r.height / 2,
        tx: e.clientX,
        ty: e.clientY,
        onTarget: !!target,
        targetUid: target?.uid ?? null,
      });
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
  }, [heroArmed, run.spell?.uid, timeUp, dispatch, armHero, inCombat]);

  // Reset the round clock at the start of each recruit wave. (Recruit stays mounted
  // across combat now, so unlike before it can't rely on a remount to re-initialise.)
  useEffect(() => {
    setSeconds(turnSeconds);
  }, [run.wave, turnSeconds]);

  // Round timer: count down each recruit turn; at 0 the player is forced into
  // combat (paused while a Discover pick is open). UI-only — the engine is untimed.
  useEffect(() => {
    // At 0 the timer just stops — actions lock (except End Turn); no auto-combat.
    if (run.phase !== 'recruit' || seconds <= 0 || run.discover) return;
    const id = window.setTimeout(() => {
      // Tick out the last five seconds (the next displayed value is 5…1).
      if (seconds - 1 <= 5 && seconds - 1 > 0) sfx.tick();
      setSeconds((s) => s - 1);
    }, 1000);
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
    // Tavern offers can be buffed too (the hero power can Fortify a shop minion) —
    // track their effective stats (base + the stored offer buff) so they flash as well.
    for (const o of run.shop) {
      const base = CARD_INDEX[o.cardId];
      if (!base) continue;
      const cur = base.attack + (o.atk ?? 0) + base.health + (o.hp ?? 0);
      next.set(o.uid, cur);
      if (prev.has(o.uid) && cur > (prev.get(o.uid) ?? 0)) newly.push(o.uid);
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
  }, [run.board, run.hand, run.shop]);

  // --- Live warband drag: a dragged board minion is *lifted out* of the row entirely
  // (the floating copy IS the card) for the whole drag; the rest physically close up,
  // and an empty drop-slot opens at the live insertion point while over the warband.
  // Dropping lands the card straight into that slot — no post-drop "swap". A played
  // hand card opens the same slot. ---
  const wouldMagnetize =
    !!drag?.active &&
    drag.source === 'hand' &&
    drag.view.keywords.includes('M') &&
    overZone === 'warband' &&
    run.board[warbandIndexAt(drag.x)]?.tribe === 'mech';
  // Casting a targeted spell from the hand: highlight the friendly minion under the
  // cursor (it's the target), and don't treat it as a board-insertion drag.
  const castingSpell = !!drag?.active && drag.source === 'hand' && !!drag.view.spell && drag.view.target === 'friendly';
  const castTargetUid = castingSpell ? boardUidAt(drag!.x, drag!.y) : null;
  const draggingBoard = !!drag?.active && drag.source === 'board';
  const overWarband =
    !!drag?.active &&
    overZone === 'warband' &&
    !wouldMagnetize &&
    !drag.view.spell &&
    (drag.source === 'board' || (drag.source === 'hand' && run.board.length < CONFIG.boardMax));
  // The dragged board minion leaves the row immediately and stays out for the whole drag.
  const displayBoard = draggingBoard ? run.board.filter((m) => m.uid !== drag!.uid) : run.board;
  // Same lift-out for the shop: a dragged offer leaves the row and the rest close up (FLIP),
  // instead of leaving a dimmed "shadow" card in place while you buy.
  const draggingShop = !!drag?.active && drag.source === 'shop';
  const displayShop = draggingShop ? run.shop.filter((o) => o.uid !== drag!.uid) : run.shop;
  // A dragged offer (not the pinned spell) over the tavern reorders the shop — open a slot.
  const overShop = draggingShop && overZone === 'tavern' && drag!.uid !== run.spell?.uid;
  const shopGapIndex = overShop ? shopIndexAt(drag!.x, drag!.uid) : -1;
  // Where the empty drop-slot opens (insertion index among the displayed cards), or -1.
  const gapIndex = overWarband
    ? warbandIndexAt(drag!.x, drag!.source === 'board' ? drag!.uid : undefined)
    : -1;
  const spellShown = run.spell && !(draggingShop && drag!.uid === run.spell.uid) ? run.spell.uid : '';
  const flipKey =
    displayShop.map((o) => o.uid).join(',') + '|' + spellShown + '|' + shopGapIndex + '|' +
    displayBoard.map((m) => m.uid).join(',') + '|' + gapIndex;

  // FLIP: slide shop + warband cards from their old spots to new ones — live as the drop
  // slot moves during a drag, and when either row changes (buy / play / sell / summon /
  // reposition / lift-out). Both rows are tracked so a lifted-out card closes the gap.
  useLayoutEffect(() => {
    const cards = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-zone="tavern"] .row .card[data-uid], [data-zone="warband"] .row .card[data-uid]',
      ),
    ];
    // Drop any in-flight FLIP first, so we measure each card's *true* layout position
    // and not an interpolated transform — otherwise rapid drags compound the deltas and
    // fling cards off-screen.
    for (const el of cards) {
      el.style.transition = 'none';
      el.style.transform = '';
    }
    const next = new Map<string, number>();
    const moved: HTMLElement[] = [];
    for (const el of cards) {
      const id = el.getAttribute('data-uid');
      if (!id) continue;
      const left = el.getBoundingClientRect().left; // natural left (transform cleared above)
      next.set(id, left);
      const prev = flipRef.current.get(id);
      if (prev !== undefined && Math.abs(prev - left) > 1) {
        el.style.transform = `translateX(${prev - left}px)`; // invert to the old spot
        moved.push(el);
      }
    }
    flipRef.current = next;
    if (moved.length > 0) {
      requestAnimationFrame(() => {
        for (const el of moved) {
          el.style.transition = 'transform 0.2s ease';
          el.style.transform = '';
        }
      });
    }
  }, [flipKey]);

  // Pop a one-shot spark burst at a screen point (when a spell resolves).
  const fireSpark = (x: number, y: number): void => {
    sparkKeyRef.current += 1;
    const key = sparkKeyRef.current;
    setSpark({ x, y, key });
    window.setTimeout(() => setSpark((s) => (s?.key === key ? null : s)), 600);
  };

  const applyDrop = (d: DragState, zone: Zone | null, x: number, y: number): boolean => {
    if (d.source === 'shop' && zone === 'hand') {
      dispatch({ type: 'buy', uid: d.uid });
      return true;
    }
    // A shop offer dropped back in the tavern reorders it (so it lands where you drop it,
    // like the warband, instead of snapping back). The spell stays pinned at the end.
    if (d.source === 'shop' && zone === 'tavern' && d.uid !== run.spell?.uid) {
      dispatch({ type: 'reorderShop', uid: d.uid, toIndex: shopIndexAt(x, d.uid) });
      return true;
    }
    // Sell a minion (board or hand) by dropping it on the tavern. Spells are excluded —
    // dragging a spell is a cast/play gesture, so on the tavern it just cancels (a spell
    // dragged up to the offers must never silently sell for +1).
    if ((d.source === 'board' || d.source === 'hand') && zone === 'tavern' && !d.view.spell) {
      dispatch({ type: 'sell', uid: d.uid });
      return true;
    }
    // Cast a spell from the hand onto its target (Spirit Fire → a friendly minion).
    if (d.source === 'hand' && d.view.spell) {
      if (d.view.target === 'friendly') {
        const targetUid = boardUidAt(x, y);
        if (!targetUid) return false; // must be released on a friendly minion
        dispatch({ type: 'play', uid: d.uid, targetUid });
        fireSpark(x, y); // spark bursts on the target it hit
        return true;
      }
      // Untargeted spell ("give your board…"): drop anywhere in the warband to cast.
      if (zone === 'warband') {
        dispatch({ type: 'play', uid: d.uid });
        fireSpark(x, y);
        return true;
      }
      return false;
    }
    if (d.source === 'hand' && zone === 'warband') {
      dispatch({ type: 'play', uid: d.uid, toIndex: warbandIndexAt(x) });
      return true;
    }
    if (d.source === 'board' && zone === 'warband') {
      dispatch({ type: 'reposition', uid: d.uid, toIndex: warbandIndexAt(x, d.uid) });
      return true;
    }
    return false;
  };

  // Gold sell-preview glow: an owned card hovered over the tavern.
  const sellGlow = overZone === 'tavern' && (drag?.source === 'board' || drag?.source === 'hand');
  const isDragging = (uid: string): boolean => drag?.active === true && drag.uid === uid;
  // A shop card over the hand will buy it — glow the hand to confirm the drop target.
  const canDropHand = !!drag?.active && drag.source === 'shop' && overZone === 'hand';

  return (
    <div
      className={`app${inCombat ? ' combat' : ''}${fighting ? ' fighting' : ''}${replay.shaking ? ' shaking' : ''}${
        inCombat && replay.done ? ` done ${replay.result}` : ''
      }`}
    >
      <HudBar />

      {!inCombat && (
      <div className="rtimer" data-low={seconds <= 5} title="Time left this turn — at 0 your actions lock; hit End Turn to fight">
        <svg viewBox="0 0 40 40">
          <circle className="rt-bg" cx="20" cy="20" r="17" />
          <circle
            className="rt-fg"
            cx="20"
            cy="20"
            r="17"
            style={{ strokeDasharray: RING, strokeDashoffset: RING * (1 - Math.max(0, seconds) / turnSeconds) }}
          />
        </svg>
        <span className="rt-n">{Math.max(0, seconds)}</span>
      </div>
      )}

      {!fighting ? (
      <div className={`shopctl${inCombat ? ' closing' : ''}`}>
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
      ) : (
        <div className="combatctl">
          <span className="cbanner">{THREATS[run.threat].name}</span>
          <div className="cbtns">
            {replay.done ? (
              <>
                <button className="btn big" onClick={() => setShowLog(true)}>
                  <Icon name="battlecry" />
                  Combat Log
                </button>
                <button className="btn big endturn" onClick={() => dispatch({ type: 'resolveCombat' })}>
                  <Icon name="up" />
                  {replay.result === 'win' ? 'Climb On' : 'End Combat'}
                </button>
              </>
            ) : (
              <button className="btn big" onClick={replay.skip}>
                <Icon name="sword" />
                Skip
              </button>
            )}
          </div>
        </div>
      )}

      <div className={`zone${sellGlow ? ' sellglow' : ''}`} data-zone="tavern">
        <div className="row">
          {fighting ? (
            replay.frame.enemy.map((u) => (
              <Unit
                key={u.uid}
                u={u}
                side="foe"
                anim={replay.anims[u.uid]}
                floats={replay.floatsFor(u.uid)}
                lunge={u.uid === replay.lungeUid ? replay.lungeTransform : undefined}
              />
            ))
          ) : (
          <>
          {displayShop.map((o, i) => (
            <Fragment key={o.uid}>
              {shopGapIndex === i && <span className="dropslot" aria-hidden="true" />}
              <Card
                uid={o.uid}
                card={shopView(o)}
                highlight={heroArmed}
                targeted={heroArmed && aim?.targetUid === o.uid}
                buffed={buffedUids.has(o.uid)}
                onPointerDown={heroArmed ? undefined : beginDrag(o.uid, 'shop', shopView(o))}
              />
            </Fragment>
          ))}
          {shopGapIndex >= displayShop.length && <span className="dropslot" aria-hidden="true" />}
          {run.spell && !(draggingShop && drag!.uid === run.spell.uid) && (
            <Card
              key={run.spell.uid}
              uid={run.spell.uid}
              card={shopView(run.spell, run.spellCostMod)}
              onPointerDown={heroArmed ? undefined : beginDrag(run.spell.uid, 'shop', shopView(run.spell, run.spellCostMod))}
            />
          )}
          </>
          )}
        </div>
      </div>

      {!inCombat && seconds <= 15 && (
        <div className="rope" title={`${seconds}s left`}>
          <div className="rope-lit" style={{ width: `${((15 - Math.max(0, seconds)) / 15) * 100}%` }} />
          <div className="rope-flame" style={{ left: `${((15 - Math.max(0, seconds)) / 15) * 100}%` }} />
        </div>
      )}

      <div className={`zone${overWarband ? ' dropok' : ''}`} data-zone="warband">
        <div className={`row warband${resetting ? ' resetting' : ''}`}>
          {inCombat ? (
            replay.frame.player.map((u) => (
              <Unit
                key={u.uid}
                u={u}
                side="you"
                anim={replay.anims[u.uid]}
                floats={replay.floatsFor(u.uid)}
                lunge={u.uid === replay.lungeUid ? replay.lungeTransform : undefined}
              />
            ))
          ) : (
            <>
              {run.board.length === 0 && !drag?.active && (
                <div className="warband-hint">Drag minions up from your hand to play them here.</div>
              )}
              {displayBoard.map((m, i) => (
                <Fragment key={m.uid}>
                  {gapIndex === i && <span className="dropslot" aria-hidden="true" />}
                  <Card
                    uid={m.uid}
                    card={instView(m)}
                    highlight={heroArmed || castingSpell}
                    targeted={(heroArmed && aim?.targetUid === m.uid) || castTargetUid === m.uid}
                    buffed={buffedUids.has(m.uid)}
                    onPointerDown={heroArmed ? undefined : beginDrag(m.uid, 'board', instView(m))}
                  />
                </Fragment>
              ))}
              {gapIndex >= displayBoard.length && <span className="dropslot" aria-hidden="true" />}
            </>
          )}
        </div>
      </div>

      <div className={`zone${canDropHand ? ' dropok' : ''}`} data-zone="hand">
        <div className="row hand">
          {run.hand.map((m) => (
            <Card
              key={m.uid}
              card={instView(m)}
              dimmed={isDragging(m.uid)}
              buffed={buffedUids.has(m.uid)}
              onPointerDown={beginDrag(m.uid, 'hand', instView(m))}
            />
          ))}
        </div>
      </div>

      {/* Start-of-Combat bolts fly from caster to target (measured in the replay). */}
      {fighting &&
        replay.projectiles.map((p) => (
          <span
            key={`proj-${p.id}`}
            className="proj"
            style={{ left: p.x, top: p.y, '--dx': `${p.dx}px`, '--dy': `${p.dy}px` } as CSSProperties}
          />
        ))}

      {/* Combat narration — a single rolling line where the hand used to fan. */}
      {fighting && <div className="alog">{replay.log}</div>}

      {drag?.active && !castingSpell && (
        <div
          className={`dragcard${snapping ? ' snap' : ''}${wouldMagnetize ? ' electric' : ''}`}
          style={{
            width: drag.w,
            height: drag.h,
            // pivot scale/rotate around the exact grab point so the card stays under the cursor
            transformOrigin: `${drag.ox}px ${drag.oy}px`,
            transform: `translate(${drag.x - drag.ox}px, ${drag.y - drag.oy}px) scale(1.04) rotate(-1.5deg)`,
          }}
        >
          <Card card={drag.view} />
        </div>
      )}

      {/* Targeted spell: the card leaves the hand and becomes an aim line (like the Hero
          Power) — release on a friend to cast, release off / right-click to cancel. */}
      {castingSpell && drag && (
        <svg className="aimline" aria-hidden="true">
          <line x1={drag.startX} y1={drag.startY} x2={drag.x} y2={drag.y} />
          <circle cx={drag.x} cy={drag.y} r={castTargetUid ? 16 : 7} className={castTargetUid ? 'on' : ''} />
        </svg>
      )}

      {heroArmed && aim && (
        <svg className="aimline" aria-hidden="true">
          <line x1={aim.ox} y1={aim.oy} x2={aim.tx} y2={aim.ty} />
          <circle cx={aim.tx} cy={aim.ty} r={aim.onTarget ? 16 : 7} className={aim.onTarget ? 'on' : ''} />
        </svg>
      )}

      {/* Spell spark: a one-shot radiating burst where a cast spell resolved. */}
      {spark && (
        <div className="spellspark" key={spark.key} style={{ left: spark.x, top: spark.y }} aria-hidden="true">
          <span className="ss-flash" />
          {[18, 70, 128, 162, 215, 268, 305, 340].map((a) => (
            <span className="ss-ray" key={a} style={{ '--a': `${a}deg` } as CSSProperties} />
          ))}
        </div>
      )}

      {showLog && (
        <div className="logov" role="dialog" aria-label="Combat log" onClick={() => setShowLog(false)}>
          <div className="logbox" onClick={(e) => e.stopPropagation()}>
            <div className="logtitle">
              Combat Log <span className={`logverdict ${replay.result ?? ''}`}>{replay.result === 'win' ? 'Victory' : replay.result === 'lose' ? 'Defeat' : 'Draw'}</span>
            </div>
            <div className="loglines">
              {replay.fullLog.length === 0 ? (
                <div className="logline">No blows were struck.</div>
              ) : (
                replay.fullLog.map((line, i) => (
                  <div className="logline" key={i}>{line}</div>
                ))
              )}
            </div>
            <button className="btn big" onClick={() => setShowLog(false)}>Close</button>
          </div>
        </div>
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
                    card={{ name: c.name, cardId: c.id, tribe: c.tribe, attack: c.attack, health: c.health, keywords: c.keywords, text: c.text, tier: c.tier }}
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
