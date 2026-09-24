import { describe, expect, it } from "vitest";
import { heightFromSupply } from "./onchain.js";

describe("heightFromSupply", () => {
  it("counts 50 BTC blocks in the first era", () => {
    expect(heightFromSupply(50)).toBe(1);
    expect(heightFromSupply(50 * 1_000)).toBe(1_000);
  });

  it("crosses every halving", () => {
    expect(heightFromSupply(210_000 * 50)).toBe(210_000);
    expect(heightFromSupply(210_000 * 50 + 25)).toBe(210_001);
    // 840,000 blocks issue 19,687,500 BTC; the fourth era pays 3.125 per block.
    expect(heightFromSupply(19_687_500)).toBe(840_000);
    expect(heightFromSupply(19_687_500 + 3.125 * 128_241)).toBe(968_241);
  });

  it("absorbs the few coins early blocks left unclaimed", () => {
    expect(heightFromSupply(19_687_500 + 3.125 * 1_000 - 0.5)).toBe(841_000);
  });
});
