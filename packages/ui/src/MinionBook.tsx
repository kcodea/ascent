import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CardDef, Keyword, QuestReward, Tribe } from '@game/core';
import { BUYABLE_CARDS, CARD_INDEX, QUEST_DEFS, SPELL_CARDS } from '@game/content';
import { Card, type CardView } from './Card';
import { QuestCard } from './QuestCard';
import { Icon } from './Icon';
import { useGame } from './store';

/** Evolution units — non-buyable tokens a minion ascends/transforms into (Spirit Pup → Spirit Worgen,
 *  Tara → Taragosa). Detected from the card set (ascend targets + `spellCastTransform` destinations) so the
 *  Compendium can show these "secret" payoff forms even though they never appear in the shop. */
const EVOLUTION_CARDS: CardDef[] = (() => {
  const ids = new Set<string>();
  for (const c of Object.values(CARD_INDEX)) {
    if (c.ascendInto) ids.add(c.ascendInto);
    for (const e of c.effects) {
      if (e.do === 'spellCastTransform' && typeof e.params?.into === 'string') ids.add(e.params.into);
    }
  }
  return [...ids].map((id) => CARD_INDEX[id]).filter((c): c is CardDef => !!c);
})();

/** Quest-reward cards — the token minions/spells a completed quest grants. They're reward-exclusive
 *  (`token: true`), so they never appear in `BUYABLE_CARDS`/`SPELL_CARDS`; the Compendium surfaces them in
 *  their own "Quest Rewards" category. Walks every quest's reward (including nested `multi` rewards) for
 *  concrete `cards` grants, mapping each to the granting quest's tribe (for run-scoping — neutral wins when a
 *  card is granted by quests of more than one tribe, since neutral quests are always offered). */
const QUEST_REWARD_CARDS: { card: CardDef; tribe: Tribe }[] = (() => {
  const byId = new Map<string, Tribe>();
  const walk = (r: QuestReward, tribe: Tribe): void => {
    if (r.kind === 'grant' || r.kind === 'recurringGrant') {
      for (const id of r.cards ?? []) if (byId.get(id) !== 'neutral') byId.set(id, tribe);
    } else if (r.kind === 'multi') {
      for (const sub of r.rewards) walk(sub, tribe);
    }
  };
  for (const q of QUEST_DEFS) walk(q.reward, q.tribe);
  return [...byId]
    .map(([id, tribe]) => ({ card: CARD_INDEX[id], tribe }))
    .filter((x): x is { card: CardDef; tribe: Tribe } => !!x.card);
})();
const QUEST_REWARD_IDS = new Set(QUEST_REWARD_CARDS.map((x) => x.card.id));
/** Cards that belong in the MINION gallery: buyable minions + evolution units. A card can *also* be a quest
 *  reward (Badgington is a normal Tier-4 Beast that Apex Hunt grants) — it then shows in BOTH its tribe and the
 *  Quest Rewards category. Membership sets keep those overlaps correct instead of hiding a real minion. */
const MINION_POOL_IDS = new Set([...BUYABLE_CARDS, ...EVOLUTION_CARDS].map((c) => c.id));
const SPELL_POOL_IDS = new Set(SPELL_CARDS.map((c) => c.id));

/** Left-rail category: a real tribe, the tribe-less "spells" bucket, the "rewards" (quest-reward cards) bucket,
 *  or the "quests" bucket (the quest DEFINITIONS themselves — objective + art, rendered as QuestCards). */
type Category = Tribe | 'spells' | 'rewards' | 'quests';

const CAT_META: Record<Category, { label: string; icon: string }> = {
  beast: { label: 'Beasts', icon: 'paw' },
  dragon: { label: 'Dragons', icon: 'flame' },
  mech: { label: 'Mechs', icon: 'gear' },
  undead: { label: 'Undead', icon: 'skull' },
  demon: { label: 'Demons', icon: 'eye' },
  neutral: { label: 'Neutral', icon: 'star' },
  spells: { label: 'Spells', icon: 'sc' },
  rewards: { label: 'Quest Rewards', icon: 'gift' },
  quests: { label: 'Quests', icon: 'target' },
};

const TIERS = [1, 2, 3, 4, 5, 6] as const;
/** Every non-neutral tribe — the left-rail set when browsing the full game (from the title, pre-run). */
const ALL_TRIBES: Tribe[] = ['beast', 'dragon', 'mech', 'undead', 'demon'];

/** One glossary entry. `match` (when present) makes the row a live filter: clicking it scopes the gallery
 *  to the cards it matches. Terms with no sensible card filter (Gilded) omit it and render inert. */
type GlossItem = { icon: string; term: string; def: string; match?: (c: CardDef) => boolean };

/** Factories whose name alone fixes the keyword they grant (no param needed). Param-based grants
 *  (battlecryGrantKeyword's `keywords`, summon/spell `keyword`, onConsumeGrantSelfKeyword's `keyword`)
 *  are read off `params` in `grantsKeyword`. */
const FIXED_GRANT: Record<string, Keyword> = {
  deathrattleGrantReborn: 'R', // Mumi → Rise
  deathrattleGrantShield: 'DS', // Selfless Sentinel → Ward
  scGrantShieldTribe: 'DS',
  onShieldBreakGrantShield: 'DS', // Shield Capacitor → Ward
};

/** Does this card's effects *grant* keyword `code` — to a friendly minion (Mumi → Rise, Selfless Sentinel
 *  → Ward, Toxin Tender/Plaguebringer → Toxin) or by summoning a body that carries it (the Taunt-token
 *  summoners)? Reads the fixed-keyword granter factories + any `params.keyword` / `params.keywords`, across
 *  top-level and Choose-One effects. Card-fetch grants ("add a Magnetic minion to hand" — Junkyard Titan,
 *  Jouster) are NOT keyword grants and correctly fall through. */
function grantsKeyword(c: CardDef, code: Keyword): boolean {
  const effs = [...c.effects, ...(c.chooseOne?.flatMap((o) => o.effects) ?? [])];
  return effs.some((e) => {
    if (FIXED_GRANT[e.do] === code) return true;
    const p = e.params as { keyword?: string; keywords?: string[] } | undefined;
    return p?.keyword === code || (Array.isArray(p?.keywords) && p.keywords.includes(code));
  });
}

/** A keyword-code filter — matches cards that either carry the keyword OR grant it. So clicking "Rise"
 *  surfaces Mumi (which has no Rise itself but hands it out), "Ward" surfaces Selfless Sentinel, etc. */
const kwMatch = (code: Keyword) => (c: CardDef): boolean => c.keywords.includes(code) || grantsKeyword(c, code);

/** The glossary — every keyword + trigger the cards use, one rule apiece. Grouped by when-it-fires
 *  (Triggers), what-it-does-in-combat (Combat), and shop/build terms. Icons + names mirror the card
 *  pills (KW_LABEL / KW_ICON + triggerPill in Card.tsx) so the codex and the cards speak one language.
 *  Each `match` predicate mirrors what the card actually shows — keyword codes read `c.keywords`, the
 *  event triggers read `c.effects` — so clicking a term surfaces exactly the minions that carry it. */
const GLOSSARY: { title: string; items: GlossItem[] }[] = [
  {
    title: 'Triggers',
    items: [
      { icon: 'battlecry', term: 'Shout', def: 'Fires when you play this minion from your hand.', match: (c) => c.effects.some((e) => e.on === 'onPlay') },
      { icon: 'echo', term: 'Echo', def: 'Fires when this minion dies.', match: (c) => c.effects.some((e) => e.on === 'onDeath') },
      { icon: 'fist', term: 'Start of Combat', def: 'Fires once, the moment the battle begins.', match: kwMatch('SC') },
      { icon: 'sc', term: 'End of Turn', def: 'Fires at the end of each recruit turn, before you fight.', match: (c) => c.effects.some((e) => e.on === 'endOfTurn') },
      { icon: 'skull', term: 'Avenge (N)', def: 'Fires after every N of your minions die in a combat.', match: (c) => c.effects.some((e) => e.on === 'avenge') },
      { icon: 'sword', term: 'Rally', def: 'Fires each time this minion attacks.', match: kwMatch('RL') },
      { icon: 'slaughter', term: 'Slaughter', def: 'Fires each time this minion kills an enemy minion.', match: kwMatch('SL') },
      { icon: 'choose1', term: 'Choose One', def: 'Pick one of two effects as you play the minion.', match: (c) => !!c.chooseOne },
    ],
  },
  {
    title: 'Combat keywords',
    items: [
      { icon: 'taunt', term: 'Taunt', def: 'Enemies must attack this minion first.', match: kwMatch('T') },
      { icon: 'shield', term: 'Ward', def: 'Blocks the first hit it would take, then breaks.', match: kwMatch('DS') },
      { icon: 'poison', term: 'Toxin', def: 'Destroys any minion it damages — spent after one hit.', match: kwMatch('V') },
      { icon: 'windfury', term: 'Flurry', def: 'Attacks twice each turn.', match: kwMatch('W') },
      { icon: 'rise', term: 'Rise', def: 'The first time it dies, it returns once with 1 Health.', match: kwMatch('R') },
      { icon: 'cleave', term: 'Cleave', def: 'Also damages the minions beside its target.', match: kwMatch('C') },
      { icon: 'eye', term: 'Stealth', def: "Can't be attacked until it has attacked once.", match: kwMatch('ST') },
      { icon: 'immune', term: 'Immune', def: "Can't take damage.", match: kwMatch('IMM') },
    ],
  },
  {
    title: 'Build & shop',
    items: [
      { icon: 'magnetic', term: 'Attachment', def: 'Play it onto a friendly minion to merge its stats and keywords in.', match: kwMatch('M') },
      { icon: 'consume', term: 'Consume', def: 'Devours your Fodder to grow.', match: kwMatch('CN') },
      { icon: 'fodder', term: 'Fodder', def: 'A cheap token your minions consume for stats.', match: kwMatch('FD') },
      { icon: 'anvil', term: 'Engraved', def: 'Stat gains during combat carry back to your board.', match: kwMatch('EG') },
      { icon: 'star', term: 'Discover', def: 'Peek at three cards and add one to your hand.', match: (c) => c.effects.some((e) => /discover/i.test(e.do)) },
      { icon: 'crown', term: 'Gilded', def: 'Collect three copies to fuse one doubled-stat Gilded minion.' },
    ],
  },
];

/** A book card def → the view object `Card` renders. Base (printed) stats only — the book is a static
 *  reference, not a live board, so no run buffs. `gilded` shows the tripled/golden form: doubled stats, the
 *  golden frame, and the card's golden text (Card falls back to doubling the printed numbers when a card has
 *  no explicit goldenText). */
function toView(c: CardDef, gilded = false): CardView {
  const mul = gilded ? 2 : 1;
  return {
    name: c.name,
    cardId: c.id,
    tribe: c.tribe,
    tribe2: c.tribe2,
    attack: c.attack * mul,
    health: c.health * mul,
    keywords: c.keywords,
    text: c.text,
    goldenText: c.goldenText,
    golden: gilded,
    baseAttack: c.attack * mul,
    baseHealth: c.health * mul,
    tier: c.tier,
    spell: c.spell,
    cost: c.cost,
    target: c.target === 'friendly' ? 'friendly' : undefined,
  };
}

/**
 * The Compendium (Tab) — a filterable codex of minions + spells: the whole card set when opened from the
 * title (pre-run), or scoped to the active run's tribes once a run is underway. A blurred
 * full-screen overlay styled like an open tome: tier filters (1–6) across the top, tribe + Spells categories
 * down the left (multi-select, both axes), and a single scrolling gallery of cards. Right-click a card
 * for the enlarged inspect (the global Inspect overlay handles it). UI-only — reads `run.pool`'s eligibility
 * rule (neutral + active tribes) off `BUYABLE_CARDS` so the contents stay stable as you buy/sell.
 */
export function MinionBook() {
  const run = useGame((s) => s.run);
  const showTitle = useGame((s) => s.showTitle);
  const closeBook = useGame((s) => s.closeBook);

  const [tiers, setTiers] = useState<Set<number>>(() => new Set());
  const [cats, setCats] = useState<Set<Category>>(() => new Set());
  const [gilded, setGilded] = useState(false); // show every card's tripled/golden form
  const [glossary, setGlossary] = useState(false); // swap the gallery for the keyword codex
  const [kw, setKw] = useState<{ term: string; icon: string; match: (c: CardDef) => boolean } | null>(null); // active keyword filter (from the glossary)

  // Opened from the title (no committed run) → browse the WHOLE card set; in a run → scope to its active
  // tribes (mirrors `stockPool`: neutral is always findable, so it's added below regardless).
  const tribes: Tribe[] = showTitle ? ALL_TRIBES : run.tribes;

  // Left-rail categories: the active (or all) tribes, then Neutral (always findable), then Spells, Quest Rewards,
  // and Quests (the quest definitions themselves).
  const categories: Category[] = useMemo(() => [...tribes, 'neutral', 'spells', 'rewards', 'quests'], [tribes]);

  // The quest DEFINITIONS to show in the Quests tab — scoped like the cards: every quest whose tribe is neutral
  // or in `tribes`, narrowed further by any selected tribe chips. Sorted lesser → greater → capstone, then name.
  const questTierOrder = { lesser: 0, greater: 1, capstone: 2 } as const;
  const questsToShow = useMemo(() => {
    const tribeSel = [...cats].filter((x): x is Tribe => x !== 'spells' && x !== 'quests' && x !== 'rewards');
    return QUEST_DEFS
      .filter((q) => q.tribe === 'neutral' || tribes.includes(q.tribe))
      .filter((q) => tribeSel.length === 0 || tribeSel.includes(q.tribe))
      .sort((a, b) => questTierOrder[a.tier] - questTierOrder[b.tier] || a.name.localeCompare(b.name));
  }, [tribes, cats]);

  // Every eligible card: minions whose tribe is neutral or in `tribes`, plus every tavern spell and every
  // quest-reward card whose granting quest is in scope. Buyable tokens are dropped by `BUYABLE_CARDS`; the
  // quest-reward tokens are re-added here (they're the whole point of the Quest Rewards category).
  const allCards = useMemo(() => {
    const inScope = (c: CardDef): boolean => c.tribe === 'neutral' || tribes.includes(c.tribe);
    const minions = BUYABLE_CARDS.filter(inScope);
    // Evolution units (Spirit Worgen, Taragosa) — shown alongside their tribe's minions though never buyable.
    const evolutions = EVOLUTION_CARDS.filter(inScope);
    const rewards = QUEST_REWARD_CARDS.filter((x) => x.tribe === 'neutral' || tribes.includes(x.tribe)).map((x) => x.card);
    // De-dupe by id: a card can appear in more than one bucket (Badgington is a buyable Beast AND an Apex Hunt
    // reward). The category filter below re-derives which gallery it shows in from the pool-membership sets.
    const seen = new Set<string>();
    const out: CardDef[] = [];
    for (const c of [...minions, ...evolutions, ...SPELL_CARDS, ...rewards]) {
      if (!seen.has(c.id)) { seen.add(c.id); out.push(c); }
    }
    return out;
  }, [tribes]);

  const filtered = useMemo(() => {
    // Spells + Quest Rewards are EXCLUSIVE modes, not additive axes: selecting either shows ONLY that pool
    // (or both pools, if both are on) and hides the minion gallery entirely. With neither selected, the gallery
    // is minions-only — spells and quest rewards never leak into a tribe search unless the player toggles them on.
    // Membership is by pool set (not the `spell` flag), so a minion that's also a reward shows correctly in both.
    if (cats.has('quests')) return []; // the Quests tab renders quest DEFINITIONS (below), not cards
    const showSpells = cats.has('spells');
    const showRewards = cats.has('rewards');
    const special = showSpells || showRewards;
    const tribeSel = [...cats].filter((x): x is Tribe => x !== 'spells' && x !== 'quests' && x !== 'rewards');
    return allCards
      .filter((c) => {
        if (tiers.size > 0 && !tiers.has(c.tier)) return false;
        if (kw && !kw.match(c)) return false;
        if (special) {
          return (showRewards && QUEST_REWARD_IDS.has(c.id)) || (showSpells && SPELL_POOL_IDS.has(c.id));
        }
        // Minion mode: buyable minions + evolutions only, narrowed by the selected tribes.
        if (!MINION_POOL_IDS.has(c.id)) return false;
        return tribeSel.length === 0 || tribeSel.includes(c.tribe) || (!!c.tribe2 && tribeSel.includes(c.tribe2));
      })
      .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  }, [allCards, tiers, cats, kw]);

  // A glossary term is a live filter only if at least one in-scope card matches it — otherwise the row
  // renders inert (no dead-end clicks). Scope-aware: a keyword absent from this run's tribes reads inert.
  const clickableTerms = useMemo(() => {
    const s = new Set<string>();
    for (const g of GLOSSARY) for (const it of g.items) if (it.match && allCards.some(it.match)) s.add(it.term);
    return s;
  }, [allCards]);

  const toggleTier = (t: number): void =>
    setTiers((prev) => { const next = new Set(prev); if (next.has(t)) next.delete(t); else next.add(t); return next; });
  const toggleCat = (c: Category): void =>
    setCats((prev) => { const next = new Set(prev); if (next.has(c)) next.delete(c); else next.add(c); return next; });

  // Click a glossary term → scope the gallery to the minions that carry it. Clears the tribe/tier filters
  // (so you see the full set), swaps back to the gallery, and shows a clearable chip in the tier bar.
  const filterByKeyword = (it: GlossItem): void => {
    if (!it.match) return;
    setKw({ term: it.term, icon: it.icon, match: it.match });
    setCats(new Set());
    setTiers(new Set());
    setGlossary(false);
  };

  return (
    <div className="book-ov" onClick={closeBook} role="dialog" aria-label="Compendium — Esc or Tab to close">
      <div className="book" onClick={(e) => e.stopPropagation()}>
        <div className="book-head">
          <div className="book-title"><Icon name="house" /> Compendium</div>
          <div className="book-sub">
            {glossary
              ? 'Keywords & abilities — click one to see its minions'
              : cats.has('quests')
                ? `${questsToShow.length} quests ${showTitle ? 'in the game' : 'available this run'}`
                : `${filtered.length} ${
                    cats.has('spells') && cats.has('rewards')
                      ? 'spells & quest rewards'
                      : cats.has('rewards')
                        ? 'quest rewards'
                        : cats.has('spells')
                          ? 'spells'
                          : 'minions'
                  } ${showTitle ? 'in the game' : 'findable this run'}`}
          </div>
          <button
            className={`book-gloss${glossary ? ' on' : ''}`}
            onClick={() => setGlossary((g) => !g)}
            aria-pressed={glossary}
            title="Glossary — every keyword and trigger, defined"
          >
            <Icon name="sc" /> Glossary
          </button>
          {!glossary && (
            <button
              className={`book-gilded${gilded ? ' on' : ''}`}
              onClick={() => setGilded((g) => !g)}
              aria-pressed={gilded}
              title="Show every card's tripled (Gilded) form"
            >
              <Icon name="crown" /> Gilded
            </button>
          )}
          <button className="book-close" onClick={closeBook} aria-label="Close (Tab / Esc)">✕</button>
        </div>

        {glossary ? (
          /* The glossary panel — replaces the tier bar + gallery with the keyword codex. */
          <div className="book-gloss-body">
            {GLOSSARY.map((group) => (
              <section className="gloss-group" key={group.title}>
                <h3 className="gloss-grouphead">{group.title}</h3>
                {group.items.map((it) =>
                  clickableTerms.has(it.term) ? (
                    <button className="gloss-row is-click" key={it.term} onClick={() => filterByKeyword(it)} title={`Show minions with ${it.term}`}>
                      <span className="gloss-ico"><Icon name={it.icon} /></span>
                      <span className="gloss-txt">
                        <span className="gloss-term">{it.term}</span>
                        <span className="gloss-def">{it.def}</span>
                      </span>
                    </button>
                  ) : (
                    <div className="gloss-row" key={it.term}>
                      <span className="gloss-ico"><Icon name={it.icon} /></span>
                      <span className="gloss-txt">
                        <span className="gloss-term">{it.term}</span>
                        <span className="gloss-def">{it.def}</span>
                      </span>
                    </div>
                  ),
                )}
              </section>
            ))}
          </div>
        ) : (
          <>
        {/* Tier filters across the top (multi-select); the active keyword filter rides at the far right. Hidden in
            the Quests tab — quests use lesser/greater/capstone pools, not the 1–6 card tiers. */}
        {!cats.has('quests') && (
        <div className="book-tiers">
          <span className="book-axislabel">Tier</span>
          {TIERS.map((t) => (
            <button
              key={t}
              className={`book-tier${tiers.has(t) ? ' on' : ''}`}
              onClick={() => toggleTier(t)}
              aria-pressed={tiers.has(t)}
            >
              {t}
            </button>
          ))}
          {kw && (
            <button className="book-kwchip" onClick={() => setKw(null)} title="Clear keyword filter">
              <Icon name={kw.icon} /> {kw.term} <span className="book-kwx">✕</span>
            </button>
          )}
        </div>
        )}

        <div className="book-main">
          {/* Tribe + Spells filters down the left (multi-select). */}
          <div className="book-rail">
            {categories.map((c) => (
              <button
                key={c}
                className={`book-cat${cats.has(c) ? ' on' : ''}`}
                style={{ '--c': c === 'spells' ? 'var(--acc)' : c === 'rewards' ? 'var(--gold)' : c === 'quests' ? 'var(--acc-dk)' : `var(--t-${c})` } as CSSProperties}
                onClick={() => toggleCat(c)}
                aria-pressed={cats.has(c)}
                title={CAT_META[c].label}
              >
                <Icon name={CAT_META[c].icon} />
                <span className="book-catlabel">{CAT_META[c].label}</span>
              </button>
            ))}
          </div>

          {/* The scrolling gallery — cards, or (in the Quests tab) the quest DEFINITIONS as read-only QuestCards. */}
          {cats.has('quests') ? (
            questsToShow.length > 0 ? (
              <div className="book-grid">
                {questsToShow.map((q) => (
                  <div className="book-cell" key={q.id}>
                    <QuestCard quest={q} onBuy={() => {}} readOnly />
                  </div>
                ))}
              </div>
            ) : (
              <div className="book-empty">No quests for these tribes.</div>
            )
          ) : filtered.length > 0 ? (
            <div className="book-grid">
              {filtered.map((c) => (
                <div className="book-cell" key={c.id}>
                  <Card card={toView(c, gilded)} forceFull suppressPop />
                </div>
              ))}
            </div>
          ) : (
            <div className="book-empty">No cards match these filters.</div>
          )}
        </div>
          </>
        )}
      </div>
    </div>
  );
}
