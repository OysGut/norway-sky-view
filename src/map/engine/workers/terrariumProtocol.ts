// LOCKED: engine code — modify only on explicit engine tasks.
//
// Message protocol between the main thread and terrariumDecode.worker.ts.

import type { TerrainMesh } from "../terrainLOD/mesher";

export const TERRARIUM_TILE_URL =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

export function terrariumTileUrl(z: number, x: number, y: number): string {
  return TERRARIUM_TILE_URL.replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

/** Decode one tile and return its heights (used by the elevation spike / picking). */
export interface DecodeRequest {
  type: "decode";
  id: string;
  z: number;
  x: number;
  y: number;
  /** Debug: synthetic hills instead of fetched heights. */
  synthetic?: boolean;
}

/** Fetch (or read from cache), decode and mesh one tile. */
export interface MeshRequest {
  type: "mesh";
  id: string;
  z: number;
  x: number;
  y: number;
  /** Ground extent of the tile in metres (computed by the caller in its ENU frame). */
  widthM: number;
  depthM: number;
  segments: number;
  skirtDepth: number;
  hole?: { u0: number; v0: number; u1: number; v1: number } | undefined;
  /** Debug: generate deterministic synthetic hills instead of fetching (offline testing). */
  synthetic?: boolean;
}

export interface DecodedTile {
  z: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Row-major heights in metres, one per pixel. */
  heights: Float32Array;
  fetchMs: number;
  decodeMs: number;
  bytes: number;
  /** true when the heights came from the IndexedDB cache */
  cached: boolean;
}

export interface DecodeSuccess extends DecodedTile {
  type: "decoded";
  id: string;
}

export interface MeshSuccess {
  type: "meshed";
  id: string;
  z: number;
  x: number;
  y: number;
  mesh: TerrainMesh;
  fetchMs: number;
  decodeMs: number;
  meshMs: number;
  cached: boolean;
}

export interface DecodeFailure {
  type: "error";
  id: string;
  error: string;
}

export type WorkerRequest = DecodeRequest | MeshRequest;
export type WorkerResponse = DecodeSuccess | MeshSuccess | DecodeFailure;
