// LOCKED: engine code — modify only on explicit engine tasks.
//
// Persistent cache for decoded elevation tiles (Float32Array heights) in
// IndexedDB, with an in-memory fallback when IndexedDB is unavailable (SSR,
// tests, private mode). Entries are versioned so a change in decoding or tile
// source invalidates old data, and trimmed LRU-style by last access.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { TileKey } from "../projection";

/** Bump when the decoded format changes (source, decoder, sampling). */
export const TILE_CACHE_VERSION = 1;
const DB_NAME = "himinrond-tiles";
const STORE = "heights";
const DEFAULT_MAX_ENTRIES = 1500;

export interface CachedHeights {
  key: string;
  version: number;
  z: number;
  x: number;
  y: number;
  width: number;
  height: number;
  heights: Float32Array;
  /** ms since epoch, refreshed on read */
  lastAccess: number;
  bytes: number;
}

export function tileCacheKey(tile: TileKey): string {
  return `${TILE_CACHE_VERSION}/${tile.z}/${tile.x}/${tile.y}`;
}

export interface TileCacheBackend {
  get(key: string): Promise<CachedHeights | undefined>;
  put(entry: CachedHeights): Promise<void>;
  delete(key: string): Promise<void>;
  /** All keys with their lastAccess, cheapest listing available. */
  index(): Promise<Array<{ key: string; lastAccess: number; bytes: number }>>;
  count(): Promise<number>;
}

/** In-memory backend: used when IndexedDB is missing, and by the unit tests. */
export class MemoryTileCacheBackend implements TileCacheBackend {
  private readonly map = new Map<string, CachedHeights>();

  get(key: string): Promise<CachedHeights | undefined> {
    return Promise.resolve(this.map.get(key));
  }

  put(entry: CachedHeights): Promise<void> {
    this.map.set(entry.key, entry);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.map.delete(key);
    return Promise.resolve();
  }

  index(): Promise<Array<{ key: string; lastAccess: number; bytes: number }>> {
    return Promise.resolve(
      [...this.map.values()].map((e) => ({ key: e.key, lastAccess: e.lastAccess, bytes: e.bytes })),
    );
  }

  count(): Promise<number> {
    return Promise.resolve(this.map.size);
  }
}

interface TileDB extends DBSchema {
  heights: {
    key: string;
    value: CachedHeights;
    indexes: { byLastAccess: number };
  };
}

class IndexedDBTileCacheBackend implements TileCacheBackend {
  private db: Promise<IDBPDatabase<TileDB>>;

  constructor() {
    this.db = openDB<TileDB>(DB_NAME, TILE_CACHE_VERSION, {
      upgrade(db) {
        for (const name of db.objectStoreNames) db.deleteObjectStore(name);
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("byLastAccess", "lastAccess");
      },
    });
  }

  async get(key: string): Promise<CachedHeights | undefined> {
    return (await this.db).get(STORE, key);
  }

  async put(entry: CachedHeights): Promise<void> {
    await (await this.db).put(STORE, entry);
  }

  async delete(key: string): Promise<void> {
    await (await this.db).delete(STORE, key);
  }

  async index(): Promise<Array<{ key: string; lastAccess: number; bytes: number }>> {
    const db = await this.db;
    const out: Array<{ key: string; lastAccess: number; bytes: number }> = [];
    let cursor = await db.transaction(STORE).store.index("byLastAccess").openCursor();
    while (cursor) {
      out.push({
        key: cursor.value.key,
        lastAccess: cursor.value.lastAccess,
        bytes: cursor.value.bytes,
      });
      cursor = await cursor.continue();
    }
    return out;
  }

  async count(): Promise<number> {
    return (await this.db).count(STORE);
  }
}

export function hasIndexedDB(): boolean {
  return typeof indexedDB !== "undefined";
}

export interface TileCacheOptions {
  backend?: TileCacheBackend;
  maxEntries?: number;
  now?: () => number;
}

/**
 * Height-tile cache. `get` refreshes lastAccess; `put` trims the oldest entries
 * once the store exceeds maxEntries. All errors are swallowed (a cache must never
 * break the pipeline) and reported through `errors`.
 */
export class TileCache {
  private readonly backend: TileCacheBackend;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private trimming: Promise<void> | null = null;
  errors = 0;

  constructor(options: TileCacheOptions = {}) {
    this.backend =
      options.backend ??
      (hasIndexedDB() ? new IndexedDBTileCacheBackend() : new MemoryTileCacheBackend());
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? (() => Date.now());
  }

  async get(tile: TileKey): Promise<CachedHeights | undefined> {
    try {
      const entry = await this.backend.get(tileCacheKey(tile));
      if (!entry || entry.version !== TILE_CACHE_VERSION) return undefined;
      // refresh access time without awaiting the write
      entry.lastAccess = this.now();
      void this.backend.put(entry).catch(() => {
        this.errors++;
      });
      return entry;
    } catch {
      this.errors++;
      return undefined;
    }
  }

  async put(tile: TileKey, width: number, height: number, heights: Float32Array): Promise<void> {
    try {
      await this.backend.put({
        key: tileCacheKey(tile),
        version: TILE_CACHE_VERSION,
        z: tile.z,
        x: tile.x,
        y: tile.y,
        width,
        height,
        heights,
        lastAccess: this.now(),
        bytes: heights.byteLength,
      });
      void this.trim();
    } catch {
      this.errors++;
    }
  }

  /** Remove least-recently-used entries beyond maxEntries. Serialised. */
  trim(): Promise<void> {
    if (this.trimming) return this.trimming;
    this.trimming = (async () => {
      try {
        const count = await this.backend.count();
        if (count <= this.maxEntries) return;
        const index = await this.backend.index();
        index.sort((a, b) => a.lastAccess - b.lastAccess);
        const excess = index.slice(0, count - this.maxEntries);
        for (const e of excess) await this.backend.delete(e.key);
      } catch {
        this.errors++;
      } finally {
        this.trimming = null;
      }
    })();
    return this.trimming;
  }

  count(): Promise<number> {
    return this.backend.count();
  }
}

let shared: TileCache | null = null;

/** Process-wide cache instance (client only). */
export function getTileCache(): TileCache {
  if (!shared) shared = new TileCache();
  return shared;
}
