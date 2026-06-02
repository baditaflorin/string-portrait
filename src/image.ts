// Pure image helpers: building the "darkness" residual the string-art solver
// consumes, plus a procedural sample so the app shows something on first load
// and is testable without a real photo. No canvas, no DOM here.

/**
 * Convert a grayscale buffer (0 = black, 255 = white, row-major width × height)
 * into a darkness residual in [0, 1] where 1 = fully black = lots of thread
 * wanted. Optionally invert (treat bright areas as the subject instead).
 *
 * Pixels outside the inscribed loom circle are zeroed: thread only ever lives
 * inside the circular frame, so darkness outside it would be unreachable and
 * would skew line scores.
 */
export function grayToResidual(
  gray: Uint8ClampedArray | Uint8Array | number[],
  width: number,
  height: number,
  invert = false,
): Float32Array {
  const out = new Float32Array(width * height);
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - 1;
  const r2 = r * r;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) {
        out[idx] = 0;
        continue;
      }
      const g = gray[idx]! / 255;
      out[idx] = invert ? g : 1 - g;
    }
  }
  return out;
}

/**
 * Standard luma-weighted grayscale from an RGBA buffer (the layout
 * `CanvasRenderingContext2D.getImageData` returns). Returns one byte per pixel.
 */
export function rgbaToGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number) {
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    // Rec. 601 luma — cheap and perceptually fine for a darkness map.
    out[i] = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
  }
  return out;
}

/**
 * A procedural high-contrast "face-like" sample: a dark radial blob (the head)
 * over a light field, with two lighter eye spots and a darker mouth band, so the
 * solver has real structure to chase. Deterministic; returns a grayscale buffer
 * (0 = black, 255 = white) of size `size × size`.
 */
export function sampleImage(size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size);
  const cx = size / 2;
  const cy = size / 2;
  const headR = size * 0.42;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      // Base: bright background, darkening toward a soft head disc.
      let v = 235;
      const t = d / headR;
      if (t < 1) {
        // Smooth dark head: darkest at centre, fading to the rim.
        const shade = 40 + 150 * (t * t); // 40 (center) → ~190 (rim)
        v = shade;
      }
      // Eyes: two light spots above centre.
      const eyeY = cy - size * 0.08;
      const eyeDX = size * 0.15;
      const eL = Math.hypot(x - (cx - eyeDX), y - eyeY);
      const eR = Math.hypot(x - (cx + eyeDX), y - eyeY);
      const eyeR = size * 0.055;
      if (eL < eyeR || eR < eyeR) v = Math.min(255, v + 120);
      // Mouth: a dark horizontal band below centre.
      const mouthY = cy + size * 0.16;
      if (Math.abs(y - mouthY) < size * 0.03 && Math.abs(dx) < size * 0.16) {
        v = Math.max(0, v - 90);
      }
      out[y * size + x] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return out;
}
