// LOCKED: engine code — modify only on explicit engine tasks.
//
// Web Worker: fetch a Terrarium PNG tile, rasterise it with OffscreenCanvas and
// decode it into a Float32Array of metres. The heights buffer is transferred
// (not copied) back to the main thread.

import { decodeTerrarium } from "../terrain/terrarium";
import {
  terrariumTileUrl,
  type DecodeRequest,
  type WorkerRequest,
  type WorkerResponse,
} from "./terrariumProtocol";

// The DOM lib types `self` as a Window; narrow to what a worker actually offers.
interface WorkerScope {
  postMessage(message: WorkerResponse, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void): void;
}

const scope = self as unknown as WorkerScope;

async function decodeTile(request: DecodeRequest): Promise<WorkerResponse> {
  const { id, z, x, y } = request;
  const url = terrariumTileUrl(z, x, y);

  const fetchStart = performance.now();
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) {
    return { type: "error", id, error: `HTTP ${response.status} for ${z}/${x}/${y}` };
  }
  const blob = await response.blob();
  const fetchMs = performance.now() - fetchStart;

  const decodeStart = performance.now();
  const bitmap = await createImageBitmap(blob, {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    return { type: "error", id, error: "OffscreenCanvas 2D context unavailable" };
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = context.getImageData(0, 0, width, height).data;
  const heights = decodeTerrarium(rgba, width, height);
  const decodeMs = performance.now() - decodeStart;

  return {
    type: "decoded",
    id,
    z,
    x,
    y,
    width,
    height,
    heights,
    fetchMs: Math.round(fetchMs * 10) / 10,
    decodeMs: Math.round(decodeMs * 10) / 10,
    bytes: blob.size,
  };
}

scope.addEventListener("message", (event) => {
  const request = event.data;
  if (request.type !== "decode") return;

  void decodeTile(request)
    .catch((error: unknown): WorkerResponse => ({
      type: "error",
      id: request.id,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }))
    .then((response) => {
      const transfer: Transferable[] = response.type === "decoded" ? [response.heights.buffer] : [];
      scope.postMessage(response, transfer);
    });
});
