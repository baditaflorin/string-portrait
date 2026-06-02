// Pure SVG export: turn the nail sequence into a single <polyline> through the
// nail coordinates — exactly the path a pen plotter would trace. No DOM.

import type { Point } from "./stringart";

export type SvgOpts = {
  width: number;
  height: number;
  /** Stroke width in user units. */
  lineWidth: number;
  /** Stroke opacity in [0, 1]. */
  opacity: number;
  /** Thread colour. Default black. */
  stroke?: string;
  /** Background fill. Default white. */
  background?: string;
  /** Draw faint nail dots around the rim. Default false. */
  showNails?: boolean;
};

function fmt(n: number): string {
  // Compact, deterministic numbers (no trailing ".000000").
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * Render the thread (one continuous polyline through `sequence` nails) as an SVG
 * document string. `sequence` holds nail indices; `nails` the coordinates.
 */
export function sequenceToSvg(sequence: number[], nails: Point[], opts: SvgOpts): string {
  const { width, height, lineWidth, opacity } = opts;
  const stroke = opts.stroke ?? "#000000";
  const background = opts.background ?? "#ffffff";

  const pts: string[] = [];
  for (const idx of sequence) {
    const p = nails[idx];
    if (!p) continue;
    pts.push(`${fmt(p.x)},${fmt(p.y)}`);
  }

  let nailDots = "";
  if (opts.showNails) {
    const dots = nails.map((p) => `<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="1" />`).join("");
    nailDots = `<g fill="#888" stroke="none" opacity="0.5">${dots}</g>`;
  }

  const polyline =
    pts.length >= 2
      ? `<polyline fill="none" stroke="${stroke}" stroke-width="${fmt(lineWidth)}" ` +
        `stroke-opacity="${fmt(opacity)}" stroke-linecap="round" stroke-linejoin="round" ` +
        `points="${pts.join(" ")}" />`
      : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${background}" />` +
    polyline +
    nailDots +
    `</svg>`
  );
}

/**
 * The nail-sequence as a plain-text file: a header comment plus one nail index
 * per line, for physically reproducing the piece by hand.
 */
export function sequenceToText(sequence: number[], nailCount: number): string {
  const lines = [
    `# string-portrait nail sequence`,
    `# nails: ${nailCount}`,
    `# threads: ${Math.max(0, sequence.length - 1)}`,
    `# Wind one continuous thread, visiting these nail indices in order:`,
    ...sequence.map((n) => String(n)),
  ];
  return lines.join("\n") + "\n";
}
