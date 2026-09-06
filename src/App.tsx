import { useEffect, useRef } from 'react';
import { loadAtlas, type LoadedAtlas } from './atlas/loader';
import { AtlasScene } from './atlas/scene';
import { actions, store, useAtlas, commands } from './atlas/store';
import { DetailPanel } from './ui/DetailPanel';
import { ExplodeControl, StageCaption } from './ui/ExplodeControl';
import { Header } from './ui/Header';
import { HintBar, InfoButton, InfoDialog, LoadingOverlay, Tooltip } from './ui/Overlays';
import { SearchBox } from './ui/SearchBox';
import { SystemsPanel } from './ui/SystemsPanel';
import { ViewToolbar } from './ui/ViewToolbar';

let loadPromise: Promise<LoadedAtlas> | null = null;
function loadOnce() {
  if (!loadPromise) loadPromise = loadAtlas(`${import.meta.env.BASE_URL}data/`, (f) => store.set({ progress: f }));
  return loadPromise;
}

export default function App() {
  const status = useAtlas((s) => s.status);
  const stageRef = useRef<HTMLDivElement>(null);
  const atlasRef = useRef<LoadedAtlas | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadOnce()
      .then((a) => {
        if (cancelled) return;
        atlasRef.current = a;
        store.set({ manifest: a.manifest, systemVisible: a.manifest.systems.map((s) => !s.hidden), status: 'ready' });
      })
      .catch((e: unknown) => {
        if (!cancelled) store.set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (status !== 'ready' || !stageRef.current || !atlasRef.current) return;
    const scene = new AtlasScene(stageRef.current, atlasRef.current);
    if (import.meta.env.DEV) (window as unknown as { __atlas?: unknown }).__atlas = { scene, store, actions, commands };
    return () => scene.dispose();
  }, [status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const s = store.get();
      if (s.infoOpen) return; // the dialog handles its own Escape
      if (s.searchOpen) return actions.setSearchOpen(false);
      if (s.panelOpen) return actions.setPanelOpen(false);
      if (s.selected !== null) actions.clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <div ref={stageRef} className="stage" />
      <div className="hud">
        <Header />
        <div className="topbar">
          <SearchBox />
          <InfoButton />
        </div>
        <SystemsPanel />
        <ViewToolbar />
        <DetailPanel />
        <StageCaption />
        <ExplodeControl />
        <HintBar />
      </div>
      <Tooltip />
      <InfoDialog />
      <LoadingOverlay />
    </div>
  );
}
