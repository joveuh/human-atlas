export type SystemGroup = 'skeleton' | 'organs';

export interface SystemMeta {
  id: string;
  label: string;
  group: SystemGroup;
  color: string;
  dot: string;
  hidden?: boolean;
  description: string;
}

export interface PieceMeta {
  id: string;
  fma: string;
  name: string;
  sys: number;
  struct: number;
  v: [number, number];
  i: [number, number, number];
  bb: [number, number, number, number, number, number];
}

export interface StructureMeta {
  fma: string;
  name: string;
  pieces: number[];
}

export interface Manifest {
  version: number;
  generated: string;
  units: 'mm';
  bbox: [number, number, number, number, number, number];
  bin: string;
  binBytes: number;
  source: { name: string; attribution: string; license: string; url: string; dataset: string };
  systems: SystemMeta[];
  pieces: PieceMeta[];
  structures: StructureMeta[];
}

export type View = 'three-quarter' | 'front' | 'side' | 'back';
export type Tab = 'all' | 'skeleton' | 'organs';
