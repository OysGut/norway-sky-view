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
//   d     = |z|                                forward distance (behind the user when z > 0)
//   u     = softKnee(d - flat - T, T)          how far into the compressed zone we are; 0 inside
//                                              the flat zone, ramping in smoothly over 2T (C¹)
//   base  = d - u                              the part that stays at true scale
//   a     = L · ln(1 + u / L)                  compressed arc length (logarithmic remap)
//   θ     = profile(a)                         angle around the cylinder; circular when
//                                              curveExponent = 1 (θ = a / R), else a power
//                                              profile that reaches 90° at the same arc length
//   f'    = 1 - u' · u / (L + u)               derivative of the remapped distance (C¹, starts at 1)
//   yEff  = y · f'^drama                       heights shrink with the compression ("Dramatikk")
//   s     = 1 / (1 + u / P)                    lateral convergence: sideways offsets shrink with the
//                                              depth into the compressed zone so far terrain gathers
//                                              toward a vanishing point (P = ∞ disables)
//   out   = (x · s, (R + yEff) cosθ - R, -(base + (R + yEff) sinθ) · sign)
// Points behind the user are bent with weight `backwardWeight` (0 = kept flat).

export interface BendParams {
  /** Flat, true-scale zone in front of the user, metres of forward distance. */
  flatM: number;
  /** Half-width of the transition into compression, metres. Compression starts at flatM and is fully developed at flatM + 2·transitionM. */
  transitionM: number;
  /** Artistic cylinder radius, metres. */
  radiusM: number;
  /** Compression length L of the logarithmic remap, metres. Smaller = more compression. */
  compressionM: number;
  /** Shape of the bend profile: 1 = circular arc, < 1 rises early then eases, > 1 stays flat longer then rises steeply. */
  curveExponent: number;
  /** Exponent applied to f'(d) when scaling heights: 0 = full height (dramatic), 1 = true scale. */
  drama: number;
  /** Clamp of the cylinder angle, radians (keeps far terrain from wrapping back up). */
  thetaMax: number;
  /** 0 = terrain behind the user stays flat, 1 = bent like the front. */
  backwardWeight: number;
  /**
   * Lateral convergence distance P, metres: sideways offsets in the compressed zone are
   * scaled by 1 / (1 + u / P), which gives far terrain a vanishing point like a real
   * perspective (a point at azimuth ψ ends up at x ≈ P · tan ψ). Infinity disables.
   */
  lateralDistanceM: number;
  /** 0 = classic 3D (no bend), 1 = full Bent World. */
  enabled: number;
  /**
   * Physical earth curvature applied in unbent space before the artistic bend:
   * y -= (x² + z²) · earthCurvature, with earthCurvature = 1 / (2 R_eff). 0 disables.
   */
  earthCurvature: number;
}

/** Earth radius with standard atmospheric refraction (k = 0.13): R / (1 − k). */
export const EFFECTIVE_EARTH_RADIUS_M = 6_371_000 / (1 - 0.13);
/** 1 / (2 R_eff): drop per metre² of horizontal distance. */
export const EARTH_CURVATURE = 1 / (2 * EFFECTIVE_EARTH_RADIUS_M);

/** Drop of the earth's surface below the tangent plane at horizontal distance d (metres). */
export function curvatureDrop(distanceM: number, curvature: number = EARTH_CURVATURE): number {
  return distanceM * distanceM * curvature;
}

export interface BendFractions {
  flatFraction: number;
  transitionFraction: number;
  /** Where the horizon line should sit on screen, fraction of viewport height from the bottom. The cylinder radius is derived from this. */
  horizonScreenFraction: number;
  /** How far away (metres of real terrain) the horizon line should be. The compression length is derived from this. */
  horizonDistanceM: number;
  curveExponent: number;
  drama: number;
  backwardWeight: number;
  /**
   * How strongly far terrain gathers toward a vanishing point, 0..1: the lateral
   * convergence distance is camera height / value (0 = off, far terrain keeps its
   * true sideways offsets and sweeps past when turning; 1 ≈ a normal camera).
   */
  lateralConvergence: number;
  /** Apply physical earth curvature (true) or keep the unbent world flat (false). */
  physicalCurvature: boolean;
}

/** Camera composition needed to derive the radius from the horizon position. */
export interface ViewComposition {
  /** Where the user point sits on screen, fraction of viewport height from the bottom (negative = below the edge). */
  userPointScreenFraction: number;
  /** Vertical field of view, degrees. */
  fovDeg: number;
}

export const DEFAULT_THETA_MAX = Math.PI * 0.95;
/** Smallest radius we allow, as a fraction of camera height (keeps the bend from collapsing into a crease). */
export const MIN_RADIUS_FRACTION = 0.02;

/** Forward offset of the camera target that puts the user point at `fraction` of the screen height. */
export function lookAheadForComposition(cameraHeightM: number, view: ViewComposition): number {
  const halfHeight = cameraHeightM * Math.tan((view.fovDeg * Math.PI) / 360);
  return (0.5 - view.userPointScreenFraction) * 2 * halfHeight;
}

/**
 * Cylinder radius that places the horizon (θ = 90°, forward = flat + T + R, depth = h + R)
 * at `horizonScreenFraction` for a camera at height h looking straight down at `lookAhead`.
 * Solves 0.5 + (flat + T + R − t) / (2 (h + R) tan(fov/2)) = horizonScreenFraction for R.
 */
export function radiusForHorizon(
  cameraHeightM: number,
  flatM: number,
  transitionM: number,
  lookAheadM: number,
  horizonScreenFraction: number,
  fovDeg: number,
): number {
  const k = (horizonScreenFraction - 0.5) * 2 * Math.tan((fovDeg * Math.PI) / 360);
  const minR = MIN_RADIUS_FRACTION * cameraHeightM;
  if (k >= 1) return minR; // asymptote: cannot place the horizon that high with a straight-down camera
  const r = (lookAheadM + k * cameraHeightM - flatM - transitionM) / (1 - k);
  return Math.max(minR, r);
}

/**
 * Compression length L such that the terrain at `depthM` beyond the flat/transition zone
 * lands exactly on the horizon: L · (e^{πR/(2L)} − 1) = depthM. The left side decreases
 * monotonically from ∞ (L → 0) to πR/2 (L → ∞), so bisection in log space converges fast.
 */
export function compressionForHorizon(radiusM: number, depthM: number): number {
  const arc = (Math.PI / 2) * radiusM;
  if (depthM <= arc * 1.0001) return radiusM * 1e6; // no compression can bring it closer than the arc itself
  let lo = Math.log(radiusM * 1e-4);
  let hi = Math.log(radiusM * 1e4);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const L = Math.exp(mid);
    const reach = L * (Math.exp(arc / L) - 1);
    if (reach > depthM)
      lo = mid; // too much reach → L too small
    else hi = mid;
  }
  return Math.exp((lo + hi) / 2);
}

/** Build metre-based params from the screen composition (constant while zooming). */
export function bendParamsFromView(
  cameraHeightM: number,
  fractions: BendFractions,
  view: ViewComposition,
  enabled: number = 1,
): BendParams {
  const flatM = Math.max(0, fractions.flatFraction * cameraHeightM);
  const transitionM = Math.max(0, fractions.transitionFraction * cameraHeightM);
  const lookAhead = lookAheadForComposition(cameraHeightM, view);
  const radiusM = radiusForHorizon(
    cameraHeightM,
    flatM,
    transitionM,
    lookAhead,
    fractions.horizonScreenFraction,
    view.fovDeg,
  );
  // depth into the compressed zone at the requested horizon distance: u = d − flat − T (past the knee)
  const depthM = Math.max(1, fractions.horizonDistanceM - flatM - transitionM);
  return {
    flatM,
    transitionM,
    radiusM,
    compressionM: compressionForHorizon(radiusM, depthM),
    curveExponent: Math.max(0.1, fractions.curveExponent),
    drama: fractions.drama,
    thetaMax: DEFAULT_THETA_MAX,
    backwardWeight: fractions.backwardWeight,
    lateralDistanceM: lateralDistanceFor(cameraHeightM, fractions.lateralConvergence),
    enabled,
    earthCurvature: fractions.physicalCurvature ? EARTH_CURVATURE : 0,
  };
}

/** Lateral convergence distance for a camera height and a 0..1 convergence setting (0 → ∞). */
export function lateralDistanceFor(cameraHeightM: number, lateralConvergence: number): number {
  const c = Math.min(1, Math.max(0, lateralConvergence));
  return c <= 0 ? Infinity : cameraHeightM / c;
}

/** Sideways scale at compressed depth u: 1 / (1 + u / P). 1 when P is infinite. */
export function lateralScale(u: number, lateralDistanceM: number): number {
  if (!(lateralDistanceM < Infinity) || lateralDistanceM <= 0) return 1;
  return 1 / (1 + u / lateralDistanceM);
}

/** Smooth max(v, 0) with a quadratic knee of half-width w. C¹. */
export function softKnee(v: number, w: number): number {
  if (w <= 0) return Math.max(v, 0);
  if (v <= -w) return 0;
  if (v >= w) return v;
  return ((v + w) * (v + w)) / (4 * w);
}

/** d/dv of softKnee. */
export function softKneeDerivative(v: number, w: number): number {
  if (w <= 0) return v > 0 ? 1 : 0;
  if (v <= -w) return 0;
  if (v >= w) return 1;
  return (v + w) / (2 * w);
}

/** Inverse of softKnee for u ≥ 0 (returns the smallest v with softKnee(v) = u). */
export function unsoftKnee(u: number, w: number): number {
  if (u <= 0) return -w;
  if (w <= 0 || u >= w) return u;
  return 2 * Math.sqrt(u * w) - w;
}

/** How far a forward distance d reaches into the compressed zone (0 inside the flat zone). */
export function compressedDepth(d: number, p: BendParams): number {
  return softKnee(d - p.flatM - p.transitionM, p.transitionM);
}

/** Remapped forward distance f(d): true scale near, logarithmic far. C². */
export function remapDistance(d: number, p: BendParams): number {
  const u = compressedDepth(d, p);
  return d - u + p.compressionM * Math.log(1 + u / p.compressionM);
}

/** f'(d): 1 in the flat zone, easing down to L / (L + u) in the compressed zone. */
export function remapDerivative(d: number, p: BendParams): number {
  const u = compressedDepth(d, p);
  const du = softKneeDerivative(d - p.flatM - p.transitionM, p.transitionM);
  return 1 - (du * u) / (p.compressionM + u);
}

/** Arc length on the cylinder for a compressed depth u. */
export function arcLength(u: number, p: BendParams): number {
  return p.compressionM * Math.log(1 + u / p.compressionM);
}

/** Inverse of arcLength. */
export function depthForArc(a: number, p: BendParams): number {
  return p.compressionM * (Math.exp(a / p.compressionM) - 1);
}

/** Angle around the cylinder for an arc length a, with the art-directed profile. */
export function bendAngle(a: number, p: BendParams): number {
  const quarter = (Math.PI / 2) * p.radiusM; // arc length that reaches the horizon
  let theta: number;
  if (a >= quarter) {
    theta = Math.PI / 2 + (a - quarter) / p.radiusM;
  } else if (p.curveExponent === 1) {
    theta = a / p.radiusM;
  } else {
    theta = (Math.PI / 2) * Math.pow(a / quarter, p.curveExponent);
  }
  return Math.min(theta, p.thetaMax);
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
  // physical curvature: the world falls away from the viewer's tangent plane
  if (p.earthCurvature > 0) y -= (x * x + z * z) * p.earthCurvature;

  const sign = z < 0 ? 1 : z > 0 ? -1 : 0; // +1 = in front of the user
  const weight = (sign >= 0 ? 1 : p.backwardWeight) * p.enabled;
  if (weight <= 0 || sign === 0) return { x, y, z, theta: 0 };

  const d = Math.abs(z);
  const v = d - p.flatM - p.transitionM;
  const u = softKnee(v, p.transitionM);
  if (u <= 0) return { x, y, z, theta: 0 };

  const base = d - u;
  const a = arcLength(u, p);
  const theta = bendAngle(a, p);
  const fPrime = 1 - (softKneeDerivative(v, p.transitionM) * u) / (p.compressionM + u);
  const yEff = y * Math.pow(Math.max(fPrime, 1e-6), p.drama);
  const rr = p.radiusM + yEff;

  const bentX = x * lateralScale(u, p.lateralDistanceM);
  const bentY = rr * Math.cos(theta) - p.radiusM;
  const bentZ = -(base + rr * Math.sin(theta)) * sign;

  if (weight >= 1) return { x: bentX, y: bentY, z: bentZ, theta };
  return {
    x: x + (bentX - x) * weight,
    y: y + (bentY - y) * weight,
    z: z + (bentZ - z) * weight,
    theta: theta * weight,
  };
}

/** Forward distance (metres, unremapped) that lands exactly on the horizon (θ = 90°). */
export function horizonDistance(p: BendParams): number {
  const quarter = (Math.PI / 2) * p.radiusM;
  const u = depthForArc(quarter, p);
  return p.flatM + p.transitionM + unsoftKnee(u, p.transitionM);
}

/**
 * Where a ground point at forward distance d ends up on screen, as a fraction of the
 * viewport height from the bottom, for a camera at height h looking straight down at a
 * target `lookAheadM` in front of the origin with the given vertical field of view.
 */
/**
 * Inverse of screenFractionOfGround: the unbent forward distance (metres) of the ground
 * point that appears at `fraction` of the screen height, found by bisection between the
 * user point and the horizon (the mapping is monotone up to the horizon). Returns 0 when the
 * fraction lies below the user point and the horizon distance when it lies above the horizon.
 */
export function groundDistanceAtScreenFraction(
  fraction: number,
  p: BendParams,
  cameraHeightM: number,
  lookAheadM: number,
  fovDeg: number,
): number {
  const at = (d: number) => screenFractionOfGround(d, p, cameraHeightM, lookAheadM, fovDeg);
  let lo = 0;
  let hi = p.enabled > 0 ? horizonDistance(p) : cameraHeightM * 50;
  if (at(lo) >= fraction) return 0;
  if (at(hi) <= fraction) return hi;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < fraction) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

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
