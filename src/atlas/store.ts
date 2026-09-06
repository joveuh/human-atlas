import { useSyncExternalStore } from 'react';
import type { Manifest, Tab, View } from './types';

export interface AtlasState {
  status: 'loading' | 'ready' | 'error';
  progress: number; // 0..1 while loading
  error: string | null;
  manifest: Manifest | null;
  systemVisible: boolean[];
  explode: number; // 0..1
  hover: number | null; // piece index
  selected: number | null; // structure index
  isolated: boolean;
  view: View;
  autoRotate: boolean;
  tab: Tab;
  query: string;
  searchOpen: boolean;
  infoOpen: boolean;
  panelOpen: boolean; // systems panel on small screens
}

const initial: AtlasState = {
  status: 'loading',
  progress: 0,
  error: null,
  manifest: null,
  systemVisible: [],
  explode: 0,
  hover: null,
  selected: null,
  isolated: false,
  view: 'front',
  autoRotate: false,
  tab: 'all',
  query: '',
  searchOpen: false,
  infoOpen: false,
  panelOpen: false,
};

type Listener = () => void;
type Patch = Partial<AtlasState> | ((s: AtlasState) => Partial<AtlasState>);

let state: AtlasState = initial;
const listeners = new Set<Listener>();

export const store = {
  get: () => state,
  set(patch: Patch) {
    const p = typeof patch === 'function' ? patch(state) : patch;
    state = { ...state, ...p };
    for (const l of listeners) l();
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useAtlas<T>(selector: (s: AtlasState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}

// ---------------------------------------------------------------- commands (UI → scene, imperative)
export type Command =
  | { type: 'resetView' }
  | { type: 'focusStructure'; index: number }
  | { type: 'flyToView'; view: View };

const commandListeners = new Set<(c: Command) => void>();
export const commands = {
  send(c: Command) {
    for (const l of commandListeners) l(c);
  },
  subscribe(l: (c: Command) => void) {
    commandListeners.add(l);
    return () => {
      commandListeners.delete(l);
    };
  },
};

// ---------------------------------------------------------------- derived helpers
export function isPieceVisible(s: AtlasState, pieceIndex: number): boolean {
  const m = s.manifest;
  if (!m) return false;
  const p = m.pieces[pieceIndex];
  if (!s.systemVisible[p.sys]) return false;
  if (s.isolated && s.selected !== null) return m.structures[s.selected].pieces.includes(pieceIndex);
  return true;
}

export function countVisible(s: AtlasState): number {
  const m = s.manifest;
  if (!m) return 0;
  if (s.isolated && s.selected !== null) {
    return m.structures[s.selected].pieces.filter((i) => s.systemVisible[m.pieces[i].sys]).length;
  }
  let n = 0;
  for (const p of m.pieces) if (s.systemVisible[p.sys]) n++;
  return n;
}

/** Majority system of a structure's pieces. */
export function structureSystem(m: Manifest, structIndex: number): number {
  const counts = new Map<number, number>();
  for (const i of m.structures[structIndex].pieces) counts.set(m.pieces[i].sys, (counts.get(m.pieces[i].sys) || 0) + 1);
  let best = 0;
  let bestN = -1;
  for (const [sys, n] of counts) if (n > bestN) { best = sys; bestN = n; }
  return best;
}

// ---------------------------------------------------------------- actions
export const actions = {
  toggleSystem(i: number) {
    store.set((s) => {
      const v = s.systemVisible.slice();
      v[i] = !v[i];
      return { systemVisible: v };
    });
  },
  setAllSystems(on: boolean) {
    store.set((s) => ({ systemVisible: s.systemVisible.map(() => on) }));
  },
  setExplode(v: number) {
    store.set({ explode: Math.min(1, Math.max(0, v)) });
  },
  setHover(i: number | null) {
    if (store.get().hover !== i) store.set({ hover: i });
  },
  selectPiece(i: number | null) {
    if (i === null) return actions.clearSelection();
    const m = store.get().manifest;
    if (!m) return;
    store.set({ selected: m.pieces[i].struct, isolated: false });
  },
  selectStructure(index: number, focus = true) {
    store.set({ selected: index, isolated: false, searchOpen: false, query: '' });
    if (focus) commands.send({ type: 'focusStructure', index });
  },
  clearSelection() {
    store.set({ selected: null, isolated: false });
  },
  toggleIsolate() {
    store.set((s) => ({ isolated: s.selected !== null ? !s.isolated : false }));
  },
  setView(view: View) {
    store.set({ view });
    commands.send({ type: 'flyToView', view });
  },
  resetView() {
    commands.send({ type: 'resetView' });
  },
  toggleAutoRotate() {
    store.set((s) => ({ autoRotate: !s.autoRotate }));
  },
  setTab(tab: Tab) {
    store.set({ tab });
  },
  setQuery(query: string) {
    store.set({ query, searchOpen: query.trim().length > 0 });
  },
  setSearchOpen(open: boolean) {
    store.set({ searchOpen: open });
  },
  setInfoOpen(open: boolean) {
    store.set({ infoOpen: open });
  },
  setPanelOpen(open: boolean) {
    store.set({ panelOpen: open });
  },
};
