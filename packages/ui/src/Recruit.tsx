import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { CARD_INDEX } from '@game/content';
import { CONFIG, THREATS, magnetizesTo, chronosRepeats, type BoardCard, type ShopCard } from '@game/sim';
import { Card, mdBold, type CardView } from './Card';
import { summonBuffText } from './cardText';
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
const INSERT_FRAC = 0.5; // insert after a card once the *dragged card's centre* passes its midpoint
const TURN_SECONDS = 30; // base round timer (wave 1); grows +5s/wave, capped at 70 (see turnSeconds)
const RING = 2 * Math.PI * 17; // countdown ring circumference

/** Cards that reference another card → hovering shows it as a popup. The token a card summons /
 *  creates, or the Fodder it buffs / consumes (so the player can read what it does, and see the
 *  *current* buffed Fodder for Ritualist & co). */
const CARD_REFERENCES: Record<string, string[]> = {
  alley: ['stray'], shaper: ['stray'], pack: ['pup'], brood: ['impscrap'], combinator: ['cling'],
  feed: ['fred'], imp: ['fred'], ritualist: ['fred'], maw: ['fred'], glut: ['fred'], pact: ['fred'],
};
/** A referenced token's card view. Fodder ('fred') folds in Ritualist's persistent buff so the
 *  popup shows its current stats. */
function tokenRefView(id: string, cardBuffs?: Record<string, { attack: number; health: number }>): CardView {
  const c = CARD_INDEX[id];
  const cb = cardBuffs?.[id] ?? { attack: 0, health: 0 };
  return {
    name: c.name, cardId: c.id, tribe: c.tribe, tribe2: c.tribe2,
    attack: c.attack + cb.attack, health: c.health + cb.health,
    keywords: c.keywords, text: c.text, tier: c.tier,
    baseAttack: c.attack, baseHealth: c.health,
  };
}

function shopView(
  card: ShopCard,
  spellCostMod = 0,
  cardBuffs?: Record<string, { attack: number; health: number }>,
): CardView {
  const c = CARD_INDEX[card.cardId];
  if (c.spell) {
    // A tavern spell: its own (modifiable) cost + a tier pill, no stat footer.
    return {
      name: c.name, cardId: c.id, tribe: c.tribe, attack: 0, health: 0,
      keywords: c.keywords, text: c.text, cost: Math.max(0, (c.cost ?? 0) - spellCostMod), spell: true,
      target: c.target, tier: c.tier,
    };
  }
  // A minion offer — fold in any tavern buff (the hero power) plus any persistent run buff
  // (Ritualist's Fodder enchantment) over its base stats, so a buffed offer reads its new
  // stats (green) and carries them in when bought.
  const cb = cardBuffs?.[c.id] ?? { attack: 0, health: 0 };
  return {
    name: c.name, cardId: c.id, tribe: c.tribe, tribe2: c.tribe2,
    attack: c.attack + (card.atk ?? 0) + cb.attack, health: c.health + (card.hp ?? 0) + cb.health,
    keywords: [...c.keywords, ...(card.keywords ?? []).filter((k) => !c.keywords.includes(k))],
    text: c.text, goldenText: c.goldenText, cost: CONFIG.minionCost, tier: c.tier,
    baseAttack: c.attack, baseHealth: c.health,
  };
}
function instView(inst: BoardCard, tier = 1): CardView {
  const c = CARD_INDEX[inst.cardId];
  const spell = c.spell === true || c.id === 'discoverspell';
  // Triple Reward names the exact Tier it Discovers from (current Tier + 1, capped). A summon-buff
  // card (Kennelmaster) instead shows its current boosted magnitude (green via {{…}}).
  const text =
    c.id === 'discoverspell'
      ? `**Discover** a **Tier ${Math.min(CONFIG.maxTier, tier + 1)}** minion.`
      : summonBuffText(c.id, inst.summonBonus ?? 0) ?? c.text;
  return {
    name: c.name, cardId: c.id, tribe: inst.tribe, tribe2: c.tribe2, attack: inst.attack, health: inst.health,
    keywords: inst.keywords, text, goldenText: c.goldenText, golden: inst.golden,
    tier: spell ? undefined : c.tier, spell, target: c.target,
    baseAttack: inst.golden ? c.attack * 2 : c.attack,
    baseHealth: inst.golden ? c.health * 2 : c.health,
    buffs: inst.buffs,
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
  const [magSlide, setMagSlide] = useState(false); // a Magnetic card sliding into its Mech
  const [magTargetUid, setMagTargetUid] = useState<string | null>(null); // the Mech being merged into (crackles)
  const [aim, setAim] = useState<{ ox: number; oy: number; tx: number; ty: number; onTarget: boolean; targetUid: string | null } | null>(null);
  const [seconds, setSeconds] = useState(turnSeconds);
  const [buffedUids, setBuffedUids] = useState<Set<string>>(new Set());
  // A one-shot spark burst at a screen point, fired when a spell is cast.
  const [spark, setSpark] = useState<{ x: number; y: number; key: number } | null>(null);
  const sparkKeyRef = useRef(0);
  // A small dust puff where you click the empty board (not a card/control) — pure tactile feel.
  const [dust, setDust] = useState<{ x: number; y: number; key: number } | null>(null);
  const dustKeyRef = useRef(0);
  // Tavern-Fodder consume: a ghost Fred pops in the tavern and swirls into the eater Demon.
  // The ghost carries the Fodder's *effective* stats (attack/health) so a Ritualist-buffed
  // Fred shows e.g. 3/3, not the 1/1 base.
  const [fodderAnim, setFodderAnim] = useState<
    {
      key: number;
      ghosts: { fid: string; attack: number; health: number; x0: number; y0: number; w: number; h: number; dx: number; dy: number }[];
    } | null
  >(null);
  const prevFodderSeq = useRef(run.fodderEatenSeq);
  // A brief "End of Turn" banner when the turn ends (recruit → combat), making it clear that
  // end-of-turn effects (Ritualist & co.) just resolved.
  const [endTurnFlash, setEndTurnFlash] = useState(false);
  // Cards a combat Deathrattle just added to the hand (Arcane Weaver → Spirit Fire) — pop them
  // in when they arrive. Snapshot the hand on entering combat; the new uids afterwards are grants.
  const [arrivedUids, setArrivedUids] = useState<Set<string>>(new Set());
  const handBeforeCombatRef = useRef<Set<string>>(new Set());
  // A one-shot flourish under a freshly-played minion whose Battlecry just fired.
  const [battlecryUids, setBattlecryUids] = useState<Set<string>>(new Set());
  const prevBoardUidsRef = useRef<Set<string>>(new Set(run.board.map((c) => c.uid)));
  // The same flourish under minions whose End-of-Turn effect just procced (as the turn ends).
  const [eotProcUids, setEotProcUids] = useState<Set<string>>(new Set());
  const endTurnPendingRef = useRef(false); // the end-of-turn beat sequence is playing before combat
  // Dragons Karwind just flame-buffed (keyed off run.karwindFlashSeq) — a one-shot flame flash.
  const [karwindFlameUids, setKarwindFlameUids] = useState<Set<string>>(new Set());
  const prevKarwindSeq = useRef(run.karwindFlashSeq);
  // A purple wash over the whole shop when Ritualist's End-of-Turn buffs the Fodder there.
  const [shopFlash, setShopFlash] = useState(0);
  // Mechs being electrified as Combinator magnetizes Cling Drones onto them (End of Turn).
  const [electrifyUids, setElectrifyUids] = useState<Set<string>>(new Set());

  // --- In-place combat. Instead of swapping to a separate arena screen, the fight
  // plays out on this same board: the shop "closes" (the tavern offers, controls,
  // timer, rope and hand animate away), then the enemy team "arrives" where the
  // tavern was — the warband, hero frame, HUD (ASCENT/wave/tribes/mute) never move.
  // `combatStage` sequences the intro (close → fight); the replay engine runs once
  // the enemies have arrived. After the fight, the warband plays a reset animation. ---
  const inCombat = run.phase === 'combat';
  const [combatStage, setCombatStage] = useState<'closing' | 'fighting'>('closing');
  const fighting = inCombat && combatStage === 'fighting';
  const [showLog, setShowLog] = useState(false); // the post-combat Combat Log overlay
  // Per-card stat snapshot for the recruit-phase green buff flash (declared up here so the
  // combat→recruit transition can re-sync it and avoid a spurious flash on the way back in).
  const prevStatsRef = useRef<Map<string, number>>(new Map());
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
  // and the replay begin. Also flash the "End of Turn" banner (end-of-turn effects just
  // resolved) and snapshot the hand so post-combat grants can be detected.
  useEffect(() => {
    if (!inCombat) {
      setCombatStage('closing');
      setShowLog(false); // close the log when the fight is over
      return;
    }
    handBeforeCombatRef.current = new Set(run.hand.map((c) => c.uid));
    setCombatStage('closing');
    setEndTurnFlash(true);
    const banner = window.setTimeout(() => setEndTurnFlash(false), 850);
    const t = window.setTimeout(() => setCombatStage('fighting'), 480);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(banner);
    };
  }, [inCombat, run.lastCombat]);

  // Returning to recruit after a fight. The warband re-mounts (it was combat Units) and re-enters
  // via the base `cardpop` — a single mount animation, so it can't re-fire from a class toggle (the
  // old `resetting`/`boardreset` toggle flashed twice: once on mount, again when the class cleared).
  // Here we only (a) pop in any cards a combat Deathrattle added to the hand, and (b) re-sync the
  // stat snapshot so the green buff-flash doesn't spuriously fire on the cards coming back in.
  // useLayoutEffect so the snapshot is synced before the buff-flash passive effect reads it.
  useLayoutEffect(() => {
    if (prevPhaseRef.current === 'combat' && run.phase === 'recruit') {
      prevPhaseRef.current = run.phase;
      const snap = new Map<string, number>();
      for (const c of [...run.board, ...run.hand]) snap.set(c.uid, c.attack + c.health);
      prevStatsRef.current = snap;
      const before = handBeforeCombatRef.current;
      const granted = run.hand.filter((c) => !before.has(c.uid)).map((c) => c.uid);
      if (granted.length > 0) {
        setArrivedUids((s) => new Set([...s, ...granted]));
        window.setTimeout(() => {
          setArrivedUids((s) => {
            const n = new Set(s);
            for (const u of granted) n.delete(u);
            return n;
          });
        }, 1100);
      }
    }
    prevPhaseRef.current = run.phase;
  }, [run.phase]);
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

  // Stable per-card view objects, keyed by uid. Recompute only when the underlying run data
  // changes — during a drag nothing dispatches, so `run.*` refs are stable and these stay
  // cached, which is what lets the memoized Card skip re-render on every pointermove.
  const shopViews = useMemo(
    () => new Map(run.shop.map((o) => [o.uid, shopView(o, 0, run.cardBuffs)] as const)),
    [run.shop, run.cardBuffs],
  );
  const spellView = useMemo(
    () => (run.spell ? shopView(run.spell, run.spellCostMod) : null),
    [run.spell, run.spellCostMod],
  );
  // Per-card referenced-card popups (uid → the cards it references). Stable across a drag (only
  // recomputes when the board / shop / hand or the Fodder buff changes), so it preserves the memo.
  const refViewsByUid = useMemo(() => {
    const m = new Map<string, CardView[]>();
    const add = (uid: string, cardId: string): void => {
      const refs = CARD_REFERENCES[cardId];
      if (refs) m.set(uid, refs.map((id) => tokenRefView(id, run.cardBuffs)));
    };
    for (const c of run.board) add(c.uid, c.cardId);
    for (const c of run.hand) add(c.uid, c.cardId);
    for (const o of run.shop) add(o.uid, o.cardId);
    return m;
  }, [run.board, run.hand, run.shop, run.cardBuffs]);
  const boardViews = useMemo(() => new Map(run.board.map((m) => [m.uid, instView(m)] as const)), [run.board]);
  const handViews = useMemo(() => new Map(run.hand.map((m) => [m.uid, instView(m, run.tier)] as const)), [run.hand, run.tier]);

  // A single stable pointer-down handler shared by every card: it reads the grabbed card's uid
  // + zone from the DOM and its view from this ref, so the handler's identity never changes
  // mid-drag (a fresh per-card closure would defeat Card's memo). Replaces the old per-card
  // `beginDrag(uid, source, view)` factory.
  const viewsRef = useRef({ shopViews, spellView, boardViews, handViews, spellUid: run.spell?.uid });
  viewsRef.current = { shopViews, spellView, boardViews, handViews, spellUid: run.spell?.uid };
  const onCardPointerDown = useCallback(
    (e: ReactPointerEvent): void => {
      if (e.button !== 0 || timeUp || inCombat) return; // no dragging once the turn timer is up / in combat
      const el = e.currentTarget as HTMLElement;
      const uid = el.dataset.uid;
      if (!uid) return;
      const zone = el.closest('[data-zone]')?.getAttribute('data-zone');
      const source: DragSource = zone === 'warband' ? 'board' : zone === 'hand' ? 'hand' : 'shop';
      const v = viewsRef.current;
      const view =
        source === 'board'
          ? v.boardViews.get(uid)
          : source === 'hand'
            ? v.handViews.get(uid)
            : uid === v.spellUid
              ? v.spellView ?? undefined
              : v.shopViews.get(uid);
      if (!view) return;
      // Grabbing a card mid-buff-flash clears its flash, so it doesn't replay the buff
      // animation when the card re-mounts after the drag (lift-out → drop).
      setBuffedUids((s) => {
        if (!s.has(uid)) return s;
        const n = new Set(s);
        n.delete(uid);
        return n;
      });
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
    },
    [timeUp, inCombat],
  );

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

      // Magnetic merge: a Magnetic minion dropped onto a friendly minion sharing one of its tribes
      // first "lands", then slides in (left→right) with electricity, and only then merges.
      const magIdx =
        d.source === 'hand' && d.view.keywords.includes('M') && zone === 'warband'
          ? warbandIndexAt(e.clientX - d.ox + d.w / 2)
          : -1;
      const magMech = magIdx >= 0 ? run.board[magIdx] : undefined;
      if (magMech && magnetizesTo(d.view.cardId, magMech.cardId)) {
        const el = document.querySelector(`[data-zone="warband"] .row .card[data-uid="${magMech.uid}"]`);
        if (el) {
          const r = el.getBoundingClientRect();
          setMagSlide(true); // the drone shrinks straight into the Mech…
          setMagTargetUid(magMech.uid); // …and the Mech crackles as it absorbs it
          setDrag((cur) => (cur ? { ...cur, x: r.left + r.width / 2, y: r.top + r.height / 2 } : cur));
        }
        window.setTimeout(() => {
          dispatch({ type: 'play', uid: d.uid, toIndex: magIdx }); // reducer merges into the Mech (stats pop)
          setMagSlide(false);
          setDrag(null);
          setOverZone(null);
          // let the Mech keep crackling a beat past the merge, then settle on the green buff flash
          window.setTimeout(() => setMagTargetUid(null), 120);
        }, el ? 280 : 0);
        return;
      }

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

  // A freshly-played minion with a Battlecry gets a one-shot flourish beneath it. Diff the
  // board's uids; a new card whose def has an onPlay effect (or Choose One) just fired its
  // Battlecry. (Summoned tokens like Strays have no onPlay, so they don't flash.)
  useEffect(() => {
    if (inCombat) {
      prevBoardUidsRef.current = new Set(run.board.map((c) => c.uid));
      return;
    }
    const prev = prevBoardUidsRef.current;
    const fresh = run.board
      .filter((c) => {
        if (prev.has(c.uid)) return false;
        const def = CARD_INDEX[c.cardId];
        return !!def && (def.effects.some((e) => e.on === 'onPlay') || (def.chooseOne?.length ?? 0) > 0);
      })
      .map((c) => c.uid);
    prevBoardUidsRef.current = new Set(run.board.map((c) => c.uid));
    if (fresh.length === 0) return;
    setBattlecryUids((s) => new Set([...s, ...fresh]));
    const t = window.setTimeout(() => {
      setBattlecryUids((s) => {
        const n = new Set(s);
        for (const u of fresh) n.delete(u);
        return n;
      });
    }, 760);
    return () => window.clearTimeout(t);
  }, [run.board, inCombat]);

  // Karwind flame flash: when a Battlecry triggers Karwind, flame the Dragons it buffed (~0.9s).
  useEffect(() => {
    if (run.karwindFlashSeq === prevKarwindSeq.current) return;
    prevKarwindSeq.current = run.karwindFlashSeq;
    const uids = run.karwindFlash ?? [];
    if (uids.length === 0) return;
    setKarwindFlameUids(new Set(uids));
    const t = window.setTimeout(() => setKarwindFlameUids(new Set()), 520);
    return () => window.clearTimeout(t);
  }, [run.karwindFlashSeq, run.karwindFlash]);

  // Tavern Fodder was auto-eaten (fodderEatenSeq bumped): show a ghost Fred in the tavern
  // and swirl it into the Demon that ate it (measured from the live DOM), then clear.
  useEffect(() => {
    if (run.fodderEatenSeq === prevFodderSeq.current) return;
    prevFodderSeq.current = run.fodderEatenSeq;
    const events = run.fodderEaten ?? [];
    const rowEl = document.querySelector('[data-zone="tavern"] .row');
    if (events.length === 0 || !rowEl) return;
    const rr = rowEl.getBoundingClientRect();
    const sample = rowEl.querySelector('.card')?.getBoundingClientRect();
    const w = sample?.width ?? rr.height * 0.752;
    const h = sample?.height ?? rr.height;
    const cy = rr.top + rr.height / 2;
    const ghosts = events.map((ev, i) => {
      const gx = rr.left + rr.width / 2 + (i - (events.length - 1) / 2) * (w * 0.72);
      const eaterEl = document.querySelector(`[data-zone="warband"] .row .card[data-uid="${ev.eaterUid}"]`);
      let dx = 0;
      let dy = 220; // fallback: drift down if the eater isn't on screen
      if (eaterEl) {
        const er = eaterEl.getBoundingClientRect();
        dx = er.left + er.width / 2 - gx;
        dy = er.top + er.height / 2 - cy;
      }
      return { fid: ev.fodderId, attack: ev.attack, health: ev.health, x0: gx - w / 2, y0: cy - h / 2, w, h, dx, dy };
    });
    setFodderAnim({ key: run.fodderEatenSeq, ghosts });
    const t = window.setTimeout(() => setFodderAnim(null), 2300); // slower: hold, then swirl in
    return () => window.clearTimeout(t);
  }, [run.fodderEatenSeq, run.fodderEaten]);

  // --- Live warband drag: a dragged board minion is *lifted out* of the row entirely
  // (the floating copy IS the card) for the whole drag; the rest physically close up,
  // and an empty drop-slot opens at the live insertion point while over the warband.
  // Dropping lands the card straight into that slot — no post-drop "swap". A played
  // hand card opens the same slot. ---
  // Insertion / hover tracks the dragged card's *centre* (not the raw pointer, which is offset by
  // wherever you grabbed the card) — so the drop slot lands where the card visually sits.
  const dragCx = drag ? drag.x - drag.ox + drag.w / 2 : 0;
  const magHoverTarget = drag?.active && drag.source === 'hand' && drag.view.keywords.includes('M') && overZone === 'warband'
    ? run.board[warbandIndexAt(dragCx)]
    : undefined;
  const wouldMagnetize =
    !!drag?.active &&
    !magSlide && // once the slide starts, the warband settles (no more shove preview)
    !!magHoverTarget &&
    magnetizesTo(drag.view.cardId, magHoverTarget.cardId);
  // Casting a targeted spell from the hand: highlight the friendly minion under the
  // cursor (it's the target), and don't treat it as a board-insertion drag.
  const castingSpell = !!drag?.active && drag.source === 'hand' && !!drag.view.spell && drag.view.target === 'friendly';
  const castTargetUid = castingSpell ? boardUidAt(drag!.x, drag!.y) : null;
  const draggingBoard = !!drag?.active && drag.source === 'board';
  const overWarband =
    !!drag?.active &&
    !magSlide &&
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
  const shopGapIndex = overShop ? shopIndexAt(dragCx, drag!.uid) : -1;
  // Where the empty drop-slot opens (insertion index among the displayed cards), or -1.
  // A magnetizing Cling Drone also shoves cards aside (a slot opens beside the target Mech).
  const gapIndex =
    overWarband || wouldMagnetize
      ? warbandIndexAt(dragCx, drag!.source === 'board' ? drag!.uid : undefined)
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

  // A dust puff on a primary click of the *empty board* — never on a card or any control,
  // so it reads as touching the table itself. Purely cosmetic (doesn't block other handlers).
  const puffBoard = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || heroArmed || drag) return;
    const t = e.target as HTMLElement;
    if (t.closest('.card, button, a, input, [role="dialog"], .bar, .rtimer, .shopctl')) return;
    dustKeyRef.current += 1;
    const key = dustKeyRef.current;
    setDust({ x: e.clientX, y: e.clientY, key });
    window.setTimeout(() => setDust((d) => (d?.key === key ? null : d)), 620);
  };

  // End Turn → face the Omen. End-of-Turn effects play out *one at a time* on the still-mounted
  // recruit board so the player sees each one fire — and each repeats `chronosRepeats` times when a
  // Chronos is in play (mirrors `applyEndOfTurn`'s per-card-then-repeat order). Each beat flashes the
  // proc flourish under its card plus a tailored effect: Ritualist washes the whole shop purple (it
  // buffs the Fodder there), Combinator electrifies the Mechs it magnetizes onto. Then it faces the
  // Omen. (The effects themselves still *resolve* inside `faceOmen` — this is purely the telegraph.)
  const endTurn = (): void => {
    if (inCombat || endTurnPendingRef.current) return;
    const repeats = chronosRepeats(run);
    type Beat = { uid: string; kind: 'ritualist' | 'combinator' | 'generic'; targets: string[] };
    const beats: Beat[] = [];
    for (const card of run.board) {
      const def = CARD_INDEX[card.cardId];
      if (!def?.effects.some((e) => e.on === 'endOfTurn')) continue;
      const kind: Beat['kind'] =
        card.cardId === 'ritualist' ? 'ritualist' : card.cardId === 'combinator' ? 'combinator' : 'generic';
      // Combinator electrifies the 2 highest-Attack friendly Mechs (incl. dual-type), like the reducer.
      const targets =
        kind === 'combinator'
          ? run.board
              .filter((c) => c.uid !== card.uid && (c.tribe === 'mech' || CARD_INDEX[c.cardId]?.tribe2 === 'mech'))
              .sort((a, b) => b.attack - a.attack)
              .slice(0, 2)
              .map((c) => c.uid)
          : [];
      for (let r = 0; r < repeats; r++) beats.push({ uid: card.uid, kind, targets });
    }
    if (beats.length === 0) {
      dispatch({ type: 'faceOmen' });
      return;
    }
    endTurnPendingRef.current = true;
    const BEAT = 760;
    const GAP = 170;
    const playBeat = (i: number): void => {
      if (i >= beats.length) {
        setEotProcUids(new Set());
        setElectrifyUids(new Set());
        endTurnPendingRef.current = false;
        dispatch({ type: 'faceOmen' });
        return;
      }
      const b = beats[i]!;
      setEotProcUids(new Set([b.uid]));
      if (b.kind === 'ritualist') setShopFlash((k) => k + 1);
      if (b.kind === 'combinator') setElectrifyUids(new Set(b.targets));
      sfx.proc();
      window.setTimeout(() => {
        setEotProcUids(new Set());
        setElectrifyUids(new Set());
        window.setTimeout(() => playBeat(i + 1), GAP);
      }, BEAT);
    };
    playBeat(0);
  };
  // The "carry" — your highest-Attack minion — auto-target for a targeted spell flung upward.
  const carryUid = (): string | undefined =>
    run.board.length ? run.board.reduce((a, b) => (b.attack > a.attack ? b : a)).uid : undefined;
  // Spark on a targeted minion's card centre (falls back to the drop point).
  const sparkAtUid = (uid: string, fx: number, fy: number): void => {
    const el = document.querySelector(`[data-zone="warband"] .row .card[data-uid="${uid}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      fireSpark(r.left + r.width / 2, r.top + r.height / 2);
    } else fireSpark(fx, fy);
  };

  const applyDrop = (d: DragState, zone: Zone | null, x: number, y: number): boolean => {
    // Insertion uses the dragged card's centre (not the raw drop pointer), matching the live preview.
    const cx = x - d.ox + d.w / 2;
    if (d.source === 'shop' && zone === 'hand') {
      dispatch({ type: 'buy', uid: d.uid });
      return true;
    }
    // A shop offer dropped back in the tavern reorders it (so it lands where you drop it,
    // like the warband, instead of snapping back). The spell stays pinned at the end.
    if (d.source === 'shop' && zone === 'tavern' && d.uid !== run.spell?.uid) {
      dispatch({ type: 'reorderShop', uid: d.uid, toIndex: shopIndexAt(cx, d.uid) });
      return true;
    }
    // Sell a *board* minion by dropping it on the tavern. A minion must be played to the board first
    // before it can be sold — a hand minion flung up to the tavern just snaps back to the hand (it
    // falls through to the invalid-drop snap-back below). Spells are never sold (cast/play gesture).
    if (d.source === 'board' && zone === 'tavern' && !d.view.spell) {
      dispatch({ type: 'sell', uid: d.uid });
      return true;
    }
    // Cast a spell — playable anywhere from the warband up (incl. the tavern), since spells can't
    // be sold. A targeted spell hits the minion under the cursor, or auto-targets the carry when
    // flung up with no minion under it; an untargeted spell just resolves.
    if (d.source === 'hand' && d.view.spell) {
      const up = zone === 'warband' || zone === 'tavern';
      if (d.view.target === 'friendly') {
        const targetUid = boardUidAt(x, y) ?? (up ? carryUid() : undefined);
        if (!targetUid) return false; // no friendly minion to cast on
        dispatch({ type: 'play', uid: d.uid, targetUid });
        sparkAtUid(targetUid, x, y); // spark bursts on the minion it hit
        return true;
      }
      if (up) {
        dispatch({ type: 'play', uid: d.uid });
        fireSpark(x, y);
        return true;
      }
      return false;
    }
    if (d.source === 'hand' && zone === 'warband') {
      dispatch({ type: 'play', uid: d.uid, toIndex: warbandIndexAt(cx) });
      return true;
    }
    if (d.source === 'board' && zone === 'warband') {
      dispatch({ type: 'reposition', uid: d.uid, toIndex: warbandIndexAt(cx, d.uid) });
      return true;
    }
    return false;
  };

  // Gold sell-preview glow: a *board* minion hovered over the tavern (only board minions sell;
  // a hand minion snaps back). Spells dragged up are *played*, not sold, so no sell glow.
  const sellGlow = overZone === 'tavern' && drag?.source === 'board' && !drag?.view.spell;
  const isDragging = (uid: string): boolean => drag?.active === true && drag.uid === uid;
  // A shop card over the hand will buy it — glow the hand to confirm the drop target.
  const canDropHand = !!drag?.active && drag.source === 'shop' && overZone === 'hand';

  return (
    <div
      className={`app${inCombat ? ' combat' : ''}${fighting ? ' fighting' : ''}${replay.shaking ? ' shaking' : ''}${
        inCombat && replay.done ? ` done ${replay.result}` : ''
      }`}
      onPointerDown={puffBoard}
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
          {run.tier >= CONFIG.maxTier ? 'Tavern MAX' : (
            <>
              Tavern Up <span className="c"><Icon name="mana" />{run.upgradeCost}</span>
            </>
          )}
        </button>
        <button className={`btn big endturn${timeUp ? ' urgent' : ''}`} onClick={endTurn}>
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
                  End Combat
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
        {shopFlash > 0 && <div className="shopflash" key={shopFlash} aria-hidden="true" />}
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
                card={shopViews.get(o.uid)!}
                refCards={refViewsByUid.get(o.uid)}
                dragging={!!drag?.active}
                highlight={heroArmed}
                targeted={heroArmed && aim?.targetUid === o.uid}
                buffed={buffedUids.has(o.uid)}
                onPointerDown={heroArmed ? undefined : onCardPointerDown}
              />
            </Fragment>
          ))}
          {shopGapIndex >= displayShop.length && <span className="dropslot" aria-hidden="true" />}
          {run.spell && !(draggingShop && drag!.uid === run.spell.uid) && (
            <Card
              key={run.spell.uid}
              uid={run.spell.uid}
              card={spellView!}
              onPointerDown={heroArmed ? undefined : onCardPointerDown}
            />
          )}
          </>
          )}
        </div>
      </div>

      {!inCombat && seconds <= 15 && (
        <div className="rope" title={`${seconds}s left`}>
          <div className="rope-lit" style={{ width: `${((15 - Math.max(0, seconds)) / 15) * 100}%` }} />
          <div className="rope-flame" style={{ left: `${((15 - Math.max(0, seconds)) / 15) * 100}%` }}>
            <span className="fl-glow" />
            <span className="fl-body" />
            <span className="fl-core" />
            <span className="fl-ember" style={{ '--ex': '-6px', animationDelay: '0s' } as CSSProperties} />
            <span className="fl-ember" style={{ '--ex': '5px', animationDelay: '0.33s' } as CSSProperties} />
            <span className="fl-ember" style={{ '--ex': '-1px', animationDelay: '0.66s' } as CSSProperties} />
          </div>
        </div>
      )}

      <div className={`zone${overWarband || wouldMagnetize ? ' dropok' : ''}`} data-zone="warband">
        <div className="row warband">
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
                    card={boardViews.get(m.uid)!}
                    refCards={refViewsByUid.get(m.uid)}
                    dragging={!!drag?.active}
                    highlight={heroArmed || castingSpell}
                    targeted={(heroArmed && aim?.targetUid === m.uid) || castTargetUid === m.uid}
                    buffed={buffedUids.has(m.uid)}
                    battlecry={battlecryUids.has(m.uid) || eotProcUids.has(m.uid)}
                    electrify={electrifyUids.has(m.uid) || magTargetUid === m.uid}
                    karwind={karwindFlameUids.has(m.uid)}
                    onPointerDown={heroArmed ? undefined : onCardPointerDown}
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
              uid={m.uid}
              card={handViews.get(m.uid)!}
              refCards={refViewsByUid.get(m.uid)}
              dragging={!!drag?.active}
              dimmed={isDragging(m.uid)}
              buffed={buffedUids.has(m.uid)}
              arrived={arrivedUids.has(m.uid)}
              onPointerDown={onCardPointerDown}
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

      {/* A clear "End of Turn" beat as the turn ends (end-of-turn effects have resolved). */}
      {endTurnFlash && (
        <div className="eotbanner" aria-hidden="true">
          <span className="eot-text">End of Turn</span>
        </div>
      )}

      {drag?.active && !castingSpell && (
        <div
          className={`dragcard${snapping ? ' snap' : ''}${wouldMagnetize ? ' electric' : ''}${magSlide ? ' magslide' : ''}`}
          style={{
            width: drag.w,
            height: drag.h,
            // pivot scale/rotate around the exact grab point so the card stays under the cursor.
            // When magnetizing, the card shrinks straight into the Mech (no tilt) so it "absorbs".
            transformOrigin: `${drag.ox}px ${drag.oy}px`,
            transform: magSlide
              ? `translate(${drag.x - drag.ox}px, ${drag.y - drag.oy}px) scale(0.06)`
              : `translate(${drag.x - drag.ox}px, ${drag.y - drag.oy}px) scale(1.04) rotate(-1.5deg)`,
            // accelerate + fade fully out as it shrinks in, so it vanishes cleanly into the Mech
            opacity: magSlide ? 0 : 1,
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

      {/* Board dust: a soft puff of motes kicked up where you tapped the empty table. */}
      {dust && (
        <div className="boarddust" key={dust.key} style={{ left: dust.x, top: dust.y }} aria-hidden="true">
          <span className="bd-puff" />
          {[28, 96, 150, 205, 270, 322].map((a, i) => (
            <span
              className="bd-mote"
              key={a}
              style={{ '--a': `${a}deg`, '--d': `${16 + (i % 3) * 7}px` } as CSSProperties}
            />
          ))}
        </div>
      )}

      {/* Tavern Fodder: a ghost Fred pops in the tavern (showing its *eaten* stats — buffed by
          Ritualist if applicable), wreathed in purple swirls, then drifts into the Demon that ate it. */}
      {!inCombat &&
        fodderAnim?.ghosts.map((g, i) => {
          const def = CARD_INDEX[g.fid];
          if (!def) return null;
          const view: CardView = {
            name: def.name, cardId: def.id, tribe: def.tribe, attack: g.attack, health: g.health,
            keywords: def.keywords, text: def.text, tier: def.tier,
            baseAttack: def.attack, baseHealth: def.health, // so a buffed Fred reads its gain in green
          };
          return (
            <div
              key={`${fodderAnim.key}-${i}`}
              className="fodderghost"
              style={{ left: g.x0, top: g.y0, width: g.w, height: g.h, '--dx': `${g.dx}px`, '--dy': `${g.dy}px` } as CSSProperties}
              aria-hidden="true"
            >
              <span className="fodderswirl" aria-hidden="true">
                {[0, 1, 2, 3].map((n) => (
                  <span className="fs-orb" key={n} style={{ '--n': n } as CSSProperties} />
                ))}
              </span>
              <Card card={view} />
            </div>
          );
        })}

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
                  <div className={`logline ${line.kind}`} key={i}>{line.text}</div>
                ))
              )}
            </div>
            <button className="btn big" onClick={() => setShowLog(false)}>Close</button>
          </div>
        </div>
      )}

      {run.chooseOne && (
        <div className="discover-ov" role="dialog" aria-label="Choose One">
          <div className="discover-box">
            <div className="discover-title">
              <b>Choose One</b> — {CARD_INDEX[run.chooseOne.cardId]?.name}
            </div>
            <div className="chooseone-opts">
              {(CARD_INDEX[run.chooseOne.cardId]?.chooseOne ?? []).map((opt, i) => (
                <button
                  className="chooseopt"
                  key={i}
                  onClick={() => dispatch({ type: 'chooseOne', index: i })}
                  dangerouslySetInnerHTML={{ __html: mdBold(opt.text) }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {run.discover && (
        <div className="discover-ov" role="dialog" aria-label="Discover a card">
          <div className="disc-panel">
            <span className="disc-gem disc-gem-top" aria-hidden="true" />
            <div className="disc-banner"><span className="disp">Discover</span></div>
            <div className="disc-sub">Choose a minion from the next tier.</div>
            <div className="disc-cards">
              {run.discover.map((id, i) => {
                const c = CARD_INDEX[id];
                return (
                  <div className="disc-slot" key={`${id}-${i}`} style={{ '--c': `var(--t-${c.tribe})` } as CSSProperties}>
                    <Card
                      card={{ name: c.name, cardId: c.id, tribe: c.tribe, tribe2: c.tribe2, attack: c.attack, health: c.health, keywords: c.keywords, text: c.text, tier: c.tier }}
                      onClick={() => dispatch({ type: 'discover', index: i })}
                    />
                  </div>
                );
              })}
            </div>
            <span className="disc-gem disc-gem-bot" aria-hidden="true" />
          </div>
        </div>
      )}
    </div>
  );
}
