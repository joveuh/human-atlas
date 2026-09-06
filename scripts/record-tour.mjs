#!/usr/bin/env node
/**
 * Records a deterministic, frame-exact tour of the running app (npm run dev on :5178)
 * by driving the scene's director clock: every frame is rendered at an exact virtual
 * time, screenshotted, then encoded with ffmpeg. Output: videos/footage/tour.mp4
 *
 *   node scripts/record-tour.mjs [--fps 30] [--size 1080] [--headed] [--out videos/footage]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FPS = Number(arg('--fps', 30));
const SIZE = Number(arg('--size', 1080));
const HEADED = process.argv.includes('--headed');
const OUT = path.resolve(arg('--out', 'videos/footage'));
const URL = arg('--url', 'http://localhost:5178/');
const FRAMES = path.join(OUT, 'frames');
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

const browser = await chromium.launch({
  channel: 'chrome',
  headless: !HEADED,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=metal', '--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('[page error]', e.message));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__atlas && window.__atlas.store.get().status === 'ready', null, { timeout: 120000 });
await page.waitForTimeout(500);

// ---- director helpers (run in page)
const ev = (fn, ...args) => page.evaluate(fn, ...args);
await ev(() => { window.__atlas.scene.setManualClock(true); });
const renderAt = (ms) => ev((t) => window.__atlas.scene.renderAt(t), ms);
const act = (name, ...args) => ev(([n, a]) => window.__atlas.actions[n](...a), [name, args]);
const project = (i) => ev((k) => window.__atlas.scene.projectPiece(k), i);
const viewPose = (v) => ev((k) => window.__atlas.scene.getViewPose(k), v);
const flyTo = (pose, ms) => ev(([p, m]) => window.__atlas.scene.flyToPose(p.position, p.target, m), [pose, ms]);
const jumpTo = (pose) => ev((p) => window.__atlas.scene.flyToPose(p.position, p.target, 0), pose);

const parkMouse = () => page.mouse.move(Math.round(SIZE * 0.86), 80); // inside the search pill: a HUD element, never the canvas
await parkMouse();

// ---- the tour, as timed cues (seconds) and per-frame continuous values
const T = {
  heroEnd: 6.0,
  togglesEnd: 11.0,
  explodeStart: 11.0, explodeEnd: 15.0, explodeHold: 17.0,
  hoverAt: 17.6, clickAt: 19.2, isolateAt: 21.6, showAllAt: 23.4,
  implodeStart: 24.0, implodeEnd: 26.0,
  slashAt: 26.4, typeStart: 26.7, typeEnd: 28.4, enterAt: 28.8, isolate2At: 31.4, clear2At: 33.4,
  quarterAt: 33.6, end: 38.0,
};
const TOTAL = Math.round(T.end * FPS);
const QUERY = 'left kidney';

const cues = []; // { at, run }
const cue = (at, run) => cues.push({ at, run });

// Beat 1 — hero orbit ¾ → front over 5.5 s.
const front = await viewPose('front');
const quarter = await viewPose('three-quarter');
await jumpTo(quarter);
cue(0.3, () => flyTo(front, (T.heroEnd - 0.5) * 1000));

// Beat 2 — system toggles: muscles, arteries, veins off; all back on.
const sysIndex = await ev(() => Object.fromEntries(window.__atlas.store.get().manifest.systems.map((s, i) => [s.id, i])));
cue(6.6, () => act('toggleSystem', sysIndex.muscles));
cue(7.6, () => act('toggleSystem', sysIndex.arteries));
cue(8.6, () => act('toggleSystem', sysIndex.veins));
cue(10.4, () => act('toggleSystem', sysIndex.muscles));
cue(10.6, () => act('toggleSystem', sysIndex.arteries));
cue(10.8, () => act('toggleSystem', sysIndex.veins));

// Beat 3 — explode ramp handled per frame (continuous); once the grid settles, dolly out to reveal more rows.
const wheel = (dy) => ev((d) => { document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel', { deltaY: d, clientX: 540, clientY: 400, bubbles: true, cancelable: true })); }, dy);
for (const at of [15.3, 15.55, 15.8, 16.05, 16.3, 16.55]) cue(at, () => wheel(180));
// Beat 4 — hover, click, isolate.
// Candidate pieces on screen near the centre of the exploded view: compact muscles/bones first
// (a thin vessel's bounding-box centre is empty space, so a hover there picks nothing).
const visibleCandidates = () => ev((S) => {
  const { store, scene } = window.__atlas;
  const m = store.get().manifest;
  const solid = new Set(['muscles', 'skeleton', 'digestive', 'urinary', 'brain', 'heart', 'respiratory']);
  const out = [];
  for (let i = 0; i < m.pieces.length; i++) {
    const p = m.pieces[i];
    if (!solid.has(m.systems[p.sys].id)) continue;
    const [x0, y0, z0, x1, y1, z1] = p.bb;
    const ex = [x1 - x0, y1 - y0, z1 - z0].sort((a, b) => b - a);
    if (ex[0] / Math.max(1, ex[1]) > 7) continue; // too elongated
    const pt = scene.projectPiece(i);
    if (pt && pt.x > S * 0.25 && pt.x < S * 0.75 && pt.y > S * 0.18 && pt.y < S * 0.7) out.push({ i, pt, d: Math.hypot(...ex), name: p.name });
  }
  return out.sort((a, b) => b.d - a.d).slice(0, 12);
}, SIZE);
const hoveredPiece = () => ev(() => window.__atlas.store.get().hover);
let hoverPt = null;
cue(T.hoverAt - 0.6, async () => {
  const cands = await visibleCandidates();
  const tNow = Math.round((T.hoverAt - 0.6) * 1000);
  for (const c of cands) {
    await page.mouse.move(c.pt.x, c.pt.y, { steps: 2 });
    await renderAt(tNow);
    const h = await hoveredPiece();
    if (h === c.i) { hoverPt = c.pt; console.log('[tour] hover target:', c.name); break; }
  }
  if (!hoverPt) console.log('[tour] no hoverable piece found among', cands.length, 'candidates');
  await parkMouse(); // park until the real hover cue
  await renderAt(tNow);
});
cue(T.hoverAt, async () => { if (hoverPt) await page.mouse.move(hoverPt.x, hoverPt.y, { steps: 6 }); });
cue(T.clickAt, async () => { if (hoverPt) { await page.mouse.down(); await page.mouse.up(); } });
const clickIf = async (sel) => { try { await page.click(sel, { timeout: 1500 }); } catch { console.log('[tour] no', sel, 'to click'); } };
cue(T.isolateAt, async () => { await clickIf('.btn-primary'); await parkMouse(); });
cue(T.showAllAt, async () => { await clickIf('.btn-primary'); await parkMouse(); });
cue(T.showAllAt + 0.3, () => act('clearSelection'));

// Beat 5 — implode per frame. Beat 6 — search.
cue(T.slashAt, () => page.keyboard.press('/'));
cue(T.enterAt, () => page.keyboard.press('Enter'));
cue(T.isolate2At, async () => { await clickIf('.btn-primary'); await parkMouse(); });
cue(T.clear2At, async () => { await clickIf('.btn-primary'); await clickIf('.btn-text'); await parkMouse(); });
cue(T.quarterAt, () => act('setView', 'three-quarter'));
cue(T.quarterAt + 0.8, () => act('toggleAutoRotate'));

// typing, one char per cue
for (let i = 0; i < QUERY.length; i++) {
  const at = T.typeStart + ((T.typeEnd - T.typeStart) * i) / (QUERY.length - 1);
  cue(at, () => page.keyboard.type(QUERY[i]));
}
cues.sort((a, b) => a.at - b.at);

// ---- run
console.log(`[tour] ${TOTAL} frames @ ${FPS} fps, ${SIZE}x${SIZE}, ${HEADED ? 'headed' : 'headless'}`);
const t0 = Date.now();
let ci = 0;
let lastExplode = -1;
for (let f = 0; f < TOTAL; f++) {
  const t = f / FPS;
  while (ci < cues.length && cues[ci].at <= t) { await cues[ci].run(); ci++; }
  // continuous: explode ramps
  let e = 0;
  if (t >= T.explodeStart && t < T.implodeStart) e = ease(clamp01((t - T.explodeStart) / (T.explodeEnd - T.explodeStart)));
  else if (t >= T.implodeStart) e = 1 - ease(clamp01((t - T.implodeStart) / (T.implodeEnd - T.implodeStart)));
  if (e !== lastExplode) { await act('setExplode', e); lastExplode = e; }
  await renderAt(Math.round(t * 1000));
  await page.screenshot({ path: path.join(FRAMES, `f${String(f).padStart(5, '0')}.png`), type: 'png', animations: 'disabled', caret: 'hide' });
  if (f % 30 === 0) {
    const el = (Date.now() - t0) / 1000;
    console.log(`[tour] ${t.toFixed(1)}s  frame ${f}/${TOTAL}  ${(el / (f + 1) * 1000).toFixed(0)} ms/frame  eta ${((TOTAL - f) * el / (f + 1)).toFixed(0)}s`);
  }
}
await browser.close();

const mp4 = path.join(OUT, 'tour.mp4');
execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', path.join(FRAMES, 'f%05d.png'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
console.log(`[tour] wrote ${mp4} (${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
