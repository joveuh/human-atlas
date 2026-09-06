import * as THREE from 'three';
import type { Manifest } from './types';

export interface LoadedAtlas {
  manifest: Manifest;
  geometries: THREE.BufferGeometry[]; // one per piece, centred on the piece's bbox centre
  centers: THREE.Vector3[]; // anatomical position of each piece (bbox centre, mm, Y-up)
  diagonals: number[]; // bbox diagonal per piece (mm)
}

async function fetchWithProgress(url: string, onProgress: (f: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) onProgress(received / total);
  }
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}

const yieldToBrowser = () => new Promise<void>((r) => setTimeout(r, 0));

export async function loadAtlas(base: string, onProgress: (f: number) => void): Promise<LoadedAtlas> {
  const manifest = (await (await fetch(`${base}atlas.json`)).json()) as Manifest;
  onProgress(0.02);
  const bin = await fetchWithProgress(`${base}${manifest.bin}`, (f) => onProgress(0.02 + f * 0.78));

  const geometries: THREE.BufferGeometry[] = new Array(manifest.pieces.length);
  const centers: THREE.Vector3[] = new Array(manifest.pieces.length);
  const diagonals: number[] = new Array(manifest.pieces.length);

  for (let i = 0; i < manifest.pieces.length; i++) {
    const p = manifest.pieces[i];
    const [x0, y0, z0, x1, y1, z1] = p.bb;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const cz = (z0 + z1) / 2;
    const ex = x1 - x0;
    const ey = y1 - y0;
    const ez = z1 - z0;
    centers[i] = new THREE.Vector3(cx, cy, cz);
    diagonals[i] = Math.hypot(ex, ey, ez);

    const q = new Uint16Array(bin, p.v[0], p.v[1] * 3);
    const pos = new Float32Array(p.v[1] * 3);
    for (let k = 0; k < pos.length; k += 3) {
      pos[k] = x0 + (q[k] / 65535) * ex - cx;
      pos[k + 1] = y0 + (q[k + 1] / 65535) * ey - cy;
      pos[k + 2] = z0 + (q[k + 2] / 65535) * ez - cz;
    }
    const idx = p.i[2] === 2 ? new Uint16Array(bin, p.i[0], p.i[1]) : new Uint32Array(bin, p.i[0], p.i[1]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), diagonals[i] / 2);
    geometries[i] = g;

    if (i % 120 === 0) {
      onProgress(0.8 + (i / manifest.pieces.length) * 0.2);
      await yieldToBrowser();
    }
  }
  onProgress(1);
  return { manifest, geometries, centers, diagonals };
}
