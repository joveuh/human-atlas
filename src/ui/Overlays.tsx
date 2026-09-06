import { useEffect, useLayoutEffect, useRef } from 'react';
import { actions, useAtlas } from '../atlas/store';
import { fmt, titleCase } from '../atlas/util';

const lastPointer = { x: 0, y: 0 };
window.addEventListener('pointermove', (e) => { lastPointer.x = e.clientX; lastPointer.y = e.clientY; }, { passive: true });

function placeTooltip(el: HTMLDivElement, cx: number, cy: number) {
  const pad = 16;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let x = cx + pad;
  let y = cy + pad + 4;
  if (x + w > window.innerWidth - 12) x = cx - w - pad;
  if (y + h > window.innerHeight - 12) y = cy - h - pad;
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

export function Tooltip() {
  const manifest = useAtlas((s) => s.manifest);
  const hover = useAtlas((s) => s.hover);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) placeTooltip(ref.current, lastPointer.x, lastPointer.y);
  }, [hover]);
  useEffect(() => {
    const onMove = (e: PointerEvent) => { if (ref.current) placeTooltip(ref.current, e.clientX, e.clientY); };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  if (!manifest || hover === null) return null;
  return (
    <div ref={ref} className="tooltip" role="status">
      {titleCase(manifest.pieces[hover].name)}
    </div>
  );
}

export function HintBar() {
  const exploded = useAtlas((s) => s.explode >= 0.999);
  const url = useAtlas((s) => s.manifest?.source.url ?? '#');
  return (
    <>
      <div className="hints">
        <span>{exploded ? 'Drag to pan' : 'Drag to orbit'}</span>
        <span className="dot-sep">·</span>
        <span>Pinch to zoom</span>
        <span className="dot-sep">·</span>
        <span>Tap to inspect</span>
      </div>
      <a className="credits" href={url} target="_blank" rel="noreferrer">
        Source &amp; credits
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
    </>
  );
}

export function InfoButton() {
  return (
    <button type="button" className="card info-btn" aria-label="About this atlas" onClick={() => actions.setInfoOpen(true)}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M12 11v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="8" r="1.1" fill="currentColor" />
      </svg>
    </button>
  );
}

export function InfoDialog() {
  const open = useAtlas((s) => s.infoOpen);
  const manifest = useAtlas((s) => s.manifest);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') actions.setInfoOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open || !manifest) return null;
  return (
    <div className="modal-backdrop" onClick={() => actions.setInfoOpen(false)}>
      <div className="card modal" role="dialog" aria-modal="true" aria-labelledby="info-title" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="detail-close" aria-label="Close" onClick={() => actions.setInfoOpen(false)}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <div className="detail-eyebrow">About</div>
        <h2 id="info-title" className="detail-title">Human Atlas</h2>
        <p className="detail-desc">
          An interactive atlas of the adult male human body built from {fmt(manifest.pieces.length)} modeled pieces.
          Toggle body systems, explode the body into a sorted inventory of every piece, and tap any piece to read
          what it is.
        </p>
        <h3 className="modal-h3">Controls</h3>
        <ul className="modal-list">
          <li>Drag to orbit, scroll or pinch to zoom, right-drag to pan.</li>
          <li>Hover a piece for its name; tap it for details and to isolate it.</li>
          <li>Press <kbd>/</kbd> to search for a structure, <kbd>Esc</kbd> to close.</li>
          <li>At 100 % explode the view switches to a flat inventory you can pan through.</li>
        </ul>
        <h3 className="modal-h3">Source &amp; licence</h3>
        <p className="detail-desc">
          Geometry: <a href={manifest.source.url} target="_blank" rel="noreferrer">{manifest.source.name}</a>{' '}
          ({manifest.source.dataset}). {manifest.source.attribution}. Derived data in this atlas is shared under the
          same licence.
        </p>
      </div>
    </div>
  );
}

export function LoadingOverlay() {
  const status = useAtlas((s) => s.status);
  const progress = useAtlas((s) => s.progress);
  const error = useAtlas((s) => s.error);
  if (status === 'ready') return null;
  return (
    <div className="loading">
      <div className="card loading-card" role="status" aria-live="polite">
        <div className="eyebrow"><span className="eyebrow-dot" />Interactive anatomy</div>
        {status === 'error' ? (
          <>
            <div className="loading-title">The atlas data is missing.</div>
            <p className="detail-desc">Run <code>npm run data</code> once to build it, then reload.</p>
            <p className="detail-note">{error}</p>
          </>
        ) : (
          <>
            <div className="loading-title">Loading the atlas</div>
            <div className="progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <div className="detail-note">{progress < 0.8 ? 'Downloading pieces' : 'Building geometry'} · {Math.round(progress * 100)} %</div>
          </>
        )}
      </div>
    </div>
  );
}
