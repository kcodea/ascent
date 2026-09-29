import { useEffect, useMemo, useRef, useState } from 'react';
import { mdBold } from './Card';
import { WIKI_BY_ID, WIKI_ENTRIES, WIKI_TOPICS, searchWiki, type WikiEntry, type WikiTopic } from './rulesWiki';

/**
 * The Compendium's RULES panel (spec docs/superpowers/specs/2026-09-28-rules-wiki-design.md): a searchable,
 * casual Q&A about how the game works. It replaces the book body like the Glossary does. Search box and topic
 * chips on top; questions below, click one to expand its answer. With no search, questions are grouped by topic;
 * while searching, they're a single list ranked by relevance. "See also" jumps to (and opens) a related entry.
 */
/** Only topics with at least one entry get a chip (a lit chip over an empty topic would read as "broken"). */
const LIVE_TOPICS = WIKI_TOPICS.filter((t) => WIKI_ENTRIES.some((e) => e.topic === t.id));

export function CompendiumRules() {
  const [query, setQuery] = useState('');
  const [topics, setTopics] = useState<Set<WikiTopic>>(() => new Set());
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());

  const results = useMemo(() => searchWiki(WIKI_ENTRIES, query, topics), [query, topics]);
  const searching = query.trim() !== '';

  // After a See-also jump, bring the target into view once it has rendered.
  useEffect(() => {
    if (!focusId) return;
    itemRefs.current.get(focusId)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    setFocusId(null);
  }, [focusId]);

  const toggleTopic = (t: WikiTopic): void =>
    setTopics((prev) => { const next = new Set(prev); if (next.has(t)) next.delete(t); else next.add(t); return next; });
  const toggleOpen = (id: string): void =>
    setOpen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const jumpTo = (id: string): void => {
    setQuery('');
    setTopics(new Set());
    setOpen((prev) => new Set(prev).add(id));
    setFocusId(id);
  };

  const item = (e: WikiEntry) => {
    const isOpen = open.has(e.id);
    return (
      <div className={`wiki-item${isOpen ? ' is-open' : ''}`} key={e.id} ref={(el) => { if (el) itemRefs.current.set(e.id, el); else itemRefs.current.delete(e.id); }}>
        <button className="wiki-q" onClick={() => toggleOpen(e.id)} aria-expanded={isOpen}>
          <span className="wiki-caret" aria-hidden="true">{isOpen ? '−' : '+'}</span>
          <span>{e.q}</span>
        </button>
        {isOpen && (
          <div className="wiki-a">
            <div dangerouslySetInnerHTML={{ __html: mdBold(e.a) }} />
            {e.seeAlso && e.seeAlso.length > 0 && (
              <div className="wiki-see">
                <span className="wiki-see-cap">See also</span>
                {e.seeAlso.map((id) => (
                  <button className="wiki-see-link" key={id} onClick={() => jumpTo(id)}>{WIKI_BY_ID[id]?.q}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="wiki-body">
      <div className="wiki-bar">
        <input
          className="wiki-search"
          type="search"
          autoFocus
          placeholder="Ask anything… (sell, who attacks first, Ward)"
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
          aria-label="Search the rules"
        />
        <div className="wiki-chips" role="group" aria-label="Topics">
          {LIVE_TOPICS.map((t) => (
            <button key={t.id} className={`wiki-chip${topics.has(t.id) ? ' on' : ''}`} onClick={() => toggleTopic(t.id)} aria-pressed={topics.has(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="wiki-list">
        {results.length === 0 ? (
          <div className="book-empty wiki-empty">Nothing matches “{query.trim()}”. Try fewer words, or one of the topics above.</div>
        ) : searching ? (
          <section className="wiki-group">
            <h3 className="wiki-grouphead">{results.length} answer{results.length === 1 ? '' : 's'}</h3>
            {results.map(item)}
          </section>
        ) : (
          WIKI_TOPICS.map((t) => {
            const inTopic = results.filter((e) => e.topic === t.id);
            if (inTopic.length === 0) return null;
            return (
              <section className="wiki-group" key={t.id}>
                <h3 className="wiki-grouphead">{t.label}</h3>
                {inTopic.map(item)}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
