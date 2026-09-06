import { useEffect, useMemo, useRef, useState } from 'react';
import { actions, useAtlas } from '../atlas/store';
import { titleCase } from '../atlas/util';

interface Hit { index: number; name: string; sys: number; pieces: number }

export function SearchBox() {
  const manifest = useAtlas((s) => s.manifest);
  const query = useAtlas((s) => s.query);
  const open = useAtlas((s) => s.searchOpen);
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);

  const hits = useMemo<Hit[]>(() => {
    if (!manifest) return [];
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const scored: { h: Hit; score: number }[] = [];
    for (let i = 0; i < manifest.structures.length; i++) {
      const s = manifest.structures[i];
      const n = s.name;
      const at = n.indexOf(q);
      if (at < 0) continue;
      const wordStart = at === 0 || n[at - 1] === ' ';
      const score = (at === 0 ? 0 : wordStart ? 1 : 2) * 1000 + Math.min(999, n.length + s.pieces.length);
      scored.push({ h: { index: i, name: n, sys: manifest.pieces[s.pieces[0]].sys, pieces: s.pieces.length }, score });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, 8).map((x) => x.h);
  }, [manifest, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if (e.key === '/' && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const choose = (h: Hit) => {
    actions.selectStructure(h.index, true);
    inputRef.current?.blur();
  };

  return (
    <div className="search" role="combobox" aria-expanded={open && hits.length > 0} aria-haspopup="listbox">
      <svg className="search-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        className="search-input"
        placeholder="Find a structure"
        value={query}
        aria-label="Find a structure"
        onChange={(e) => actions.setQuery(e.target.value)}
        onFocus={() => query.trim() && actions.setSearchOpen(true)}
        onBlur={() => setTimeout(() => actions.setSearchOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter' && hits[active]) { e.preventDefault(); choose(hits[active]); }
          else if (e.key === 'Escape') { actions.setQuery(''); inputRef.current?.blur(); }
        }}
      />
      <kbd className="search-kbd">/</kbd>
      {open && hits.length > 0 && manifest && (
        <ul className="search-results" role="listbox">
          {hits.map((h, i) => (
            <li
              key={h.index}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : ''}
              onMouseDown={(e) => { e.preventDefault(); choose(h); }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="result-dot" style={{ background: manifest.systems[h.sys].dot }} />
              <span className="result-name">{titleCase(h.name)}</span>
              <span className="result-meta">
                {manifest.systems[h.sys].label}
                {h.pieces > 1 ? ` · ${h.pieces} pieces` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim().length >= 2 && hits.length === 0 && (
        <div className="search-results search-empty">No structure matches “{query.trim()}”.</div>
      )}
    </div>
  );
}
