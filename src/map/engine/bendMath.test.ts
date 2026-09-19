// LOCKED: engine code — modify only on explicit engine tasks.
import { describe, expect, it } from "vitest";

import {
  bendParamsFromView,
  bendPoint,
  horizonDistance,
  knee,
  remapDerivative,
  remapDistance,
  screenFractionOfGround,
  unremapDistance,
  type BendParams,
} from "./bendMath";

const P: BendParams = {
  flatM: 300,
  radiusM: 360,
  compressionM: 72,
  drama: 0.35,
  featherM: 150,
  thetaMax: Math.PI * 0.95,
  backwardWeight: 0,
  enabled: 1,
};

describe("remapDistance", () => {
  it("is the identity inside the flat zone", () => {
    expect(remapDistance(0, P)).toBe(0);
    expect(remapDistance(150, P)).toBe(150);
    expect(remapDistance(300, P)).toBe(300);
  });

  it("compresses logarithmically beyond it and stays monotonic", () => {
    let prev = remapDistance(300, P);
    for (let d = 310; d < 200_000; d *= 1.3) {
      const f = remapDistance(d, P);
      expect(f).toBeGreaterThan(prev);
      expect(f).toBeLessThan(d);
      prev = f;
    }
    // 150 km ends up within a few hundred metres of arc
    expect(remapDistance(150_000, P) - P.flatM).toBeLessThan(700);
  });

  it("is C¹ at the flat-zone edge", () => {
    const eps = 1e-3;
    const left = (remapDistance(300, P) - remapDistance(300 - eps, P)) / eps;
    const right = (remapDistance(300 + eps, P) - remapDistance(300, P)) / eps;
    expect(left).toBeCloseTo(1, 4);
    expect(right).toBeCloseTo(1, 4);
    expect(remapDerivative(300, P)).toBe(1);
    expect(remapDerivative(300 + 72, P)).toBeCloseTo(0.5, 10);
  });

  it("round-trips through unremapDistance", () => {
    for (const d of [10, 300, 1000, 25_000, 150_000]) {
      expect(unremapDistance(remapDistance(d, P), P)).toBeCloseTo(d, 6);
    }
  });
});

describe("knee", () => {
  it("matches max(u, 0) outside the feather and is C¹ inside", () => {
    expect(knee(-200, 150)).toBe(0);
    expect(knee(200, 150)).toBe(200);
    expect(knee(0, 150)).toBeCloseTo(37.5, 10);
    const eps = 1e-4;
    const dLeft = (knee(-150 + eps, 150) - knee(-150, 150)) / eps;
    const dRight = (knee(150, 150) - knee(150 - eps, 150)) / eps;
    expect(dLeft).toBeCloseTo(0, 3);
    expect(dRight).toBeCloseTo(1, 3);
  });

  it("degenerates to max(u, 0) with zero width", () => {
    expect(knee(-1, 0)).toBe(0);
    expect(knee(5, 0)).toBe(5);
  });
});

describe("bendPoint", () => {
  it("leaves the user point and the deep flat zone untouched", () => {
    expect(bendPoint(0, 0, 0, P)).toEqual({ x: 0, y: 0, z: 0, theta: 0 });
    const q = bendPoint(50, 120, -100, P); // well inside flat - feather
    expect(q.x).toBe(50);
    expect(q.y).toBeCloseTo(120, 9);
    expect(q.z).toBeCloseTo(-100, 9);
    expect(q.theta).toBe(0);
  });

  it("never touches x", () => {
    for (const d of [10, 500, 5000, 100_000]) {
      expect(bendPoint(-1234.5, 0, -d, P).x).toBe(-1234.5);
    }
  });

  it("keeps terrain behind the user flat when backwardWeight is 0", () => {
    const b = bendPoint(0, 80, 5000, P);
    expect(b).toEqual({ x: 0, y: 80, z: 5000, theta: 0 });
  });

  it("bends terrain behind the user when backwardWeight is 1", () => {
    const b = bendPoint(0, 0, 5000, { ...P, backwardWeight: 1 });
    const f = bendPoint(0, 0, -5000, P);
    expect(b.z).toBeCloseTo(-f.z, 9);
    expect(b.y).toBeCloseTo(f.y, 9);
  });

  it("curls far terrain down and away, monotonically in forward distance until the horizon", () => {
    let prevForward = 0;
    let prevY = 0;
    const horizon = horizonDistance(P);
    for (let d = 100; d < horizon; d *= 1.2) {
      const b = bendPoint(0, 0, -d, P);
      const forward = -b.z;
      expect(forward).toBeGreaterThan(prevForward);
      expect(b.y).toBeLessThanOrEqual(prevY + 1e-9);
      prevForward = forward;
      prevY = b.y;
    }
    // at the horizon the surface is vertical: y = -R, forward = flat + R (up to knee)
    const h = bendPoint(0, 0, -horizon, P);
    expect(h.y).toBeCloseTo(-P.radiusM, 3);
    expect(-h.z).toBeCloseTo(P.flatM + P.radiusM, 0);
  });

  it("clamps theta so the far world does not wrap back up", () => {
    const clamped = { ...P, thetaMax: 1.5 };
    const far = bendPoint(0, 0, -10_000_000, clamped);
    expect(far.theta).toBeCloseTo(1.5, 9);
    // with the default clamp the logarithm alone keeps theta finite and past the horizon
    const unclamped = bendPoint(0, 0, -10_000_000, P);
    expect(unclamped.theta).toBeGreaterThan(Math.PI / 2);
    expect(unclamped.theta).toBeLessThan(P.thetaMax);
    expect(unclamped.y).toBeLessThan(-P.radiusM); // below the cylinder axis, hidden under the near map
  });

  it("shrinks heights in the compressed zone according to drama", () => {
    const tall = bendPoint(0, 2000, -100_000, { ...P, drama: 1 });
    const flat = bendPoint(0, 0, -100_000, { ...P, drama: 1 });
    const scale = remapDerivative(100_000, P); // f'
    const rrDiff = Math.hypot(tall.y - flat.y, tall.z - flat.z);
    expect(rrDiff).toBeCloseTo(2000 * scale, 3);

    const dramatic = bendPoint(0, 2000, -100_000, { ...P, drama: 0 });
    const rrDramatic = Math.hypot(dramatic.y - flat.y, dramatic.z - flat.z);
    expect(rrDramatic).toBeCloseTo(2000, 3);
  });

  it("is the identity when disabled (classic 3D)", () => {
    const b = bendPoint(3, 900, -80_000, { ...P, enabled: 0 });
    expect(b).toEqual({ x: 3, y: 900, z: -80_000, theta: 0 });
  });

  it("blends linearly for partial enable", () => {
    const full = bendPoint(0, 0, -20_000, P);
    const half = bendPoint(0, 0, -20_000, { ...P, enabled: 0.5 });
    expect(half.y).toBeCloseTo(full.y / 2, 9);
    expect(half.z).toBeCloseTo((-20_000 + full.z) / 2, 9);
  });
});

describe("bendParamsFromView", () => {
  it("scales with camera height so the composition stays constant", () => {
    const f = {
      flatFraction: 0.25,
      radiusFraction: 0.3,
      compressionFraction: 0.06,
      drama: 0.35,
      backwardWeight: 0,
    };
    const a = bendParamsFromView(1200, f);
    const b = bendParamsFromView(2400, f);
    expect(a.flatM).toBe(300);
    expect(a.radiusM).toBe(360);
    expect(a.compressionM).toBeCloseTo(72, 9);
    expect(b.radiusM).toBe(2 * a.radiusM);
    // horizon distance in the world grows with camera height, screen position does not
    expect(horizonDistance(b)).toBeGreaterThan(horizonDistance(a));
    const fa = screenFractionOfGround(horizonDistance(a), a, 1200, 0.2 * 1200, 50);
    const fb = screenFractionOfGround(horizonDistance(b), b, 2400, 0.2 * 2400, 50);
    expect(fa).toBeCloseTo(fb, 6);
  });

  it("puts the horizon in the upper part of the screen with the defaults", () => {
    const p = bendParamsFromView(1200, {
      flatFraction: 0.25,
      radiusFraction: 0.3,
      compressionFraction: 0.06,
      drama: 0.35,
      backwardWeight: 0,
    });
    const horizon = horizonDistance(p);
    expect(horizon).toBeGreaterThan(50_000); // tens of kilometres of terrain reach the horizon
    const frac = screenFractionOfGround(horizon, p, 1200, 0.2 * 1200, 50);
    expect(frac).toBeGreaterThan(0.6);
    expect(frac).toBeLessThan(0.95);
    // the user point itself sits in the lower part of the screen
    expect(screenFractionOfGround(0, p, 1200, 0.2 * 1200, 50)).toBeCloseTo(
      0.5 - 0.2 / (2 * Math.tan((25 * Math.PI) / 180)),
      6,
    );
  });
});
