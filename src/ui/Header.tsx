import { actions, useAtlas } from '../atlas/store';
import { fmt } from '../atlas/util';

export function Header() {
  const count = useAtlas((s) => s.manifest?.pieces.length ?? 0);
  const panelOpen = useAtlas((s) => s.panelOpen);
  return (
    <header className="header">
      <div className="eyebrow"><span className="eyebrow-dot" />Interactive anatomy</div>
      <h1 className="title">
        Human Atlas <span className="chip">3D</span>
      </h1>
      <div className="subline">
        {count ? `${fmt(count)} modeled pieces` : 'Loading pieces'} <span className="dot-sep">·</span> BodyParts3D
      </div>
      <button className="panel-toggle" type="button" onClick={() => actions.setPanelOpen(!panelOpen)} aria-expanded={panelOpen}>
        Systems
      </button>
    </header>
  );
}
