import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CardDef, QuestReward, Tribe } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, QUEST_DEFS, RUNES, activeSet, poolFor } from '@game/content';
import { HEROES, chooseBothActive, type RunState } from '@game/sim';
import { Card, mdBold, type CardView } from './Card';
import { chooseBothText } from './cardText';
import { QuestCard } from './QuestCard';
import { RuneCard } from './RuneCard';
import { heroArt } from './art';
import { Icon } from './Icon';
import { MECHANICS, toMechInput } from './mechanics';
import { useGame } from './store';

/** Evolution units — non-buyable tokens a minion ascends/transforms into (Spirit Pup → Spirit Worgen,
 *  Tara → Taragosa). Detected from the SOURCE cards actually in the given set's pool (ascend targets +
 *  `spellCastTransform` destinations), so the Compendium can show these "secret" payoff forms even though they
 *  never appear in the shop.
 *
 *  Scanning the set's pool rather than the global `CARD_INDEX` is load-bearing: the index is set-agnostic by
 *  design (id→def needs no set), so the old global walk leaked every set's evolution targets into every other
 *  set — Spirit Worgen showed up under a Set-2 run's Beasts even though Spirit Pup, the only card that can
 *  transform into it, isn't in Set 2 at all (owner report 2026-07-24). An evolution form is in scope exactly
 *  when the card that evolves into it is. */
const evolutionCardsFor = (buyable: readonly CardDef[]): CardDef[] => {
  const ids = new Set<string>();
  for (const c of buyable) {
    if (c.ascendInto) ids.add(c.ascendInto);
    for (const e of c.effects) {
      if (e.do === 'spellCastTransform' && typeof e.params?.into === 'string') ids.add(e.params.into);
    }
  }
  return [...ids].map((id) => CARD_INDEX[id]).filter((c): c is CardDef => !!c);
};

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

/** Rune-reward cards — the specific minions/spells a purchased rune grants (named `cards` / `grantGolden`
 *  grants; random-tier / random-tribe / random-filter grants have no fixed card to show). Mirrors
 *  QUEST_REWARD_CARDS, but runes aren't tribe-bound (the Runeforge is hero-reached), so this is a flat,
 *  un-scoped list — shown always, like the Runes tab. Surfaces the rune-exclusive tokens (Feasting Bogrot,
 *  Reconfigured Combinator) that otherwise appear nowhere in the Compendium, plus the buyable minions a rune
 *  hands you (Mama Bear, Pillager, Soulsman…). */
const RUNE_REWARD_CARDS: CardDef[] = (() => {
  const ids = new Set<string>();
  const walk = (r: QuestReward): void => {
    if (r.kind === 'grant') {
      for (const id of r.cards ?? []) ids.add(id);
      for (const id of r.grantGolden ?? []) ids.add(id);
    } else if (r.kind === 'recurringGrant') {
      for (const id of r.cards) ids.add(id);
    } else if (r.kind === 'multi') {
      for (const sub of r.rewards) walk(sub);
    }
  };
  for (const rune of [...RUNES, ...EPIC_RUNES]) walk(rune.reward);
  return [...ids].map((id) => CARD_INDEX[id]).filter((c): c is CardDef => !!c);
})();
const RUNE_REWARD_IDS = new Set(RUNE_REWARD_CARDS.map((c) => c.id));
/** Cards that belong in the MINION gallery: buyable minions + evolution units. A card can *also* be a quest
 *  reward (Badgington is a normal Tier-4 Beast that Apex Hunt grants) — it then shows in BOTH its tribe and the
 *  Quest Rewards category. Membership sets keep those overlaps correct instead of hiding a real minion. */
/** Which gallery a card belongs to, per SET — the Compendium shows the pool of the set the player is
 *  actually in (title screen = the live set), not a hardcoded one. Memoized; sets are immutable at runtime. */
const poolIdsBySet = new Map<string, { minions: Set<string>; spells: Set<string>; evolutions: CardDef[] }>();
function poolIds(setId: Parameters<typeof poolFor>[0]): { minions: Set<string>; spells: Set<string>; evolutions: CardDef[] } {
  const hit = poolIdsBySet.get(setId);
  if (hit) return hit;
  const p = poolFor(setId);
  const evolutions = evolutionCardsFor(p.buyable);
  const ids = {
    minions: new Set([...p.buyable, ...evolutions].map((c) => c.id)),
    spells: new Set(p.spells.map((c) => c.id)),
    evolutions,
  };
  poolIdsBySet.set(setId, ids);
  return ids;
}

/** Left-rail category: a real tribe, the tribe-less "spells" bucket, the "rewards" (quest-reward cards) bucket,
 *  or the "quests" bucket (the quest DEFINITIONS themselves — objective + art, rendered as QuestCards). */
type Category = Tribe | 'spells' | 'rewards' | 'quests' | 'runes' | 'runeRewards' | 'heroes';

const CAT_META: Record<Category, { label: string; icon: string }> = {
  beast: { label: 'Beasts', icon: 'paw' },
  celestial: { label: 'Celestials', icon: 'clock' },
  dragon: { label: 'Dragons', icon: 'flame' },
  mech: { label: 'Mechs', icon: 'gear' },
  undead: { label: 'Undead', icon: 'skull' },
  demon: { label: 'Demons', icon: 'eye' },
  dwarf: { label: 'Dwarves', icon: 'anvil' },
  kobold: { label: 'Kobolds', icon: 'crown' },
  neutral: { label: 'Neutral', icon: 'star' },
  spells: { label: 'Spells', icon: 'sc' },
  rewards: { label: 'Quest Rewards', icon: 'gift' },
  quests: { label: 'Quests', icon: 'target' },
  runes: { label: 'Runes', icon: 'anvil' },
  runeRewards: { label: 'Rune Rewards', icon: 'gift' },
  heroes: { label: 'Heroes', icon: 'shield' },
};

/** Left-rail categories that are NOT tribes — used to derive the selected-tribe subset from `cats`. */
const NON_TRIBE_CATS = new Set<Category>(['spells', 'rewards', 'quests', 'runes', 'runeRewards', 'heroes']);

const TIERS = [1, 2, 3, 4, 5, 6, 7] as const;
/** Every non-neutral tribe — the left-rail set when browsing the full game (from the title, pre-run). */
// (Was a hardcoded set-1 five — with set 2 live the title-screen book showed Mechs/Undead and no
// Kobolds/Dwarves. The ACTIVE set's tribe list is the truth; a mid-run book uses the run's own tribes.)

/** One glossary entry. `match` (when present) makes the row a live filter: clicking it scopes the gallery
 *  to the cards it matches. Terms with no sensible card filter (Gilded) omit it and render inert. */
type GlossItem = { icon: string; term: string; def: string; match?: (c: CardDef) => boolean };

/** Build a text predicate from the raw search-box value. Two modes:
 *  - **Quoted** (`"Imp"`) → WHOLE-WORD match, so it hits "Imp" / "Imp King" but NOT "Improve" / "Imps" / "Impala".
 *  - **Unquoted** (`Imp`) → case-insensitive substring (the loose default).
 *  Empty / quotes-only → matches everything. Callers OR it across a card's name + text fields. */
function makeSearchMatcher(raw: string): (text: string) => boolean {
  const trimmed = raw.trim();
  if (!trimmed) return () => true;
  const quoted = trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
  if (quoted) {
    const term = trimmed.slice(1, -1).trim();
    if (!term) return () => true;
    // `\b…\b` around the regex-escaped term: a word boundary on each side excludes substrings inside a larger word.
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return (text) => re.test(text);
  }
  const lower = trimmed.toLowerCase();
  return (text) => text.toLowerCase().includes(lower);
}

/** The glossary — every keyword + trigger the cards use, one rule apiece. Grouped by when-it-fires
 *  (Triggers), what-it-does-in-combat (Combat), and shop/build terms. It is REBUILT from the shared
 *  `MECHANICS` registry (`mechanics.ts`) by id, so the codex glyph/name/def and the card medallion
 *  (`mechIcon.ts`) can never drift — a `mechIcon.test.ts` drift test guards `GLOSSARY_MECHANIC_IDS`.
 *  Each row's `match` predicate is the registry `detect` run over the card, so clicking a term surfaces
 *  exactly the minions that carry (or grant) it. Non-mechanic rows with no card filter (Gilded) are
 *  appended by hand. */
const byId = Object.fromEntries(MECHANICS.map((m) => [m.id, m]));
const row = (id: string): GlossItem => {
  const m = byId[id]!;
  return { icon: m.glyph, term: m.term, def: m.def, match: (c: CardDef) => m.detect(toMechInput(c)) };
};

/** The registry ids the glossary renders, in section+display order. Exported for the drift test. */
export const GLOSSARY_MECHANIC_IDS = [
  'shout', 'echo', 'startCombat', 'endTurn', 'avenge', 'rally', 'slaughter', 'bleed', 'chooseOne',
  'taunt', 'ward', 'execute', 'flurry', 'crit', 'rise', 'cleave', 'stealth', 'immune', 'watcher',
  'attachment', 'consume', 'fodder', 'engraved', 'discover',
] as const;

const GLOSSARY: { title: string; items: GlossItem[] }[] = [
  { title: 'Triggers', items: ['shout', 'echo', 'startCombat', 'endTurn', 'avenge', 'rally', 'slaughter', 'bleed', 'chooseOne'].map(row) },
  { title: 'Combat keywords', items: ['taunt', 'ward', 'execute', 'flurry', 'crit', 'rise', 'cleave', 'stealth', 'immune', 'watcher'].map(row) },
  {
    title: 'Build & shop',
    items: [
      ...['attachment', 'consume', 'fodder', 'engraved', 'discover'].map(row),
      // Non-mechanic row (a shop/fusion term, not a card-detectable mechanic): no `match`, renders inert.
      { icon: 'crown', term: 'Gilded', def: 'Collect three copies to fuse one doubled-stat Gilded minion.' },
    ],
  },
];

/** Zoom steps for the card grid — the multiplier applied to the grid's `--ch` (card height), which the CSS
 *  derives width + drawer geometry from. 0.6 fits roughly twice the cards per row; 1.6 is a reading size. */
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.2;

/** A book card def → the view object `Card` renders. Base (printed) stats only — the book is a static
 *  reference, not a live board, so no run buffs. `gilded` shows the tripled/golden form: doubled stats, the
 *  golden frame, and the card's golden text (Card falls back to doubling the printed numbers when a card has
 *  no explicit goldenText). */
function toView(c: CardDef, gilded = false, run?: RunState): CardView {
  const mul = gilded ? 2 : 1;
  // (Both): the Compendium is run-scoped (it lists what THIS run can find), so a Choose One the run already
  // makes do both must read that way here as well — the same predicate every other surface uses.
  const both = run && chooseBothActive(run, { golden: gilded }, c) ? chooseBothText(c.id, gilded) : null;
  return {
    name: c.name,
    cardId: c.id,
    tribe: c.tribe,
    tribe2: c.tribe2,
    attack: c.attack * mul,
    health: c.health * mul,
    keywords: c.keywords,
    text: both ?? c.text,
    goldenText: both ?? c.goldenText,
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
  const showTitleEarly = useGame((s) => s.showTitle);
  // From the TITLE the book shows the ACTIVE set (what a new run would play); mid-run it shows the run's own
  // pinned set — which can differ after a set flip, and the book must describe the game being played.
  const setId = showTitleEarly ? activeSet().id : (run.setId ?? 'set1');
  const pool = poolFor(setId);
  const { minions: MINION_POOL_IDS, spells: SPELL_POOL_IDS, evolutions: EVOLUTION_CARDS } = poolIds(setId);
  const showTitle = useGame((s) => s.showTitle);
  const closeBook = useGame((s) => s.closeBook);

  const [tiers, setTiers] = useState<Set<number>>(() => new Set());
  const [cats, setCats] = useState<Set<Category>>(() => new Set());
  const [search, setSearch] = useState(''); // free-text search over card/quest/rune name + text ("Imp", "Ward", …)
  const [gilded, setGilded] = useState(false); // show every card's tripled/golden form
  // ZOOM (owner ask 2026-08-02): scales the grid's card size so more/fewer cards fit. Persisted, because a
  // browsing preference that resets every open is one the player has to re-set every time. Clamped to the
  // steps the grid actually reads (the CSS derives --cw/--ccw from --ch, so one variable drives all three).
  const [zoom, setZoom] = useState<number>(() => {
    try { const v = Number(localStorage.getItem('ascent.bookzoom')); return v >= ZOOM_MIN && v <= ZOOM_MAX ? v : 1; } catch { return 1; }
  });
  useEffect(() => { try { localStorage.setItem('ascent.bookzoom', String(zoom)); } catch { /* ignore */ } }, [zoom]);
  const [glossary, setGlossary] = useState(false); // swap the gallery for the keyword codex
  const [kw, setKw] = useState<{ term: string; icon: string; match: (c: CardDef) => boolean } | null>(null); // active keyword filter (from the glossary)

  // Opened from the title (no committed run) → browse the WHOLE card set; in a run → scope to its active
  // tribes (mirrors `stockPool`: neutral is always findable, so it's added below regardless).
  const tribes: Tribe[] = showTitle ? [...activeSet().tribes] : run.tribes;

  // Left-rail categories: the active (or all) tribes, then Neutral (always findable), then Spells, Runes,
  // Rune Rewards and Heroes.
  //
  // QUESTS + QUEST REWARDS ARE HIDDEN (owner 2026-08-24: "not a system that's currently active"). Only the two
  // left-rail buttons are removed, so the buckets can never be selected — every `cats.has('quests')` /
  // `cats.has('rewards')` branch below (and `questsToShow`, `QUEST_REWARD_CARDS`) simply stays dormant rather
  // than being deleted, so restoring the tab when quests come back is a one-line change here. A quest-reward
  // token that is ALSO a real minion still shows in its tribe gallery (BUYABLE_CARDS membership is unchanged);
  // only the pure reward-only tokens, which needed the now-absent bucket to appear, go dark.
  const categories: Category[] = useMemo(() => [...tribes, 'neutral', 'spells', 'runes', 'runeRewards', 'heroes'], [tribes]);

  // Heroes for the Heroes tab — every shippable hero (WIP ones are withheld, like the picker), searchable by
  // name or power. Not run-scoped (heroes aren't tribe-bound), same as the Runes tab.
  const heroesToShow = useMemo(() => {
    const m = makeSearchMatcher(search);
    return HEROES.filter((h) => !h.wip)
      .filter((h) => m(h.name) || m(h.power.name) || m(h.power.text))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [search]);

  // Every rune (both forges) for the Runes tab — Basic set first, then Epic, each alphabetical. Not run-scoped
  // (runes aren't tribe-bound); shown as read-only RuneCards.
  const runesToShow = useMemo(() => {
    const m = makeSearchMatcher(search);
    const match = (r: { name: string; text: string }): boolean => m(r.name) || m(r.text);
    return [...[...RUNES].sort((a, b) => a.name.localeCompare(b.name)), ...[...EPIC_RUNES].sort((a, b) => a.name.localeCompare(b.name))].filter(match);
  }, [search]);

  // The quest DEFINITIONS to show in the Quests tab — scoped like the cards: every quest whose tribe is neutral
  // or in `tribes`, narrowed further by any selected tribe chips. Sorted lesser → greater → capstone, then name.
  const questTierOrder = { lesser: 0, greater: 1, capstone: 2 } as const;
  const questsToShow = useMemo(() => {
    const tribeSel = [...cats].filter((x): x is Tribe => !NON_TRIBE_CATS.has(x));
    const m = makeSearchMatcher(search);
    return QUEST_DEFS
      .filter((qd) => qd.tribe === 'neutral' || tribes.includes(qd.tribe))
      .filter((qd) => tribeSel.length === 0 || tribeSel.includes(qd.tribe))
      .filter((qd) => m(qd.name)) // search matches the quest name
      .sort((a, b) => questTierOrder[a.tier] - questTierOrder[b.tier] || a.name.localeCompare(b.name));
  }, [tribes, cats, search]);

  // Every eligible card: minions whose tribe is neutral or in `tribes`, plus every tavern spell and every
  // quest-reward card whose granting quest is in scope. Buyable tokens are dropped by `BUYABLE_CARDS`; the
  // quest-reward tokens are re-added here (they're the whole point of the Quest Rewards category).
  const allCards = useMemo(() => {
    const inScope = (c: CardDef): boolean => c.tribe === 'neutral' || tribes.includes(c.tribe);
    const minions = pool.buyable.filter(inScope);
    // Evolution units (Spirit Worgen, Taragosa) — shown alongside their tribe's minions though never buyable.
    // Already scoped to THIS set (their source card is in its pool); `inScope` then narrows to the run's tribes.
    const evolutions = EVOLUTION_CARDS.filter(inScope);
    const rewards = QUEST_REWARD_CARDS.filter((x) => x.tribe === 'neutral' || tribes.includes(x.tribe)).map((x) => x.card);
    // De-dupe by id: a card can appear in more than one bucket (Badgington is a buyable Beast AND an Apex Hunt
    // reward). The category filter below re-derives which gallery it shows in from the pool-membership sets.
    const seen = new Set<string>();
    const out: CardDef[] = [];
    // Rune rewards are un-scoped (the Runeforge isn't tribe-bound) — added unconditionally, like spells.
    for (const c of [...minions, ...evolutions, ...pool.spells, ...rewards, ...RUNE_REWARD_CARDS]) {
      if (!seen.has(c.id)) { seen.add(c.id); out.push(c); }
    }
    return out;
  }, [tribes, pool]); // `pool` changes only when the run's set does — but it IS an input now


  const query = search.trim().toLowerCase();
  // Free-text match over a card's name + printed text (and golden text) — powers the search box. Quote the query
  // ("Imp") for a whole-word match; leave it unquoted (Imp) for a loose substring.
  const searchMatch = makeSearchMatcher(search);
  const matchText = (c: CardDef): boolean => searchMatch(c.name) || searchMatch(c.text ?? '') || searchMatch(c.goldenText ?? '');

  const filtered = useMemo(() => {
    // A text search is GLOBAL: it scans every in-scope card (minions + evolutions + spells + quest/rune rewards),
    // ignoring the tribe chips + Spells/Rewards mode toggles, so typing "Imp" surfaces every match. Tier chips
    // still narrow it. Overrides the category logic below.
    if (query) {
      if (cats.has('quests') || cats.has('runes') || cats.has('heroes')) return []; // those tabs filter their own lists by the query
      return allCards
        .filter((c) => (tiers.size === 0 || tiers.has(c.tier)) && matchText(c))
        .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
    }
    // Spells + Quest Rewards are EXCLUSIVE modes, not additive axes: selecting either shows ONLY that pool
    // (or both pools, if both are on) and hides the minion gallery entirely. With neither selected, the gallery
    // is minions-only — spells and quest rewards never leak into a tribe search unless the player toggles them on.
    // Membership is by pool set (not the `spell` flag), so a minion that's also a reward shows correctly in both.
    if (cats.has('quests') || cats.has('runes') || cats.has('heroes')) return []; // the Quests / Runes / Heroes tabs render their own galleries below
    const showSpells = cats.has('spells');
    const showRewards = cats.has('rewards');
    const showRuneRewards = cats.has('runeRewards');
    const special = showSpells || showRewards || showRuneRewards;
    const tribeSel = [...cats].filter((x): x is Tribe => !NON_TRIBE_CATS.has(x));
    return allCards
      .filter((c) => {
        if (tiers.size > 0 && !tiers.has(c.tier)) return false;
        if (kw && !kw.match(c)) return false;
        if (special) {
          return (showRewards && QUEST_REWARD_IDS.has(c.id)) || (showSpells && SPELL_POOL_IDS.has(c.id)) || (showRuneRewards && RUNE_REWARD_IDS.has(c.id));
        }
        // Minion mode: buyable minions + evolutions only, narrowed by the selected tribes.
        if (!MINION_POOL_IDS.has(c.id)) return false;
        return tribeSel.length === 0 || tribeSel.includes(c.tribe) || (!!c.tribe2 && tribeSel.includes(c.tribe2));
      })
      .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  }, [allCards, tiers, cats, kw, query]);

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
              : query
                ? `${(cats.has('quests') ? questsToShow.length : cats.has('runes') ? runesToShow.length : cats.has('heroes') ? heroesToShow.length : filtered.length)} result${
                    (cats.has('quests') ? questsToShow.length : cats.has('runes') ? runesToShow.length : cats.has('heroes') ? heroesToShow.length : filtered.length) === 1 ? '' : 's'
                  } for "${search.trim().replace(/^"(.*)"$/, '$1')}"`
              : cats.has('heroes')
                ? `${heroesToShow.length} heroes — every champion and their power`
                : cats.has('runes')
                ? `${runesToShow.length} runes — the Basic + Epic Runeforge stock`
                : cats.has('quests')
                ? `${questsToShow.length} quests ${showTitle ? 'in the game' : 'available this run'}`
                : `${filtered.length} ${
                    [cats.has('spells') && 'spells', cats.has('rewards') && 'quest rewards', cats.has('runeRewards') && 'rune rewards']
                      .filter(Boolean)
                      .join(' & ') || 'minions'
                  } ${showTitle || cats.has('runeRewards') ? 'in the game' : 'findable this run'}`}
          </div>
          {!glossary && (
            <input
              className="book-search"
              type="search"
              placeholder={'Search… (Imp, or "Imp" exact)'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search cards, quests, and runes by name or text"
            />
          )}
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
          {!glossary && (
            <div className="book-zoom" role="group" aria-label="Card size">
              <button
                className="book-zoom-btn pressable"
                onClick={() => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 10) / 10))}
                disabled={zoom <= ZOOM_MIN}
                aria-label="Smaller cards (more per screen)"
                title="Smaller cards — more per screen"
              >−</button>
              <span className="book-zoom-val">{Math.round(zoom * 100)}%</span>
              <button
                className="book-zoom-btn pressable"
                onClick={() => setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 10) / 10))}
                disabled={zoom >= ZOOM_MAX}
                aria-label="Bigger cards (fewer per screen)"
                title="Bigger cards — fewer per screen"
              >+</button>
            </div>
          )}
          <button className="book-close pressable" onClick={closeBook} aria-label="Close (Tab / Esc)">✕</button>
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
            the Quests + Runes tabs — those pools aren't organized by the 1–6 card tiers. */}
        {!cats.has('quests') && !cats.has('runes') && !cats.has('heroes') && (
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
                style={{ '--c': c === 'spells' ? 'var(--acc)' : c === 'rewards' ? 'var(--gold)' : c === 'quests' ? 'var(--acc-dk)' : c === 'runes' ? '#b078e6' : c === 'runeRewards' ? '#c9a4ec' : c === 'heroes' ? '#e0b34a' : `var(--t-${c})` } as CSSProperties}
                onClick={() => toggleCat(c)}
                aria-pressed={cats.has(c)}
                title={CAT_META[c].label}
              >
                <Icon name={CAT_META[c].icon} />
                <span className="book-catlabel">{CAT_META[c].label}</span>
              </button>
            ))}
          </div>

          {/* The scrolling gallery — cards, the quest DEFINITIONS (Quests tab), the runes (Runes tab), or the
              heroes (Heroes tab). */}
          {cats.has('heroes') ? (
            heroesToShow.length > 0 ? (
              <div className="book-grid">
                {heroesToShow.map((h) => {
                  const art = heroArt(h.id);
                  return (
                    <div className="book-cell" key={h.id}>
                      <div className="bookhero">
                        <div className="bookhero-art">
                          {art ? <img src={art} alt={h.name} draggable={false} /> : <Icon name="shield" />}
                        </div>
                        <div className="bookhero-name">{h.name}</div>
                        <div className="bookhero-hp" title="Starting Health + Armor">
                          <Icon name="heart" />{h.resolve}
                          {h.armor > 0 && <span className="bookhero-armor" title="Starting Armor">+{h.armor}</span>}
                        </div>
                        <div className="bookhero-pw"><b>{h.power.name}</b> · <span dangerouslySetInnerHTML={{ __html: mdBold(h.power.text) }} /></div>
                        {h.power.unlockWave && h.power.unlockWave > 1 && (
                          <div className="bookhero-lock">Unlocks turn {h.power.unlockWave}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="book-empty">No heroes match your search.</div>
            )
          ) : cats.has('runes') ? (
            <div className="book-grid">
              {runesToShow.map((r) => (
                <div className="book-cell" key={r.id}>
                  <RuneCard rune={r} affordable onBuy={() => {}} />
                </div>
              ))}
            </div>
          ) : cats.has('quests') ? (
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
            // `--book-zoom` scales the grid's card metrics (see styles.css); `plated` gives every card the
            // same carved PLATE it wears in hand, so the Compendium reads as the game does (owner 2026-08-02).
            <div className="book-grid" style={{ '--book-zoom': zoom } as CSSProperties}>
              {filtered.map((c) => (
                <div className="book-cell" key={c.id}>
                  <Card card={toView(c, gilded, run)} forceFull suppressPop plated />
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
