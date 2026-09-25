import { memo, useMemo, useState } from 'react';
import type { CombatResult } from '@game/core';
import { getHero, lossDamageCap, playerLossDamage, playerOpponent, type CombatOdds, type RunState } from '@game/sim';
import { artFor, heroArt } from './art';
import { Icon } from './Icon';
import { combatGainItems, oddsRecap, splitDamage, type DamageSplit, type GainItem } from './fightRecapData';

/**
 * FIGHT RECAP (owner ask 2026-09-24): the redesigned post-combat summary, opened only from the Summary pill.
 * Dark glass + gold trim (the Discover / Runeforge / End Combat chrome), a strong result header with the foe
 * and the ONE damage number that mattered (dealt on a win, taken on a loss), the outcome odds flanked by the
 * average damage a win deals and a loss costs, what you keep, and the old Procs + Log folded into a
 * closed-by-default Details drawer (condensed per owner ask 2026-09-25). Every value is read off the recorded fight.
 *
 * Mounted only while open (the parent gates it), so none of this costs anything during the shop phase.
 */

type Line = { text: string; kind: string };

export interface FightRecapProps {
  result: 'win' | 'lose' | 'draw' | null;
  combatOdds: CombatOdds | null;
  lastCombat: CombatResult | null | undefined;
  lobby: RunState['lobby'];
  /** The run board: resolves a kept-stats carry-back (keyed by run-board uid) to its card. */
  board?: RunState['board'];
  wave: number;
  mode: RunState['mode'];
  procs: Line[];
  fullLog: Line[];
  /** Absent = no replay to jump to right now (the button is omitted). */
  onWatchReplay?: () => void;
  onClose: () => void;
}

const VERDICT = { win: 'Victory', lose: 'Defeat', draw: 'Draw' } as const;

/** One mini card: a portrait (card art, or an icon when the gain has no card) + name + stat chips. Memoized
 *  with primitive props so a parent re-render (the odds arriving) never re-renders the row. */
const RecapMini = memo(function RecapMini({ art, icon, name, chips, golden }: {
  art?: string; icon?: string; name: string; chips: string; golden?: boolean;
}) {
  return (
    <div className={`fr-mini${golden ? ' golden' : ''}`}>
      <div className="fr-mini-pic">
        {art ? <img decoding="sync" src={art} alt="" draggable={false} /> : <Icon name={icon ?? 'star'} />}
      </div>
      <div className="fr-mini-name">{name}</div>
      <div className="fr-mini-chips">
        {chips.split('\n').map((c) => <span className="fr-chip" key={c}>{c}</span>)}
      </div>
    </div>
  );
});

/** The header's single damage line: "You dealt X" (green) on a win, "You took X" (red) on a loss, "No damage"
 *  otherwise. The Armor / Resolve split rides underneath when the lobby split it. */
function DamageLine({ verdict, dealt, taken, split }: { verdict: 'win' | 'lose' | 'draw'; dealt: DamageSplit; taken: DamageSplit; split: boolean }) {
  const kind = verdict === 'win' && dealt.total > 0 ? 'dealt' : verdict === 'lose' && taken.total > 0 ? 'taken' : null;
  if (!kind) return <div className="fr-dmgline zero">No damage</div>;
  const dmg = kind === 'dealt' ? dealt : taken;
  const parts: string[] = [];
  if (split && dmg.armor) parts.push(`${dmg.armor} Armor`);
  if (split && dmg.resolve && dmg.armor) parts.push(`${dmg.resolve} Resolve`);
  return (
    <div className={`fr-dmgline ${kind}`}>
      <span className="fr-dmgline-label">{kind === 'dealt' ? 'You dealt' : 'You took'}</span>
      <span className="fr-dmgline-num">{dmg.total}</span>
      {parts.length > 0 && <span className="fr-dmgline-sub">{parts.join(' · ')}</span>}
    </div>
  );
}

/** One average-damage figure flanking the odds bar: what a win deals (left) / what a loss costs (right). */
function OddsDmg({ kind, value }: { kind: 'win' | 'lose'; value: number | null }) {
  return (
    <div className={`fr-odds-dmg ${kind}${value === null ? ' none' : ''}`}>
      <span className="fr-odds-dmg-num">{value ?? '–'}</span>
      <span className="fr-odds-dmg-label">{kind === 'win' ? 'avg dealt' : 'avg taken'}</span>
    </div>
  );
}

export const FightRecap = memo(function FightRecap({ result, combatOdds, lastCombat, lobby, board, wave, mode, procs, fullLog, onWatchReplay, onClose }: FightRecapProps) {
  const [details, setDetails] = useState(false);
  const [detailTab, setDetailTab] = useState<'procs' | 'log'>('procs');

  // The foe + the damage both ways. The summary only exists during the combat phase, BEFORE the lobby round
  // settles (that happens on End Combat), so `playerOpponent` still names this fight's foe and every seat's
  // Armor is still its going-in value: exactly what the split needs.
  const head = useMemo(() => {
    const foe = lobby ? playerOpponent(lobby) : null;
    const me = lobby?.seats[0];
    const cap = lossDamageCap(wave);
    const taken = !lastCombat || lastCombat.result === 'win' ? 0
      : lobby && mode !== 'practice' ? playerLossDamage(lobby, lastCombat)
      : Math.min(lastCombat.playerDamage, cap);
    const dealt = !lastCombat || lastCombat.result !== 'win' || foe?.ghost ? 0 : Math.min(lastCombat.enemyDamage ?? 0, cap);
    return {
      round: lobby ? lobby.round : wave,
      foe: foe?.seat ? { label: foe.seat.label, heroId: foe.seat.heroId, heroName: getHero(foe.seat.heroId)?.name, ghost: !!foe.ghost } : null,
      dealt: splitDamage(dealt, foe?.seat ? foe.seat.armor : undefined),
      taken: splitDamage(taken, me ? me.armor : undefined),
      split: !!lobby,
    };
  }, [lobby, wave, mode, lastCombat]);

  const odds = useMemo(() => oddsRecap(combatOdds, result), [combatOdds, result]);
  const gains = useMemo<GainItem[]>(() => combatGainItems(lastCombat, board), [lastCombat, board]);
  const verdict = result ?? 'draw';

  return (
    <div className="fr-ov" role="dialog" aria-label="Fight recap" onClick={onClose}>
      <div className="fr-panel" onClick={(e) => e.stopPropagation()}>
        <header className={`fr-head ${verdict}`}>
          <div className="fr-round">Round {head.round}</div>
          <div className="fr-verdict-row">
            <span className={`fr-verdict ${verdict}`}>{VERDICT[verdict]}</span>
            {odds?.tag && <span className={`fr-tag ${odds.tag}`}>{odds.tag === 'upset' ? 'Upset!' : 'Heartbreaker'}</span>}
          </div>
          <div className="fr-foe">
            <div className="fr-foe-pic">
              {head.foe && heroArt(head.foe.heroId)
                ? <img decoding="sync" src={heroArt(head.foe.heroId)} alt="" draggable={false} />
                : <Icon name="sword" />}
            </div>
            <div className="fr-foe-name">{head.foe ? head.foe.label : 'Your opponent'}</div>
            {head.foe && (head.foe.heroName || head.foe.ghost) && (
              <div className="fr-foe-hero">{head.foe.ghost ? 'Ghost' : head.foe.heroName}</div>
            )}
          </div>
          <DamageLine verdict={verdict} dealt={head.dealt} taken={head.taken} split={head.split} />
        </header>

        <div className="fr-body">
          {odds && (
            <section className="fr-odds" aria-label="Estimated from repeated simulations of this matchup. The actual result was one roll of these odds.">
              <div className="fr-sechead">Fight outcome odds</div>
              <div className="fr-odds-row">
                <OddsDmg kind="win" value={odds.winDmg} />
                <div className="fr-odds-mid">
                  <div className="fr-oddsbar" aria-hidden="true">
                    {/* Flex-grow by share, so a 0% segment collapses to nothing but its label still shows below. */}
                    {odds.pcts.win > 0 && <span className="win" style={{ flexGrow: odds.pcts.win }} />}
                    {odds.pcts.draw > 0 && <span className="draw" style={{ flexGrow: odds.pcts.draw }} />}
                    {odds.pcts.lose > 0 && <span className="lose" style={{ flexGrow: odds.pcts.lose }} />}
                  </div>
                  <div className="fr-oddslabels">
                    <span className="win"><b>{odds.pcts.win}%</b> Win</span>
                    <span className="draw"><b>{odds.pcts.draw}%</b> Draw</span>
                    <span className="lose"><b>{odds.pcts.lose}%</b> Loss</span>
                  </div>
                </div>
                <OddsDmg kind="lose" value={odds.lossDmg} />
              </div>
            </section>
          )}

          {gains.length > 0 && (
            <section className="fr-sec">
              <div className="fr-sechead">What you keep</div>
              <div className="fr-row wrap">
                {gains.map((g) => (
                  <RecapMini key={g.key} art={g.cardId ? artFor(g.cardId) : undefined} icon={g.icon} name={g.label} chips={g.chip} />
                ))}
              </div>
            </section>
          )}

          <section className={`fr-details${details ? ' open' : ''}`}>
            <button className="fr-details-toggle" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
              <span className="fr-caret" aria-hidden="true">{details ? '▾' : '▸'}</span>
              Details
            </button>
            {details && (
              <div className="fr-details-body">
                <div className="fr-detail-tabs" role="tablist" aria-label="Detail view">
                  <button role="tab" aria-selected={detailTab === 'procs'} className={`fr-detail-tab${detailTab === 'procs' ? ' on' : ''}`} onClick={() => setDetailTab('procs')}>Procs</button>
                  <button role="tab" aria-selected={detailTab === 'log'} className={`fr-detail-tab${detailTab === 'log' ? ' on' : ''}`} onClick={() => setDetailTab('log')}>Log</button>
                </div>
                <div className="fr-lines">
                  {detailTab === 'procs'
                    ? procs.map((s, i) => <div className={`fr-line sum ${s.kind}`} key={i}>{s.text}</div>)
                    : fullLog.length === 0
                      ? <div className="fr-line">No blows were struck.</div>
                      : fullLog.map((l, i) => <div className={`fr-line ${l.kind}`} key={i}>{l.text}</div>)}
                </div>
              </div>
            )}
          </section>
        </div>

        <footer className="fr-foot">
          {onWatchReplay && (
            <button className="fr-btn ghost" onClick={onWatchReplay}>
              <Icon name="eye" />
              Watch replay
            </button>
          )}
          <button className="fr-btn primary" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
});
