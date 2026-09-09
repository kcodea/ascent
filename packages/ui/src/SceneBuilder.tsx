import { useMemo, useRef, useState } from 'react';
import { CARD_INDEX, RUNES, EPIC_RUNES, SETS, activeSet, poolFor, type SetId } from '@game/content';
import { HEROES, runQaScenario, validateQaScenario, type BoardSnapshot, type BotLevel, type QaScenarioV1, type RunState, type ShopCard } from '@game/sim';
import { buildQaScenario, reproCommandFor, scenarioFileName, scenarioFileText, QA_SCENARIO_FIXTURE_DIR } from './qaScenarioBridge';
import type { Keyword } from '@game/core';
import { useGame } from './store';
import { useDraggablePanel, DevPanelContext } from './useDraggablePanel';
import { turnClock } from './turnClock';
import { addEnemy, stagedBoard, foeSnapshotOf, MAX_BOARD } from './sandboxEdit';

/**
 * DEV-only SCENE BUILDER control panel — the sandbox rig launched from the title (its own mode, see
 * `startSceneBuilder`). It mutates the LIVE run via the store, so every real system (buy-time effects,
 * combat, quests, FX) runs exactly as in a normal game — nothing bypasses the sim.
 *
 * Since 2026-09-09 the sandbox is a LOBBY GAME AGAINST BOTS (the practice-bots lobby, invulnerable seat, no
 * curtain), not the retired course mode — so the rail, pairing and elimination all run for real. The RULES
 * toggle picks the feel: GOD (infinite time + Gold) or NORMAL (the real clock + real per-turn Gold); every
 * authoring tool works under both, and the player cannot be eliminated under either.
 *
 * Layout (2026-09-09): a brass nameplate carrying the live readout (round · seats left · rules), then five
 * FOLDABLE sections — Setup (hero · set · rules · bots), Table (Gold / time / sweeps as tiles + the tier row),
 * Enemy (which row shows, edit mode, dummies), Library (one search, Cards | Runes tabs, one list) and
 * Scenarios (the bug-report + QA bridges, folded by default). Fold state is remembered per section. The whole
 * panel collapses to a strip so it can tuck out of the way while you watch a fight. It wears the tuner
 * panels' slate (`.scenebuilder` in styles.css). Stripped from production with the rest of the dev tooling.
 */
type CardRow = { id: string; name: string; tier: number; spell: boolean; tribe: string; hay: string };
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

/** Every set in the registry — INCLUDING disabled ones, which is the point: the rig is how you play a set
 *  that is still in development (`enabled: false`) without flipping the global switch and moving real runs
 *  onto it. Pool sizes are shown because an empty set draws an empty shop, and that should read as
 *  "set 2 has no cards yet", not as a bug. */
const SET_OPTIONS = Object.values(SETS).map((s) => {
  const p = poolFor(s.id);
  return { id: s.id, name: s.name, enabled: s.enabled, minions: p.buyable.length, spells: p.spells.length };
});

/** Outer shell: holds the minimized state and provides `close` (the injected ✕ / DevPanelContext) so the panel's
 *  ✕ minimizes it to the dock instead of no-op-closing. The inner component (below) reads that context via
 *  `useDraggablePanel`, so the provider must sit ABOVE its hook call — hence the split. */
export function SceneBuilder() {
  const [minimized, setMinimized] = useState(false);
  return (
    <DevPanelContext.Provider value={{ close: () => setMinimized(true) }}>
      <SceneBuilderInner minimized={minimized} onRestore={() => setMinimized(false)} />
    </DevPanelContext.Provider>
  );
}

function SceneBuilderInner({ minimized, onRestore }: { minimized: boolean; onRestore: () => void }) {
  const run = useGame((s) => s.run);
  const startSceneBuilder = useGame((s) => s.startSceneBuilder);
  const dispatch = useGame((s) => s.dispatch);
  const [query, setQuery] = useState('');
  const [enemyHp, setEnemyHp] = useState(5);
  const [enemyAtk, setEnemyAtk] = useState(0);
  const [enemyN, setEnemyN] = useState(5);
  const [refill, setRefill] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const sbEditMode = useGame((s) => s.sbEditMode);
  const setSbEditMode = useGame((s) => s.setSbEditMode);
  const sbTavernShowsEnemy = useGame((s) => s.sbTavernShowsEnemy);
  const setSbTavernShowsEnemy = useGame((s) => s.setSbTavernShowsEnemy);
  const replayLastCombat = useGame((s) => s.replayLastCombat);
  const sbRules = useGame((s) => s.sbRules);
  const setSbRules = useGame((s) => s.setSbRules);
  const sbBotLevel = useGame((s) => s.sbBotLevel);
  const { panelRef, headerPointerDown, panelStyle, raise } = useDraggablePanel('scenebuilder');
  // Library tab (cards / runes share the search box + list) and the per-section fold state (remembered).
  const [lib, setLib] = useState<'cards' | 'runes'>('cards');
  const [folded, setFolded] = useState<Record<string, boolean>>(loadFolded);
  const fold = (id: string, closed: boolean): void => setFolded((f) => {
    const next = { ...f, [id]: closed };
    try { localStorage.setItem(SB_FOLD_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  // BUG SCENARIO bridge (bug reporter PR 4): load a `scenario.json` (the bug CLI's export) into the rig —
  // file picker or pasted JSON, both routed through the store's `loadBugScenario` (validation + the
  // no-writes sandbox entry live there; this section is just the input surface).
  const bugScenario = useGame((s) => s.bugScenario);
  const loadBugScenario = useGame((s) => s.loadBugScenario);
  const clearBugScenario = useGame((s) => s.clearBugScenario);
  const [bugJson, setBugJson] = useState('');
  const [bugErrors, setBugErrors] = useState<string[]>([]);
  const bugFileRef = useRef<HTMLInputElement | null>(null);
  const loadBugText = (raw: string): void => {
    const res = loadBugScenario(raw);
    setBugErrors(res.errors);
    if (res.ok) setBugJson('');
  };

  // QA SCENARIO bridge (Docbot handoff §4.5, PR 2): export the live sandbox run as a `QaScenarioV1`, import
  // one back through the store's suppression-guarded sandbox door (`loadQaScenario`), run the current export
  // headlessly IN the browser (the runner is pure @game/sim code), and save it as a checked-in regression
  // fixture via the dev server's /__qa-scenario/save endpoint. All pure logic lives in `qaScenarioBridge.ts`.
  const loadQaScenario = useGame((s) => s.loadQaScenario);
  const [qaJson, setQaJson] = useState('');
  const [qaErrors, setQaErrors] = useState<string[]>([]);
  const [qaStatus, setQaStatus] = useState('');
  const [qaSummary, setQaSummary] = useState('');
  const [qaOverwrite, setQaOverwrite] = useState(false);
  const qaFileRef = useRef<HTMLInputElement | null>(null);
  /** Build the export from the CURRENT run, validating through the keystone's own validator first — a red
   *  export here means the bridge (not the author) broke, so it surfaces instead of downloading garbage. */
  const buildExport = (): QaScenarioV1 | null => {
    if (!run) return null;
    const scenario = buildQaScenario(run, { createdAt: new Date().toISOString() });
    const errors = validateQaScenario(scenario);
    if (errors.length > 0) { setQaErrors(errors); return null; }
    setQaErrors([]);
    return scenario;
  };
  const copyText = (text: string): void => { void navigator.clipboard?.writeText(text).catch(() => {}); };
  const exportQa = (): void => {
    const scenario = buildExport();
    if (!scenario) return;
    const text = scenarioFileText(scenario);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = scenarioFileName(scenario.id);
    a.click();
    URL.revokeObjectURL(a.href);
    copyText(text);
    setQaSummary('');
    setQaStatus(`exported ${scenarioFileName(scenario.id)} (downloaded + copied to clipboard)`);
  };
  const runHeadless = (): void => {
    const scenario = buildExport();
    if (!scenario) return;
    const result = runQaScenario(scenario);
    setQaSummary([result.summary, ...result.expectationResults.map((r) => `${r.pass ? '✓' : '✗'} [${r.expectation.kind}] ${r.detail}`)].join('\n'));
    setQaStatus('');
  };
  const copyRepro = (): void => {
    const scenario = buildExport();
    if (!scenario) return;
    copyText(reproCommandFor(scenario.id));
    setQaStatus(`copied: ${reproCommandFor(scenario.id)} (bare ids resolve in ${QA_SCENARIO_FIXTURE_DIR})`);
  };
  const saveFixture = (): void => {
    const scenario = buildExport();
    if (!scenario) return;
    setQaStatus('saving…');
    void fetch('/__qa-scenario/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario, overwrite: qaOverwrite }),
    })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as { ok?: boolean; path?: string; error?: string };
        setQaStatus(body.ok ? `saved ${body.path} — repro: ${reproCommandFor(scenario.id)}` : `save failed: ${body.error ?? r.statusText}`);
      })
      .catch((e: unknown) => setQaStatus(`save failed: ${e instanceof Error ? e.message : String(e)} (dev server only)`));
  };
  const importQaText = (raw: string): void => {
    const res = loadQaScenario(raw);
    setQaErrors(res.errors);
    setQaSummary('');
    setQaStatus(res.ok ? 'scenario imported — the rig now holds its state' : '');
    if (res.ok) setQaJson('');
  };

  // The card library is scoped to the run's PINNED set, so the Set toggle visibly changes what you can add and
  // "set 2 has 3 cards" reads honestly. `CARD_INDEX` stays the global id→def map (tokens included) — this is
  // only about what this set can DRAW. Switch sets to reach another set's cards.
  const setId: SetId = run?.setId ?? activeSet().id;
  const pool = useMemo(() => poolFor(setId), [setId]);

  const all = useMemo<CardRow[]>(() =>
    pool.all
      .filter((c) => !c.token)
      .map((c) => ({
        id: c.id, name: c.name, tier: c.tier ?? 0, spell: !!c.spell, tribe: c.tribe ?? 'neutral',
        // Keywords + rules text + effect ids, so "avenge" / "deathrattle" / "magnetic" find their cards.
        hay: hay(c.name, c.id, c.tribe, c.tribe2, c.text, (c.keywords ?? []).join(' '),
          (c.effects ?? []).map((e) => `${e.on} ${e.do}`).join(' ')),
      }))
      .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)),
  [pool]);

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
  const runeResults = useMemo(() => allRunes.filter((r) => matches(r.hay, terms)), [allRunes, terms]);

  // ∞ gold — top the pool back up whenever it dips (default on). GOD rules only: under NORMAL rules the
  // reducer's per-turn Gold is the whole point. Cheap: a subscribe on `run.embers`.
  if (refill && sbRules === 'god' && run && (run.embers ?? 0) < 900) {
    queueMicrotask(() => mutate((r) => ({ ...r, embers: 999 })));
  }

  const addToShop = (cardId: string): void => mutate((r) => ({ ...r, shop: [...r.shop, { uid: uid(), cardId } as ShopCard] }));
  // Quests / runes go through the REAL reducer (not `mutate`), so the reward engine, triple checks and modal
  // queueing all run exactly as they would in a played run — which is the only way the interaction under test
  // is the real one. Clicking a quest completes it (pays the reward); "◷" adds it un-started to watch it fill.
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
    // `sandboxFoeWave` marks the pin as RIG-AUTHORED — the lobby fight serves it instead of the paired seat.
    return { ...r, servedBoards: { ...(r.servedBoards ?? {}), [r.wave]: board }, sandboxFoeWave: r.wave };
  });

  // The board the coming fight will serve, as the rig sees it: the rig's own pin once it has authored this
  // wave, else the paired seat's board (a lobby sandbox), else nothing. Mirrors Recruit's `sbEnemySnap`.
  const rigAuthored = run?.sandboxFoeWave === run?.wave;
  const foeSnap: BoardSnapshot | null = run && sbTavernShowsEnemy ? foeSnapshotOf(run) : null;
  const foeCount = foeSnap?.minions.length ?? 0;

  // "+ add enemy" writes through `mutate` too, but composes `stagedBoard` + `addEnemy` from `sandboxEdit.ts`
  // rather than hand-building a `BoardSnapshot` (unlike `setEnemies` above, which predates that module) — this
  // is the same envelope + clamp rules the tavern-row editor uses, so a card added here and one added by
  // editing an existing slot are indistinguishable. `stagedBoard(wave, [])`'s zero-minion result is never
  // itself written: `addEnemy` fills it in the same call, so the store never observes an empty pin.
  // Starts from the board the row is SHOWING (the seat's, in an un-authored lobby wave), so adding to what you
  // see is what you get — and the write stamps `sandboxFoeWave`, which is what makes the fight serve it.
  const addEnemyFromPanel = (): void => mutate((r) => {
    const snap = foeSnapshotOf(r) ?? stagedBoard(r.wave, []);
    const first = pool.buyable[0];
    if (first === undefined) return r; // this set has no buyable cards — nothing to add
    return { ...r, servedBoards: { ...(r.servedBoards ?? {}), [r.wave]: addEnemy(snap, first.id, (id) => CARD_INDEX[id]) }, sandboxFoeWave: r.wave };
  });

  const foeShown = sbTavernShowsEnemy;
  const roundLabel = run?.lobby ? `round ${run.lobby.round} · ${run.lobby.seats.filter((x) => x.alive).length} left` : `wave ${run?.wave ?? 1}`;

  return (
    <>
    <div className={`sfxmix lunge scenebuilder${collapsed ? ' collapsed' : ''}${minimized ? ' minimized' : ''}`} ref={panelRef} style={panelStyle}>
      {/* NAMEPLATE — the struck-brass header the tuner panels wear. The live readout (round · rules) sits in
          it so the collapsed strip still says what the rig is doing. */}
      <div className="sfxmix-h drag sb-head" onPointerDown={headerPointerDown}>
        <span className="sb-emblem" aria-hidden>🧩</span>
        <span className="sb-title">Scene Builder</span>
        <span className="sb-status">{roundLabel} · {sbRules === 'god' ? 'god' : 'normal'}</span>
        <button className="sb-collapse" onPointerDown={(e) => e.stopPropagation()} onClick={() => setCollapsed((c) => !c)} title={collapsed ? 'Expand' : 'Collapse'}>{collapsed ? '▸' : '▾'}</button>
      </div>

      {!collapsed && (
        <div className="sb-body">
          {/* SETUP — hero + set side by side. Both restart the sandbox, and each carries the OTHER's current
              value so switching hero can't silently drop you back to the live set (or vice versa). */}
          <Sec id="setup" title="Setup" folded={folded} onFold={fold}>
            <div className="sb-two">
              <label className="sb-field">
                <span className="sb-mini">hero</span>
                <select className="sb-select" value={run?.heroId ?? 'warden'}
                  onChange={(e) => startSceneBuilder(e.target.value, setId)}
                  title="Switch hero (restarts the sandbox so the hero's opener runs)">
                  {HERO_OPTIONS.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </label>
              <label className="sb-field">
                <span className="sb-mini">set</span>
                <select className="sb-select" value={setId}
                  onChange={(e) => startSceneBuilder(run?.heroId ?? 'warden', e.target.value as SetId)}
                  title="Play an unreleased set here without flipping the global switch — real runs are unaffected">
                  {SET_OPTIONS.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}{s.enabled ? ' (live)' : ''} — {s.minions}m · {s.spells}s</option>
                  ))}
                </select>
              </label>
            </div>
            {pool.buyable.length === 0 && (
              <div className="sb-mini sb-warn">this set has no cards yet — the shop will be empty</div>
            )}
            {/* RULES — the sandbox is a lobby game against bots (2026-09-09). GOD keeps the rig's classic feel
                (infinite time + Gold); NORMAL runs the real clock and the real per-turn Gold. Both keep every
                authoring tool, and the player's seat is invulnerable under both. Flipping is live; the bot
                level rebuilds the lobby, so it relaunches like the hero and set pickers do. */}
            <div className="sb-seg" role="radiogroup" aria-label="Sandbox rules">
              <button type="button" role="radio" aria-checked={sbRules === 'god'}
                className={`sb-seg-btn${sbRules === 'god' ? ' on' : ''}`} onClick={() => setSbRules('god')}
                title="Infinite time and Gold — build anything, nothing rushes you">✦ God mode</button>
              <button type="button" role="radio" aria-checked={sbRules === 'normal'}
                className={`sb-seg-btn${sbRules === 'normal' ? ' on' : ''}`} onClick={() => setSbRules('normal')}
                title="The real shop clock and the real per-turn Gold — every authoring tool stays live">⏱ Normal</button>
            </div>
            <div className="sb-two sb-two-tight">
              <label className="sb-field">
                <span className="sb-mini">bots</span>
                <select className="sb-select" value={sbBotLevel}
                  onChange={(e) => startSceneBuilder(run?.heroId ?? 'warden', setId, Number(e.target.value) as BotLevel)}
                  title="Bot strength for the seven other seats (restarts the sandbox — the seats are built at creation)">
                  {([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const).map((n) => (
                    <option key={n} value={n}>level {n}{n === 1 ? ' — gentlest' : n === 10 ? ' — hardest' : ''}</option>
                  ))}
                </select>
              </label>
              <button className="sb-btn sb-btn-tall" onClick={() => startSceneBuilder(run?.heroId ?? 'warden', setId)} title="Start the sandbox over with a fresh lobby (same hero, set and rules)">↺ restart</button>
            </div>
            <div className="sb-mini sb-note">you can't be eliminated under either rule set</div>
          </Sec>

          {/* TABLE — Gold, time, tier and the board sweeps, as one grid of same-sized tiles. */}
          <Sec id="table" title="Table" folded={folded} onFold={fold}>
            <div className="sb-tiles">
              <button className="sb-tile" onClick={giveGold} title="Add 1000 Gold"><b>+1000</b> gold</button>
              {sbRules === 'god' ? (
                <button className={`sb-tile${refill ? ' on' : ''}`} onClick={() => setRefill((r) => !r)} title="Keep Gold topped up at 999" aria-pressed={refill}><b>∞</b> refill</button>
              ) : (
                <button className="sb-tile" onClick={freezeTime} title="Freeze the turn timer"><b>❄</b> freeze</button>
              )}
              {sbRules === 'god' && <button className="sb-tile" onClick={freezeTime} title="Freeze the turn timer"><b>❄</b> freeze</button>}
              <button className="sb-tile" onClick={clearShop} title="Empty the shop row"><b>⌫</b> shop</button>
              <button className="sb-tile" onClick={clearBoard} title="Empty your board"><b>⌫</b> board</button>
              <button className="sb-tile sb-tile-warn" onClick={clearAll} title="Empty shop, board and hand"><b>⌫</b> all</button>
            </div>
            <div className="sb-row sb-tierrow">
              <span className="sb-mini">tier</span>
              <div className="sb-seg sb-seg-7" role="radiogroup" aria-label="Tavern tier">
                {[1, 2, 3, 4, 5, 6, 7].map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={run?.tier === t} className={`sb-seg-btn${run?.tier === t ? ' on' : ''}`} onClick={() => setTier(t)}>{t}</button>
                ))}
              </div>
            </div>
          </Sec>

          {/* ENEMY — what the top row shows, click-to-edit, and the pinned dummies. Both toggles are
              sandbox-only and neither changes run state, so the shop is exactly as you left it when you
              flip back. */}
          <Sec id="enemy" title="Enemy" folded={folded} onFold={fold}
            right={foeShown ? <span className="sb-count">{foeCount} / {MAX_BOARD}{run?.lobby && !rigAuthored ? ' · paired seat' : rigAuthored ? ' · authored' : ''}</span> : undefined}>
            <div className="sb-seg" role="radiogroup" aria-label="Top row shows">
              <button type="button" role="radio" aria-checked={!foeShown} className={`sb-seg-btn${!foeShown ? ' on' : ''}`} onClick={() => setSbTavernShowsEnemy(false)} title="The top row shows the shop">shop row</button>
              <button type="button" role="radio" aria-checked={foeShown} className={`sb-seg-btn${foeShown ? ' on' : ''}`} onClick={() => setSbTavernShowsEnemy(true)} title="The top row shows the opponent you are about to fight">enemy row</button>
            </div>
            <div className="sb-tiles sb-tiles-3">
              <button className={`sb-tile${sbEditMode ? ' on' : ''}`} onClick={() => setSbEditMode(!sbEditMode)} aria-pressed={sbEditMode}
                title="Click a minion on either row to set its card, attack, health and keywords"><b>✎</b> {sbEditMode ? 'editing' : 'edit'}</button>
              <button className="sb-tile" disabled={!foeShown || foeCount >= MAX_BOARD} onClick={addEnemyFromPanel}
                title={foeShown ? 'Add a minion to the enemy row' : 'Show the enemy row first'}><b>+</b> enemy</button>
              {/* Tuning an effect means watching the same moment many times. This re-mounts the replay on the
                  CombatResult already stored — same boards, same seed, same beats — and resolves nothing.
                  Recruit phase ONLY: a click DURING a live fight re-entered a phase it was already in. */}
              <button className="sb-tile" disabled={run?.lastCombat === undefined || run.phase !== 'recruit'} onClick={replayLastCombat}
                title="Watch the last fight again — nothing advances"><b>↻</b> rewatch</button>
            </div>
            <div className="sb-row sb-dummies">
              <span className="sb-mini">dummies</span>
              <label className="sb-num" title="How many">×<input type="number" min={1} max={7} value={enemyN} onChange={(e) => setEnemyN(Number(e.target.value))} /></label>
              <label className="sb-num" title="Health">hp<input type="number" min={1} value={enemyHp} onChange={(e) => setEnemyHp(Number(e.target.value))} /></label>
              <label className="sb-num" title="Attack">atk<input type="number" min={0} value={enemyAtk} onChange={(e) => setEnemyAtk(Number(e.target.value))} /></label>
              <button className="sb-btn sb-primary" onClick={() => setEnemies(enemyHp, enemyAtk, enemyN)} title="Pin these dummies as the next fight's opponent">set</button>
            </div>
            <div className="sb-row">
              <button className="sb-btn" onClick={() => setEnemies(1, 0, 7)} title="7 glass dummies (1 hp)">glass ×7</button>
              <button className="sb-btn" onClick={() => setEnemies(300, 0, 1)} title="1 tank dummy (300 hp)">tank</button>
              <button className="sb-btn" onClick={() => setEnemies(20, 20, 5)} title="5 bruisers (20/20)">bruisers</button>
            </div>
          </Sec>

          {/* LIBRARY — one search box, Cards and Runes as tabs over one tall list. ↵ adds the top card. */}
          <Sec id="library" title="Library" folded={folded} onFold={fold}
            right={<div className="sb-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={lib === 'cards'} className={`sb-tab${lib === 'cards' ? ' on' : ''}`} onClick={() => setLib('cards')}>cards <em>{results.length}</em></button>
              <button type="button" role="tab" aria-selected={lib === 'runes'} className={`sb-tab${lib === 'runes' ? ' on' : ''}`} onClick={() => setLib('runes')}>runes <em>{runeResults.length}</em></button>
            </div>}>
            <input
              className="sb-search"
              placeholder={lib === 'cards' ? 'name, id, tribe, keyword… ↵ adds the top match to the shop' : 'rune name, id, text…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Rapid-fire keyboard add (owner ask 2026-08-14): Enter drops the top card match into the shop
                // without reaching for the mouse. The text is re-selected, not cleared, so a second Enter adds
                // ANOTHER copy of the same card and typing over it switches to the next — never leaving the box.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (lib === 'cards' && results.length > 0) addToShop(results[0]!.id);
                  else if (lib === 'runes' && runeResults.length > 0) grantRune(runeResults[0]!.id);
                  e.currentTarget.select();
                }
              }}
              title="Matches name, id, tribe, keywords, rules text and effect ids. Space-separated terms must ALL match. ↵ adds the top match (again for another copy)."
            />
            <div className="sb-results">
              {lib === 'cards' ? results.map((c) => (
                <button key={c.id} className="sb-card" onClick={() => addToShop(c.id)} title={`Add ${c.name} (Tier ${c.tier}) to the shop`}>
                  <span className={`sb-t sb-t${c.tier}`}>{c.tier}</span>
                  <span className="sb-name">{c.name}</span>
                  {c.spell && <span className="sb-tag">spell</span>}
                </button>
              )) : runeResults.map((r) => (
                // Granting a rune applies its reward for the run, exactly like buying it in the Runeforge.
                <button key={r.id} className="sb-card" onClick={() => grantRune(r.id)} title={`Grant ${r.name} — its reward applies for the run (free here)`}>
                  <span className="sb-name">{r.name}</span>
                  {r.epic && <span className="sb-tag">epic</span>}
                </button>
              ))}
              {(lib === 'cards' ? results : runeResults).length === 0 && <div className="sb-empty">no matches</div>}
            </div>
          </Sec>

          {/* QUESTS — REMOVED from the menu 2026-08-28 (owner): quests are not being actively developed. The
              `devGrant` quest path and `QUEST_DEFS` are untouched — re-adding it is putting the block back. */}

          {/* SCENARIOS — the bug-report and QA bridges. Folded by default: they are the rig's I/O, not its
              daily controls. Bug: load a report's scenario.json (bug CLI export); the run enters as a sandbox
              (no saves / uploads / drafts — see `loadBugScenario`). QA: export this run as a QaScenarioV1,
              import one back, run it headlessly right here, or save it as a checked-in fixture. */}
          <Sec id="scenarios" title="Scenarios" folded={folded} onFold={fold} defaultFolded
            right={bugScenario ? <span className="sb-count" title={bugScenario.reportId}>bug loaded</span> : undefined}>
            <div className="sb-sub">Bug report</div>
            {bugScenario ? (
              <div className="sb-row">
                <span className="sb-mini sb-name" title={bugScenario.reportId}>loaded: {bugScenario.reportId}</span>
                <button className="sb-btn" onClick={clearBugScenario}>clear</button>
              </div>
            ) : (
              <>
                <div className="sb-row">
                  <input ref={bugFileRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = ''; // re-picking the same file must fire onChange again
                      if (!file) return;
                      void file.text().then(loadBugText).catch(() => setBugErrors(['Could not read the file.']));
                    }} />
                  <button className="sb-btn" onClick={() => bugFileRef.current?.click()} title="Load a scenario.json exported by npm run bugs:repro">📂 load file…</button>
                  <button className="sb-btn sb-primary" disabled={bugJson.trim() === ''} onClick={() => loadBugText(bugJson)} title="Load the pasted JSON">load JSON</button>
                </div>
                <textarea className="sb-search sb-bugpaste" rows={2} placeholder="…or paste a scenario.json here" value={bugJson} onChange={(e) => setBugJson(e.target.value)} />
              </>
            )}
            {bugErrors.length > 0 && <div className="sb-mini sb-warn">{bugErrors.join(' ')}</div>}

            <div className="sb-sub">QA scenario</div>
            <div className="sb-row">
              <button className="sb-btn" onClick={exportQa} title="Serialize this run as a QaScenarioV1 — downloads the JSON and copies it to the clipboard">⬇ export</button>
              <button className="sb-btn" onClick={runHeadless} title="Run the current export through the headless scenario runner (real engine, no UI) and show its summary">▶ headless</button>
              <button className="sb-btn" onClick={copyRepro} title="Copy the deterministic reproduction command for this scenario's id">⎘ repro</button>
            </div>
            <div className="sb-row">
              <button className="sb-btn" onClick={saveFixture} title={`Write the export into ${QA_SCENARIO_FIXTURE_DIR} via the dev server (refuses to overwrite unless armed)`}>💾 save fixture</button>
              <label className="sb-chk" title="Allow the save to replace an existing fixture of the same id">
                <input type="checkbox" checked={qaOverwrite} onChange={(e) => setQaOverwrite(e.target.checked)} /> overwrite
              </label>
            </div>
            <div className="sb-row">
              <input ref={qaFileRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ''; // re-picking the same file must fire onChange again
                  if (!file) return;
                  void file.text().then(importQaText).catch(() => setQaErrors(['Could not read the file.']));
                }} />
              <button className="sb-btn" onClick={() => qaFileRef.current?.click()} title="Load a QaScenarioV1 JSON file into the rig (validated; sandbox — nothing writes)">📂 import file…</button>
              <button className="sb-btn sb-primary" disabled={qaJson.trim() === ''} onClick={() => importQaText(qaJson)} title="Import the pasted scenario JSON">import JSON</button>
            </div>
            <textarea className="sb-search sb-bugpaste" rows={2} placeholder="…or paste a QaScenarioV1 JSON here" value={qaJson} onChange={(e) => setQaJson(e.target.value)} />
            {qaStatus !== '' && <div className="sb-mini">{qaStatus}</div>}
            {qaErrors.length > 0 && <div className="sb-mini sb-warn">{qaErrors.join(' · ')}</div>}
            {qaSummary !== '' && <pre className="sb-mini sb-qa-summary">{qaSummary}</pre>}
          </Sec>
        </div>
      )}
    </div>
    {/* Minimized (the header ✕ hides it): a circle icon docked bottom-right, left of the 🛠️ dev-tuning button.
        Click restores + refocuses (brings the panel back to the front via the shared hook's raise). */}
    {minimized && (
      <button className="sb-dock" title="Restore Scene Builder"
        onClick={() => { onRestore(); raise(); }}>🧩</button>
    )}
    </>
  );
}

/** Where a section's fold state is remembered, per section id. A property of how you are working, not of the
 *  run, so it lives beside the panel's dragged position rather than in any run state. */
const SB_FOLD_KEY = 'ascent.sb.fold';
function loadFolded(): Record<string, boolean> {
  try { return (JSON.parse(localStorage.getItem(SB_FOLD_KEY) || '{}') as Record<string, boolean>) ?? {}; } catch { return {}; }
}

/** One foldable section: a brass heading you can click shut, an optional right-hand slot (a count, tabs). */
function Sec({ id, title, right, folded, onFold, defaultFolded, children }: {
  id: string; title: string; right?: React.ReactNode; folded: Record<string, boolean>;
  onFold: (id: string, closed: boolean) => void; defaultFolded?: boolean; children: React.ReactNode;
}): JSX.Element {
  const closed = folded[id] ?? defaultFolded ?? false;
  return (
    <div className={`sb-sec${closed ? ' folded' : ''}`}>
      <div className="sb-label">
        <button type="button" className="sb-fold" onClick={() => onFold(id, !closed)} aria-expanded={!closed} title={closed ? 'Expand' : 'Fold'}>
          <span className="sb-caret" aria-hidden>{closed ? '▸' : '▾'}</span>{title}
        </button>
        {right !== undefined && <span className="sb-label-r">{right}</span>}
      </div>
      {!closed && children}
    </div>
  );
}
