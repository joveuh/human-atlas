import { useMemo } from 'react';
import { actions, countVisible, useAtlas } from '../atlas/store';
import type { Tab } from '../atlas/types';
import { fmt } from '../atlas/util';

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'skeleton', label: 'Skeleton' },
  { id: 'organs', label: 'Organs' },
];

export function SystemsPanel() {
  const manifest = useAtlas((s) => s.manifest);
  const visible = useAtlas((s) => s.systemVisible);
  const tab = useAtlas((s) => s.tab);
  const visibleCount = useAtlas(countVisible);
  const panelOpen = useAtlas((s) => s.panelOpen);

  const counts = useMemo(() => {
    if (!manifest) return [];
    const c = manifest.systems.map(() => 0);
    for (const p of manifest.pieces) c[p.sys]++;
    return c;
  }, [manifest]);

  if (!manifest) return null;
  const anyOn = visible.some(Boolean);
  const rows = manifest.systems.map((s, i) => ({ s, i })).filter(({ s }) => tab === 'all' || s.group === tab);

  return (
    <aside className={`card systems ${panelOpen ? 'is-open' : ''}`} aria-label="Body systems">
      <div className="systems-head">
        <h2>Systems</h2>
        <span className="badge">{manifest.systems.length}</span>
        <button className="sheet-close" type="button" aria-label="Close systems" onClick={() => actions.setPanelOpen(false)}>×</button>
      </div>
      <div className="segmented" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} className={tab === t.id ? 'is-active' : ''} onClick={() => actions.setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <ul className="systems-list">
        {rows.map(({ s, i }) => (
          <li key={s.id} className="system-row">
            <span className="system-dot" style={{ background: s.dot }} />
            <span className="system-label">{s.label}</span>
            <span className="system-count">{fmt(counts[i])}</span>
            <button
              type="button"
              role="switch"
              aria-checked={visible[i]}
              aria-label={`${visible[i] ? 'Hide' : 'Show'} ${s.label}`}
              className={`toggle ${visible[i] ? 'is-on' : ''}`}
              onClick={() => actions.toggleSystem(i)}
            >
              <span className="toggle-knob" />
            </button>
          </li>
        ))}
      </ul>
      <div className="systems-foot">
        <span>{fmt(visibleCount)} pieces visible</span>
        <button type="button" className="link-btn" onClick={() => actions.setAllSystems(!anyOn)}>
          {anyOn ? 'Hide all' : 'Show all'}
        </button>
      </div>
    </aside>
  );
}
