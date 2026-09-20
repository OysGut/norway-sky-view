// Pure helpers for pointer navigation: where a pointer ray hits the local ground
// plane, and how a drag in scene space translates into an ENU move of the user
// point. Scene frame: x right, y up, z toward the viewer; the world root is
// rotated by heading, so scene -z is the heading direction.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Intersection of the ray (origin + t·dir, t > 0) with the plane y = 0, or null when
 * the ray points away from the plane or the hit lies farther than `maxDistance` from
 * the plane origin (dragging near the horizon would otherwise make huge jumps).
 */
export function groundHit(origin: Vec3, dir: Vec3, maxDistance: number): Vec3 | null {
  if (dir.y >= -1e-9) return null;
  const t = -origin.y / dir.y;
  if (t <= 0) return null;
  const hit = { x: origin.x + dir.x * t, y: 0, z: origin.z + dir.z * t };
  if (Math.hypot(hit.x, hit.z) > maxDistance) return null;
  return hit;
}

/** A scene-space ground delta (x right, z toward viewer) as an ENU offset for a given heading. */
export function sceneDeltaToEnu(
  dx: number,
  dz: number,
  headingDeg: number,
): { east: number; north: number } {
  const h = (headingDeg * Math.PI) / 180;
  // forward (scene -z) in ENU is (sin h, cos h); right (scene +x) is (cos h, -sin h)
  const forward = -dz;
  return {
    east: Math.cos(h) * dx + Math.sin(h) * forward,
    north: -Math.sin(h) * dx + Math.cos(h) * forward,
  };
}

/** Pixel → normalised device coordinates for a pointer inside an element of size w × h. */
export function toNdc(
  px: number,
  py: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return { x: (px / width) * 2 - 1, y: -(py / height) * 2 + 1 };
}
