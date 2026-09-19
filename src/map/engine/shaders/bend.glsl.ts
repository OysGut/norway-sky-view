// LOCKED: engine code — modify only on explicit engine tasks.
//
// GLSL twin of bendMath.ts. Every material that takes part in the Bent World
// (terrain, ships, markers, photo cones, routes, labels) includes this chunk and
// calls bendWorld() on its WORLD-space position. Keep the math identical to
// bendMath.bendPoint — the JS side is what the unit tests check.

import type { BendParams } from "../bendMath";

export const BEND_UNIFORM_NAMES = [
  "uBendFlat",
  "uBendTransition",
  "uBendRadius",
  "uBendCompression",
  "uBendCurveExponent",
  "uBendDrama",
  "uBendThetaMax",
  "uBendBackward",
  "uBendEnabled",
  "uEarthCurvature",
] as const;

export type BendUniformName = (typeof BEND_UNIFORM_NAMES)[number];

export type BendUniforms = Record<BendUniformName, { value: number }>;

export function createBendUniforms(p: BendParams): BendUniforms {
  return {
    uBendFlat: { value: p.flatM },
    uBendTransition: { value: p.transitionM },
    uBendRadius: { value: p.radiusM },
    uBendCompression: { value: p.compressionM },
    uBendCurveExponent: { value: p.curveExponent },
    uBendDrama: { value: p.drama },
    uBendThetaMax: { value: p.thetaMax },
    uBendBackward: { value: p.backwardWeight },
    uBendEnabled: { value: p.enabled },
    uEarthCurvature: { value: p.earthCurvature },
  };
}

/** Copy params into an existing uniform set (call once per frame; no allocation). */
export function updateBendUniforms(u: BendUniforms, p: BendParams): void {
  u.uBendFlat.value = p.flatM;
  u.uBendTransition.value = p.transitionM;
  u.uBendRadius.value = p.radiusM;
  u.uBendCompression.value = p.compressionM;
  u.uBendCurveExponent.value = p.curveExponent;
  u.uBendDrama.value = p.drama;
  u.uBendThetaMax.value = p.thetaMax;
  u.uBendBackward.value = p.backwardWeight;
  u.uBendEnabled.value = p.enabled;
  u.uEarthCurvature.value = p.earthCurvature;
}

/** Uniform declarations + bend functions. Prepend to a vertex shader before main(). */
export const BEND_GLSL = /* glsl */ `
uniform float uBendFlat;
uniform float uBendTransition;
uniform float uBendRadius;
uniform float uBendCompression;
uniform float uBendCurveExponent;
uniform float uBendDrama;
uniform float uBendThetaMax;
uniform float uBendBackward;
uniform float uBendEnabled;
uniform float uEarthCurvature;

// Smooth max(v, 0) with a quadratic knee of half-width w. C1.
float bendSoftKnee(float v, float w) {
  if (w <= 0.0) return max(v, 0.0);
  if (v <= -w) return 0.0;
  if (v >= w) return v;
  return (v + w) * (v + w) / (4.0 * w);
}

float bendSoftKneeDeriv(float v, float w) {
  if (w <= 0.0) return v > 0.0 ? 1.0 : 0.0;
  if (v <= -w) return 0.0;
  if (v >= w) return 1.0;
  return (v + w) / (2.0 * w);
}

// Angle around the cylinder for an arc length a, with the art-directed profile.
float bendAngle(float a) {
  float quarter = 1.5707963267948966 * uBendRadius;
  float theta;
  if (a >= quarter) {
    theta = 1.5707963267948966 + (a - quarter) / uBendRadius;
  } else if (uBendCurveExponent == 1.0) {
    theta = a / uBendRadius;
  } else {
    theta = 1.5707963267948966 * pow(a / quarter, uBendCurveExponent);
  }
  return min(theta, uBendThetaMax);
}

// Bend a WORLD-space point. Forward is -z; the user stands at the origin.
// Also outputs the cylinder angle actually used (weighted) and the forward sign,
// so callers can rotate normals consistently.
vec3 bendWorldTheta(vec3 p, out float thetaOut, out float sgnOut) {
  // physical curvature: the world falls away from the viewer's tangent plane
  p.y -= (p.x * p.x + p.z * p.z) * uEarthCurvature;

  float sgn = p.z < 0.0 ? 1.0 : (p.z > 0.0 ? -1.0 : 0.0);
  float weight = (sgn >= 0.0 ? 1.0 : uBendBackward) * uBendEnabled;
  thetaOut = 0.0;
  sgnOut = sgn;
  if (weight <= 0.0 || sgn == 0.0) return p;

  float d = abs(p.z);
  float v = d - uBendFlat - uBendTransition;
  float u = bendSoftKnee(v, uBendTransition);
  if (u <= 0.0) return p;

  float base = d - u;
  float a = uBendCompression * log(1.0 + u / uBendCompression);
  float theta = bendAngle(a);
  float fPrime = 1.0 - bendSoftKneeDeriv(v, uBendTransition) * u / (uBendCompression + u);
  float yEff = p.y * pow(max(fPrime, 1e-6), uBendDrama);
  float rr = uBendRadius + yEff;

  vec3 bent = vec3(p.x, rr * cos(theta) - uBendRadius, -(base + rr * sin(theta)) * sgn);
  thetaOut = theta * weight;
  return mix(p, bent, weight);
}

vec3 bendWorld(vec3 p) {
  float t;
  float s;
  return bendWorldTheta(p, t, s);
}

// Rotate a world-space normal to follow the bend: the local frame turns by theta
// around the x axis (mirrored for points behind the user).
vec3 bendNormal(vec3 n, float theta, float sgn) {
  float phi = -theta * sgn;
  float c = cos(phi);
  float s = sin(phi);
  return vec3(n.x, n.y * c - n.z * s, n.y * s + n.z * c);
}
`;
