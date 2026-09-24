// LOCKED: engine code — modify only on explicit engine tasks.
//
// Main-thread client for terrariumDecode.worker.ts. Runs a small pool of
// workers and matches replies to requests by id. Client-side only.

import type {
  DecodedTile,
  MeshRequest,
  MeshSuccess,
  WorkerRequest,
  WorkerResponse,
} from "./terrariumProtocol";

interface Pending {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
}

/** One worker per spare core, between 2 and 4. */
const POOL_SIZE =
  typeof navigator !== "undefined" && navigator.hardwareConcurrency
    ? Math.max(2, Math.min(4, navigator.hardwareConcurrency - 2))
    : 3;
const workers: Worker[] = [];
let nextWorker = 0;
let nextId = 0;
const pending = new Map<string, Pending>();

function createWorker(): Worker {
  const worker = new Worker(new URL("./terrariumDecode.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.type === "error") entry.reject(new Error(message.error));
    else entry.resolve(message);
  });
  worker.addEventListener("error", (event) => {
    const error = new Error(`terrarium worker crashed: ${event.message}`);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  });
  return worker;
}

/** Stable small hash of a tile key, so one tile always lands on the same worker. */
function affinity(z: number, x: number, y: number): number {
  let h = (z * 73856093) ^ (x * 19349663) ^ (y * 83492791);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

function pickWorker(tile?: { z: number; x: number; y: number }): Worker {
  if (typeof window === "undefined") {
    throw new Error("terrariumClient is client-side only");
  }
  while (workers.length < POOL_SIZE) workers.push(createWorker());
  // Each worker keeps recently decoded tiles in memory; sending every request for a
  // tile (its re-meshes with a new rim or hole included) to the same worker makes
  // those re-meshes memory hits.
  const index = tile ? affinity(tile.z, tile.x, tile.y) : nextWorker++;
  const w = workers[index % workers.length];
  if (!w) throw new Error("worker pool empty");
  return w;
}

function send(
  request: WorkerRequest,
  tile?: { z: number; x: number; y: number },
): Promise<WorkerResponse> {
  return new Promise<WorkerResponse>((resolve, reject) => {
    pending.set(request.id, { resolve, reject });
    pickWorker(tile).postMessage(request);
  });
}

/** Fetch and decode one Terrarium tile off the main thread. */
export async function requestTile(
  z: number,
  x: number,
  y: number,
  synthetic = false,
): Promise<DecodedTile> {
  const response = await send(
    { type: "decode", id: `d${nextId++}`, z, x, y, synthetic },
    { z, x, y },
  );
  if (response.type !== "decoded") throw new Error("unexpected worker response");
  const { type: _type, id: _id, ...tile } = response;
  return tile;
}

export type MeshResult = Omit<MeshSuccess, "type" | "id">;

/** Fetch (or read from cache), decode and mesh one tile off the main thread. */
export async function requestMesh(options: Omit<MeshRequest, "type" | "id">): Promise<MeshResult> {
  const response = await send({ type: "mesh", id: `m${nextId++}`, ...options }, options);
  if (response.type !== "meshed") throw new Error("unexpected worker response");
  const { type: _type, id: _id, ...result } = response;
  return result;
}

/** Terminate all workers (tests, hot reload). Pending requests are rejected. */
export function disposeTerrariumWorker(): void {
  for (const w of workers) w.terminate();
  workers.length = 0;
  const error = new Error("terrarium worker disposed");
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}
