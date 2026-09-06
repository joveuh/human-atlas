#!/usr/bin/env node
/**
 * Builds public/data/atlas.json + public/data/atlas.bin from BodyParts3D.
 *
 * Source: BodyParts3D, (c) The Database Center for Life Science,
 * licensed under CC Attribution-Share Alike 2.1 Japan.
 * https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html
 *
 * Steps
 *   1. download the six hierarchy tables + the IS-A 99%-reduced OBJ zip into .cache/bp3d
 *   2. resolve every element file (FJxxxx.obj) to its leaf FMA concept
 *   3. classify each piece into one of 15 body systems (ordered regex rules over its
 *      IS-A ancestors, PART-OF ancestors and its own name)
 *   4. parse, rotate to Y-up, simplify (meshoptimizer), quantize to uint16, pack
 *
 * Flags
 *   --stats   classification report only (no mesh work)
 *   --force   ignore the cached outputs and rebuild
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MeshoptSimplifier } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.cache', 'bp3d');
const OUT = path.join(ROOT, 'public', 'data');
const BASE = 'https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/';
const LISTS = [
  'isa_parts_list_e.txt',
  'isa_inclusion_relation_list.txt',
  'isa_element_parts.txt',
  'partof_parts_list_e.txt',
  'partof_inclusion_relation_list.txt',
  'partof_element_parts.txt',
];
const ZIP = 'isa_BP3D_4.0_obj_99.zip';
const OBJ_DIR = path.join(CACHE, 'isa_BP3D_4.0_obj_99');
const STATS_ONLY = process.argv.includes('--stats');

// ---------------------------------------------------------------- systems
// Order here is the display order. `group` feeds the All / Skeleton / Organs tabs.
export const SYSTEMS = [
  { id: 'skeleton', label: 'Skeleton', group: 'skeleton', color: '#e4dbc3', dot: '#d3c48f',
    description: 'Bones form the supporting framework of the body, protect organs, and provide attachment points for muscles. Their internal tissue also stores minerals and produces blood cells.' },
  { id: 'muscles', label: 'Muscles', group: 'organs', color: '#d98470', dot: '#b0473b',
    description: 'Skeletal muscles generate movement by pulling on their attachments. Together with tendons, they move joints, stabilize posture, and produce heat.' },
  { id: 'heart', label: 'Heart', group: 'organs', color: '#b8443e', dot: '#a2322d',
    description: 'The heart is a muscular pump with four chambers. Its valves keep blood moving in one direction as it drives the pulmonary and systemic circulations.' },
  { id: 'sensory', label: 'Sensory organs', group: 'organs', color: '#b7c3bc', dot: '#9aa8a0',
    description: 'The eyes and ears turn light and sound into nerve signals. Their lenses, membranes, and tiny bones focus and amplify what reaches the receptors.' },
  { id: 'arteries', label: 'Arteries', group: 'organs', color: '#c8463b', dot: '#b53a30',
    description: 'The heart drives blood through the circulation. Arteries carry blood away from the heart to supply tissues or, in the pulmonary circuit, to the lungs.' },
  { id: 'veins', label: 'Veins', group: 'organs', color: '#5d87b6', dot: '#4a72a0',
    description: 'Veins return blood toward the heart. Superficial and deep networks collect blood from the tissues; the pulmonary veins bring oxygenated blood back from the lungs.' },
  { id: 'nervous', label: 'Nervous system', group: 'organs', color: '#e3c266', dot: '#cfa83f',
    description: 'The brain and spinal cord process information. Nerves carry signals between them and the rest of the body, controlling movement, sensation, and organ function.' },
  { id: 'brain', label: 'Brain', group: 'organs', color: '#cfaac8', dot: '#b087a8',
    description: 'The brain is the control centre of the nervous system. Its hemispheres, brainstem, and cerebellum handle thought, sensation, movement, and the automatic functions that keep the body alive.' },
  { id: 'respiratory', label: 'Respiratory', group: 'organs', color: '#d59c9c', dot: '#c07f7f',
    description: 'Air passes through the nose, larynx, and trachea into a branching tree of bronchi that ends in the lungs, where oxygen enters the blood and carbon dioxide leaves it.' },
  { id: 'digestive', label: 'Digestive', group: 'organs', color: '#d4a47a', dot: '#b9865a',
    description: 'The digestive tract breaks food down and absorbs nutrients along its length, from the mouth and esophagus through the stomach and intestines, helped by the liver, gallbladder, and pancreas.' },
  { id: 'urinary', label: 'Urinary', group: 'organs', color: '#d1a06c', dot: '#b5834f',
    description: 'The kidneys filter blood and regulate fluid, electrolyte, and acid-base balance. Urine travels through the ureters to the bladder and exits through the urethra.' },
  { id: 'reproductive', label: 'Reproductive', group: 'organs', color: '#c79fb2', dot: '#ad7f95',
    description: 'The reproductive organs produce gametes and hormones. In the male body they include the testes, the duct system, the accessory glands, and the penis.' },
  { id: 'endocrine', label: 'Endocrine', group: 'organs', color: '#b99cd0', dot: '#9c7bb8',
    description: 'Endocrine glands release hormones directly into the blood. The pituitary, thyroid, parathyroid, adrenal, and pineal glands regulate growth, metabolism, and the stress response.' },
  { id: 'lymphatic', label: 'Lymphatic', group: 'organs', color: '#9dbf9f', dot: '#7fa482',
    description: 'Lymphatic vessels return tissue fluid to the blood and pass it through lymph nodes. The spleen, thymus, and tonsils house immune cells.' },
  { id: 'skin', label: 'Skin', group: 'organs', color: '#e9cdb6', dot: '#d1ab8d', hidden: true,
    description: 'The skin is the outer covering of the body. It shields the tissues beneath it, regulates temperature, and carries the receptors for touch.' },
];

// ---------------------------------------------------------------- helpers
const log = (...a) => console.log('[atlas]', ...a);
const tsv = (file) =>
  fs.readFileSync(path.join(CACHE, file), 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.split('\t'));

async function download(name, dest) {
  log(`downloading ${name}`);
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
}

async function ensureInputs() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const f of LISTS) {
    const p = path.join(CACHE, f);
    if (!fs.existsSync(p)) await download(f, p);
  }
  if (STATS_ONLY) return;
  const zip = path.join(CACHE, ZIP);
  if (!fs.existsSync(OBJ_DIR)) {
    if (!fs.existsSync(zip)) await download(ZIP, zip);
    log('unzipping (this takes a minute)');
    execFileSync('unzip', ['-q', '-o', zip, '-d', CACHE]);
  }
}

// ---------------------------------------------------------------- hierarchy
function loadHierarchy() {
  const isaName = new Map(tsv('isa_parts_list_e.txt').map((r) => [r[0], r[2]]));
  const isaParents = new Map();
  for (const [p, , c] of tsv('isa_inclusion_relation_list.txt')) {
    if (!isaParents.has(c)) isaParents.set(c, []);
    isaParents.get(c).push(p);
  }
  const isaElems = new Map(); // concept -> Set(FJ)
  for (const [c, , fj] of tsv('isa_element_parts.txt')) {
    if (!isaElems.has(c)) isaElems.set(c, new Set());
    isaElems.get(c).add(fj);
  }
  const poName = new Map(tsv('partof_parts_list_e.txt').map((r) => [r[0], r[2]]));
  const poParents = new Map();
  for (const [p, , c] of tsv('partof_inclusion_relation_list.txt')) {
    if (!poParents.has(c)) poParents.set(c, []);
    poParents.get(c).push(p);
  }
  const poByFj = new Map(); // FJ -> Set(concept)
  for (const [c, , fj] of tsv('partof_element_parts.txt')) {
    if (!poByFj.has(fj)) poByFj.set(fj, new Set());
    poByFj.get(fj).add(c);
  }
  const ancestors = (id, parents) => {
    const out = new Set();
    const st = [id];
    while (st.length) {
      const x = st.pop();
      for (const p of parents.get(x) || []) if (!out.has(p)) { out.add(p); st.push(p); }
    }
    return out;
  };
  // leaf concept per element file = the concept with the fewest element files containing it
  const leaf = new Map();
  for (const [c, set] of isaElems) {
    for (const fj of set) {
      const cur = leaf.get(fj);
      if (!cur || set.size < isaElems.get(cur).size || (set.size === isaElems.get(cur).size && c < cur)) leaf.set(fj, c);
    }
  }
  const pieces = [...leaf.keys()].sort();
  const info = pieces.map((fj) => {
    const c = leaf.get(fj);
    const isaAnc = [...ancestors(c, isaParents)].map((id) => isaName.get(id) || '');
    const poSet = new Set();
    for (const pc of poByFj.get(fj) || []) { poSet.add(pc); for (const a of ancestors(pc, poParents)) poSet.add(a); }
    const poAnc = [...poSet].map((id) => poName.get(id) || '');
    return { fj, fma: c, name: isaName.get(c) || c, isaAnc, poAnc };
  });
  return { pieces: info, isaElems, isaName, pieceIndex: new Map(pieces.map((fj, i) => [fj, i])) };
}

// ---------------------------------------------------------------- classification
function classify(p) {
  const A = p.isaAnc.join(' | ');
  const H = [p.name, A, p.poAnc.join(' | ')].join(' | ');
  const a = (re) => re.test(A);
  const h = (re) => re.test(H);
  const n = (re) => re.test(p.name);

  if (n(/\b(skin|integument|hairs?|eyebrow)\b/i) || a(/^skin$|\bskin\b|integument/i)) return 'skin';
  if (a(/\bartery\b|arterial|\baorta\b|arteriole/i) || n(/\barter(y|ies)\b|\baorta\b|arterial trunk/i)) return 'arteries';
  if (a(/\bvein\b|venous|vena cava|portal vein|dural venous sinus/i) || n(/\bveins?\b|vena cava|venous/i)) return 'veins';
  if (h(/malleus|incus|stapes|ossicle/i)) return 'sensory';
  if (!a(/neuraxis|\bbrain\b|cerebr|spinal cord/i) && !n(/foramen|of brain|cerebral|lateral ventricle|third ventricle|fourth ventricle/i) &&
      h(/\bheart\b|cardiac|atrium|auricle of|myocardi|endocardi|epicardi|pericardi|papillary muscle|chordae|\bvalve\b|trabecula|interventricular|interatrial|conus arteriosus|\bventricle\b/i)) return 'heart';
  if (a(/\bbone organ\b|\btooth\b|\bbone\b|\bvertebra\b|\brib\b|phalanx|\bskull\b|sesamoid/i) || n(/\bbone\b|\btooth\b|\bvertebra\b|\brib\b|phalanx|\bsacrum\b|\bcoccyx\b|\bsternum\b|\bhyoid\b|\bscapula\b|\bclavicle\b|\bpatella\b|\bmandible\b|\bmaxilla\b/i)) return 'skeleton';
  if (a(/muscle organ|head of muscle organ|zone of muscle organ|\btendon\b|aponeurosis|\bfascia\b|retinaculum/i) ||
      n(/^(left |right )?tendon of|aponeurosis|\bmuscle\b|trapezius|interossei|lumbrical|levatores|intertransversarii|interspinales|tendinous ring|raphe|linea alba|diaphragm/i)) return 'muscles';
  if (n(/conus elasticus/i)) return 'respiratory';
  if (n(/interosseous membrane/i)) return 'skeleton';
  if (!n(/\bnerve\b|spinal cord|ganglion|plexus|cauda equina/i) &&
      (a(/segment of brain|segment of neuraxis|cell part cluster of neuraxis|telenceph|dienceph|cerebell|brainstem|gyrus|cerebral|ventricle of brain|\bbrain\b/i) ||
       n(/cerebr|cerebell|gyrus|thalam|hypothalam|\bpons\b|medulla oblongata|midbrain|telenceph|dienceph|hippocamp|amygdal|corpus callosum|commissure|brainstem|colliculus|geniculate|lateral ventricle|third ventricle|fourth ventricle|infundibulum|interventricular foramen|internal capsule|putamen|caudate|pallid|claustrum|fornix|septum pellucidum|\bbrain\b|olfactory bulb|olfactory tract|optic chiasm|optic tract|pineal body|insula|precuneus|cuneus|uncus|operculum|substantia nigra|red nucleus|nucleus of|\bpole\b|\bsulcus\b|lobule|vermis|tectum|tegmentum|aqueduct|choroid plexus/i))) return 'brain';
  if (h(/\bnerve\b|neural|neuraxis|spinal cord|ganglion|plexus|meninges|dura mater|pia mater|arachnoid|cauda equina|cranial nerve|nervous system|central canal|conus medullaris|filum terminale/i)) return 'nervous';
  if (h(/\beye\b|eyeball|retina|\blens\b|cornea|sclera|\biris\b|choroid|vitreous|ciliary|lacrimal|\bear\b|cochlea|vestibul|semicircular|tympan|auditory|external ear|middle ear|inner ear|eyelid|conjunctiva|labyrinth|orbit\b/i)) return 'sensory';
  if (h(/\blung\b|pulmonary|bronch|trache|larynx|laryngeal|pleura|alveol|nasal|\bnose\b|paranasal|epiglott|arytenoid|cricoid|thyroid cartilage|corniculate|cuneiform cartilage|vocal|glottis|respirat|thyrohyoid/i)) return 'respiratory';
  if (h(/cartilage|intervertebral|articular|ligament|\bjoint\b|meniscus|labrum|symphysis|synovial|capsule of|skeletal|skeleton|trochlea of/i)) return 'skeleton';
  if (h(/stomach|gastric|intestin|esophag|oesophag|\bliver\b|hepatic|gallbladder|biliary|\bbile\b|pancrea|duoden|jejun|\bile(um|al)\b|\bcolon\b|colic|caec|\bcec(um|al)\b|rectum|rectal|\banal\b|\banus\b|appendix|tongue|lingual|salivary|parotid|submandibular|sublingual|pharyn|\boral\b|\blip\b|palat|gingiv|peritone|omentum|mesenter|alimentary|digestive|\bgut\b|taenia|\bmouth\b/i)) return 'digestive';
  if (!n(/adrenal|suprarenal/i) && h(/kidney|\brenal\b|ureter|bladder|urethra|urinary|nephr|calyx|calyces|vesical/i)) return 'urinary';
  if (h(/testis|testes|testicular|epididym|deferens|deferent|seminal|prostat|penis|penile|scrot|spermatic|bulbourethral|ejaculat|cavernos|spongios|glans|ovar|uter|vagin|genital|reproduct/i)) return 'reproductive';
  if (h(/thyroid|parathyroid|adrenal|suprarenal|pituitary|hypophys|pineal|endocrine|islet/i)) return 'endocrine';
  if (h(/lymph|spleen|splenic|thymus|thoracic duct|tonsil|cisterna chyli/i)) return 'lymphatic';
  return null;
}

// ---------------------------------------------------------------- meshes
function parseObj(text) {
  const pos = [];
  const idx = [];
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const c0 = line.charCodeAt(0);
    if (c0 === 118 /* v */ && line.charCodeAt(1) === 32) {
      const p = line.trim().split(/\s+/);
      // BodyParts3D is Z-up with the face toward -Y. Rotate to Three.js Y-up, face toward +Z.
      pos.push(+p[1], +p[3], -+p[2]);
    } else if (c0 === 102 /* f */ && line.charCodeAt(1) === 32) {
      const p = line.trim().split(/\s+/);
      const f = [];
      for (let k = 1; k < p.length; k++) {
        const a = p[k].split('/')[0];
        let i = parseInt(a, 10);
        if (i < 0) i = pos.length / 3 + i + 1;
        f.push(i - 1);
      }
      for (let k = 1; k + 1 < f.length; k++) idx.push(f[0], f[k], f[k + 1]);
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

function compact(positions, indices) {
  const remap = new Int32Array(positions.length / 3).fill(-1);
  let n = 0;
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (remap[v] < 0) remap[v] = n++;
    out[i] = remap[v];
  }
  const np = new Float32Array(n * 3);
  for (let v = 0; v < remap.length; v++) {
    const r = remap[v];
    if (r >= 0) { np[r * 3] = positions[v * 3]; np[r * 3 + 1] = positions[v * 3 + 1]; np[r * 3 + 2] = positions[v * 3 + 2]; }
  }
  return { positions: np, indices: out };
}

// Triangle budget per piece: keep small pieces intact, shrink big ones on a square-root curve.
function targetTriangles(tris) {
  if (tris <= 600) return tris;
  return Math.round(600 * Math.pow(tris / 600, 0.5));
}

// Weld vertices that share a position so seams do not lock the simplifier.
function weld(mesh) {
  const remap = MeshoptSimplifier.generatePositionRemap(mesh.positions, 3);
  const idx = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < idx.length; i++) idx[i] = remap[mesh.indices[i]];
  return compact(mesh.positions, idx);
}

function simplify(mesh) {
  const tris = mesh.indices.length / 3;
  const target = targetTriangles(tris);
  if (target >= tris) return mesh;
  const [idx] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, target * 3, 0.03);
  return idx.length >= 3 ? { positions: mesh.positions, indices: idx } : mesh;
}

function quantize(positions) {
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < bb[k]) bb[k] = v;
      if (v > bb[k + 3]) bb[k + 3] = v;
    }
  }
  const q = new Uint16Array(positions.length);
  const ext = [0, 1, 2].map((k) => Math.max(bb[k + 3] - bb[k], 1e-6));
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) q[i + k] = Math.round(((positions[i + k] - bb[k]) / ext[k]) * 65535);
  }
  return { q, bb };
}

// ---------------------------------------------------------------- main
async function main() {
  await ensureInputs();
  const { pieces, isaElems, isaName, pieceIndex } = loadHierarchy();
  log(`${pieces.length} element files, ${isaElems.size} named concepts`);

  for (const p of pieces) p.system = classify(p);
  const unclassified = pieces.filter((p) => !p.system);
  if (unclassified.length) {
    console.error('[atlas] unclassified pieces — extend classify():');
    for (const p of unclassified) console.error(`   ${p.fj}  ${p.fma}  ${p.name}  ← ${p.isaAnc.slice(0, 4).join(' / ')}`);
    process.exit(1);
  }

  const counts = Object.fromEntries(SYSTEMS.map((s) => [s.id, 0]));
  for (const p of pieces) counts[p.system]++;
  log('classification:');
  for (const s of SYSTEMS) console.log(`   ${s.label.padEnd(18)} ${String(counts[s.id]).padStart(5)}`);
  if (STATS_ONLY) {
    for (const s of SYSTEMS) {
      const names = pieces.filter((p) => p.system === s.id).map((p) => p.name);
      const uniq = [...new Set(names)];
      console.log(`\n--- ${s.label} (${names.length} pieces, ${uniq.length} names)`);
      console.log('   ' + uniq.slice(0, 40).join(' · '));
      if (uniq.length > 40) console.log(`   … +${uniq.length - 40} more`);
    }
    return;
  }

  await MeshoptSimplifier.ready;
  fs.mkdirSync(OUT, { recursive: true });

  const chunks = [];
  let offset = 0;
  const push = (arr) => {
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const start = offset;
    chunks.push(buf);
    offset += buf.length;
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    return start;
  };

  const global = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let totalTris = 0;
  let totalVerts = 0;
  let srcTris = 0;
  const outPieces = [];
  const t0 = Date.now();
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const text = fs.readFileSync(path.join(OBJ_DIR, `${p.fj}.obj`), 'utf8');
    let mesh = parseObj(text);
    srcTris += mesh.indices.length / 3;
    mesh = weld(mesh);
    mesh = compact(mesh.positions, simplify(mesh).indices);
    const { q, bb } = quantize(mesh.positions);
    for (let k = 0; k < 3; k++) { global[k] = Math.min(global[k], bb[k]); global[k + 3] = Math.max(global[k + 3], bb[k + 3]); }
    const vCount = mesh.positions.length / 3;
    const wide = vCount > 65535;
    const idx = wide ? mesh.indices : Uint16Array.from(mesh.indices);
    const vOff = push(q);
    const iOff = push(idx);
    totalTris += idx.length / 3;
    totalVerts += vCount;
    outPieces.push({
      id: p.fj,
      fma: p.fma,
      name: p.name,
      sys: SYSTEMS.findIndex((s) => s.id === p.system),
      v: [vOff, vCount],
      i: [iOff, idx.length, wide ? 4 : 2],
      bb: bb.map((x) => Math.round(x * 10) / 10),
    });
    if (i % 250 === 0) log(`packed ${i}/${pieces.length}`);
  }

  // Structures = every named concept that owns element files; pieces are indices into `pieces`.
  const structures = [];
  const structIndexByFma = new Map();
  for (const [fma, set] of isaElems) {
    structIndexByFma.set(fma, structures.length);
    structures.push({ fma, name: isaName.get(fma) || fma, pieces: [...set].map((fj) => pieceIndex.get(fj)).sort((a, b) => a - b) });
  }
  for (const op of outPieces) op.struct = structIndexByFma.get(op.fma);

  const bin = Buffer.concat(chunks);
  fs.writeFileSync(path.join(OUT, 'atlas.bin'), bin);
  const manifest = {
    version: 1,
    generated: new Date().toISOString(),
    source: {
      name: 'BodyParts3D',
      attribution: 'BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan',
      license: 'CC BY-SA 2.1 JP',
      url: 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html',
      dataset: 'isa_BP3D_4.0_obj_99',
    },
    units: 'mm',
    bbox: global.map((x) => Math.round(x * 10) / 10),
    bin: 'atlas.bin',
    binBytes: bin.length,
    systems: SYSTEMS,
    pieces: outPieces,
    structures,
  };
  fs.writeFileSync(path.join(OUT, 'atlas.json'), JSON.stringify(manifest));
  const json = fs.statSync(path.join(OUT, 'atlas.json')).size;
  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  log(`triangles ${srcTris.toLocaleString()} -> ${totalTris.toLocaleString()}, vertices ${totalVerts.toLocaleString()}`);
  log(`atlas.bin ${(bin.length / 1e6).toFixed(1)} MB, atlas.json ${(json / 1e6).toFixed(1)} MB`);
  log(`bbox mm: ${manifest.bbox.join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
