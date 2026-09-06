import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { LoadedAtlas } from './loader';
import { computeGrid, type GridLayout } from './layout';
import { actions, commands, isPieceVisible, store, type AtlasState, type Command } from './store';
import type { View } from './types';
import { clamp, easeInOutCubic, hash01, smoothstep } from './util';

const FOV = 30;
const NAVY = new THREE.Color('#22313f');

/** The camera frame the inventory grid is laid out in, captured when an explode starts. */
interface GridFrame {
  origin: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  forward: THREE.Vector3;
  dist: number;
  viewW: number;
  viewH: number;
}

interface Tween {
  p0: THREE.Vector3;
  t0: THREE.Vector3;
  p1: THREE.Vector3;
  t1: THREE.Vector3;
  start: number;
  ms: number;
}

export class AtlasScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private root = new THREE.Group();

  private meshes: THREE.Mesh[] = [];
  private baseMats: THREE.MeshStandardMaterial[] = [];
  private hoverMats: THREE.MeshStandardMaterial[] = [];
  private selectedMats: THREE.MeshStandardMaterial[] = [];
  private pickMats: THREE.MeshBasicMaterial[] = [];
  private currentMats: THREE.Material[] = [];

  private pickRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType });
  private pixel = new Uint8Array(4);

  private ring!: THREE.Group;
  private dots!: THREE.Points;
  private dotsMat!: THREE.PointsMaterial;

  private grid!: GridLayout;
  private slotsWorld: THREE.Vector3[] = [];
  private frame: GridFrame = {
    origin: new THREE.Vector3(), right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0),
    forward: new THREE.Vector3(0, 0, -1), dist: 1, viewW: 1, viewH: 1,
  };
  private bodyCenter: THREE.Vector3;
  private bodyTop: number;
  private bodyBottom: number;
  private bodyWidth: number;
  private fitDistance = 3600;

  private stagger: Float32Array;
  private bulge: THREE.Vector3[] = [];
  private explodeShown = 0;
  private explodeFrom = 0;
  private explodeTarget = 0;
  private explodeStart = 0;
  private explodeApplied = -1;
  private wasExploded = false;

  private width = 1;
  private height = 1;
  private raf = 0;
  /** Director mode: the clock is driven by renderAt() instead of requestAnimationFrame (frame-exact capture). */
  private manual = false;
  private vt = 0;
  private tween: Tween | null = null;
  private pointer = { x: 0, y: 0, downX: 0, downY: 0, down: false, moved: false, inside: false };
  private pickDirty = false;
  private prev: AtlasState;
  private disposers: (() => void)[] = [];
  private resizeObs: ResizeObserver;

  constructor(private container: HTMLElement, private atlas: LoadedAtlas) {
    const m = atlas.manifest;
    const [x0, y0, z0, x1, y1, z1] = m.bbox;
    this.bodyTop = y1;
    this.bodyBottom = y0;
    this.bodyWidth = x1 - x0;
    this.bodyCenter = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = 'atlas-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 10, 40000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.9;
    this.controls.minDistance = 150;
    this.controls.maxDistance = 12000;
    this.controls.autoRotateSpeed = 1.2;
    this.controls.addEventListener('start', () => { this.tween = null; });

    this.stagger = new Float32Array(m.pieces.length);
    for (let i = 0; i < m.pieces.length; i++) {
      this.stagger[i] = hash01(i) * 0.45;
      const c = atlas.centers[i];
      const d = new THREE.Vector3(c.x, 0, c.z - this.bodyCenter.z);
      if (d.lengthSq() < 1) d.set(Math.cos(hash01(i + 7) * 6.283), 0, Math.sin(hash01(i + 7) * 6.283));
      d.normalize().multiplyScalar(180 + hash01(i + 13) * 160);
      d.y = (hash01(i + 29) - 0.5) * 120;
      this.bulge.push(d);
    }

    this.buildLights();
    this.buildMaterials();
    this.buildMeshes();
    this.buildStage();
    this.scene.add(this.root);

    this.prev = store.get();
    this.resizeObs = new ResizeObserver(() => this.onResize());
    this.resizeObs.observe(container);
    this.updateViewport();
    this.goToView(this.prev.view, 0);
    this.captureFrame(true);
    this.rebuildGrid();
    this.applyState(this.prev, true);

    this.disposers.push(store.subscribe(() => this.applyState(store.get(), false)));
    this.disposers.push(commands.subscribe((c) => this.onCommand(c)));
    this.bindPointer();
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  // ------------------------------------------------------------------ build
  private buildLights() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0xcfd4da, 1.9);
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(1.5, 2.5, 2.2);
    const fill = new THREE.DirectionalLight(0xdde6f0, 0.8);
    fill.position.set(-2.2, 1.2, -1.2);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6);
    rim.position.set(0.3, 1.5, -3);
    this.scene.add(hemi, key, fill, rim);
  }

  private buildMaterials() {
    for (const s of this.atlas.manifest.systems) {
      const color = new THREE.Color(s.color);
      const base = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0 });
      const hover = base.clone();
      hover.color = color.clone().lerp(new THREE.Color('#ffffff'), 0.28);
      hover.emissive = color.clone().multiplyScalar(0.18);
      const selected = base.clone();
      selected.color = color.clone().lerp(NAVY, 0.22);
      selected.emissive = color.clone().multiplyScalar(0.12);
      this.baseMats.push(base);
      this.hoverMats.push(hover);
      this.selectedMats.push(selected);
    }
  }

  private buildMeshes() {
    const { manifest, geometries, centers } = this.atlas;
    for (let i = 0; i < manifest.pieces.length; i++) {
      const p = manifest.pieces[i];
      const mat = this.baseMats[p.sys];
      const mesh = new THREE.Mesh(geometries[i], mat);
      mesh.position.copy(centers[i]);
      mesh.matrixAutoUpdate = true;
      mesh.frustumCulled = true;
      this.meshes.push(mesh);
      this.currentMats.push(mat);
      const id = i + 1;
      const pm = new THREE.MeshBasicMaterial({ toneMapped: false });
      pm.color.setRGB((id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255, THREE.NoColorSpace);
      this.pickMats.push(pm);
      this.root.add(mesh);
    }
  }

  private buildStage() {
    this.ring = new THREE.Group();
    const mk = (r: number, w: number, opacity: number) => {
      const g = new THREE.RingGeometry(r, r + w, 160);
      const m = new THREE.MeshBasicMaterial({ color: '#c9cfd6', transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, m);
      mesh.rotation.x = -Math.PI / 2;
      return mesh;
    };
    this.ring.add(mk(560, 6, 0.9), mk(690, 3, 0.45));
    this.ring.position.set(this.bodyCenter.x, this.bodyBottom - 4, this.bodyCenter.z);
    this.scene.add(this.ring);

    // Round slot markers: a soft disc sprite, drawn behind the pieces so they only show in empty cells.
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(32, 32, 26, 0, Math.PI * 2);
    ctx.fill();
    const disc = new THREE.CanvasTexture(c);
    this.dotsMat = new THREE.PointsMaterial({ map: disc, size: 5, sizeAttenuation: false, color: '#98a1ab', transparent: true, opacity: 0, alphaTest: 0.4, depthWrite: false });
    this.dots = new THREE.Points(new THREE.BufferGeometry(), this.dotsMat);
    this.dots.frustumCulled = false;
    this.scene.add(this.dots);
  }

  /**
   * Freeze the camera frame the grid lives in. `full` re-reads the camera pose; otherwise only
   * the visible extent is refreshed (viewport resize while already exploded keeps the plane).
   */
  private captureFrame(full: boolean) {
    const f = this.frame;
    if (full) {
      this.camera.updateMatrixWorld();
      f.origin.copy(this.controls.target);
      f.right.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
      f.up.setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
      this.camera.getWorldDirection(f.forward);
      f.dist = Math.max(120, this.camera.position.distanceTo(this.controls.target));
    }
    // Height follows the current zoom so the first row starts at the top of what the viewer sees;
    // width follows the fitted body view so the grid keeps the reference's ~40 columns at any zoom.
    const tanHalf = Math.tan((FOV * Math.PI) / 360);
    f.viewH = 2 * f.dist * tanHalf;
    f.viewW = 2 * this.fitDistance * tanHalf * (this.width / Math.max(1, this.height));
  }

  private rebuildGrid() {
    const f = this.frame;
    // Footprint of every piece along the frame's right/up axes (conservative bbox projection).
    const pieces = this.atlas.manifest.pieces;
    const widths = new Array<number>(pieces.length);
    const heights = new Array<number>(pieces.length);
    for (let i = 0; i < pieces.length; i++) {
      const [x0, y0, z0, x1, y1, z1] = pieces[i].bb;
      const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0;
      widths[i] = Math.abs(f.right.x) * ex + Math.abs(f.right.y) * ey + Math.abs(f.right.z) * ez;
      heights[i] = Math.abs(f.up.x) * ex + Math.abs(f.up.y) * ey + Math.abs(f.up.z) * ez;
    }
    this.grid = computeGrid(widths, heights, this.atlas.diagonals, f.viewW, f.viewH, this.width / Math.max(1, this.height));
    const arr = new Float32Array(this.grid.slots.length * 3);
    this.slotsWorld = this.grid.slots.map((s, i) => {
      const w = f.origin.clone().addScaledVector(f.right, s.x).addScaledVector(f.up, s.y);
      const d = w.clone().addScaledVector(f.forward, 90);
      arr[i * 3] = d.x; arr[i * 3 + 1] = d.y; arr[i * 3 + 2] = d.z;
      return w;
    });
    this.dots.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.dots.geometry = g;
    this.explodeApplied = -1;
  }

  // ------------------------------------------------------------------ sizing
  private onResize() {
    this.updateViewport();
    this.captureFrame(store.get().explode < 0.001);
    this.rebuildGrid();
  }

  private updateViewport() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const tanHalf = Math.tan((FOV * Math.PI) / 360);
    // The reference frames the body at ~69 % of the viewport height, centred at ~42 % from the top.
    const dH = ((this.bodyTop - this.bodyBottom) / 0.69 / 2) / tanHalf;
    const dW = ((this.bodyWidth / 0.8 / 2) / tanHalf) / (w / h);
    this.fitDistance = Math.max(dH, dW);
  }

  // ------------------------------------------------------------------ camera poses
  private viewPose(view: View): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const d = this.fitDistance;
    const viewH = 2 * d * Math.tan((FOV * Math.PI) / 360);
    const c = this.bodyCenter.clone();
    c.y -= viewH * 0.08; // lift the body above the explode card
    const target = c.clone();
    let pos: THREE.Vector3;
    switch (view) {
      case 'back': pos = new THREE.Vector3(c.x, c.y, c.z - d); break;
      case 'side': pos = new THREE.Vector3(c.x + d, c.y, c.z); break;
      case 'three-quarter': pos = new THREE.Vector3(c.x + d * Math.sin(0.72), c.y + d * 0.14, c.z + d * Math.cos(0.72)); break;
      default: pos = new THREE.Vector3(c.x, c.y, c.z + d);
    }
    return { pos, target };
  }

  private gridPose(): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const f = this.frame;
    return { pos: f.origin.clone().addScaledVector(f.forward, -f.dist), target: f.origin.clone() };
  }

  private goToView(view: View, ms: number) {
    const exploded = store.get().explode > 0.001;
    const pose = exploded ? this.gridPose() : this.viewPose(view);
    this.flyTo(pose.pos, pose.target, ms);
  }

  private flyTo(pos: THREE.Vector3, target: THREE.Vector3, ms: number) {
    if (ms <= 0) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.tween = null;
      return;
    }
    this.tween = { p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: pos, t1: target, start: this.now(), ms };
  }

  private focusStructure(index: number) {
    const s = store.get();
    const m = this.atlas.manifest;
    const box = new THREE.Box3();
    for (const i of m.structures[index].pieces) {
      if (!isPieceVisible(s, i)) continue;
      const r = this.atlas.diagonals[i] / 2;
      const p = this.meshes[i].position;
      box.expandByPoint(new THREE.Vector3(p.x - r, p.y - r, p.z - r));
      box.expandByPoint(new THREE.Vector3(p.x + r, p.y + r, p.z + r));
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(70, box.getSize(new THREE.Vector3()).length() / 2);
    const dist = clamp((radius / Math.tan((FOV * Math.PI) / 360)) * 1.35, 260, this.fitDistance * 1.2);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (s.explode > 0.999) dir.copy(this.frame.forward).negate();
    this.flyTo(center.clone().add(dir.multiplyScalar(dist)), center, 750);
  }

  private onCommand(c: Command) {
    if (c.type === 'resetView') {
      this.controls.autoRotate = false;
      this.goToView(store.get().view, 650);
    } else if (c.type === 'flyToView') {
      this.goToView(c.view, 650);
    } else if (c.type === 'focusStructure') {
      this.focusStructure(c.index);
    }
  }

  // ------------------------------------------------------------------ state
  private applyState(s: AtlasState, force: boolean) {
    const p = this.prev;
    if (force || s.systemVisible !== p.systemVisible || s.isolated !== p.isolated || s.selected !== p.selected) {
      for (let i = 0; i < this.meshes.length; i++) this.meshes[i].visible = isPieceVisible(s, i);
    }
    if (force || s.hover !== p.hover || s.selected !== p.selected) {
      const m = this.atlas.manifest;
      const selectedSet = s.selected !== null ? new Set(m.structures[s.selected].pieces) : null;
      for (let i = 0; i < this.meshes.length; i++) {
        const sys = m.pieces[i].sys;
        const mat = i === s.hover ? this.hoverMats[sys] : selectedSet?.has(i) ? this.selectedMats[sys] : this.baseMats[sys];
        if (this.currentMats[i] !== mat) { this.currentMats[i] = mat; this.meshes[i].material = mat; }
      }
      this.container.style.cursor = s.hover !== null ? 'pointer' : '';
    }
    if (force || s.autoRotate !== p.autoRotate) this.controls.autoRotate = s.autoRotate && s.explode < 0.001;
    if (s.explode !== p.explode) {
      const nowExploded = s.explode > 0.001;
      if (nowExploded && !this.wasExploded) {
        // Explode from wherever the viewer is: lay the grid out in the current camera frame.
        this.tween = null;
        this.captureFrame(true);
        this.rebuildGrid();
        this.explodeApplied = -1;
      }
      this.wasExploded = nowExploded;
      this.controls.autoRotate = s.autoRotate && !nowExploded;
    }
    this.prev = s;
  }

  private setInteractionMode(exploded: boolean) {
    const c = this.controls;
    if (exploded) {
      c.enableRotate = false;
      c.screenSpacePanning = true;
      c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    } else {
      c.enableRotate = true;
      c.screenSpacePanning = true;
      c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    }
  }

  private applyExplode(e: number) {
    const { centers } = this.atlas;
    const slots = this.slotsWorld;
    for (let i = 0; i < this.meshes.length; i++) {
      const st = this.stagger[i];
      const t = smoothstep((e - st) / (1 - st));
      const a = centers[i];
      const b = slots[i];
      const bulge = Math.sin(Math.PI * t);
      const bv = this.bulge[i];
      this.meshes[i].position.set(
        a.x + (b.x - a.x) * t + bv.x * bulge,
        a.y + (b.y - a.y) * t + bv.y * bulge,
        a.z + (b.z - a.z) * t + bv.z * bulge,
      );
    }
    const ringOpacity = clamp(1 - e * 2.2, 0, 1);
    this.ring.children.forEach((c, k) => {
      const mat = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = (k === 0 ? 0.9 : 0.45) * ringOpacity;
    });
    this.ring.visible = ringOpacity > 0.01;
    this.dotsMat.opacity = clamp((e - 0.6) / 0.4, 0, 1) * 0.7;
    this.dots.visible = this.dotsMat.opacity > 0.01;
    this.explodeApplied = e;
    this.setInteractionMode(e > 0.999);
  }

  // ------------------------------------------------------------------ picking
  private pick(x: number, y: number): number {
    const dpr = this.renderer.getPixelRatio();
    const W = Math.floor(this.width * dpr);
    const H = Math.floor(this.height * dpr);
    const px = clamp(Math.floor(x * dpr), 0, W - 1);
    const py = clamp(Math.floor(y * dpr), 0, H - 1);
    this.camera.setViewOffset(W, H, px, py, 1, 1);
    for (let i = 0; i < this.meshes.length; i++) if (this.meshes[i].visible) this.meshes[i].material = this.pickMats[i];
    const ringVis = this.ring.visible;
    const dotsVis = this.dots.visible;
    this.ring.visible = false;
    this.dots.visible = false;
    this.renderer.setRenderTarget(this.pickRT);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.readRenderTargetPixels(this.pickRT, 0, 0, 1, 1, this.pixel);
    this.renderer.setRenderTarget(null);
    this.camera.clearViewOffset();
    for (let i = 0; i < this.meshes.length; i++) if (this.meshes[i].visible) this.meshes[i].material = this.currentMats[i];
    this.ring.visible = ringVis;
    this.dots.visible = dotsVis;
    const id = this.pixel[0] + (this.pixel[1] << 8) + (this.pixel[2] << 16);
    return id - 1;
  }

  private bindPointer() {
    const el = this.renderer.domElement;
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onMove = (e: PointerEvent) => {
      const { x, y } = local(e);
      this.pointer.x = x;
      this.pointer.y = y;
      this.pointer.inside = true;
      if (this.pointer.down && Math.hypot(x - this.pointer.downX, y - this.pointer.downY) > 5) this.pointer.moved = true;
      if (e.pointerType === 'mouse') this.pickDirty = !this.pointer.down;
    };
    const onDown = (e: PointerEvent) => {
      const { x, y } = local(e);
      this.pointer.down = true;
      this.pointer.moved = false;
      this.pointer.downX = x;
      this.pointer.downY = y;
    };
    const onUp = (e: PointerEvent) => {
      if (!this.pointer.down) return;
      this.pointer.down = false;
      if (this.pointer.moved) return;
      const { x, y } = local(e);
      const id = this.pick(x, y);
      actions.selectPiece(id >= 0 ? id : null);
      if (e.pointerType !== 'mouse') actions.setHover(id >= 0 ? id : null);
    };
    const onLeave = () => {
      this.pointer.inside = false;
      this.pickDirty = false;
      actions.setHover(null);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    this.disposers.push(() => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
    });
  }

  // ------------------------------------------------------------------ loop
  now(): number {
    return this.manual ? this.vt : performance.now();
  }

  /** Switch to a virtual clock. While on, nothing renders until renderAt() is called. */
  setManualClock(on: boolean) {
    this.manual = on;
    cancelAnimationFrame(this.raf);
    if (!on) this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  /** Render exactly one frame at virtual time `ms` (director mode). */
  renderAt(ms: number) {
    this.vt = ms;
    this.loop(ms);
  }

  /** Screen position (CSS px) of a piece's current centre, or null when off-screen. */
  projectPiece(i: number): { x: number; y: number } | null {
    const m = this.meshes[i];
    if (!m || !m.visible) return null;
    const v = m.position.clone().project(this.camera);
    if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return null;
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  /** The preset pose for a view, for scripted tours. */
  getViewPose(view: View): { position: number[]; target: number[] } {
    const p = this.viewPose(view);
    return { position: p.pos.toArray(), target: p.target.toArray() };
  }

  /** Current camera pose, for scripted tours. */
  getPose() {
    return { position: this.camera.position.toArray(), target: this.controls.target.toArray() };
  }

  /** Fly the camera to a pose over `ms` milliseconds (0 = jump). */
  flyToPose(position: [number, number, number], target: [number, number, number], ms: number) {
    this.flyTo(new THREE.Vector3(...position), new THREE.Vector3(...target), ms);
  }

  private loop(time: number) {
    if (!this.manual) this.raf = requestAnimationFrame((t) => this.loop(t));

    // Time-based follow: converges in 600 ms whatever the frame rate, and restarts smoothly mid-drag.
    const target = store.get().explode;
    if (target !== this.explodeTarget) {
      this.explodeFrom = this.explodeShown;
      this.explodeTarget = target;
      this.explodeStart = time;
    }
    const k = clamp((time - this.explodeStart) / 600, 0, 1);
    const eased = 1 - Math.pow(1 - k, 3);
    this.explodeShown = this.explodeFrom + (this.explodeTarget - this.explodeFrom) * eased;
    if (this.explodeShown !== this.explodeApplied) this.applyExplode(this.explodeShown);

    if (this.tween) {
      const k = easeInOutCubic(clamp((this.now() - this.tween.start) / this.tween.ms, 0, 1));
      this.camera.position.lerpVectors(this.tween.p0, this.tween.p1, k);
      this.controls.target.lerpVectors(this.tween.t0, this.tween.t1, k);
      if (k >= 1) this.tween = null;
    }
    this.controls.update();

    if (this.pickDirty && this.pointer.inside) {
      this.pickDirty = false;
      const id = this.pick(this.pointer.x, this.pointer.y);
      actions.setHover(id >= 0 ? id : null);
    }

    this.renderer.render(this.scene, this.camera);
  }

  get pointerPosition() {
    return { x: this.pointer.x, y: this.pointer.y };
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    for (const d of this.disposers) d();
    this.controls.dispose();
    this.pickRT.dispose();
    for (const g of this.atlas.geometries) g.dispose();
    for (const m of [...this.baseMats, ...this.hoverMats, ...this.selectedMats, ...this.pickMats]) m.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
