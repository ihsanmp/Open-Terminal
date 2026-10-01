import { existsSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dataDir } from "./db.js";
import { cachedOnDisk } from "./diskcache.js";

const key = `test:diskcache:${Date.now()}`;
const file = join(dataDir, "cache", `${createHash("sha1").update(key).digest("hex")}.json`);
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterAll(() => {
  if (existsSync(file)) unlinkSync(file);
});

describe("disk cache", () => {
  it("serves the saved copy after memory has expired, then the refreshed one", async () => {
    let calls = 0;
    const fetchValue = async () => [++calls];
    expect(await cachedOnDisk(key, 50, fetchValue)).toEqual({ value: [1], fromDisk: false });
    await tick(80); // written to disk; expired from memory, as after a restart
    expect(await cachedOnDisk(key, 50, fetchValue)).toEqual({ value: [1], fromDisk: true });
    await tick(5); // the background refresh has landed
    expect(await cachedOnDisk(key, 50, fetchValue)).toEqual({ value: [2], fromDisk: false });
    expect(calls).toBe(2);
  });

  it("doesn't serve a saved copy it was told is unusable", async () => {
    const k = `${key}:empty`;
    await cachedOnDisk(k, 1, async () => [] as number[]);
    await tick(20);
    const r = await cachedOnDisk(k, 1, async () => [7], (v) => v.length > 0);
    expect(r).toEqual({ value: [7], fromDisk: false });
    const f = join(dataDir, "cache", `${createHash("sha1").update(k).digest("hex")}.json`);
    await tick(20);
    if (existsSync(f)) unlinkSync(f);
  });
});
