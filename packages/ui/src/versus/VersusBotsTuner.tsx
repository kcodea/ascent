/**
 * THE VERSUS BOTS + DUOS DEV TUNER (owner 2026-10-25: "maybe if you have a bot teammate, have a dev tuner that says
 * like... pass a card etc etc so i can just force the various mechanics"). DEV ONLY: listed in the dev menu (Versus),
 * which a production build strips.
 *
 * The table is the host's own: up to three test bots (each its own account, playing in this tab). The panel drives
 * them, and the real code paths, to show a mechanic on demand: a bot passes you a card through its run and the pass
 * RPCs; your pass lands in the bot's run, which answers the server; a refusal is a real refusal (a full hand, an away
 * teammate, no Gold, the clock); a forced fight is the real resolver on boards set up for it; a concede is the real
 * forfeit. What only a test needs (a hand topped up, a board replaced, the hearts, the clock, the fight order) is a
 * dev edit or a dev RPC (`versus_dev_*`, the host's bot-only tables, no XP), labelled "dev" here. Who fights first is
 * the server's seeded 50/50 (R-DUOS-ORDER-01) and the resolver reads only the seed, so the panel shows it, never sets it.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { duosTeamOf, handCap, poolOf, type RunState, type VersusGroupSeat } from '@game/sim';
import { useDraggablePanel } from '../useDraggablePanel';
import { useGame } from '../store';
import { currentUserId } from '../identity';
import {
  concedeVersusBot, setVersusBotDisconnected, setVersusBotHooks, startVersusBot, stopVersusBotSlot, useVersusBots, versusBotAtSeat, versusBotDriver,
  type VersusBotSlot,
} from './versusBot';
import { fillHand } from './versusBotDriver';
import { forfeitMatch, useVersus } from './versusStore';
import { versusRemote, VersusError } from './versusRemote';
import { enterTeammateView, exitTeammateView } from './teammateView';
import { ownRunWhileWatching } from './spectate';
import {
  DUOS_SCENARIO_LABEL, scenarioBoard, tunerNote, useDuosTuner, withAddedCard, withEmptyBoard, withEmptyHand, withForcedBoard, withGold,
  type DuosScenario,
} from './duosDevTuner';
import './versus.css';

/** Am I still shopping this round (a seat, the shop open, not locked)? "Bots end turn after me" waits on it. */
function meStillShopping(): boolean {
  const m = useVersus.getState().match;
  if (!m || m.phase !== 'shop' || m.paused_at) return false;
  const me = currentUserId();
  if (m.group) return !!m.group.me && !m.p1_locked; // the projection's p1 is me
  if (m.p1_user === me) return !m.p1_locked;
  if (m.p2_user === me) return !m.p2_locked;
  return false;
}

/** The tuner's bot hooks: installed once the panel first opens, kept after it closes (an armed fight still applies). */
function installHooks(): void {
  setVersusBotHooks({
    holdLock: () => useDuosTuner.getState().botsAfterMe && meStillShopping(),
    beforeLock: (run, ctx) => {
      const a = useDuosTuner.getState().armed;
      const first = useVersus.getState().match?.group?.duos?.first;
      if (!a || a.round !== ctx.round || !ctx.seat || !first) return run;
      return withForcedBoard(run, scenarioBoard(a.kind, ctx.seat, a.viewer, first));
    },
  });
}

/** Edit MY run (dev). Refused while the teammate view holds the screen (the store's run is theirs then). */
function editMine(fn: (r: RunState) => RunState): boolean {
  if (ownRunWhileWatching()) { tunerNote('Leave the teammate view first.'); return false; }
  const g = useGame.getState();
  if (g.run.mode !== 'versus') { tunerNote('Not in a Versus game.'); return false; }
  useGame.setState({ run: fn(g.run) });
  return true;
}

const say = (p: Promise<unknown>, ok: string): void => {
  void p.then(() => tunerNote(ok)).catch((e: unknown) => tunerNote(`Refused: ${e instanceof VersusError ? e.code : (e as Error).message}`));
};

function Btn({ label, hint, run, disabled }: { label: string; hint: string; run: () => void; disabled?: boolean }) {
  return <button type="button" className="sfxmix-copy" aria-label={hint} disabled={disabled} onClick={run}>{label}</button>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="tuner-section">
      <div className="tuner-gh">{title}</div>
      <div className="lunge-btns duostuner-btns">{children}</div>
    </div>
  );
}

export function VersusBotsTuner(): JSX.Element {
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('versusbots');
  useEffect(() => { installHooks(); }, []);
  // The bots' drivers are not a store: re-read them once a second while the panel is open (a dev panel, off the game's
  // render path), so a bot that just took its seat or locked shows up.
  const [, setTick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => setTick((x) => x + 1), 1000); return () => window.clearInterval(t); }, []);
  const room = useVersus((s) => s.room);
  const match = useVersus((s) => s.match);
  const bots = useVersusBots((s) => s.bots);
  const busy = useVersusBots((s) => s.busy);
  const tuner = useDuosTuner();
  const run = useGame((s) => s.run);
  const me = currentUserId();
  const [cardId, setCardId] = useState('');
  const [hearts, setHearts] = useState<Record<string, number>>({});

  const raw = match?.group?.raw ?? null;
  const duos = match?.group?.duos ?? null;
  const mySeat = match?.group?.me ?? null;
  const live = !!match && match.phase !== 'complete';
  const host = !!room && room.host_user_id === me;
  const roomSeats = useMemo(() => new Map((room?.members ?? []).map((m) => [m.userId, m.role] as const)), [room]);
  const slotAt = (seat: VersusGroupSeat | null | undefined): VersusBotSlot | null => (seat ? versusBotAtSeat(seat, roomSeats) : null);
  const mateSlot = duos?.mate ? slotAt(duos.mate) : null;
  const mate = mateSlot ? versusBotDriver(mateSlot) : null;
  const foeSeats = raw && mySeat && duos ? raw.seats.filter((s) => s.seat !== mySeat && s.seat !== duos.mate).map((s) => s.seat) : [];
  const foeSlots = foeSeats.map(slotAt).filter((x): x is VersusBotSlot => x != null);

  const pool = useMemo(() => (run.mode === 'versus' ? [...poolOf(run).buyable].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)) : []),
    // The pool only changes with the run's set and tribes.
    [run.mode, run.setId, run.tribes]);
  const pick = cardId || pool[0]?.id || '';

  const editMate = (fn: (r: RunState) => RunState, ok: string): void => {
    if (!mate) { tunerNote('No bot teammate.'); return; }
    tunerNote(mate.edit(fn) ? ok : 'The bot has no run yet.');
  };

  const matePasses = (chosen: boolean): void => {
    if (!mate) { tunerNote('No bot teammate.'); return; }
    let uid: string | undefined;
    if (chosen) {
      mate.edit((r) => withAddedCard(r, pick, 'hand'));
      uid = mate.run?.hand[mate.run.hand.length - 1]?.uid;
    }
    mate.edit((r) => (r.embers < 1 ? withGold(r, 1) : r)); // a pass costs the bot 1 Gold, like anyone
    const why = mate.forcePass(uid);
    tunerNote(why ? `The bot could not pass (${why}).` : 'Your teammate passed you a card. It drops out of their portrait in a moment.');
  };

  const arm = (kind: DuosScenario): void => {
    if (!match || !mySeat || !duos || match.phase !== 'shop') { tunerNote('Arm it during a Duos shop.'); return; }
    const lockedBots = bots.filter((b) => versusBotDriver(b.slot)?.lockedFor === match.round).map((b) => b.name);
    useDuosTuner.setState({ armed: { kind, round: match.round, viewer: mySeat, first: duos.first } });
    const mine = !match.p1_locked && editMine((r) => withForcedBoard(r, scenarioBoard(kind, mySeat, mySeat, duos.first)));
    tunerNote(`${DUOS_SCENARIO_LABEL[kind]} armed for round ${match.round}.${mine ? ' Your board is set.' : ' You already locked: your board stays.'}`
      + (lockedBots.length ? ` Already locked: ${lockedBots.join(', ')}.` : ' End your turn to see it.'));
  };

  const setSeatHearts = (seat: VersusGroupSeat, n: number): void => {
    if (!match) return;
    say(versusRemote.devSetHearts(match.id, seat, n), `Hearts set to ${n}.`);
  };

  const teams = duos && raw ? (['a', 'b'] as const).map((t, i) => ({ t, label: `Team ${i + 1}`, seat: raw.seats.find((s) => duosTeamOf(s.seat) === t) ?? null })) : [];

  return (
    <div className="sfxmix tunerpanel duostuner" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>
        <span className="tuner-emblem" aria-hidden="true">🤝</span>
        <b className="tuner-title">Versus Bots + Duos</b>
        <span>dev · forces mechanics · no XP</span>
      </div>

      {tuner.note && <div className="duostuner-note" role="status">{tuner.note}</div>}

      <Section title="Bots (up to three, each its own account)">
        {bots.length === 0 && <span className="duostuner-line">No bots. Add one from an empty seat in the room, or below.</span>}
        {bots.map((b) => {
          const d = versusBotDriver(b.slot);
          const seat = d?.realSeat ?? (b.userId ? roomSeats.get(b.userId) : null) ?? '-';
          return (
            <div className="duostuner-bot" key={b.slot}>
              <span className="duostuner-line">{b.name} · {seat} · {b.status}{b.disconnected ? ' · away' : ''}</span>
              <Btn label={b.disconnected ? 'Reconnect' : 'Disconnect'} hint="Stop or resume its heartbeat: pause, the reconnect grace, then auto"
                run={() => setVersusBotDisconnected(!b.disconnected, b.slot)} />
              <Btn label="Concede" hint="It concedes the running match (a group seat goes to the stands; Duos: its team goes out)" disabled={!live}
                run={() => { void concedeVersusBot(b.slot).then(() => tunerNote(`${b.name} conceded.`)); }} />
              <Btn label="Remove" hint="It leaves the room" run={() => { void stopVersusBotSlot(b.slot); }} />
            </div>
          );
        })}
        {room && host && room.status === 'open' && (
          <Btn label="Add bot" hint="Seat a bot on the first open seat" disabled={busy || bots.length >= 3} run={() => { void startVersusBot(room.id); }} />
        )}
        <label className="duostuner-check">
          <input type="checkbox" checked={tuner.botsAfterMe} onChange={(e) => useDuosTuner.setState({ botsAfterMe: e.target.checked })} />
          Bots end turn after me
        </label>
      </Section>

      {live && raw && (
        <Section title="Match (dev)">
          <Btn label="Skip shop timer" hint="Dev: the clock jumps to 5 seconds; everyone locks at 0:00 as usual" disabled={match!.phase !== 'shop'}
            run={() => say(versusRemote.devSkipShop(match!.id), 'The shop ends in 5 seconds.')} />
          <Btn label="Concede" hint="You concede (Duos: your whole team goes out)" disabled={!mySeat} run={() => { void forfeitMatch(); }} />
          {duos && <Btn label="Force win" hint="Both foe bots concede: their team is out and yours wins" disabled={!foeSlots.length}
            run={() => { void Promise.all(foeSlots.map(concedeVersusBot)).then(() => tunerNote('The foe team conceded.')); }} />}
          {duos && <Btn label="Force loss" hint="Your bot teammate concedes: your team is out" disabled={!mateSlot}
            run={() => { void concedeVersusBot(mateSlot!).then(() => tunerNote('Your teammate conceded.')); }} />}
        </Section>
      )}

      {live && raw && (
        <Section title={duos ? 'Team hearts (dev)' : 'Hearts (dev)'}>
          {(duos ? teams.filter((x) => x.seat).map((x) => ({ key: x.t, label: x.label, seat: x.seat!.seat, now: x.seat!.hearts, out: x.seat!.eliminatedRound != null }))
            : raw.seats.map((s) => ({ key: s.seat, label: s.name, seat: s.seat, now: s.hearts, out: s.eliminatedRound != null }))).map((x) => (
            <div className="duostuner-bot" key={x.key}>
              <span className="duostuner-line">{x.label}: {x.now}</span>
              <input className="duostuner-num" type="number" min={1} max={30} value={hearts[x.key] ?? x.now} aria-label={`${x.label} hearts`}
                onChange={(e) => setHearts((h) => ({ ...h, [x.key]: Number(e.target.value) }))} />
              <Btn label="Set" hint="Dev: set these hearts now" disabled={x.out} run={() => setSeatHearts(x.seat, hearts[x.key] ?? x.now)} />
              <Btn label="1 left" hint="Dev: one heart left (the next lost fight ends it)" disabled={x.out} run={() => setSeatHearts(x.seat, 1)} />
            </div>
          ))}
        </Section>
      )}

      {live && duos && mySeat && (
        <>
          <Section title="Passing">
            <Btn label="Teammate passes me a card" hint="Your bot teammate passes a random card through the real pass" run={() => matePasses(false)} disabled={!mate} />
            <Btn label="...this card" hint="Your bot teammate gets the picked card, then passes it to you" run={() => matePasses(true)} disabled={!mate || !pick} />
            <span className="duostuner-line">To pass to the bot, drag a card onto its portrait (bottom right). It accepts.</span>
          </Section>

          <Section title="Refused passes">
            <Btn label="Teammate hand full" hint="Dev: the bot's hand fills to the cap (hover its portrait while dragging)"
              run={() => { if (mate) mate.quiet = true; editMate((r) => fillHand(r, handCap(r)), 'Teammate hand is full (it stops shopping). Drag a card onto their portrait.'); }} disabled={!mate} />
            <Btn label="Empty teammate hand" hint="Dev: the bot's hand is emptied and it shops again"
              run={() => { if (mate) mate.quiet = false; editMate(withEmptyHand, 'Teammate hand emptied.'); }} disabled={!mate} />
            <Btn label="Teammate away" hint="The bot disconnects: pause, the 30 s grace, then its board plays on auto"
              run={() => { if (mateSlot) { setVersusBotDisconnected(true, mateSlot); tunerNote('Teammate disconnected. Unpause after the grace to put them on auto.'); } }} disabled={!mateSlot} />
            <Btn label="Teammate back" hint="The bot reconnects and presses Unpause" run={() => { if (mateSlot) { setVersusBotDisconnected(false, mateSlot); tunerNote('Teammate reconnected.'); } }} disabled={!mateSlot} />
            <Btn label="My Gold to 0" hint="Dev: your Gold is 0 (a pass costs 1)" run={() => { if (editMine((r) => withGold(r, 0))) tunerNote('You have 0 Gold.'); }} />
            <Btn label="Close passing" hint="Dev: skip the shop timer; passing closes with it" disabled={match!.phase !== 'shop'}
              run={() => say(versusRemote.devSkipShop(match!.id), 'The shop ends in 5 seconds; passing closes at 0:00.')} />
            <Btn label="Arm full-hand race" hint="Your next pass to the bot is accepted, then its hand fills before it lands: the server refuses it and refunds you"
              run={() => { if (mate) { mate.raceArmed = true; tunerNote('Race armed: pass a card to your teammate now.'); } }} disabled={!mate} />
            <span className="duostuner-line">Just passed to you: a card your teammate passed cannot go straight back.</span>
          </Section>

          <Section title="Teammate view">
            <Btn label="Watch teammate" hint="Swap to your teammate's live screen" run={() => enterTeammateView()} />
            <Btn label="Back to my board" hint="Swap back" run={() => exitTeammateView()} />
          </Section>

          <Section title="Who fights first">
            <span className="duostuner-line">This round {duos.first[duos.team] === mySeat ? 'you fight' : 'your teammate fights'} first (seeded each round; nobody picks it). The forced fights below follow it.</span>
          </Section>

          <Section title="Next fight (dev boards)">
            {(Object.keys(DUOS_SCENARIO_LABEL) as DuosScenario[]).map((k) => (
              <Btn key={k} label={DUOS_SCENARIO_LABEL[k]} hint="Dev: sets every board for this round's fight; bots apply it as they lock" run={() => arm(k)} disabled={match!.phase !== 'shop'} />
            ))}
            <Btn label="Clear" hint="Disarm the forced fight" run={() => { useDuosTuner.setState({ armed: null }); tunerNote('Forced fight cleared.'); }} disabled={!tuner.armed} />
            {tuner.armed && <span className="duostuner-line">Armed: {DUOS_SCENARIO_LABEL[tuner.armed.kind]}, round {tuner.armed.round}.</span>}
          </Section>

          <Section title="Teammate board and hand (dev)">
            <select className="duostuner-select" value={pick} aria-label="Card" onChange={(e) => setCardId(e.target.value)}>
              {pool.map((d) => <option key={d.id} value={d.id}>T{d.tier} {d.name}</option>)}
            </select>
            <Btn label="To teammate hand" hint="Dev: the picked card into the bot's hand" run={() => editMate((r) => withAddedCard(r, pick, 'hand'), 'Added to your teammate\'s hand.')} disabled={!mate || !pick} />
            <Btn label="To teammate board" hint="Dev: the picked card onto the bot's board (it fights with it if it has not locked)"
              run={() => editMate((r) => withAddedCard(r, pick, 'board'), 'Added to your teammate\'s board.')} disabled={!mate || !pick} />
            <Btn label="Clear teammate board" hint="Dev: the bot's board is emptied" run={() => editMate(withEmptyBoard, 'Teammate board cleared.')} disabled={!mate} />
          </Section>
        </>
      )}
    </div>
  );
}
