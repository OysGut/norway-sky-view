// LOCKED: engine code — modify only on explicit engine tasks.
//
// JS reference implementation of the Bent World deformation. The GLSL chunk in
// shaders/bend.glsl.ts implements the SAME math; keep them in lockstep and let
// bendMath.test.ts guard the JS side. Used for CPU picking on the collision mesh
// and for derived readouts (horizon distance etc.).
//
// Scene frame: x = east/right, y = up, z = -forward (screen top is -z when the
// world root has been rotated by heading). The camera is fixed above the origin
// looking straight down, so "forward distance" d = -z is measured in world space.
//
// Pipeline for a point (x, y, z):
//   d      = |z|                        forward distance (behind the user when z > 0)
//   f(d)   = remapDistance(d)           linear inside the flat zone, logarithmic beyond
//   a      = knee(f - flat, feather)    arc length on the cylinder, C¹ at the flat edge
//   base   = f - a                      the unbent part (≈ flat)
//   θ      = min(a / R, θmax)           angle around the cylinder
//   yEff   = y · f'(d)^drama            heights shrink with the compression ("Dramatikk")
//   out    = (x, (R + yEff) cosθ - R, -(base + (R + yEff) sinθ) · sign)
// Points behind the user are bent with weight `backwardWeight` (0 = kept flat).

export interface BendParams {
  /** Flat, orthographic-like zone around the user, metres of forward distance. */
  flatM: number;
  /** Artistic cylinder radius, metres. */
  radiusM: number;
  /** Compression length L of the logarithmic remap, metres. Smaller = more compression. */
  compressionM: number;
  /** Exponent applied to f'(d) when scaling heights: 0 = full height (dramatic), 1 = true scale. */
  drama: number;
  /** Feather half-width of the C¹ knee at the flat-zone edge, metres. */
  featherM: number;
  /** Clamp of the cylinder angle, radians (keeps far terrain from wrapping back up). */
  thetaMax: number;
  /** 0 = terrain behind the user stays flat, 1 = bent like the front. */
  backwardWeight: number;
  /** 0 = classic 3D (no bend), 1 = full Bent World. */
  enabled: number;
}

export interface BendFractions {
  flatFraction: number;
  radiusFraction: number;
  compressionFraction: number;
  drama: number;
  backwardWeight: number;
}

export const DEFAULT_THETA_MAX = Math.PI * 0.95;

/** Build metre-based params from camera-height fractions (screen composition stays constant). */
export function bendParamsFromView(
  cameraHeightM: number,
  fractions: BendFractions,
  enabled: number = 1,
): BendParams {
  const flatM = Math.max(1, fractions.flatFraction * cameraHeightM);
  return {
    flatM,
    radiusM: Math.max(1, fractions.radiusFraction * cameraHeightM),
    compressionM: Math.max(0.01, fractions.compressionFraction * cameraHeightM),
    drama: fractions.drama,
    featherM: flatM * 0.5,
    thetaMax: DEFAULT_THETA_MAX,
    backwardWeight: fractions.backwardWeight,
    enabled,
  };
}

/** f(d): identity inside the flat zone, logarithmic compression beyond it. C¹. */
export function remapDistance(d: number, p: BendParams): number {
  if (d <= p.flatM) return d;
  return p.flatM + p.compressionM * Math.log(1 + (d - p.flatM) / p.compressionM);
}

/** f'(d) */
export function remapDerivative(d: number, p: BendParams): number {
  if (d <= p.flatM) return 1;
  return p.compressionM / (p.compressionM + d - p.flatM);
}

/** Inverse of remapDistance. */
export function unremapDistance(f: number, p: BendParams): number {
  if (f <= p.flatM) return f;
  return p.flatM + p.compressionM * (Math.exp((f - p.flatM) / p.compressionM) - 1);
}

/** Smooth max(u, 0) with a quadratic knee of half-width w. C¹. */
export function knee(u: number, w: number): number {
  if (w <= 0) return Math.max(u, 0);
  if (u <= -w) return 0;
  if (u >= w) return u;
  return ((u + w) * (u + w)) / (4 * w);
}

export interface BentPoint {
  x: number;
  y: number;
  z: number;
  /** Cylinder angle actually used, radians (0 inside the flat zone). */
  theta: number;
}

/** Bend a world-space point. Pure; allocates one small object. */
export function bendPoint(x: number, y: number, z: number, p: BendParams): BentPoint {
  const sign = z < 0 ? 1 : z > 0 ? -1 : 0; // +1 = in front of the user
  const weight = (sign >= 0 ? 1 : p.backwardWeight) * p.enabled;
  if (weight <= 0 || sign === 0) return { x, y, z, theta: 0 };

  const d = Math.abs(z);
  const f = remapDistance(d, p);
  const a = knee(f - p.flatM, p.featherM);
  const base = f - a;
  const theta = Math.min(a / p.radiusM, p.thetaMax);
  const yEff = y * Math.pow(remapDerivative(d, p), p.drama);
  const rr = p.radiusM + yEff;

  const bentY = rr * Math.cos(theta) - p.radiusM;
  const bentZ = -(base + rr * Math.sin(theta)) * sign;

  if (weight >= 1) return { x, y: bentY, z: bentZ, theta };
  return {
    x,
    y: y + (bentY - y) * weight,
    z: z + (bentZ - z) * weight,
    theta: theta * weight,
  };
}

/** Forward distance (metres, unremapped) that lands exactly on the horizon (θ = 90°). */
export function horizonDistance(p: BendParams): number {
  const arc = (Math.PI / 2) * p.radiusM;
  // knee is negligible here (arc >> feather); invert f - flat = arc
  return unremapDistance(p.flatM + arc, p);
}

/**
 * Where a ground point at forward distance d ends up on screen, as a fraction of the
 * viewport height from the bottom, for a camera at height h looking straight down at a
 * target `lookAheadM` in front of the origin with the given vertical field of view.
 */
export function screenFractionOfGround(
  d: number,
  p: BendParams,
  cameraHeightM: number,
  lookAheadM: number,
  fovDeg: number,
): number {
  const bent = bendPoint(0, 0, -d, p);
  const forward = -bent.z;
  const depth = cameraHeightM - bent.y;
  const halfHeightAtDepth = depth * Math.tan((fovDeg * Math.PI) / 360);
  return 0.5 + (forward - lookAheadM) / (2 * halfHeightAtDepth);
}
