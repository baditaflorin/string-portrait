import {
  nailPositions,
  linePixels,
  chooseNextNail,
  subtractLine,
  edgeKey,
  type Point,
} from "./stringart";
import { grayToResidual, rgbaToGray, sampleImage } from "./image";
import { sequenceToSvg, sequenceToText } from "./svg";

// ---- DOM helpers ----------------------------------------------------------
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

const canvas = el<HTMLCanvasElement>("canvas");
const ctx = canvas.getContext("2d")!;

// Internal working resolution for the solver and the rendered loom. The visual
// canvas is scaled by CSS to fit the stage; this keeps the algorithm's cost
// bounded regardless of the source photo size.
const RES = 500;

// ---- settings -------------------------------------------------------------
type Settings = {
  nails: number;
  maxLines: number;
  strength: number;
  opacity: number;
  invert: boolean;
};

const settings: Settings = {
  nails: 240,
  maxLines: 2500,
  strength: 0.15,
  opacity: 0.5,
  invert: false,
};

// ---- working state --------------------------------------------------------
// The grayscale source (0=black..255=white) at RES×RES; null until loaded.
let sourceGray: Uint8ClampedArray | null = null;
// Live solver state during a run.
let residual: Float32Array | null = null;
let nails: Point[] = [];
let sequence: number[] = [];
let used: Set<number> | null = null;
let current = 0;
let raf = 0;
let running = false;

// ---- canvas sizing --------------------------------------------------------
function setupCanvas(): void {
  // Backing store is fixed at RES; CSS scales it to fit the stage responsively.
  canvas.width = RES;
  canvas.height = RES;
  const stage = canvas.parentElement!;
  const r = stage.getBoundingClientRect();
  const side = Math.max(280, Math.min(r.width, r.height) - 24);
  canvas.style.width = `${side}px`;
  canvas.style.height = `${side}px`;
}

function paintBackground(): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, RES, RES);
}

// ---- image ingestion ------------------------------------------------------
/** Draw an ImageBitmap/HTMLImageElement onto an offscreen RES×RES canvas,
 *  cover-cropped, and read back a grayscale buffer. */
function imageToGray(img: CanvasImageSource, iw: number, ih: number): Uint8ClampedArray {
  const off = document.createElement("canvas");
  off.width = RES;
  off.height = RES;
  const octx = off.getContext("2d")!;
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, RES, RES);
  // Cover: scale so the shorter side fills RES, centre-crop the rest.
  const scale = Math.max(RES / iw, RES / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  octx.drawImage(img, (RES - dw) / 2, (RES - dh) / 2, dw, dh);
  const data = octx.getImageData(0, 0, RES, RES).data;
  return rgbaToGray(data, RES, RES);
}

function loadSample(): void {
  sourceGray = sampleImage(RES);
  drawSourcePreview();
  setProgress("Sample loaded — hit ▶ Generate.");
}

async function loadFile(file: File): Promise<void> {
  try {
    const bmp = await createImageBitmap(file);
    sourceGray = imageToGray(bmp, bmp.width, bmp.height);
    bmp.close();
    drawSourcePreview();
    setProgress("Photo loaded — hit ▶ Generate.");
  } catch {
    // Fallback for browsers/files where createImageBitmap rejects.
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      sourceGray = imageToGray(img, img.naturalWidth, img.naturalHeight);
      URL.revokeObjectURL(url);
      drawSourcePreview();
      setProgress("Photo loaded — hit ▶ Generate.");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast("Could not read that image.");
    };
    img.src = url;
  }
}

/** Show a faint grayscale preview of the loaded source inside the loom circle. */
function drawSourcePreview(): void {
  stop();
  paintBackground();
  if (!sourceGray) return;
  const img = ctx.createImageData(RES, RES);
  const cx = RES / 2;
  const cy = RES / 2;
  const rad = RES / 2 - 1;
  const r2 = rad * rad;
  for (let y = 0; y < RES; y++) {
    for (let x = 0; x < RES; x++) {
      const i = y * RES + x;
      const inside = (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2;
      let g = sourceGray[i]!;
      if (settings.invert) g = 255 - g;
      // Lighten the preview so the thread reads clearly once drawn over it.
      const v = inside ? Math.round(200 + (g / 255) * 55) : 255;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---- the incremental greedy run -------------------------------------------
function startGeneration(): void {
  if (!sourceGray) {
    toast("Load a photo or pick the sample first.");
    return;
  }
  stop();
  setupCanvas();
  paintBackground();

  residual = grayToResidual(sourceGray, RES, RES, settings.invert);
  const radius = RES / 2 - 1;
  nails = nailPositions(settings.nails, radius, RES / 2, RES / 2);
  sequence = [0];
  used = new Set<number>();
  current = 0;

  ctx.strokeStyle = `rgba(20, 20, 28, ${settings.opacity})`;
  ctx.lineWidth = 0.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  running = true;
  setButtons();

  // Draw a modest batch of threads per frame so the UI keeps breathing.
  const linesPerFrame = 24;

  const step = (): void => {
    if (!running || !residual || !used) return;
    let drewAny = false;
    for (let k = 0; k < linesPerFrame; k++) {
      if (sequence.length - 1 >= settings.maxLines) break;
      const next = chooseNextNail(current, nails, residual, {
        width: RES,
        height: RES,
        used,
        count: settings.nails,
      });
      if (next < 0) {
        // Nothing worth drawing remains — finish early.
        finish(true);
        return;
      }
      const a = nails[current]!;
      const b = nails[next]!;
      const px = linePixels(a.x, a.y, b.x, b.y);
      subtractLine(residual, px, settings.strength, { width: RES, height: RES });
      used.add(edgeKey(current, next, settings.nails));

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      sequence.push(next);
      current = next;
      drewAny = true;
    }

    const drawn = sequence.length - 1;
    setProgress(`Winding… ${drawn} / ${settings.maxLines} threads`);

    if (drawn >= settings.maxLines || !drewAny) {
      finish(false);
      return;
    }
    raf = requestAnimationFrame(step);
  };

  raf = requestAnimationFrame(step);
}

function finish(early: boolean): void {
  running = false;
  cancelAnimationFrame(raf);
  setButtons();
  const drawn = sequence.length - 1;
  setProgress(
    early
      ? `Done — ${drawn} threads (no darkness left to chase).`
      : `Done — ${drawn} threads through ${settings.nails} nails.`,
  );
}

function stop(): void {
  running = false;
  cancelAnimationFrame(raf);
  setButtons();
}

// ---- controls wiring ------------------------------------------------------
function setButtons(): void {
  el<HTMLButtonElement>("generate").disabled = running;
  el<HTMLButtonElement>("stop").disabled = !running;
}

function setProgress(msg: string): void {
  el<HTMLElement>("progress").textContent = msg;
}

function toast(msg: string): void {
  const t = el<HTMLElement>("toast");
  t.textContent = msg;
  t.classList.add("show");
  window.setTimeout(() => t.classList.remove("show"), 1800);
}

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fmt(key: keyof Settings, v: number): string {
  if (key === "strength") return v.toFixed(2);
  if (key === "opacity") return v.toFixed(2);
  return String(v);
}

type RangeKey = "nails" | "maxLines" | "strength" | "opacity";
const RANGE_KEYS: RangeKey[] = ["nails", "maxLines", "strength", "opacity"];

function syncOutputs(): void {
  for (const key of RANGE_KEYS) {
    el<HTMLOutputElement>(`${key}-out`).textContent = fmt(key, settings[key]);
  }
}

function wire(): void {
  syncOutputs();

  el<HTMLInputElement>("file").addEventListener("change", (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void loadFile(f);
  });
  el("sample").addEventListener("click", loadSample);

  for (const key of RANGE_KEYS) {
    el<HTMLInputElement>(key).addEventListener("input", (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      (settings[key] as number) = v;
      el<HTMLOutputElement>(`${key}-out`).textContent = fmt(key, v);
    });
  }

  el<HTMLInputElement>("invert").addEventListener("change", (e) => {
    settings.invert = (e.target as HTMLInputElement).checked;
    if (sourceGray && !running) drawSourcePreview();
  });

  el("generate").addEventListener("click", startGeneration);
  el("stop").addEventListener("click", () => {
    stop();
    setProgress(`Stopped at ${sequence.length - 1} threads.`);
  });

  el("png").addEventListener("click", () => {
    canvas.toBlob((blob) => {
      if (blob) download("string-portrait.png", blob);
    }, "image/png");
  });

  el("svg").addEventListener("click", () => {
    if (sequence.length < 2) {
      toast("Generate a portrait first.");
      return;
    }
    const svg = sequenceToSvg(sequence, nails, {
      width: RES,
      height: RES,
      lineWidth: 0.6,
      opacity: settings.opacity,
      stroke: "#14141c",
      background: "#ffffff",
    });
    download("string-portrait.svg", new Blob([svg], { type: "image/svg+xml" }));
  });

  el("txt").addEventListener("click", () => {
    if (sequence.length < 2) {
      toast("Generate a portrait first.");
      return;
    }
    const txt = sequenceToText(sequence, settings.nails);
    download("string-portrait-nails.txt", new Blob([txt], { type: "text/plain" }));
  });

  // Panel show/hide (mobile).
  el("toggle-panel").addEventListener("click", () => el("panel").classList.add("hidden"));
  el("show-panel").addEventListener("click", () => el("panel").classList.remove("hidden"));

  el<HTMLElement>("version").textContent = `v${__APP_VERSION__} · ${__GIT_COMMIT__}`;

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!running) {
        setupCanvas();
        if (sequence.length >= 2) redraw();
        else drawSourcePreview();
      }
    }, 200);
  });
}

/** Repaint a finished portrait (e.g. after a resize) from the stored sequence. */
function redraw(): void {
  paintBackground();
  ctx.strokeStyle = `rgba(20, 20, 28, ${settings.opacity})`;
  ctx.lineWidth = 0.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < sequence.length; i++) {
    const p = nails[sequence[i]!]!;
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

// ---- boot -----------------------------------------------------------------
setupCanvas();
paintBackground();
wire();
loadSample();
