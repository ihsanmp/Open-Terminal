import { describe, expect, it } from "vitest";
import { COMMODITY_GROUPS, CONTRACTS, futuresTickers } from "./futures.js";

describe("the futures list", () => {
  it("names each contract once, each a continuous front month", () => {
    const codes = CONTRACTS.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of CONTRACTS) expect(c.tv).toMatch(/^[A-Z_]+:[A-Z0-9]+1!$/);
  });

  it("keeps the charts' earlier contracts where they were", () => {
    const before: Record<string, string> = {
      ES: "CME_MINI:ES1!", NQ: "CME_MINI:NQ1!", RTY: "CME_MINI:RTY1!", YM: "CBOT_MINI:YM1!",
      GC: "COMEX:GC1!", SI: "COMEX:SI1!", HG: "COMEX:HG1!", PL: "NYMEX:PL1!", PA: "NYMEX:PA1!",
      CL: "NYMEX:CL1!", NG: "NYMEX:NG1!", RB: "NYMEX:RB1!", HO: "NYMEX:HO1!", BZ: "NYMEX:BB1!",
      ZC: "CBOT:ZC1!", ZW: "CBOT:ZW1!", ZS: "CBOT:ZS1!", ZN: "CBOT:ZN1!", ZB: "CBOT:ZB1!", ZF: "CBOT:ZF1!",
      KC: "ICEUS:KC1!", SB: "ICEUS:SB1!", CC: "ICEUS:CC1!", CT: "ICEUS:CT1!",
      "6E": "CME:6E1!", "6J": "CME:6J1!", "6B": "CME:6B1!", BTC: "CME:BTC1!",
    };
    for (const [code, tv] of Object.entries(before)) expect(futuresTickers(`${code}=F`), code).toEqual([tv]);
  });

  it("finds a symbol's contract, and nothing for an unknown one or a non-futures symbol", () => {
    expect(futuresTickers("fcpo=f")).toEqual(["MYX:FCPO1!"]);
    expect(futuresTickers("XYZ=F")).toBeNull();
    expect(futuresTickers("EURUSD=X")).toBeNull();
    expect(futuresTickers("GC")).toBeNull();
  });

  it("splits commodities from financial futures", () => {
    const groupOf = (code: string) => CONTRACTS.find((c) => c.code === code)!.group;
    for (const code of ["CL", "GC", "ZC", "KC", "FCPO", "LE"]) expect(COMMODITY_GROUPS).toContain(groupOf(code));
    for (const code of ["ES", "ZN", "6E", "BTC"]) expect(COMMODITY_GROUPS).not.toContain(groupOf(code));
  });
});
