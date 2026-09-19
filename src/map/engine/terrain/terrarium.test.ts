// LOCKED: engine code — modify only on explicit engine tasks.
import { describe, expect, it } from "vitest";

import {
  decodeTerrarium,
  decodeTerrariumPixel,
  heightStats,
  sampleBilinear,
  sampleNearest,
} from "./terrarium";

function pixels(...rgb: Array<[number, number, number]>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgb.length * 4);
  rgb.forEach(([r, g, b], i) => {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  });
  return out;
}

describe("decodeTerrariumPixel", () => {
  it("decodes known values", () => {
    expect(decodeTerrariumPixel(128, 0, 0)).toBe(0);
    expect(decodeTerrariumPixel(129, 165, 0)).toBe(421);
    expect(decodeTerrariumPixel(130, 0, 128)).toBe(512.5);
    expect(decodeTerrariumPixel(137, 165, 0)).toBe(2469); // Galdhøpiggen
    expect(decodeTerrariumPixel(0, 0, 0)).toBe(-32768);
  });
});

describe("decodeTerrarium", () => {
  it("decodes a 2×2 tile in row-major order", () => {
    const h = decodeTerrarium(
      pixels([128, 0, 0], [129, 165, 0], [130, 0, 128], [137, 165, 0]),
      2,
      2,
    );
    expect(Array.from(h)).toEqual([0, 421, 512.5, 2469]);
  });

  it("rejects short buffers", () => {
    expect(() => decodeTerrarium(new Uint8ClampedArray(7), 2, 1)).toThrow();
  });
});

describe("sampleBilinear", () => {
  const heights = new Float32Array([100, 200, 300, 400]); // 2×2

  it("returns pixel values at pixel centres", () => {
    expect(sampleBilinear(heights, 2, 2, 0.5, 0.5)).toBe(100);
    expect(sampleBilinear(heights, 2, 2, 1.5, 0.5)).toBe(200);
    expect(sampleBilinear(heights, 2, 2, 0.5, 1.5)).toBe(300);
    expect(sampleBilinear(heights, 2, 2, 1.5, 1.5)).toBe(400);
  });

  it("interpolates the midpoint between two pixels", () => {
    expect(sampleBilinear(heights, 2, 2, 1.0, 0.5)).toBe(150);
    expect(sampleBilinear(heights, 2, 2, 0.5, 1.0)).toBe(200);
    expect(sampleBilinear(heights, 2, 2, 1.0, 1.0)).toBe(250);
  });

  it("clamps outside the grid", () => {
    expect(sampleBilinear(heights, 2, 2, -5, -5)).toBe(100);
    expect(sampleBilinear(heights, 2, 2, 50, 50)).toBe(400);
  });
});

describe("sampleNearest", () => {
  it("picks the containing pixel", () => {
    const heights = new Float32Array([1, 2, 3, 4]);
    expect(sampleNearest(heights, 2, 2, 0.9, 0.1)).toBe(1);
    expect(sampleNearest(heights, 2, 2, 1.1, 1.9)).toBe(4);
  });
});

describe("heightStats", () => {
  it("finds min and max", () => {
    expect(heightStats(new Float32Array([5, -3, 12, 0]))).toEqual({ min: -3, max: 12 });
    expect(heightStats(new Float32Array([]))).toEqual({ min: 0, max: 0 });
  });
});
