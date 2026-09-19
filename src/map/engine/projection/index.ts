// LOCKED: engine code — modify only on explicit engine tasks.
//
// Web Mercator (EPSG:3857) tile addressing and a local ENU frame.
//
// Conventions (see Knowledge "Architecture decisions"):
//   • WGS84 lon/lat in degrees at every API boundary.
//   • EPSG:3857 is used ONLY to address tiles (z/x/y). Never for scene geometry.
//   • Inside the scene we use a local East-North-Up frame in metres around an
//     origin point. Scene axes: x = east, y = up, z = -north (three.js right-handed).
//
// Everything here is pure and side-effect free so it can run in workers.

export const TILE_SIZE = 256;
export const EARTH_RADIUS_M = 6_378_137; // WGS84 semi-major axis, used by Web Mercator
export const MAX_MERCATOR_LAT = 85.05112878;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export interface TileKey {
  z: number;
  x: number;
  y: number;
}

export interface TilePixel extends TileKey {
  /** Fractional pixel position inside the tile, 0 ≤ px, py < tileSize. */
  px: number;
  py: number;
}

export interface LonLatBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface LonLat {
  lon: number;
  lat: number;
}

export interface EnuOffset {
  /** metres east of the origin */
  east: number;
  /** metres north of the origin */
  north: number;
}

function clampLat(lat: number): number {
  return Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
}

/** Continuous tile coordinates (not floored) for a lon/lat at zoom z. */
export function lonLatToTileFloat(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const latRad = clampLat(lat) * DEG2RAD;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

/** Integer tile indices containing the point. */
export function lonLatToTile(lon: number, lat: number, z: number): TileKey {
  const { x, y } = lonLatToTileFloat(lon, lat, z);
  const n = 2 ** z;
  return {
    z,
    x: Math.min(n - 1, Math.max(0, Math.floor(x))),
    y: Math.min(n - 1, Math.max(0, Math.floor(y))),
  };
}

/** Tile indices plus fractional pixel position inside that tile. */
export function lonLatToTilePixel(
  lon: number,
  lat: number,
  z: number,
  tileSize: number = TILE_SIZE,
): TilePixel {
  const { x, y } = lonLatToTileFloat(lon, lat, z);
  const tile = lonLatToTile(lon, lat, z);
  return {
    ...tile,
    px: (x - tile.x) * tileSize,
    py: (y - tile.y) * tileSize,
  };
}

/** Lon/lat of the north-west corner of a (possibly fractional) tile coordinate. */
export function tileFloatToLonLat(x: number, y: number, z: number): LonLat {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return { lon, lat: latRad * RAD2DEG };
}

export function tileToLonLatBounds(x: number, y: number, z: number): LonLatBounds {
  const nw = tileFloatToLonLat(x, y, z);
  const se = tileFloatToLonLat(x + 1, y + 1, z);
  return { west: nw.lon, north: nw.lat, east: se.lon, south: se.lat };
}

/** Ground resolution of one pixel at the given latitude and zoom, in metres. */
export function metersPerPixel(lat: number, z: number, tileSize: number = TILE_SIZE): number {
  const circumference = 2 * Math.PI * EARTH_RADIUS_M;
  return (circumference * Math.cos(clampLat(lat) * DEG2RAD)) / (tileSize * 2 ** z);
}

/** Ground size of a whole tile at the given latitude, in metres (square in Mercator). */
export function tileSizeMeters(lat: number, z: number, tileSize: number = TILE_SIZE): number {
  return metersPerPixel(lat, z, tileSize) * tileSize;
}

// ---------------------------------------------------------------------------
// Local ENU frame (equirectangular approximation around an origin).
// Accurate to well under 0.1 % within ~100 km, which is all the scene needs;
// the engine never mixes this with Mercator metres.

const METERS_PER_DEG_LAT = 111_132.954; // mean value; varies ±0.6 % with latitude

function metersPerDegLon(lat: number): number {
  return 111_412.84 * Math.cos(lat * DEG2RAD) - 93.5 * Math.cos(3 * lat * DEG2RAD);
}

export function lonLatToEnu(origin: LonLat, point: LonLat): EnuOffset {
  return {
    east: (point.lon - origin.lon) * metersPerDegLon(origin.lat),
    north: (point.lat - origin.lat) * METERS_PER_DEG_LAT,
  };
}

export function enuToLonLat(origin: LonLat, offset: EnuOffset): LonLat {
  return {
    lon: origin.lon + offset.east / metersPerDegLon(origin.lat),
    lat: origin.lat + offset.north / METERS_PER_DEG_LAT,
  };
}
