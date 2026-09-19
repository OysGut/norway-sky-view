// LOCKED: engine code — modify only on explicit engine tasks.
//
// GLSL twin of bendMath.ts. Every material that takes part in the Bent World
// (terrain, ships, markers, photo cones, routes, labels) includes this chunk and
// calls bendWorld() on its WORLD-space position. Keep the math identical to
// bendMath.bendPoint — the JS side is what the unit tests check.

import type { BendParams } from "../bendMath";

export const BEND_UNIFORM_NAMES = [
  "uBendFlat",
  "uBendRadius",
  "uBendCompression",
  "uBendDrama",
  "uBendFeather",
  "uBendThetaMax",
  "uBendBackward",
  "uBendEnabled",
] as const;

export type BendUniformName = (typeof BEND_UNIFORM_NAMES)[number];

export type BendUniforms = Record<BendUniformName, { value: number }>;

export function createBendUniforms(p: BendParams): BendUniforms {
  return {
    uBendFlat: { value: p.flatM },
    uBendRadius: { value: p.radiusM },
    uBendCompression: { value: p.compressionM },
    uBendDrama: { value: p.drama },
    uBendFeather: { value: p.featherM },
    uBendThetaMax: { value: p.thetaMax },
    uBendBackward: { value: p.backwardWeight },
    uBendEnabled: { value: p.enabled },
  };
}

/** Copy params into an existing uniform set (call once per frame; no allocation). */
export function updateBendUniforms(u: BendUniforms, p: BendParams): void {
  u.uBendFlat.value = p.flatM;
  u.uBendRadius.value = p.radiusM;
  u.uBendCompression.value = p.compressionM;
  u.uBendDrama.value = p.drama;
  u.uBendFeather.value = p.featherM;
  u.uBendThetaMax.value = p.thetaMax;
  u.uBendBackward.value = p.backwardWeight;
  u.uBendEnabled.value = p.enabled;
}

/** Uniform declarations + bend functions. Prepend to a vertex shader before main(). */
export const BEND_GLSL = /* glsl */ `
uniform float uBendFlat;
uniform float uBendRadius;
uniform float uBendCompression;
uniform float uBendDrama;
uniform float uBendFeather;
uniform float uBendThetaMax;
uniform float uBendBackward;
uniform float uBendEnabled;

// f(d): identity inside the flat zone, logarithmic compression beyond. C1.
float bendRemap(float d) {
  if (d <= uBendFlat) return d;
  return uBendFlat + uBendCompression * log(1.0 + (d - uBendFlat) / uBendCompression);
}

// f'(d)
float bendRemapDeriv(float d) {
  if (d <= uBendFlat) return 1.0;
  return uBendCompression / (uBendCompression + d - uBendFlat);
}

// Smooth max(u, 0) with a quadratic knee of half-width w. C1.
float bendKnee(float u, float w) {
  if (w <= 0.0) return max(u, 0.0);
  if (u <= -w) return 0.0;
  if (u >= w) return u;
  return (u + w) * (u + w) / (4.0 * w);
}

// Bend a WORLD-space point. Forward is -z; the user stands at the origin.
vec3 bendWorld(vec3 p) {
  float sgn = p.z < 0.0 ? 1.0 : (p.z > 0.0 ? -1.0 : 0.0);
  float weight = (sgn >= 0.0 ? 1.0 : uBendBackward) * uBendEnabled;
  if (weight <= 0.0 || sgn == 0.0) return p;

  float d = abs(p.z);
  float f = bendRemap(d);
  float a = bendKnee(f - uBendFlat, uBendFeather);
  float base = f - a;
  float theta = min(a / uBendRadius, uBendThetaMax);
  float yEff = p.y * pow(bendRemapDeriv(d), uBendDrama);
  float rr = uBendRadius + yEff;

  vec3 bent = vec3(p.x, rr * cos(theta) - uBendRadius, -(base + rr * sin(theta)) * sgn);
  return mix(p, bent, weight);
}
`;
