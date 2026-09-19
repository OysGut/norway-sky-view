// LOCKED: engine code — modify only on explicit engine tasks.
import { describe, expect, it } from "vitest";

import { MemoryTileCacheBackend, TILE_CACHE_VERSION, TileCache, tileCacheKey } from "./tileCache";

function heights(v: number): Float32Array {
  return new Float32Array([v, v, v, v]);
}

describe("TileCache", () => {
  it("keys include the version", () => {
    expect(tileCacheKey({ z: 12, x: 2142, y: 1151 })).toBe(`${TILE_CACHE_VERSION}/12/2142/1151`);
  });

  it("stores and returns tiles", async () => {
    const cache = new TileCache({ backend: new MemoryTileCacheBackend(), maxEntries: 10 });
    await cache.put({ z: 12, x: 1, y: 2 }, 2, 2, heights(7));
    const got = await cache.get({ z: 12, x: 1, y: 2 });
    expect(got?.width).toBe(2);
    expect(got && Array.from(got.heights)).toEqual([7, 7, 7, 7]);
    expect(await cache.get({ z: 12, x: 9, y: 9 })).toBeUndefined();
  });

  it("trims the least recently used entries beyond maxEntries", async () => {
    let t = 0;
    const cache = new TileCache({
      backend: new MemoryTileCacheBackend(),
      maxEntries: 3,
      now: () => ++t,
    });
    for (let i = 0; i < 5; i++) await cache.put({ z: 1, x: i, y: 0 }, 2, 2, heights(i));
    await cache.trim();
    expect(await cache.count()).toBe(3);
    expect(await cache.get({ z: 1, x: 0, y: 0 })).toBeUndefined();
    expect(await cache.get({ z: 1, x: 1, y: 0 })).toBeUndefined();
    expect((await cache.get({ z: 1, x: 4, y: 0 }))?.heights[0]).toBe(4);
  });

  it("reading refreshes recency so hot tiles survive trimming", async () => {
    let t = 0;
    const cache = new TileCache({
      backend: new MemoryTileCacheBackend(),
      maxEntries: 2,
      now: () => ++t,
    });
    await cache.put({ z: 1, x: 0, y: 0 }, 2, 2, heights(0));
    await cache.put({ z: 1, x: 1, y: 0 }, 2, 2, heights(1));
    await cache.get({ z: 1, x: 0, y: 0 }); // touch the oldest
    await cache.put({ z: 1, x: 2, y: 0 }, 2, 2, heights(2));
    await cache.trim();
    expect((await cache.get({ z: 1, x: 0, y: 0 }))?.heights[0]).toBe(0);
    expect(await cache.get({ z: 1, x: 1, y: 0 })).toBeUndefined();
  });

  it("swallows backend errors", async () => {
    const broken = new MemoryTileCacheBackend();
    broken.get = () => Promise.reject(new Error("boom"));
    const cache = new TileCache({ backend: broken });
    expect(await cache.get({ z: 1, x: 0, y: 0 })).toBeUndefined();
    expect(cache.errors).toBe(1);
  });
});
