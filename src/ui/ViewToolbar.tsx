import { actions, useAtlas } from '../atlas/store';
import type { View } from '../atlas/types';

const VIEWS: { id: View; label: string; title: string }[] = [
  { id: 'three-quarter', label: '¾', title: 'Three-quarter view' },
  { id: 'front', label: 'F', title: 'Front view' },
  { id: 'side', label: 'S', title: 'Side view' },
  { id: 'back', label: 'B', title: 'Back view' },
];

export function ViewToolbar() {
  const view = useAtlas((s) => s.view);
  const autoRotate = useAtlas((s) => s.autoRotate);
  const exploded = useAtlas((s) => s.explode > 0.001);
  return (
    <nav className="card toolbar" aria-label="Camera">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          title={v.title}
          aria-label={v.title}
          aria-pressed={view === v.id}
          className={`tool ${view === v.id ? 'is-active' : ''}`}
          disabled={exploded}
          onClick={() => actions.setView(v.id)}
        >
          {v.label}
        </button>
      ))}
      <span className="tool-divider" />
      <button
        type="button"
        title="Auto-rotate"
        aria-label="Auto-rotate"
        aria-pressed={autoRotate}
        className={`tool tool-icon ${autoRotate ? 'is-on' : ''}`}
        disabled={exploded}
        onClick={() => actions.toggleAutoRotate()}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M20 4v5h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button type="button" title="Reset view" aria-label="Reset view" className="tool tool-icon" onClick={() => actions.resetView()}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M4 12a8 8 0 1 0 2.34-5.66" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M4 4v5h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </nav>
  );
}
