import { actions, structureSystem, useAtlas } from '../atlas/store';
import { titleCase } from '../atlas/util';

export function DetailPanel() {
  const manifest = useAtlas((s) => s.manifest);
  const selected = useAtlas((s) => s.selected);
  const isolated = useAtlas((s) => s.isolated);
  if (!manifest || selected === null) return null;
  const structure = manifest.structures[selected];
  const sys = manifest.systems[structureSystem(manifest, selected)];
  return (
    <section className="card detail" aria-label="Structure details">
      <span className="detail-bar" style={{ background: sys.dot }} />
      <button type="button" className="detail-close" aria-label="Close details" onClick={() => actions.clearSelection()}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      <div className="detail-eyebrow">{sys.label}</div>
      <h2 className="detail-title">{titleCase(structure.name)}</h2>
      <p className="detail-desc">{sys.description}</p>
      <p className="detail-note">System overview · structure identified from source anatomy</p>
      <div className="detail-grid">
        <div>
          <div className="detail-key">Atlas reference</div>
          <div className="detail-val">{structure.fma}</div>
        </div>
        <div>
          <div className="detail-key">Selected pieces</div>
          <div className="detail-val">{structure.pieces.length}</div>
        </div>
      </div>
      <a className="detail-link" href={manifest.source.url} target="_blank" rel="noreferrer">
        View anatomical source
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
      <button type="button" className={`btn-primary ${isolated ? 'is-on' : ''}`} onClick={() => actions.toggleIsolate()}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <span>{isolated ? 'Show everything' : 'Isolate structure'}</span>
        <svg className="btn-chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button type="button" className="btn-text" onClick={() => actions.clearSelection()}>
        Clear selection
      </button>
    </section>
  );
}
