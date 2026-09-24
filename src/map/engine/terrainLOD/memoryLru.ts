// LOCKED: engine code — modify only on explicit engine tasks.
//
// Small in-memory LRU with in-flight de-duplication, used by the terrain worker
// in front of the IndexedDB tile cache. A re-mesh of a tile whose rim or hole
// changed (which happens to most tiles near the user every time the rings move
// one tile) then reads its heights — and its neighbours' — from memory in
// microseconds instead of going through IndexedDB, and two requests for the
// same tile at the same time share one fetch.

export class MemoryLru<V> {
  private readonly entries = new Map<string, V>();
  private readonly pending = new Map<string, Promise<V>>();
  hits = 0;
  misses = 0;

  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new Error("MemoryLru capacity must be at least 1");
  }

  get size(): number {
    return this.entries.size;
  }

  /** The cached value, refreshed as most recently used; undefined on a miss. */
  peek(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /**
   * Value for `key` from memory, or from `load` (called at most once per key while
   * a load is in flight). Failed loads are not cached, so the next call retries.
   */
  getOrLoad(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.peek(key);
    if (hit !== undefined) {
      this.hits++;
      return Promise.resolve(hit);
    }
    const inFlight = this.pending.get(key);
    if (inFlight) {
      this.hits++;
      return inFlight;
    }
    this.misses++;
    const promise = load().then(
      (value) => {
        this.pending.delete(key);
        this.set(key, value);
        return value;
      },
      (error: unknown) => {
        this.pending.delete(key);
        throw error;
      },
    );
    this.pending.set(key, promise);
    return promise;
  }
}
