import { describe, expect, it, vi } from "vitest";

import { MemoryLru } from "./memoryLru";

describe("MemoryLru", () => {
  it("evicts the least recently used entry beyond capacity", () => {
    const lru = new MemoryLru<number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    expect(lru.peek("a")).toBe(1); // a is now most recent
    lru.set("c", 3);
    expect(lru.peek("b")).toBeUndefined();
    expect(lru.peek("a")).toBe(1);
    expect(lru.peek("c")).toBe(3);
    expect(lru.size).toBe(2);
  });

  it("loads once per key and serves repeats from memory", async () => {
    const lru = new MemoryLru<string>(4);
    const load = vi.fn(() => Promise.resolve("v"));
    const [a, b] = await Promise.all([lru.getOrLoad("k", load), lru.getOrLoad("k", load)]);
    expect(a).toBe("v");
    expect(b).toBe("v");
    await lru.getOrLoad("k", load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(lru.misses).toBe(1);
    expect(lru.hits).toBe(2);
  });

  it("does not cache failures", async () => {
    const lru = new MemoryLru<string>(4);
    await expect(lru.getOrLoad("k", () => Promise.reject(new Error("net")))).rejects.toThrow("net");
    await expect(lru.getOrLoad("k", () => Promise.resolve("ok"))).resolves.toBe("ok");
  });
});
