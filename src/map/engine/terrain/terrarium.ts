// LOCKED: engine code — modify only on explicit engine tasks.
//
// Terrarium elevation encoding (AWS Terrain Tiles / Mapzen):
//   height_m = R * 256 + G + B / 256 - 32768
// Pure functions on typed arrays; safe to run in a worker.

export const TERRARIUM_OFFSET = 32768;

/** Height at which we treat a Terrarium sample as "no data" (sea-floor tiles go to −11 000). */
export const TERRARIUM_NODATA_BELOW = -12_000;

export interface HeightStats {
  min: number;
  max: number;
}

/**
 * Decode RGBA pixels (row-major, 4 bytes per pixel) into metres.
 * The output has one float per pixel in the same row-major order.
 */
export function decodeTerrarium(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const count = width * height;
  if (rgba.length < count * 4) {
    throw new Error(`decodeTerrarium: expected ${count * 4} bytes, got ${rgba.length}`);
  }
  const out = new Float32Array(count);
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    const r = rgba[p] ?? 0;
    const g = rgba[p + 1] ?? 0;
    const b = rgba[p + 2] ?? 0;
    out[i] = r * 256 + g + b / 256 - TERRARIUM_OFFSET;
  }
  return out;
}

/** Decode a single pixel — handy for tests and picking. */
export function decodeTerrariumPixel(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - TERRARIUM_OFFSET;
}

function clampIndex(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}

/**
 * Bilinear sample at fractional pixel coordinates. `px, py` are measured from the
 * top-left corner of the top-left pixel, so the centre of pixel (0,0) is (0.5, 0.5).
 * Coordinates outside the grid are clamped to the edge.
 */
export function sampleBilinear(
  heights: Float32Array,
  width: number,
  height: number,
  px: number,
  py: number,
): number {
  const fx = clampIndex(px - 0.5, width - 1);
  const fy = clampIndex(py - 0.5, height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const h00 = heights[y0 * width + x0] ?? 0;
  const h10 = heights[y0 * width + x1] ?? 0;
  const h01 = heights[y1 * width + x0] ?? 0;
  const h11 = heights[y1 * width + x1] ?? 0;

  const top = h00 + (h10 - h00) * tx;
  const bottom = h01 + (h11 - h01) * tx;
  return top + (bottom - top) * ty;
}

/** Nearest-neighbour sample, same coordinate convention as sampleBilinear. */
export function sampleNearest(
  heights: Float32Array,
  width: number,
  height: number,
  px: number,
  py: number,
): number {
  const x = clampIndex(Math.floor(px), width - 1);
  const y = clampIndex(Math.floor(py), height - 1);
  return heights[y * width + x] ?? 0;
}

export function heightStats(heights: Float32Array): HeightStats {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i] ?? 0;
    if (h < min) min = h;
    if (h > max) max = h;
  }
  if (heights.length === 0) return { min: 0, max: 0 };
  return { min, max };
}
