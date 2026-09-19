// LOCKED: engine code — modify only on explicit engine tasks.
//
// Message protocol between the main thread and terrariumDecode.worker.ts.

export const TERRARIUM_TILE_URL =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

export function terrariumTileUrl(z: number, x: number, y: number): string {
  return TERRARIUM_TILE_URL.replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

export interface DecodeRequest {
  type: "decode";
  id: string;
  z: number;
  x: number;
  y: number;
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
}

export interface DecodeSuccess extends DecodedTile {
  type: "decoded";
  id: string;
}

export interface DecodeFailure {
  type: "error";
  id: string;
  error: string;
}

export type WorkerRequest = DecodeRequest;
export type WorkerResponse = DecodeSuccess | DecodeFailure;
