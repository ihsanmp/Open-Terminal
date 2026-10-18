import { describe, expect, it } from "vitest";
import { benchmarks, normalize, type TDSecurity } from "./treasurydirect.js";

const sec = (p: Partial<TDSecurity>): TDSecurity => ({
  cusip: "X",
  securityType: "Note",
  securityTerm: "2-Year",
  auctionDate: "2026-09-22T00:00:00",
  issueDate: "2026-09-30T00:00:00",
  maturityDate: "2028-09-30T00:00:00",
  tips: "No",
  floatingRate: "No",
  ...p,
});

describe("Treasury benchmarks", () => {
  it("takes each tenor's last auction, a reopening included, and its next one", () => {
    const auctioned = [
      sec({ cusip: "10Y-NEW", securityTerm: "10-Year", originalSecurityTerm: "10-Year", auctionDate: "2026-08-12T00:00:00", maturityDate: "2036-08-15T00:00:00", interestRate: "4.625000", highYield: "4.6830" }),
      sec({ cusip: "10Y-NEW", securityTerm: "9-Year 10-Month", originalSecurityTerm: "10-Year", reopening: "Yes", auctionDate: "2026-10-07T00:00:00", issueDate: "2026-10-15T00:00:00", maturityDate: "2036-08-15T00:00:00", interestRate: "4.625000", highYield: "5.3000", bidToCoverRatio: "2.77" }),
      sec({ cusip: "2Y", originalSecurityTerm: "2-Year", interestRate: "4.750000", highYield: "4.7870" }),
      // A 5-year reopened as a 2-year is not the 2-year benchmark; TIPS aren't either.
      sec({ cusip: "OLD5Y", securityTerm: "2-Year", originalSecurityTerm: "5-Year", reopening: "Yes", auctionDate: "2026-09-29T00:00:00" }),
      sec({ cusip: "TIPS", securityTerm: "10-Year", originalSecurityTerm: "10-Year", tips: "Yes", auctionDate: "2026-09-30T00:00:00" }),
      // A 13-week bill can be a reopened 26-week one.
      sec({ cusip: "B13", securityType: "Bill", securityTerm: "13-Week", originalSecurityTerm: "26-Week", reopening: "Yes", auctionDate: "2026-10-05T00:00:00", maturityDate: "2027-01-07T00:00:00", highInvestmentRate: "4.1" }),
    ];
    const upcoming = [sec({ cusip: "", securityTerm: "2-Year", originalSecurityTerm: "2-Year", auctionDate: "2026-10-27T00:00:00", issueDate: "2026-11-02T00:00:00", maturityDate: "2028-10-31T00:00:00" })];
    const b = benchmarks(auctioned, upcoming);
    expect(b.map((x) => x.tenor)).toEqual(["3M", "2Y", "10Y"]);
    const ten = b.find((x) => x.tenor === "10Y")!;
    expect(ten).toMatchObject({ cusip: "10Y-NEW", maturityDate: "2036-08-15", coupon: 4.625, auctionYield: 5.3, bidToCover: 2.77, reopening: true, next: null });
    const two = b.find((x) => x.tenor === "2Y")!;
    expect(two).toMatchObject({ cusip: "2Y", maturityDate: "2028-09-30", coupon: 4.75 });
    expect(two.next).toEqual({ auctionDate: "2026-10-27", issueDate: "2026-11-02", maturityDate: "2028-10-31", reopening: false });
    expect(b.find((x) => x.tenor === "3M")).toMatchObject({ cusip: "B13", coupon: null, auctionYield: 4.1, maturityDate: "2027-01-07" });
  });
});

describe("TreasuryDirect's replies since October 2026", () => {
  it("reads the auction's date from its close when auctionDate is gone, and nulls as blanks", () => {
    const strip = (s: TDSecurity) => ({ ...s, auctionDate: undefined as unknown as string });
    const auctioned = [
      strip(sec({ cusip: "2Y-OLD", competitiveAuctionCloseDate: "2026-08-26T00:00:00", issueDate: "2026-08-31T00:00:00" })),
      strip(sec({ cusip: "2Y-NEW", competitiveAuctionCloseDate: "2026-09-24T00:00:00" })),
    ].map(normalize);
    const upcoming = [strip(sec({ cusip: "", competitiveAuctionCloseDate: "2026-10-27T00:00:00", issueDate: "2026-11-02T00:00:00", maturityDate: null as unknown as string }))].map(normalize);
    const [b] = benchmarks(auctioned, upcoming);
    expect(b.cusip).toBe("2Y-NEW");
    expect(b.auctionDate).toBe("2026-09-24");
    expect(b.next).toEqual({ auctionDate: "2026-10-27", issueDate: "2026-11-02", maturityDate: "", reopening: false });
  });

  it("tells TIPS by their type and reads a bill's rate from investmentRate", () => {
    const now = (p: Partial<TDSecurity>) => normalize({ ...sec(p), tips: undefined, floatingRate: undefined });
    const auctioned = [
      now({ cusip: "5Y", securityTerm: "5-Year", originalSecurityTerm: "5-Year", maturityDate: "2031-09-30T00:00:00", type: "Note" }),
      now({ cusip: "B13", securityType: "Bill", securityTerm: "13-Week", type: "Bill", maturityDate: "2027-01-07T00:00:00", investmentRate: "4.068" }),
    ];
    const upcoming = [
      now({ cusip: "", securityTerm: "5-Year", originalSecurityTerm: "5-Year", type: "TIPS", auctionDate: "2026-10-22T00:00:00", issueDate: "2026-10-30T00:00:00", maturityDate: "2031-10-15T00:00:00" }),
      now({ cusip: "", securityTerm: "5-Year", originalSecurityTerm: "5-Year", type: "Note", auctionDate: "2026-10-28T00:00:00", issueDate: "2026-10-31T00:00:00", maturityDate: "2031-10-31T00:00:00" }),
    ];
    const b = benchmarks(auctioned, upcoming);
    expect(b.find((x) => x.tenor === "3M")?.auctionYield).toBe(4.068);
    expect(b.find((x) => x.tenor === "5Y")?.next?.auctionDate).toBe("2026-10-28");
  });
});
