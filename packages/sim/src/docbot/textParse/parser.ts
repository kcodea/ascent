/**
 * DOC BOT 2.0 WP E — the conservative partial parser over printed text (blueprint §11.1).
 *
 * Grown from the three tranche grammars (textOracle's stat-buff parse, textOracleSummons' summon-clause
 * parse, targetCardinality's target-language) + the keyword/trigger lexicons. Strategy, honest by
 * construction (§4.3):
 *
 *   sentence by sentence → peel one leading trigger prefix (TRIGGER_LEXICON) or conditional clause
 *   (CONDITIONAL_LEXICON) → then PREFIX-PARSE the effect body: anchored recognizers consume from the
 *   left; the FIRST position no recognizer accepts ends the parse of that sentence and the whole
 *   remainder lands in `unresolvedPhrases`, verbatim, with its span. A recognizer never guesses — a
 *   clause it half-understands is a clause it does not consume.
 *
 * The parser is pure over the text string (plus CARD_INDEX name resolution for named cards) — no engine
 * state, no RNG, no side effects. It reads STRIPPED text (bold/live-value markers removed) so parsing is
 * stable across presentation markers.
 */
import { stripMarkers } from '../textOracle';
import { resolveTokenName } from '../textOracleSummons';
import { CONDITIONAL_LEXICON, TRIGGER_LEXICON, keywordNameTable } from './lexicon';
import type {
  ParsedAmount, ParsedEffect, ParsedGamePhase, ParsedLimit, ParsedPersistence, ParsedRandomness,
  ParsedTarget, ParsedTextContract, ParsedTrigger, TextSpan,
} from './types';

const span = (stripped: string, start: number, end: number): TextSpan =>
  ({ start, end, text: stripped.slice(start, end) });

// ── shared sub-grammars ──────────────────────────────────────────────────────────────────────────────────

const COUNT_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const countOf = (w: string): number => COUNT_WORDS[w.toLowerCase()] ?? Number(w);
const COUNT_RE = 'a|an|one|two|three|four|five|six|seven|\\d+';

/** "+A/+H" | "+N Attack" | "+N Health" | "+A/+H ... " — the T1 pair grammar, position-anchored. */
function statToken(s: string): { attack: number; health: number; len: number; at: number } | null {
  const m = /\+(\d+)\/\+(\d+)|\+(\d+) Attack|\+(\d+) Health/.exec(s);
  if (!m) return null;
  const at = m.index;
  const len = m[0].length;
  if (m[1] !== undefined) return { attack: Number(m[1]), health: Number(m[2]), len, at };
  if (m[3] !== undefined) return { attack: Number(m[3]), health: 0, len, at };
  return { attack: 0, health: Number(m[4]!), len, at };
}

const TRIBE_WORDS = 'Beasts?|Demons?|Dragons?|Dwarves|Dwarf|Kobolds?|Mechs?|Undead|Imps?|Rubies|Ruby|Fodder|Attachments?|Magnetics?|minions?|units?|Shop spells?|Dwarven Ales?|Golems?';

/** A target phrase, anchored at the start of `s`. Deliberately small: the shapes the corpus actually
 *  prints. Returns null (no consumption) for anything else. */
function targetPhrase(s: string): { target: ParsedTarget; len: number } | null {
  let m = /^your (other )?(entire board|board|(?:[A-Z][\w']*(?: spells)?s?|minions|Imps and Fodder|Fodder|Undead))\b/.exec(s);
  if (m) {
    return { target: { cardinality: 'all', scope: `your-${m[2]!.toLowerCase().replace(/\s+/g, '-')}`, friendly: true }, len: m[0].length };
  }
  m = new RegExp(`^(${COUNT_RE}) (random )?(other )?(friendly )?(${TRIBE_WORDS})\\b`).exec(s);
  if (m) {
    return {
      target: {
        cardinality: 'exactly', count: countOf(m[1]!), scope: m[5]!.toLowerCase(),
        ...(m[4] ? { friendly: true } : {}), ...(m[2] ? { random: true } : {}),
      },
      len: m[0].length,
    };
  }
  m = /^adjacent (?:minions|units)\b/.exec(s);
  if (m) return { target: { cardinality: 'all', scope: 'adjacent', friendly: true }, len: m[0].length };
  m = /^(?:this(?: minion)?|it)\b/.exec(s);
  if (m) return { target: { cardinality: 'exactly', count: 1, scope: 'self', friendly: true }, len: m[0].length };
  m = /^the target\b/.exec(s);
  if (m) return { target: { cardinality: 'exactly', count: 1, scope: 'target' }, len: m[0].length };
  m = /^minions in the Shop\b/.exec(s);
  if (m) return { target: { cardinality: 'all', scope: 'shop-minions' }, len: m[0].length };
  return null;
}

// ── effect recognizers (anchored; return the consumed length or null) ────────────────────────────────────

interface Rec { effect: Omit<ParsedEffect, 'span'>; len: number }

const KEYWORD_TABLE = keywordNameTable();

/** Keyword names at the start of `s` ("Taunt", "Ward and Taunt", "Critical Strike (50%)"). */
function keywordRun(s: string): { letters: string[]; len: number } | null {
  let pos = 0;
  const letters: string[] = [];
  for (;;) {
    const rest = s.slice(pos);
    let hit: { name: string; code: string } | null = null;
    for (const [name, code] of KEYWORD_TABLE) {
      if (rest.startsWith(name)) { hit = { name, code }; break; }
    }
    if (!hit) break;
    let len = hit.name.length;
    const pct = /^ \(\d+%\)/.exec(rest.slice(len));
    if (pct) len += pct[0].length;
    letters.push(hit.code);
    pos += len;
    const joiner = /^(?:[.,]\s*| and )/.exec(s.slice(pos));
    if (!joiner) break;
    pos += joiner[0].length;
  }
  return letters.length ? { letters, len: pos } : null;
}

function recKeywordLine(s: string): Rec | null {
  const run = keywordRun(s);
  if (!run) return null;
  // Only a run that consumes the whole fragment (bar trailing punctuation) is a bare keyword line.
  if (/^[.\s]*$/.test(s.slice(run.len))) return { effect: { kind: 'keyword-line', keywords: run.letters }, len: s.length };
  return null;
}

function recStatBuff(s: string): Rec | null {
  const m = /^(Give|Gives|Gain|Gains|Improve|Improves|Improving|Engrave|Engraves|improve|improving|give|gives|gain|gains)\b\s*/.exec(s);
  if (!m) return null;
  const verb = m[1]!.toLowerCase();
  let pos = m[0].length;
  // Optional target phrase between verb and the stat token ("give your Beasts +1/+1").
  const tp = targetPhrase(s.slice(pos));
  if (tp) pos += tp.len + (/^\s*/.exec(s.slice(pos + tp.len))?.[0].length ?? 0);
  else if (/^this by /.test(s.slice(pos))) pos += 'this by '.length; // "Improve this by +2/+2"
  const rest = s.slice(pos);
  const st = statToken(rest);
  if (!st || st.at > 1) return null; // the stat pair must sit right here — anything between is unread
  pos += st.at + st.len;
  const amount: ParsedAmount = { attack: st.attack, health: st.health };
  const effect: Omit<ParsedEffect, 'span'> = {
    kind: 'stat-buff', amount, verb,
    ...(tp ? { target: tp.target } : verb.startsWith('gain') ? { target: { cardinality: 'exactly', count: 1, scope: 'self', friendly: true } } : {}),
  };
  return { effect, len: pos };
}

function recGrantKeyword(s: string): Rec | null {
  const m = /^(Give|Gives|Gain|Gains|give|gives|gain|gains|grant|grants)\b\s*/.exec(s);
  if (!m) return null;
  let pos = m[0].length;
  const tp = targetPhrase(s.slice(pos));
  if (tp) pos += tp.len + (/^\s*(?:an? |permanent )*/.exec(s.slice(pos + tp.len))?.[0].length ?? 0);
  else {
    const art = /^(?:an? |permanent )+/.exec(s.slice(pos));
    if (art) pos += art[0].length;
  }
  const run = keywordRun(s.slice(pos));
  if (!run) return null;
  pos += run.len;
  const effect: Omit<ParsedEffect, 'span'> = {
    kind: 'grant-keyword', keywords: run.letters, verb: m[1]!.toLowerCase(),
    ...(tp ? { target: tp.target } : m[1]!.toLowerCase().startsWith('gain') ? { target: { cardinality: 'exactly', count: 1, scope: 'self', friendly: true } } : {}),
  };
  return { effect, len: pos };
}

function recSummon(s: string): Rec | null {
  const m = new RegExp(`^(?:[Rr]e)?[Ss]ummons?\\s+(${COUNT_RE})?\\s*`).exec(s);
  if (!m) return null;
  let pos = m[0].length;
  const count = m[1] ? countOf(m[1]) : 1;
  let rest = s.slice(pos);
  if (/^cop(?:y|ies) of /.test(rest)) return null; // "Summon a copy of …" belongs to the copy recognizer
  let stats: ParsedAmount | undefined;
  const sm = /^(\d+)\/(\d+)\s+/.exec(rest);
  if (sm) { stats = { attack: Number(sm[1]), health: Number(sm[2]) }; pos += sm[0].length; rest = s.slice(pos); }
  const golden = /^(?:Golden|Gilded)\s+/.exec(rest);
  if (golden) { pos += golden[0].length; rest = s.slice(pos); }
  const nm = /^([A-Z][\w']*(?:\s+[A-Z][\w']*)*)/.exec(rest);
  if (!nm) return null;
  pos += nm[0].length;
  let keywords: string[] | undefined;
  const withKw = /^ with /.exec(s.slice(pos));
  if (withKw) {
    const run = keywordRun(s.slice(pos + withKw[0].length));
    if (run) { keywords = run.letters; pos += withKw[0].length + run.len; }
  }
  const id = resolveTokenName(nm[1]!);
  return {
    effect: {
      kind: 'summon', summonCount: count,
      ...(id ? { refId: id } : { refName: nm[1]! }),
      ...(stats ? { amount: stats } : {}), ...(keywords ? { keywords } : {}),
    },
    len: pos,
  };
}

function recGold(s: string): Rec | null {
  const m = new RegExp(`^(?:[Gg]ains?|[Gg]ets?)\\s+(${COUNT_RE}) (?:extra )?Gold\\b(?: next (?:turn|shop))?`).exec(s);
  if (m) return { effect: { kind: 'gain-gold', amount: { value: countOf(m[1]!), unit: 'gold' }, verb: /gain/i.test(m[0]) ? 'gain' : 'get' }, len: m[0].length };
  const mx = /^(?:[Gg]ain|[Rr]aise your maximum Gold by|[Gg]ain \+?)(\s*\+?(\d+) max(?:imum)? Gold|\s+(\d+))\b/.exec(s);
  if (mx) {
    const v = Number(mx[2] ?? mx[3]);
    if (Number.isFinite(v)) return { effect: { kind: 'gain-gold', amount: { value: v, unit: 'max-gold' }, verb: 'gain' }, len: mx[0].length };
  }
  return null;
}

function recDiscover(s: string): Rec | null {
  const m = /^Discover (an? |two |\d+ )?([^.,]+)/.exec(s);
  if (!m) return null;
  return { effect: { kind: 'discover', refName: m[2]!.trim(), verb: 'discover' }, len: m[0].length };
}

function recCopy(s: string): Rec | null {
  const m = new RegExp(`^(?:[Gg]ets?|[Aa]dds?|[Ss]ummons?|[Cc]op(?:y|ies))\\s+(?:(${COUNT_RE})\\s+)?(?:(exact|plain)\\s+)?cop(?:y|ies)?\\b`).exec(s);
  const m2 = /^[Cc]op(?:y|ies)\b/.exec(s);
  if (!m && !m2) return null;
  const mode = (m?.[2] as 'exact' | 'plain' | undefined) ?? (/\bexact cop/.test(s) ? 'exact' : /\bplain cop/.test(s) ? 'plain' : 'unmarked');
  // Consume through "of <thing>" when present; through the head otherwise.
  const head = (m ?? m2)![0].length;
  const of = /^(?:y|ies)?\s*(?:of ([^.,]+))?/.exec(s.slice(head));
  const len = head + (of?.[0].length ?? 0);
  const named = of?.[1]?.trim();
  const id = named ? resolveTokenName(named.replace(/^(?:this minion|a friendly minion|the minion.*)$/, '')) : null;
  return {
    effect: {
      kind: 'copy', copyMode: mode,
      ...(m?.[1] ? { summonCount: countOf(m[1]) } : {}),
      ...(id ? { refId: id } : named ? { refName: named } : {}),
    },
    len,
  };
}

function recGetCard(s: string): Rec | null {
  const m = new RegExp(`^(?:[Gg]ets?|[Aa]dds?)\\s+(${COUNT_RE})\\s+(random\\s+)?([^.]+?)(?:\\s+to your (?:hand|next(?: \\d+)? shops?|next tavern))?\\s*$`).exec(s.split('.')[0] ? s : s);
  const mm = new RegExp(`^(?:[Gg]ets?|[Aa]dds?)\\s+(${COUNT_RE})\\s+(random\\s+)?([A-Za-z][\\w' ]*?)(\\s+to your (?:hand|next(?: \\d+)? shops?|next tavern))?(?=[.,]|$)`).exec(s);
  void m;
  if (!mm) return null;
  const named = mm[3]!.trim();
  const id = resolveTokenName(named);
  return {
    effect: {
      kind: 'get-card', verb: 'get',
      summonCount: countOf(mm[1]!),
      ...(mm[2] ? {} : {}),
      ...(id ? { refId: id } : { refName: named }),
      ...(mm[2] ? { target: { cardinality: 'exactly', count: countOf(mm[1]!), scope: named.toLowerCase(), random: true } } : {}),
    },
    len: mm[0].length,
  };
}

function recCast(s: string): Rec | null {
  const m = /^[Cc]asts?\s+([A-Z][\w' ]*?)(?:\s+(twice|three times|\d+ times))?(?=[.,]|$| on )/.exec(s);
  if (!m) return null;
  const id = resolveTokenName(m[1]!.trim());
  return { effect: { kind: 'cast-spell', verb: 'cast', ...(id ? { refId: id } : { refName: m[1]!.trim() }) }, len: m[0].length };
}

function recDamage(s: string): Rec | null {
  const m = /^[Dd]eals?\s+(?:(\d+) damage|(?:its |this minion's )Attack(?:\s*\+\s*\d+)?)(?:\s+to ([^.,]+))?/.exec(s);
  if (!m) return null;
  return { effect: { kind: 'deal-damage', ...(m[1] ? { amount: { value: Number(m[1]), unit: 'damage' } } : {}) }, len: m[0].length };
}

/** "Your <family> (effects) trigger/cast/proc/fire/magnetize twice | an additional time | N more times" —
 *  the multiplier-print family (the LG-TWICE-01 surface). `value` is the number of EXTRA fires printed. */
function recMultiplierPrint(s: string): Rec | null {
  const m = /^(?:[Yy]our|The next)\s+([\w' ,-]+?)\s+(?:effects?\s+)?(triggers?|procs?|fires?|casts?|magnetizes?)\s+(?:an?\s+)?(twice|three times|additional times?|extra time|(?:one|two|\d+)\s+(?:more|additional)\s+times?)\b/.exec(s);
  if (!m) return null;
  const tail = m[3]!;
  const extra = tail === 'twice' ? 1
    : tail === 'three times' ? 2
      : /^(?:additional|extra)/.test(tail) ? 1
        : (() => { const n = /^(one|two|\d+)/.exec(tail)![1]!; return n === 'one' ? 1 : n === 'two' ? 2 : Number(n); })();
  return {
    effect: {
      kind: 'multiplier-print', verb: m[2]!.toLowerCase().replace(/s$/, ''),
      amount: { value: extra, unit: 'extra-fires' },
      target: { cardinality: 'all', scope: m[1]!.toLowerCase().replace(/\s+/g, '-'), friendly: true },
    },
    len: m[0].length,
  };
}

/** "trigger your left-most Echo (twice)" / "Trigger adjacent minions' Battlecries" — effects that fire
 *  ANOTHER object's trigger. */
function recTriggerOther(s: string): Rec | null {
  const m = /^[Tt]riggers?\s+(?:a|an|your|both|all|its|their|the)?\s*[\w' -]*?(Shouts?|Echo(?:es)?|Deathrattles?|Battlecr(?:y|ies)|Rall(?:y|ies)|End of Turn effects?)\b(?:\s+(?:minion's|minions['’]?)\s+\w+)?(?:\s+twice|\s+\d+ times)?/.exec(s);
  if (!m) return null;
  return { effect: { kind: 'trigger-other', verb: 'trigger', refName: m[1]! }, len: m[0].length };
}

function recAttackNow(s: string): Rec | null {
  const m = /^(?:[Ii]t |[Tt]his minion )?attacks? (?:(?:twice|\d+ times) )?immediately\b(?: at the start of next combat)?/.exec(s);
  if (!m) return null;
  return { effect: { kind: 'attack-immediately' }, len: m[0].length };
}

/** Order matters: copy outranks get-card ("get a copy of …"); grant-keyword after stat-buff (both start
 *  with give/gain — stat wins only when a stat token follows); multiplier-print before trigger-other. */
const RECOGNIZERS: ReadonlyArray<(s: string) => Rec | null> = [
  recKeywordLine, recStatBuff, recGrantKeyword, recCopy, recSummon, recGold, recDiscover,
  recMultiplierPrint, recTriggerOther, recAttackNow, recGetCard, recCast, recDamage,
];

// ── sentence-level modifiers (recorded from anywhere in the sentence; never block consumption) ───────────

const PERSISTENCE_TABLE: ReadonlyArray<readonly [RegExp, ParsedPersistence['kind']]> = [
  [/\bpermanently\b|\bpermanent\b/, 'permanent'],
  [/\bthis turn\b/, 'this-turn'],
  [/\bnext turn\b/, 'next-turn'],
  [/\b(?:for the )?next combat(?: only)?\b/, 'next-combat'],
  [/\bthis combat\b|\bin combat\b/, 'this-combat'],
  [/\b(?:for the rest of the|this|the) (?:run|game)\b/, 'run-wide'],
];

function collectModifiers(sentence: string, base: number, stripped: string, out: {
  limits: ParsedLimit[]; persistence: ParsedPersistence[]; randomness: ParsedRandomness[]; phases: ParsedGamePhase[];
}): void {
  for (const [re, kind] of PERSISTENCE_TABLE) {
    const m = re.exec(sentence);
    if (m) out.persistence.push({ kind, display: m[0], span: span(stripped, base + m.index, base + m.index + m[0].length) });
  }
  const lim = /\bup to (\d+)|\((\d+) max\)|\bonce per (turn|combat|game|run|shop)\b|\b(\d+) times? per combat\b|\bmax (\d+)\b|\b[Tt]he first (\d+)\b/.exec(sentence);
  if (lim) {
    const n = Number(lim[1] ?? lim[2] ?? lim[4] ?? lim[5] ?? lim[6]);
    out.limits.push({
      kind: lim[3] ? 'once-per' : lim[4] ? 'times-per' : lim[6] ? 'first-n' : lim[1] ? 'up-to-n' : 'max-n',
      ...(Number.isFinite(n) ? { n } : {}),
      ...(lim[3] ? { per: lim[3] as ParsedLimit['per'] } : {}),
      span: span(stripped, base + lim.index, base + lim.index + lim[0].length),
    });
  }
  const rnd = /\brandom(?:ly)?\b/i.exec(sentence);
  if (rnd) out.randomness.push({ kind: 'random', span: span(stripped, base + rnd.index, base + rnd.index + rnd[0].length) });
  const choice = /\b(?:Discover|Choose)\b/.exec(sentence);
  if (choice) out.randomness.push({ kind: 'player-choice', span: span(stripped, base + choice.index, base + choice.index + choice[0].length) });
  if (/\bIn combat\b|\bin combat\b|\(shop or combat\)/.test(sentence)) out.phases.push(/\(shop or combat\)/.test(sentence) ? 'both' : 'combat');
  if (/\bin the Shop\b/.test(sentence)) out.phases.push('shop');
}

// ── the parser ───────────────────────────────────────────────────────────────────────────────────────────

/** Split into sentences, tracking offsets into the stripped text. */
function sentences(stripped: string): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  const re = /[^.!]+[.!]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) {
    const text = m[0];
    if (text.trim().length) out.push({ text, start: m.index });
  }
  return out;
}

export function parseObjectText(rawText: string | undefined): ParsedTextContract {
  const stripped = stripMarkers(rawText ?? '').trim();
  const parsed: ParsedTextContract = {
    triggers: [], targets: [], effects: [], amounts: [], limits: [], persistence: [], randomness: [],
    phaseRestrictions: [], unresolvedPhrases: [], keywordLine: [], fullyParsed: true, stripped,
  };
  if (!stripped) return parsed;

  const mods = { limits: parsed.limits, persistence: parsed.persistence, randomness: parsed.randomness, phases: parsed.phaseRestrictions };

  for (const sent of sentences(stripped)) {
    let pos = 0;
    const body = sent.text;
    collectModifiers(body, sent.start, stripped, mods);

    // Optional leading phase gate ("In combat, …").
    const gate = /^In combat,\s*/.exec(body);
    if (gate) pos += gate[0].length;

    // One leading trigger prefix.
    let matchedTrigger = false;
    for (const t of TRIGGER_LEXICON) {
      const m = t.re.exec(body.slice(pos));
      if (!m) continue;
      const events = t.event.split('+');
      for (const ev of events) {
        parsed.triggers.push({
          event: ev, display: t.display,
          ...(m[1] !== undefined ? { threshold: Number(m[1]) } : {}),
          span: span(stripped, sent.start + pos, sent.start + pos + m[0].length),
        });
      }
      pos += m[0].length + (/^\s*/.exec(body.slice(pos + m[0].length))?.[0].length ?? 0);
      matchedTrigger = true;
      break;
    }

    // Or a conditional clause ("When you buy a minion, …").
    if (!matchedTrigger) {
      const cond = /^(When(?:ever)?|After|Each time|Every time)\s+([^,]+),\s*/.exec(body.slice(pos));
      if (cond) {
        let event = 'conditional:unknown';
        for (const [re, ev] of CONDITIONAL_LEXICON) {
          if (re.test(cond[2]!)) { event = ev; break; }
        }
        const trigSpan = span(stripped, sent.start + pos, sent.start + pos + cond[0].length);
        parsed.triggers.push({ event, display: cond[1]!, span: trigSpan });
        if (event === 'conditional:unknown') parsed.unresolvedPhrases.push(trigSpan);
        pos += cond[0].length;
      }
    }

    // Prefix-parse the effect body.
    for (;;) {
      const lead = /^\s*(?:,?\s*(?:and|then|also|or)\s+|[,—]\s*|\.\s*)*/.exec(body.slice(pos));
      if (lead) pos += lead[0].length;
      if (pos >= body.length || /^[.\s]*$/.test(body.slice(pos))) break;
      let hit: Rec | null = null;
      for (const rec of RECOGNIZERS) {
        hit = rec(body.slice(pos));
        if (hit) break;
      }
      if (!hit) {
        // Everything from here to the sentence end is unread — one honest span, verbatim.
        const restText = body.slice(pos).replace(/\s+$/, '');
        parsed.unresolvedPhrases.push(span(stripped, sent.start + pos, sent.start + pos + restText.length));
        break;
      }
      const eff: ParsedEffect = { ...hit.effect, span: span(stripped, sent.start + pos, sent.start + pos + hit.len) };
      parsed.effects.push(eff);
      if (eff.kind === 'keyword-line' && eff.keywords) parsed.keywordLine.push(...eff.keywords);
      if (eff.amount) parsed.amounts.push(eff.amount);
      if (eff.target) parsed.targets.push(eff.target);
      pos += hit.len;
      // Tolerated trailing modifiers already collected sentence-wide; consume the common tails so a
      // recognized effect's known modifier suffix does not read as an unresolved span.
      const tail = /^\s*(?:permanently|this turn|next turn|this run|this game|for the (?:rest of the (?:run|game)|next combat)|next combat only|wherever (?:they are|it is)|in combat|next shop|to your hand|\(\d+ max\)|— up to \d+ \w+ a combat)\b/;
      let tm: RegExpExecArray | null;
      while ((tm = tail.exec(body.slice(pos)))) pos += tm[0].length;
    }
  }

  parsed.fullyParsed = parsed.unresolvedPhrases.length === 0;
  return parsed;
}
