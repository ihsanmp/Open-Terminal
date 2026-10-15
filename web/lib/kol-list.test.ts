import { describe, expect, it } from "vitest";
import { KOL_ACCOUNTS, kolOf } from "./kol-list";

describe("the listed market accounts", () => {
  it("are found by their X handle, whatever its case", () => {
    expect(kolOf("deitaone")?.name).toBe("Walter Bloomberg");
    expect(kolOf("DeItaone")?.note).toContain("tarif palsu");
    expect(kolOf("nobody_here")).toBeUndefined();
  });

  it("name each followed account's source once, and don't follow the news outlets", () => {
    const via = KOL_ACCOUNTS.flatMap((a) => (a.followedVia ? [a.followedVia] : []));
    expect(new Set(via).size).toBe(via.length);
    for (const v of via) expect(v).toMatch(/^(bluesky|telegram|truthsocial):[a-z0-9._-]+$/);
    expect(KOL_ACCOUNTS.some((a) => a.media && a.followedVia)).toBe(false);
  });
});
