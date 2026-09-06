# Human Atlas. interactive 3D anatomy

A browser atlas of the adult human body. It loads 2,234 modelled anatomical pieces from
the open BodyParts3D dataset, groups them into 15 body systems you can toggle, lets you
"explode" the body into a sorted inventory grid, and shows a detail card for any structure
you hover, click, or search for.

## Run it locally

Requirements: Node 20 or newer, `npm`, and the `unzip` command (present on macOS).

```bash
npm install
npm run data     # one-time: downloads BodyParts3D (~143 MB) and builds public/data/
npm run dev      # http://localhost:5178
```

`npm run build` produces a static site in `dist/`; `npm run preview` serves it.

## The data step

`npm run data` runs `scripts/build-data.mjs`:

1. Downloads six hierarchy tables and the IS-A 99 %-reduced OBJ archive into `.cache/bp3d/`
   (skipped when already present).
2. Resolves every element mesh to its most specific named FMA concept.
3. Classifies each piece into one of 15 systems with ordered name rules over its IS-A and
   PART-OF ancestors. Any piece the rules cannot place stops the build with a list, so a
   dataset change can never ship silently as "other".
4. Rotates the meshes to Y-up, welds duplicate vertices, simplifies large meshes with
   meshoptimizer, quantizes positions to 16-bit, and packs everything into
   `public/data/atlas.bin` with a `public/data/atlas.json` manifest.

`npm run data:stats` prints the classification report without touching the meshes.
`public/data/` and `.cache/` are generated and ignored by git; rebuild them with the command above.

## Recording a demo tour

`npm run record-tour` drives the running dev server through a scripted tour (orbit, system
toggles, explode, inspect, search) with a frame-exact virtual clock and writes
`videos/footage/tour.mp4` (1080×1080, 30 fps, 38 s). It needs Google Chrome installed; the
window it opens is the recording surface.

Two promo cuts live in `videos/human-atlas-promo/` and `videos/human-atlas-promo-v2/` (HyperFrames
projects; `npm run render` in either). Each is built from a hand-made screen recording of the app
(`assets/atlas-rec.mp4`, gitignored) with an original synthesised music bed, not from the scripted tour.

## Source data and licence

The geometry is **BodyParts3D**, © The Database Center for Life Science, licensed under
**CC Attribution-Share Alike 2.1 Japan**. Anything derived from it, including the packed
data this app serves, carries the same licence and must keep the attribution:

> BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan

Dataset page: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html
