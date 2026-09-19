// LOCKED: engine code — modify only on explicit engine tasks.
import { describe, expect, it } from "vitest";

import {
  bendAngle,
  bendParamsFromView,
  bendPoint,
  compressedDepth,
  compressionForHorizon,
  horizonDistance,
  remapDerivative,
  remapDistance,
  lookAheadForComposition,
  radiusForHorizon,
  screenFractionOfGround,
  softKnee,
  softKneeDerivative,
  unsoftKnee,
  type BendFractions,
  type BendParams,
  type ViewComposition,
} from "./bendMath";

const P: BendParams = {
  flatM: 300,
  transitionM: 180,
  radiusM: 360,
  compressionM: 72,
  curveExponent: 1,
  drama: 0.35,
  thetaMax: Math.PI * 0.95,
  backwardWeight: 0,
  enabled: 1,
};

const FRACTIONS: BendFractions = {
  flatFraction: 0.25,
  transitionFraction: 0.15,
  horizonScreenFraction: 0.8,
  horizonDistanceM: 150_000,
  curveExponent: 1,
  drama: 0.35,
  backwardWeight: 0,
};
const VIEW: ViewComposition = { userPointScreenFraction: 0.3, fovDeg: 50 };

function numericDerivative(f: (x: number) => number, x: number, eps = 1e-3): number {
  return (f(x + eps) - f(x - eps)) / (2 * eps);
}

describe("softKnee", () => {
  it("matches max(v, 0) outside the knee and is C¹ inside", () => {
    expect(softKnee(-200, 150)).toBe(0);
    expect(softKnee(200, 150)).toBe(200);
    expect(softKnee(0, 150)).toBeCloseTo(37.5, 10);
    expect(softKneeDerivative(-150, 150)).toBe(0);
    expect(softKneeDerivative(150, 150)).toBe(1);
    expect(softKneeDerivative(0, 150)).toBeCloseTo(0.5, 10);
    for (const v of [-100, -10, 0, 40, 149]) {
      expect(numericDerivative((x) => softKnee(x, 150), v)).toBeCloseTo(
        softKneeDerivative(v, 150),
        5,
      );
    }
  });

  it("degenerates to max(v, 0) with zero width", () => {
    expect(softKnee(-1, 0)).toBe(0);
    expect(softKnee(5, 0)).toBe(5);
  });

  it("inverts", () => {
    for (const v of [-100, 0, 60, 149, 400]) {
      const u = softKnee(v, 150);
      if (u > 0) expect(softKnee(unsoftKnee(u, 150), 150)).toBeCloseTo(u, 9);
    }
  });
});

describe("remapDistance", () => {
  it("is the identity inside the flat zone", () => {
    expect(remapDistance(0, P)).toBe(0);
    expect(remapDistance(150, P)).toBe(150);
    expect(remapDistance(300, P)).toBe(300);
    expect(compressedDepth(300, P)).toBe(0);
  });

  it("compresses beyond the flat zone and stays monotonic", () => {
    let prev = remapDistance(300, P);
    for (let d = 310; d < 200_000; d *= 1.3) {
      const f = remapDistance(d, P);
      expect(f).toBeGreaterThan(prev);
      expect(f).toBeLessThan(d);
      prev = f;
    }
    // 150 km ends up within a kilometre of remapped distance
    expect(remapDistance(150_000, P)).toBeLessThan(1200);
  });

  it("has a continuous derivative that starts at 1 and eases down (no crease)", () => {
    expect(remapDerivative(300, P)).toBe(1);
    expect(remapDerivative(301, P)).toBeGreaterThan(0.999);
    let prev = 1;
    for (let d = 300; d < 5000; d += 10) {
      const fp = remapDerivative(d, P);
      expect(fp).toBeLessThanOrEqual(prev + 1e-9);
      expect(fp).toBeCloseTo(
        numericDerivative((x) => remapDistance(x, P), d),
        5,
      );
      prev = fp;
    }
    // fully developed compression matches the pure logarithm: L / (L + u), u = d - flat - T
    const d = 300 + 2 * 180 + 1000;
    expect(remapDerivative(d, P)).toBeCloseTo(72 / (72 + (d - 300 - 180)), 9);
  });

  it("with zero transition the old hard knee is recovered", () => {
    const hard = { ...P, transitionM: 0 };
    expect(remapDistance(300, hard)).toBe(300);
    expect(remapDistance(372, hard)).toBeCloseTo(300 + 72 * Math.log(2), 9);
    expect(remapDerivative(372, hard)).toBeCloseTo(0.5, 9);
  });
});

describe("bendAngle", () => {
  it("is a circular arc for exponent 1 and reaches 90° at the same arc length for any exponent", () => {
    const quarter = (Math.PI / 2) * P.radiusM;
    expect(bendAngle(quarter / 2, P)).toBeCloseTo(Math.PI / 4, 9);
    for (const exp of [0.5, 1, 1.5, 2]) {
      const q = { ...P, curveExponent: exp };
      expect(bendAngle(quarter, q)).toBeCloseTo(Math.PI / 2, 9);
      expect(bendAngle(0, q)).toBe(0);
      // monotonic
      let prev = 0;
      for (let a = 0; a <= quarter * 1.5; a += quarter / 20) {
        const th = bendAngle(a, q);
        expect(th).toBeGreaterThanOrEqual(prev);
        prev = th;
      }
    }
    // exponent < 1 rises early, > 1 rises late
    expect(bendAngle(quarter / 2, { ...P, curveExponent: 0.5 })).toBeGreaterThan(Math.PI / 4);
    expect(bendAngle(quarter / 2, { ...P, curveExponent: 2 })).toBeLessThan(Math.PI / 4);
  });
});

describe("bendPoint", () => {
  it("leaves the user point and the flat zone untouched", () => {
    expect(bendPoint(0, 0, 0, P)).toEqual({ x: 0, y: 0, z: 0, theta: 0 });
    const q = bendPoint(50, 120, -299, P);
    expect(q).toEqual({ x: 50, y: 120, z: -299, theta: 0 });
  });

  it("never touches x", () => {
    for (const d of [10, 500, 5000, 100_000]) {
      expect(bendPoint(-1234.5, 0, -d, P).x).toBe(-1234.5);
    }
  });

  it("keeps terrain behind the user flat when backwardWeight is 0", () => {
    expect(bendPoint(0, 80, 5000, P)).toEqual({ x: 0, y: 80, z: 5000, theta: 0 });
  });

  it("bends terrain behind the user when backwardWeight is 1", () => {
    const b = bendPoint(0, 0, 5000, { ...P, backwardWeight: 1 });
    const f = bendPoint(0, 0, -5000, P);
    expect(b.z).toBeCloseTo(-f.z, 9);
    expect(b.y).toBeCloseTo(f.y, 9);
  });

  it("is smooth across the start of the transition (position and slope)", () => {
    const yAt = (d: number) => bendPoint(0, 0, -d, P).y;
    const fwdAt = (d: number) => -bendPoint(0, 0, -d, P).z;
    // slope of the ground surface: dy/dforward, must approach 0 at the flat edge
    for (const d of [300.5, 302, 310, 330]) {
      const slope = numericDerivative(yAt, d) / numericDerivative(fwdAt, d);
      expect(Math.abs(slope)).toBeLessThan(0.05);
    }
    expect(Math.abs(numericDerivative(yAt, 300.5))).toBeLessThan(1e-3);
    expect(numericDerivative(fwdAt, 300.5)).toBeCloseTo(1, 2);
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
    // at the horizon the surface is vertical: y = -R, forward = base + R
    const h = bendPoint(0, 0, -horizon, P);
    expect(h.theta).toBeCloseTo(Math.PI / 2, 6);
    expect(h.y).toBeCloseTo(-P.radiusM, 3);
    expect(-h.z).toBeCloseTo(P.flatM + P.transitionM + P.radiusM, 0);
  });

  it("horizon distance is consistent for every curve exponent", () => {
    for (const exp of [0.6, 1, 1.8]) {
      const q = { ...P, curveExponent: exp };
      expect(bendPoint(0, 0, -horizonDistance(q), q).theta).toBeCloseTo(Math.PI / 2, 6);
    }
  });

  it("clamps theta so the far world does not wrap back up", () => {
    const clamped = { ...P, thetaMax: 1.5 };
    expect(bendPoint(0, 0, -10_000_000, clamped).theta).toBeCloseTo(1.5, 9);
    const unclamped = bendPoint(0, 0, -10_000_000, P);
    expect(unclamped.theta).toBeGreaterThan(Math.PI / 2);
    expect(unclamped.theta).toBeLessThan(P.thetaMax);
    expect(unclamped.y).toBeLessThan(-P.radiusM);
  });

  it("shrinks heights in the compressed zone according to drama", () => {
    const d = 100_000;
    const tall = bendPoint(0, 2000, -d, { ...P, drama: 1 });
    const flat = bendPoint(0, 0, -d, { ...P, drama: 1 });
    const scale = remapDerivative(d, P);
    expect(Math.hypot(tall.y - flat.y, tall.z - flat.z)).toBeCloseTo(2000 * scale, 3);

    const dramatic = bendPoint(0, 2000, -d, { ...P, drama: 0 });
    expect(Math.hypot(dramatic.y - flat.y, dramatic.z - flat.z)).toBeCloseTo(2000, 3);
  });

  it("is the identity when disabled (classic 3D)", () => {
    expect(bendPoint(3, 900, -80_000, { ...P, enabled: 0 })).toEqual({
      x: 3,
      y: 900,
      z: -80_000,
      theta: 0,
    });
  });

  it("blends linearly for partial enable", () => {
    const full = bendPoint(0, 0, -20_000, P);
    const half = bendPoint(0, 0, -20_000, { ...P, enabled: 0.5 });
    expect(half.y).toBeCloseTo(full.y / 2, 9);
    expect(half.z).toBeCloseTo((-20_000 + full.z) / 2, 9);
  });
});

describe("compressionForHorizon", () => {
  it("solves L so the requested depth lands on the horizon", () => {
    const cases: Array<[number, number]> = [
      [110, 150_000],
      [360, 150_000],
      [1509, 150_000],
      [50, 5_000],
    ];
    for (const [R, depth] of cases) {
      const L = compressionForHorizon(R, depth);
      const reach = L * (Math.exp(((Math.PI / 2) * R) / L) - 1);
      expect(reach / depth).toBeCloseTo(1, 6);
    }
  });

  it("returns a huge L when the depth is closer than the arc itself", () => {
    expect(compressionForHorizon(1000, 100)).toBeGreaterThan(1e8);
  });
});

describe("bendParamsFromView", () => {
  it("derives radius and compression so the horizon lands where asked, at the asked distance", () => {
    for (const h of [600, 1200, 5000, 20_000]) {
      const p = bendParamsFromView(h, FRACTIONS, VIEW);
      const lookAhead = lookAheadForComposition(h, VIEW);
      expect(horizonDistance(p)).toBeCloseTo(150_000, -1);
      const frac = screenFractionOfGround(horizonDistance(p), p, h, lookAhead, VIEW.fovDeg);
      expect(frac).toBeCloseTo(0.8, 4);
      expect(p.radiusM / h).toBeCloseTo(
        bendParamsFromView(1200, FRACTIONS, VIEW).radiusM / 1200,
        9,
      );
    }
  });

  it("keeps metres proportional to camera height", () => {
    const a = bendParamsFromView(1200, FRACTIONS, VIEW);
    const b = bendParamsFromView(2400, FRACTIONS, VIEW);
    expect(a.flatM).toBe(300);
    expect(a.transitionM).toBe(180);
    expect(b.radiusM).toBeCloseTo(2 * a.radiusM, 6);
  });

  it("places the user point where asked, including below the screen edge", () => {
    const p = bendParamsFromView(1200, FRACTIONS, VIEW);
    expect(screenFractionOfGround(0, p, 1200, lookAheadForComposition(1200, VIEW), 50)).toBeCloseTo(
      0.3,
      9,
    );
    const below: ViewComposition = { userPointScreenFraction: -0.4, fovDeg: 50 };
    const q = bendParamsFromView(1200, FRACTIONS, below);
    const la = lookAheadForComposition(1200, below);
    expect(screenFractionOfGround(0, q, 1200, la, 50)).toBeCloseTo(-0.4, 9);
    // the horizon still lands at 0.8 and 150 km — radius and compression adapted
    expect(screenFractionOfGround(horizonDistance(q), q, 1200, la, 50)).toBeCloseTo(0.8, 4);
    expect(horizonDistance(q)).toBeCloseTo(150_000, -1);
    expect(q.radiusM).toBeGreaterThan(p.radiusM);
  });

  it("clamps the radius when the requested horizon is unreachable", () => {
    const r = radiusForHorizon(1200, 300, 180, 100, 0.2, 50); // horizon below where the flat zone ends
    expect(r).toBeCloseTo(0.02 * 1200, 9);
    expect(radiusForHorizon(1200, 300, 180, 200, 1.6, 50)).toBeCloseTo(0.02 * 1200, 9); // asymptote
  });
});
