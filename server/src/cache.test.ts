import { describe, expect, it } from "vitest";
import { cached, cacheGet, cacheSet } from "./cache.js";

describe("cache", () => {
  it("stores and retrieves values within TTL", () => {
    cacheSet("k1", 42, 1000);
    expect(cacheGet("k1")).toBe(42);
  });

  it("expires values after TTL", async () => {
    cacheSet("k2", "x", 1);
    await new Promise((r) => setTimeout(r, 10));
    expect(cacheGet("k2")).toBeUndefined();
  });

  it("serves stale data when the loader fails after a prior success", async () => {
    let calls = 0;
    const loader = async () => {
      calls++;
      if (calls === 1) return "fresh";
      throw new Error("provider down");
    };
    expect(await cached("k3", 1, loader)).toBe("fresh");
    await new Promise((r) => setTimeout(r, 10));
    expect(await cached("k3", 1, loader)).toBe("fresh"); // stale fallback
    expect(calls).toBe(2);
  });

  it("fetches once for requests that arrive while the data is loading", async () => {
    let calls = 0;
    const slow = () => new Promise<number>((r) => setTimeout(() => r(++calls), 20));
    const results = await Promise.all(Array.from({ length: 12 }, () => cached("k5", 1000, slow)));
    expect(results).toEqual(Array(12).fill(1));
    expect(calls).toBe(1);
    expect(await cached("k5", 1000, slow)).toBe(1); // then from memory
  });

  it("propagates errors when no stale data exists", async () => {
    await expect(cached("k4", 1000, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });
});
