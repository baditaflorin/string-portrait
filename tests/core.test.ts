import { describe, expect, it } from "vitest";
import {
  nailPositions,
  linePixels,
  lineScore,
  subtractLine,
  chooseNextNail,
  edgeKey,
  generateStringArt,
  type Point,
} from "../src/stringart";
import { grayToResidual, rgbaToGray, sampleImage } from "../src/image";
import { sequenceToSvg, sequenceToText } from "../src/svg";

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("nailPositions", () => {
  it("returns the requested count", () => {
    expect(nailPositions(240, 100, 0, 0)).toHaveLength(240);
    expect(nailPositions(0, 100, 0, 0)).toHaveLength(0);
  });

  it("places every nail at ~radius from the centre", () => {
    const cx = 50;
    const cy = 70;
    const r = 40;
    for (const p of nailPositions(64, r, cx, cy)) {
      expect(dist(p, { x: cx, y: cy })).toBeCloseTo(r, 6);
    }
  });

  it("puts nail 0 at angle 0 (centre + radius on x)", () => {
    const nails = nailPositions(8, 10, 5, 5);
    expect(nails[0]!.x).toBeCloseTo(15, 6);
    expect(nails[0]!.y).toBeCloseTo(5, 6);
  });

  it("spaces nails evenly (nail at count/4 is a quarter turn around)", () => {
    const nails = nailPositions(8, 10, 0, 0);
    expect(nails[2]!.x).toBeCloseTo(0, 6);
    expect(nails[2]!.y).toBeCloseTo(10, 6);
  });
});

describe("linePixels", () => {
  it("includes both endpoints", () => {
    const px = linePixels(0, 0, 5, 0);
    expect(px[0]).toBe(0);
    expect(px[1]).toBe(0);
    expect(px[px.length - 2]).toBe(5);
    expect(px[px.length - 1]).toBe(0);
  });

  it("has a plausible length for a horizontal run", () => {
    const px = linePixels(0, 0, 9, 0);
    expect(px.length / 2).toBe(10); // 0..9 inclusive
  });

  it("walks a diagonal one pixel at a time", () => {
    const px = linePixels(0, 0, 4, 4);
    expect(px.length / 2).toBe(5);
    // last pixel is the endpoint
    expect(px[px.length - 2]).toBe(4);
    expect(px[px.length - 1]).toBe(4);
  });

  it("handles reversed and steep lines", () => {
    const px = linePixels(5, 5, 0, 0);
    expect(px[0]).toBe(5);
    expect(px[1]).toBe(5);
    expect(px[px.length - 2]).toBe(0);
    const steep = linePixels(0, 0, 1, 8);
    expect(steep.length / 2).toBe(9);
  });

  it("returns a single pixel for a zero-length segment", () => {
    const px = linePixels(3, 3, 3, 3);
    expect(px.length / 2).toBe(1);
    expect(px[0]).toBe(3);
    expect(px[1]).toBe(3);
  });
});

describe("lineScore + subtractLine", () => {
  it("scores the mean residual under a line and subtraction lowers it", () => {
    const w = 5;
    const h = 5;
    const residual = new Float32Array(w * h).fill(1);
    const px = linePixels(0, 2, 4, 2); // middle row
    expect(lineScore(residual, px, { width: w, height: h })).toBeCloseTo(1, 6);
    subtractLine(residual, px, 0.5, { width: w, height: h });
    expect(lineScore(residual, px, { width: w, height: h })).toBeCloseTo(0.5, 6);
  });

  it("clamps residual at zero (never invents brightness)", () => {
    const w = 4;
    const residual = new Float32Array(w * 1).fill(0.3);
    const px = linePixels(0, 0, 3, 0);
    subtractLine(residual, px, 0.5, { width: w, height: 1 });
    for (let i = 0; i < residual.length; i++) expect(residual[i]).toBe(0);
  });

  it("ignores pixels outside the buffer", () => {
    const w = 3;
    const h = 3;
    const residual = new Float32Array(w * h).fill(1);
    const px = linePixels(-5, 1, 10, 1); // overshoots both sides
    // Only x in [0,2] count → mean is still 1, no crash.
    expect(lineScore(residual, px, { width: w, height: h })).toBeCloseTo(1, 6);
  });
});

describe("chooseNextNail", () => {
  it("picks the chord covering the clearly-darkest band", () => {
    // 4 nails at compass points. Nail 0 right, 1 bottom, 2 left, 3 top.
    const w = 21;
    const h = 21;
    const nails = nailPositions(4, 10, 10, 10);
    const residual = new Float32Array(w * h); // all 0 (white)
    // Paint a dark horizontal band on the centre row → the 0→2 chord wins.
    for (let x = 0; x < w; x++) residual[10 * w + x] = 1;
    const next = chooseNextNail(0, nails, residual, { width: w, height: h });
    expect(next).toBe(2);
  });

  it("picks the vertical chord when the dark band is vertical", () => {
    const w = 21;
    const h = 21;
    const nails = nailPositions(4, 10, 10, 10);
    const residual = new Float32Array(w * h);
    for (let y = 0; y < h; y++) residual[y * w + 10] = 1; // centre column
    // The vertical chord is nail 3 (top) ↔ nail 1 (bottom); it lies on the band.
    const fromTop = chooseNextNail(3, nails, residual, { width: w, height: h });
    expect(fromTop).toBe(1);
    const fromBottom = chooseNextNail(1, nails, residual, { width: w, height: h });
    expect(fromBottom).toBe(3);
  });

  it("returns -1 when the residual is empty", () => {
    const w = 11;
    const h = 11;
    const nails = nailPositions(6, 5, 5, 5);
    const residual = new Float32Array(w * h); // all zero
    expect(chooseNextNail(0, nails, residual, { width: w, height: h })).toBe(-1);
  });

  it("skips already-used edges", () => {
    const w = 21;
    const h = 21;
    const nails = nailPositions(4, 10, 10, 10);
    const residual = new Float32Array(w * h);
    for (let x = 0; x < w; x++) residual[10 * w + x] = 1; // horizontal band
    const used = new Set<number>([edgeKey(0, 2, 4)]);
    const next = chooseNextNail(0, nails, residual, {
      width: w,
      height: h,
      used,
      count: 4,
    });
    // 0→2 is banned, so it must pick something else (1 or 3), not 2.
    expect(next).not.toBe(2);
    expect(next).toBeGreaterThanOrEqual(0);
  });
});

describe("edgeKey", () => {
  it("is order-independent", () => {
    expect(edgeKey(3, 7, 100)).toBe(edgeKey(7, 3, 100));
    expect(edgeKey(0, 1, 10)).not.toBe(edgeKey(0, 2, 10));
  });
});

describe("image helpers", () => {
  it("rgbaToGray applies luma weighting", () => {
    // Pure red pixel → 0.299*255 ≈ 76.
    const rgba = new Uint8ClampedArray([255, 0, 0, 255]);
    const gray = rgbaToGray(rgba, 1, 1);
    expect(gray[0]).toBe(76);
  });

  it("grayToResidual inverts brightness inside the circle and zeroes outside", () => {
    const size = 11;
    const gray = new Uint8ClampedArray(size * size).fill(0); // all black
    const res = grayToResidual(gray, size, size, false);
    // Centre pixel is black → residual ~1.
    expect(res[5 * size + 5]).toBeCloseTo(1, 6);
    // A corner is outside the inscribed circle → forced to 0.
    expect(res[0]).toBe(0);
  });

  it("grayToResidual honours invert", () => {
    const size = 11;
    const gray = new Uint8ClampedArray(size * size).fill(255); // all white
    const normal = grayToResidual(gray, size, size, false);
    const inverted = grayToResidual(gray, size, size, true);
    expect(normal[5 * size + 5]).toBeCloseTo(0, 6); // white → no thread
    expect(inverted[5 * size + 5]).toBeCloseTo(1, 6); // inverted → lots
  });

  it("sampleImage is deterministic and has real contrast", () => {
    const a = sampleImage(64);
    const b = sampleImage(64);
    expect(a.length).toBe(64 * 64);
    expect(Array.from(a)).toEqual(Array.from(b));
    let min = 255;
    let max = 0;
    for (const v of a) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(max - min).toBeGreaterThan(120); // genuinely high-contrast
  });
});

describe("generateStringArt", () => {
  it("produces a continuous sequence bounded by maxLines", () => {
    const size = 64;
    const gray = sampleImage(size);
    const residual = grayToResidual(gray, size, size, false);
    const res = generateStringArt(residual, {
      width: size,
      height: size,
      nailCount: 120,
      maxLines: 200,
      strength: 0.15,
    });
    expect(res.lines).toBeGreaterThan(0);
    expect(res.lines).toBeLessThanOrEqual(200);
    expect(res.sequence.length).toBe(res.lines + 1);
    expect(res.nails).toHaveLength(120);
    // Every index is a valid nail.
    for (const idx of res.sequence) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(120);
    }
    // Starts at nail 0 by default.
    expect(res.sequence[0]).toBe(0);
  });

  it("is deterministic for the same input", () => {
    const size = 48;
    const r1 = grayToResidual(sampleImage(size), size, size, false);
    const r2 = grayToResidual(sampleImage(size), size, size, false);
    const a = generateStringArt(r1, {
      width: size,
      height: size,
      nailCount: 90,
      maxLines: 120,
      strength: 0.2,
    });
    const b = generateStringArt(r2, {
      width: size,
      height: size,
      nailCount: 90,
      maxLines: 120,
      strength: 0.2,
    });
    expect(a.sequence).toEqual(b.sequence);
  });

  it("draws nothing for a blank (white) image", () => {
    const size = 32;
    const blank = new Uint8ClampedArray(size * size).fill(255);
    const residual = grayToResidual(blank, size, size, false);
    const res = generateStringArt(residual, {
      width: size,
      height: size,
      nailCount: 60,
      maxLines: 500,
      strength: 0.2,
    });
    expect(res.lines).toBe(0);
    expect(res.sequence).toEqual([0]);
  });
});

describe("svg + text export", () => {
  it("emits an svg with a background and a polyline", () => {
    const nails = nailPositions(8, 50, 60, 60);
    const sequence = [0, 3, 6, 1, 4];
    const svg = sequenceToSvg(sequence, nails, {
      width: 120,
      height: 120,
      lineWidth: 0.5,
      opacity: 0.3,
    });
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("<rect");
    expect(svg).toContain("<polyline");
    expect(svg).toContain("stroke=");
    expect(svg).toContain("points=");
  });

  it("omits the polyline when there are too few points", () => {
    const nails = nailPositions(8, 50, 60, 60);
    const svg = sequenceToSvg([0], nails, {
      width: 120,
      height: 120,
      lineWidth: 1,
      opacity: 1,
    });
    expect(svg).toContain("<rect");
    expect(svg).not.toContain("<polyline");
  });

  it("text export lists one nail per line with a header", () => {
    const txt = sequenceToText([0, 5, 2], 240);
    expect(txt).toContain("# nails: 240");
    expect(txt).toContain("# threads: 2");
    const body = txt.trim().split("\n");
    expect(body[body.length - 3]).toBe("0");
    expect(body[body.length - 2]).toBe("5");
    expect(body[body.length - 1]).toBe("2");
  });
});
