import { describe, expect, it } from "vitest";
import { KOL_ACCOUNTS, kolOf } from "./kol-list";

describe("the listed market accounts", () => {
  it("are found by their X handle, whatever its case", () => {
    expect(kolOf("deitaone")?.name).toBe("Walter Bloomberg");
    expect(kolOf("DeItaone")?.note).toContain("tarif palsu");
    expect(kolOf("nobody_here")).toBeUndefined();
    expect(kolOf("bitcoinmagazine")?.name).toBe("Bitcoin Magazine");
    expect(kolOf("EricBalchunas")?.category).toBe("ETF & institusi");
  });

  it("include the OG sheet, and give an account on both sheets both notes", () => {
    expect(kolOf("IOHK_Charles")).toMatchObject({ market: "OG Crypto", og: { since: "2011" } });
    expect(kolOf("IOHK_Charles")?.note).toContain("ADA");
    const cz = kolOf("cz_binance")!;
    expect(cz.market).toBe("Crypto / Web3");
    expect(cz.og?.group).toBe("Pendiri exchange & infrastruktur");
    expect(cz.note).toContain("BNB chain");
    expect(cz.note).toContain("diampuni");
    expect(KOL_ACCOUNTS.filter((a) => a.handle?.toLowerCase() === "cz_binance")).toHaveLength(1);
  });

  it("name each followed account's source once, and don't follow the news outlets", () => {
    const via = KOL_ACCOUNTS.flatMap((a) => (a.followedVia ? [a.followedVia] : []));
    expect(new Set(via).size).toBe(via.length);
    for (const v of via) expect(v).toMatch(/^(bluesky|telegram|truthsocial):[a-z0-9._-]+$/);
    expect(KOL_ACCOUNTS.some((a) => a.media && a.followedVia)).toBe(false);
  });
});
