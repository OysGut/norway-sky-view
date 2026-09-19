// LOCKED: engine code — modify only on explicit engine tasks.
//
// Main-thread client for terrariumDecode.worker.ts. Lazily creates one worker
// and matches replies to requests by id. Client-side only.

import type { DecodedTile, WorkerRequest, WorkerResponse } from "./terrariumProtocol";

interface Pending {
  resolve: (tile: DecodedTile) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<string, Pending>();

function getWorker(): Worker {
  if (typeof window === "undefined") {
    throw new Error("terrariumClient is client-side only");
  }
  if (worker) return worker;

  worker = new Worker(new URL("./terrariumDecode.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.type === "decoded") {
      const { type: _type, id: _id, ...tile } = message;
      entry.resolve(tile);
    } else {
      entry.reject(new Error(message.error));
    }
  });
  worker.addEventListener("error", (event) => {
    const error = new Error(`terrarium worker crashed: ${event.message}`);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

/** Fetch and decode one Terrarium tile off the main thread. */
export function requestTile(z: number, x: number, y: number): Promise<DecodedTile> {
  const id = `t${nextId++}`;
  const request: WorkerRequest = { type: "decode", id, z, x, y };
  return new Promise<DecodedTile>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage(request);
  });
}

/** Terminate the worker (tests, hot reload). Pending requests are rejected. */
export function disposeTerrariumWorker(): void {
  if (!worker) return;
  worker.terminate();
  worker = null;
  const error = new Error("terrarium worker disposed");
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}
