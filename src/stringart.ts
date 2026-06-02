// Computational string art — the Petros Vrellis greedy algorithm, as pure logic.
//
// A grayscale photo becomes a single continuous thread wound between nails on a
// circular loom. We model the target as a "darkness" residual buffer (one float
// per pixel, 0 = white = no thread wanted, up to 1 = black = lots of thread
// wanted). The greedy loop repeatedly draws the chord that covers the most
// remaining darkness, then subtracts the thread's own contribution from the
// residual so the next line goes somewhere new.
//
// Everything here operates on plain numbers / typed arrays — no canvas, no DOM —
// so it runs unchanged under vitest's node environment and stays reusable.

export type Point = { x: number; y: number };

/**
 * Evenly place `count` nails on a circle of radius `radius` centred at
 * (`cx`, `cy`). Nail 0 sits at angle 0 (to the right of centre) and the rest
 * proceed counter-clockwise in screen space (y grows downward → visually
 * clockwise, which does not matter for the algorithm). Deterministic.
 */
export function nailPositions(count: number, radius: number, cx: number, cy: number): Point[] {
  const out: Point[] = [];
  if (count <= 0) return out;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    out.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return out;
}

/**
 * Integer pixel coordinates along the segment from (ax, ay) to (bx, by) using
 * Bresenham's line algorithm. Both endpoints are included. Inputs are rounded
 * to the nearest pixel first. Returns a flat array `[x0, y0, x1, y1, …]` so the
 * hot path avoids per-pixel object allocation.
 */
export function linePixels(ax: number, ay: number, bx: number, by: number): Int32Array {
  let x0 = Math.round(ax);
  let y0 = Math.round(ay);
  const x1 = Math.round(bx);
  const y1 = Math.round(by);

  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;

  // Upper bound on pixel count for a Bresenham line is max(dx,|dy|)+1.
  const cap = Math.max(dx, -dy) + 1;
  const buf = new Int32Array(cap * 2);
  let n = 0;

  // Guard against pathological loops; cap+1 iterations is always enough.
  for (let guard = 0; guard <= cap; guard++) {
    buf[n++] = x0;
    buf[n++] = y0;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }

  return n === buf.length ? buf : buf.subarray(0, n);
}

export type LineScoreOpts = {
  /** Image width in pixels (residual is row-major width × height). */
  width: number;
  /** Image height in pixels. Optional; used only for bounds clipping. */
  height?: number;
};

/**
 * Sum of residual darkness under a precomputed line, normalised by the number of
 * sampled pixels so long chords are not unfairly favoured over short ones. The
 * `pixels` argument is the flat `[x,y,…]` array from {@link linePixels}. Pixels
 * outside the buffer contribute nothing. Returns the mean residual in [0, …].
 */
export function lineScore(residual: Float32Array, pixels: Int32Array, opts: LineScoreOpts): number {
  const { width } = opts;
  const height = opts.height ?? Math.floor(residual.length / width);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < pixels.length; i += 2) {
    const x = pixels[i]!;
    const y = pixels[i + 1]!;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    sum += residual[y * width + x]!;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * Subtract a thread's contribution from the residual along a precomputed line.
 * Each touched pixel loses `strength` darkness, clamped at 0 (we never push a
 * pixel negative — that would invent brightness the photo never had). Mutates
 * `residual` in place.
 */
export function subtractLine(
  residual: Float32Array,
  pixels: Int32Array,
  strength: number,
  opts: LineScoreOpts,
): void {
  const { width } = opts;
  const height = opts.height ?? Math.floor(residual.length / width);
  for (let i = 0; i < pixels.length; i += 2) {
    const x = pixels[i]!;
    const y = pixels[i + 1]!;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const idx = y * width + x;
    const v = residual[idx]! - strength;
    residual[idx] = v < 0 ? 0 : v;
  }
}

export type ChooseOpts = {
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
  /**
   * Don't return a nail within this many index-steps of the current one (in
   * either direction). Very short chords barely cross the image and tend to pile
   * up near the rim, so the classic algorithm skips immediate neighbours.
   * Default 1.
   */
  minGap?: number;
  /**
   * Optional set of already-used directed/undirected edges, keyed by
   * `a * count + b`, to avoid re-drawing the identical chord. Pass the live Set
   * the generator maintains.
   */
  used?: Set<number>;
  /** Total nail count, required when `used` is supplied for edge keys. */
  count?: number;
};

/**
 * Greedy pick: from `currentNail`, return the index of the nail whose connecting
 * chord covers the most remaining darkness (highest mean residual). Returns -1
 * when no admissible nail exists (e.g. every chord is already used or scores 0).
 *
 * Pure: reads `residual` and `nails`, mutates nothing.
 */
export function chooseNextNail(
  currentNail: number,
  nails: Point[],
  residual: Float32Array,
  opts: ChooseOpts,
): number {
  const count = nails.length;
  if (count < 2) return -1;
  const minGap = Math.max(1, opts.minGap ?? 1);
  const used = opts.used;
  const edgeCount = opts.count ?? count;

  const cur = nails[currentNail]!;
  let best = -1;
  let bestScore = 0; // strictly-positive improvement required

  for (let j = 0; j < count; j++) {
    if (j === currentNail) continue;
    // Skip near neighbours in circular index space.
    const d = Math.abs(j - currentNail);
    const circ = Math.min(d, count - d);
    if (circ < minGap) continue;

    if (used) {
      const key = currentNail < j ? currentNail * edgeCount + j : j * edgeCount + currentNail;
      if (used.has(key)) continue;
    }

    const target = nails[j]!;
    const px = linePixels(cur.x, cur.y, target.x, target.y);
    const s = lineScore(residual, px, { width: opts.width, height: opts.height });
    if (s > bestScore) {
      bestScore = s;
      best = j;
    }
  }

  return best;
}

/** Undirected edge key for the `used` set. */
export function edgeKey(a: number, b: number, count: number): number {
  return a < b ? a * count + b : b * count + a;
}

export type GenerateOpts = {
  width: number;
  height: number;
  /** Number of nails on the loom. */
  nailCount: number;
  /** Hard cap on threads drawn. */
  maxLines: number;
  /** How much darkness each thread removes from the residual, per pixel. */
  strength: number;
  /** Circular-index neighbour gap to skip (default 1). */
  minGap?: number;
  /** Nail to start winding from (default 0). */
  startNail?: number;
  /**
   * If true, refuse to draw the same chord twice. Prevents tight oscillation but
   * can end the run early once the obvious chords are exhausted. Default true.
   */
  uniqueEdges?: boolean;
};

export type GenerateResult = {
  /** Ordered nail indices the thread passes through, length = lines + 1. */
  sequence: number[];
  /** Nail coordinates used (so callers can render without recomputing). */
  nails: Point[];
  /** Number of threads (chords) actually drawn = sequence.length - 1. */
  lines: number;
};

/**
 * Run the full greedy winding on a darkness `residual` (mutated as it goes).
 * Returns the ordered nail sequence describing one continuous thread.
 *
 * Pure aside from the in-place residual update (which the caller hands us and
 * owns). No canvas, no DOM — safe under node.
 */
export function generateStringArt(residual: Float32Array, opts: GenerateOpts): GenerateResult {
  const { width, height, nailCount, maxLines, strength } = opts;
  const minGap = opts.minGap ?? 1;
  const uniqueEdges = opts.uniqueEdges ?? true;
  const radius = Math.min(width, height) / 2 - 1;
  const nails = nailPositions(nailCount, radius, width / 2, height / 2);

  const sequence: number[] = [];
  if (nailCount < 2 || maxLines <= 0) {
    return { sequence, nails, lines: 0 };
  }

  let current = (opts.startNail ?? 0) % nailCount;
  if (current < 0) current += nailCount;
  sequence.push(current);

  const used = uniqueEdges ? new Set<number>() : undefined;

  for (let line = 0; line < maxLines; line++) {
    const next = chooseNextNail(current, nails, residual, {
      width,
      height,
      minGap,
      used,
      count: nailCount,
    });
    if (next < 0) break; // nothing left worth drawing

    const px = linePixels(nails[current]!.x, nails[current]!.y, nails[next]!.x, nails[next]!.y);
    subtractLine(residual, px, strength, { width, height });
    if (used) used.add(edgeKey(current, next, nailCount));

    sequence.push(next);
    current = next;
  }

  return { sequence, nails, lines: sequence.length - 1 };
}
