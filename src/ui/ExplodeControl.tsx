import { actions, useAtlas } from '../atlas/store';

export function StageCaption() {
  const explode = useAtlas((s) => s.explode);
  const text = explode <= 0.001 ? 'Adult human · Male' : explode >= 0.999 ? 'Anatomical inventory' : 'Separated structures';
  return (
    <div className="stage-caption" aria-live="polite">
      <span className="caption-line" />
      <span className="caption-text">{text}</span>
      <span className="caption-line" />
    </div>
  );
}

export function ExplodeControl() {
  const explode = useAtlas((s) => s.explode);
  const pct = Math.round(explode * 100);
  return (
    <div className="card explode">
      <div className="explode-main">
        <div className="explode-head">
          <span className="explode-title">Explode anatomy</span>
          <span className="explode-value">
            {pct} <small>%</small>
          </span>
        </div>
        <input
          className="explode-slider"
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          aria-label="Explode anatomy"
          aria-valuetext={`${pct} percent`}
          onChange={(e) => actions.setExplode(Number(e.target.value) / 100)}
          style={{ ['--fill' as string]: `${pct}%` }}
        />
        <div className="explode-labels">
          <span>Assembled</span>
          <span>Every piece</span>
        </div>
      </div>
      <span className="explode-divider" />
      <button
        type="button"
        className="explode-reset"
        onClick={() => {
          actions.setExplode(0);
          actions.resetView();
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M4 12a8 8 0 1 0 2.34-5.66" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M4 4v5h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Reset</span>
      </button>
    </div>
  );
}
