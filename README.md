# string-portrait

[![pages](https://img.shields.io/badge/live-baditaflorin.github.io%2Fstring--portrait-d4a24c)](https://baditaflorin.github.io/string-portrait/)
[![version](https://img.shields.io/badge/version-0.1.0-blue)](https://github.com/baditaflorin/string-portrait/blob/main/package.json)
[![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

> Turn a photo into single-thread string art — plotter/print-ready, made in your browser.

**Live → https://baditaflorin.github.io/string-portrait/**

Upload a photo and watch it become one continuous thread wound between nails on a circular loom — the classic **computational string art** (Petros Vrellis) algorithm, running entirely in your browser. Nothing is uploaded; the image never leaves your device.

## What you can do

- **Feed it a photo** — drawn to an offscreen canvas, cover-cropped to 500×500, converted to grayscale. No photo? Hit **✦ Sample** for a built-in procedural face.
- **Tune it** — nails (120–360), max lines (500–4000), thread strength, line opacity, and an invert toggle for light-on-dark subjects.
- **Watch it wind** — the greedy solver runs in chunks via `requestAnimationFrame`, so the thread draws progressively and the UI never freezes. A live counter shows threads drawn / max.
- **Export it** — **⬇ PNG** raster, **⬇ SVG** (the whole thread as one `<polyline>` a pen plotter can run), and **⬇ Nails .txt** — the ordered nail indices for reproducing the piece by hand on a physical loom.

## How it works

The photo becomes a **darkness residual** (`image.ts`): one float per pixel, 1 = black = lots of thread wanted, masked to the inscribed loom circle. Then the greedy loop (`stringart.ts`):

1. From the current nail, score every candidate chord by the mean residual darkness under its pixels (`linePixels` Bresenham + `lineScore`).
2. Pick the darkest chord (`chooseNextNail`), draw it, and **subtract** the thread's contribution from the residual (`subtractLine`) so the next line goes somewhere new.
3. Repeat up to `maxLines`, producing one continuous nail sequence.

All of that is pure — plain numbers and typed arrays, no canvas or DOM — and unit-tested in `tests/core.test.ts`. The UI in `main.ts` is a thin wiring layer: it handles file/canvas/exports and drives the same greedy primitives one frame-batch at a time.

## Run it locally

```bash
git clone https://github.com/baditaflorin/string-portrait
cd string-portrait
npm install
npm run dev      # http://127.0.0.1:5173
```

## Build & deploy

GitHub Pages serves the committed `docs/` directory on `main`. No CI — a local smoke gate builds and sanity-checks the output:

```bash
npm run smoke    # vitest + vite build → docs/ + output checks
```

## Privacy

100% client-side. There is no backend, no analytics, no upload. Your photo is processed in-page and never leaves your device.

## License

MIT — see [LICENSE](./LICENSE).
